export interface OccluderSphere {
  x: number
  y: number
  z: number
  r: number
}

export const MAX_OCCLUDER_SPHERES = 96

export const FRAME_SPHERE_CELL_METERS = 0.008

export const LENS_SPHERE_CELL_METERS = 0.016

export const MIN_SPHERE_RADIUS_METERS = 0.0015

export const MAX_SPHERE_OCCLUSION = 0.5

export const OCCLUSION_RANGE_METERS = 0.02

export const SILHOUETTE_FADE_START = 0.15
export const SILHOUETTE_FADE_END = 0.45

export function silhouetteFade(cosView: number): number {
  const t = Math.min(
    Math.max((cosView - SILHOUETTE_FADE_START) / (SILHOUETTE_FADE_END - SILHOUETTE_FADE_START), 0),
    1
  )
  return t * t * (3 - 2 * t)
}

export const CONTACT_OCCLUSION_GAIN = 1.6

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
    const spread = Math.sqrt(Math.max(sq / n - (cx * cx + cy * cy + cz * cz), 0))
    const r = Math.min(Math.max(spread, MIN_SPHERE_RADIUS_METERS), cellSize / 2) * scale
    if (r > 0) spheres.push({ x: cx, y: cy, z: cz, r })
  }
  return spheres
}

export interface OccluderPart {
  points: ArrayLike<number>
  cellSize: number
  weight: number
}

export function fitFrameOccludersByPart(
  parts: readonly OccluderPart[],
  max: number = MAX_OCCLUDER_SPHERES
): OccluderSphere[][] {
  let coarsen = 1
  for (let attempt = 0; attempt < 20; attempt++) {
    const byPart = parts.map((part) =>
      fitOccluderSpheres(part.points, part.cellSize * coarsen, part.weight)
    )
    if (byPart.reduce((total, spheres) => total + spheres.length, 0) <= max) return byPart
    coarsen *= 1.25
  }
  return parts.map(() => [])
}

export function fitFrameOccluders(
  parts: readonly OccluderPart[],
  max: number = MAX_OCCLUDER_SPHERES
): OccluderSphere[] {
  return fitFrameOccludersByPart(parts, max).flat()
}

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

export function contactShadowAlpha(
  shadow: number,
  occlusion: number,
  strength: number
): number {
  const shadowed = 1 - strength * shadow
  const occluded = 1 - Math.min(strength * CONTACT_OCCLUSION_GAIN, 1) * occlusion
  return 1 - shadowed * occluded
}
