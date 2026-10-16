/**
 * Contact occlusion of the frame on the face (issue #88): the soft darkening
 * right under the nose pads, along the temples where they lie on the skin and
 * under the bridge. Indoor light is mostly diffuse, so this, not the cast
 * shadow of one light, is what grounds a real pair on the face.
 *
 * The frame is approximated by a cloud of small spheres fitted to its own
 * vertices (any GLB, no hand-placed proxies), and each point of the tracked
 * skin is darkened by the cosine-weighted solid angle those spheres cover
 * above it — the analytic sphere occlusion behind capsule shadows (Unreal),
 * without a shadow map. The receiver shader in TryOnScene.vue mirrors
 * `sphereOcclusion` and `contactShadowAlpha`.
 *
 * Pure math, no three.js.
 */

/** A sphere occluder: centre and radius in the GLB's local metres. */
export interface OccluderSphere {
  x: number
  y: number
  z: number
  r: number
}

/**
 * Upper bound on spheres per frame: a uniform array in the receiver shader,
 * well inside WebGL2's minimum of 224 fragment vec4 uniforms.
 */
export const MAX_OCCLUDER_SPHERES = 96

/**
 * Cell size for the frame's own parts (rims, bridge, pads, temples): about the
 * width of a temple arm, so a thin part becomes a chain of small spheres.
 */
export const FRAME_SPHERE_CELL_METERS = 0.008

/**
 * Cell size for lenses: a lens is a flat disc, so coarser spheres cover it
 * with far fewer occluders.
 */
export const LENS_SPHERE_CELL_METERS = 0.016

/** Smallest sphere radius, so a single-vertex cell still occludes a little. */
export const MIN_SPHERE_RADIUS_METERS = 0.0015

/**
 * Most light one sphere can hide, even with the skin point inside it: where a
 * temple tip pierces the face mesh behind the ear, full occlusion would draw a
 * hard black dot on the skin. Real contact is soft at this scale.
 */
export const MAX_SPHERE_OCCLUSION = 0.5

/**
 * Distance past a sphere's surface at which its occlusion has faded to zero.
 * Without it the 1/d² tails of all spheres add up to a faint haze over the
 * whole face mesh, which shows the mesh's outline on the forehead and jaw.
 * 20 mm keeps the lenses' darkening on the cheeks below them (12–15 mm away).
 */
export const OCCLUSION_RANGE_METERS = 0.02

/**
 * Cosine between skin normal and view direction below which the occlusion is
 * gone, and above which it is whole. The tracked mesh ends at the side of the
 * head, where a temple enters it; without the fade the darkening there stops
 * on the mesh's edge as a hard outline.
 */
export const SILHOUETTE_FADE_START = 0.15
export const SILHOUETTE_FADE_END = 0.45

/** Share of the occlusion kept at a skin point facing the camera by `cosView`. */
export function silhouetteFade(cosView: number): number {
  const t = Math.min(
    Math.max((cosView - SILHOUETTE_FADE_START) / (SILHOUETTE_FADE_END - SILHOUETTE_FADE_START), 0),
    1
  )
  return t * t * (3 - 2 * t)
}

/**
 * Occlusion strength per unit of contact-shadow strength: the darkest
 * contact (pads on the nose) ends at about 0.35 at the default 0.22.
 */
export const CONTACT_OCCLUSION_GAIN = 1.6

/**
 * Fit spheres to a point cloud (xyz triples, the GLB's local metres): bin the
 * points into cubic cells of `cellSize`, one sphere per occupied cell at the
 * points' centroid. The radius is the points' RMS distance from that centroid
 * (how thick the part is there), capped at half a cell and floored at
 * `MIN_SPHERE_RADIUS_METERS`. `weight` (0…1) scales the occluding area — a
 * tinted lens blocks only part of the light — by shrinking the radius by
 * √weight, since a sphere's occlusion grows with r².
 */
export function fitOccluderSpheres(
  points: ArrayLike<number>,
  cellSize: number,
  weight = 1
): OccluderSphere[] {
  const cells = new Map<string, { sx: number; sy: number; sz: number; sq: number; n: number }>()
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i]!
    const y = points[i + 1]!
    const z = points[i + 2]!
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`
    const cell = cells.get(key)
    if (cell) {
      cell.sx += x
      cell.sy += y
      cell.sz += z
      cell.sq += x * x + y * y + z * z
      cell.n++
    } else {
      cells.set(key, { sx: x, sy: y, sz: z, sq: x * x + y * y + z * z, n: 1 })
    }
  }
  const scale = Math.sqrt(Math.min(Math.max(weight, 0), 1))
  const spheres: OccluderSphere[] = []
  for (const { sx, sy, sz, sq, n } of cells.values()) {
    const cx = sx / n
    const cy = sy / n
    const cz = sz / n
    // Mean squared distance from the centroid: E[|p|²] − |c|².
    const spread = Math.sqrt(Math.max(sq / n - (cx * cx + cy * cy + cz * cz), 0))
    const r = Math.min(Math.max(spread, MIN_SPHERE_RADIUS_METERS), cellSize / 2) * scale
    if (r > 0) spheres.push({ x: cx, y: cy, z: cz, r })
  }
  return spheres
}

/** One group of frame geometry to fit: its points, cell size and weight. */
export interface OccluderPart {
  points: ArrayLike<number>
  cellSize: number
  weight: number
}

/**
 * Fit all parts of a frame, coarsening every cell size by 25 % until the total
 * fits in `max` spheres.
 */
export function fitFrameOccluders(
  parts: readonly OccluderPart[],
  max: number = MAX_OCCLUDER_SPHERES
): OccluderSphere[] {
  let coarsen = 1
  for (let attempt = 0; attempt < 20; attempt++) {
    const spheres = parts.flatMap((part) =>
      fitOccluderSpheres(part.points, part.cellSize * coarsen, part.weight)
    )
    if (spheres.length <= max) return spheres
    coarsen *= 1.25
  }
  return []
}

/**
 * Share of the light a sphere hides from a skin point `p` with unit normal
 * `n`: the cosine-weighted solid angle `cos · r²/|d|²` (`d` from `p` to the
 * centre), faded by `(1 − (|d| − r)/range)²` to zero at `range` past the
 * surface, capped at `MAX_SPHERE_OCCLUSION`.
 *
 * `cos = (n·d + r)/(|d| + r)` instead of `n·d̂`: it counts the part of a
 * sphere that sticks up through the skin's horizon, and it is continuous
 * across the sphere's surface (inside, `|d|` is held at `r`). With `n·d̂`
 * and a constant inside, a sphere that sits mostly below the skin (a temple
 * tip entering the head) leaves a hard-edged disc.
 */
export function sphereOcclusion(
  p: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  sphere: OccluderSphere,
  range: number = OCCLUSION_RANGE_METERS
): number {
  const dx = sphere.x - p.x
  const dy = sphere.y - p.y
  const dz = sphere.z - p.z
  const d2 = dx * dx + dy * dy + dz * dz
  const r2 = sphere.r * sphere.r
  const held = Math.max(d2, r2)
  const d = Math.sqrt(held)
  const fade = Math.max(1 - (d - sphere.r) / range, 0) ** 2
  const cosine = Math.min(
    Math.max((n.x * dx + n.y * dy + n.z * dz + sphere.r) / (d + sphere.r), 0),
    1
  )
  return Math.min(cosine * (r2 / held) * fade, MAX_SPHERE_OCCLUSION)
}

/** Occlusion of a skin point by all spheres: 1 − Π(1 − occlusionᵢ). */
export function contactOcclusion(
  p: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  spheres: readonly OccluderSphere[],
  range: number = OCCLUSION_RANGE_METERS
): number {
  let visible = 1
  for (const sphere of spheres) visible *= 1 - sphereOcclusion(p, n, sphere, range)
  return 1 - visible
}

/**
 * Alpha of the shadow-only receiver, which the browser composites as
 * `video × (1 − alpha)`: the cast shadow (0 lit … 1 fully shadowed) and the
 * contact occlusion darken independently, so their visibilities multiply.
 */
export function contactShadowAlpha(
  shadow: number,
  occlusion: number,
  strength: number
): number {
  const shadowed = 1 - strength * shadow
  const occluded = 1 - Math.min(strength * CONTACT_OCCLUSION_GAIN, 1) * occlusion
  return 1 - shadowed * occluded
}
