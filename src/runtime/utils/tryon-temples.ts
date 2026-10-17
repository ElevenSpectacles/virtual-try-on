import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three'

/**
 * Temple arms that open at the hinge to meet the side of the head (issue
 * #83). A real frame front is rigid; on a wide head the temples flex open at
 * the hinge, on a narrow one they close in. Without that they either float
 * off the head or run into it, where the face-mesh occluder hides them.
 *
 * Every catalog GLB holds both temples in one mesh, `pt2`, mirrored across
 * its local Y (the frame's width axis): local X runs from the hinge
 * (≈ 0.018 m) back toward the ear, local Z is up. `rigTemples` splits it by
 * the side of each triangle into two meshes, each on a pivot at its own
 * hinge, at load time — the GLBs themselves are not changed. A GLB without
 * that layout keeps its temples as authored.
 *
 * The opening angle comes from where the side of the head is: the tracked
 * face-oval point at temple height (`EAR_LEVEL_RIGHT`/`EAR_LEVEL_LEFT`) of
 * the face-mesh occluder, in the temple's own frame. MediaPipe has no ear
 * landmarks; the oval point is the furthest back point of the face that is
 * tracked, and behind it the occluder's collar hides the arm anyway.
 */

/** Node holding both temple arms in every catalog GLB. */
export const TEMPLE_NODE_NAME = 'pt2'

/**
 * Widest the temples open or close, each way. An acetate or metal temple
 * flexes a few degrees at the hinge before it binds; beyond that, the
 * tracked oval point is noise (a strongly turned head), not head width.
 */
export const MAX_TEMPLE_OPENING_RADIANS = (8 * Math.PI) / 180

/**
 * Gap kept between the temple's inner face and the side of the head, so the
 * occluder (the same surface) does not cut into the arm where it passes.
 */
export const TEMPLE_CLEARANCE_METERS = 0.001

/**
 * Below this reach from the hinge to the oval point (GLB metres), a small
 * lateral error would swing the arm far, so the temple stays as authored.
 */
export const MIN_TEMPLE_REACH_METERS = 0.015

/** Depth band behind the arm's front end that counts as the hinge. */
export const TEMPLE_HINGE_BAND_METERS = 0.003

/** Depth step of the arm's inner-face profile. */
export const TEMPLE_PROFILE_STEP_METERS = 0.01

/** One temple arm, in the temple node's local frame (GLB metres). */
export interface TempleProfile {
  /** +1 for the arm on local +Y, −1 for local −Y. */
  side: 1 | -1
  /** Hinge pivot: the arm's front end, on its outer face, at mid height. */
  pivot: { x: number; y: number; z: number }
  /** Inner-face distance from the midline (|y|) by depth, front to back. */
  inner: { x: number; halfWidth: number }[]
}

/**
 * Profile of one temple arm from its vertices (xyz triples, the temple
 * node's local frame). Null when there are none.
 */
export function templeProfile(
  points: ArrayLike<number>,
  side: 1 | -1,
  step: number = TEMPLE_PROFILE_STEP_METERS
): TempleProfile | null {
  let minX = Infinity
  for (let i = 0; i + 2 < points.length; i += 3) minX = Math.min(minX, points[i]!)
  if (!Number.isFinite(minX)) return null

  let outer = 0
  let zSum = 0
  let zCount = 0
  const bins = new Map<number, number>()
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i]!
    const halfWidth = Math.abs(points[i + 1]!)
    if (x <= minX + TEMPLE_HINGE_BAND_METERS) {
      outer = Math.max(outer, halfWidth)
      zSum += points[i + 2]!
      zCount++
    }
    const bin = Math.floor((x - minX) / step)
    bins.set(bin, Math.min(bins.get(bin) ?? Infinity, halfWidth))
  }
  const inner = [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bin, halfWidth]) => ({ x: minX + (bin + 0.5) * step, halfWidth }))
  return { side, pivot: { x: minX, y: side * outer, z: zSum / zCount }, inner }
}

/** Inner-face half-width of the arm at depth `x`, held at the profile's ends. */
export function templeInnerHalfWidth(profile: TempleProfile, x: number): number {
  const { inner } = profile
  if (inner.length === 0) return Math.abs(profile.pivot.y)
  if (x <= inner[0]!.x) return inner[0]!.halfWidth
  for (let i = 1; i < inner.length; i++) {
    const b = inner[i]!
    if (x <= b.x) {
      const a = inner[i - 1]!
      return a.halfWidth + ((x - a.x) / (b.x - a.x)) * (b.halfWidth - a.halfWidth)
    }
  }
  return inner[inner.length - 1]!.halfWidth
}

/**
 * Rotation of the arm about local +Z at its pivot (radians) that puts its
 * inner face `clearance` outside the head point `head` (the temple node's
 * frame): positive on the +Y arm and negative on the −Y arm both open it.
 * Zero when the point is on the other side, or too close to the hinge;
 * clamped to ±`max`.
 */
export function templeOpeningAngle(
  profile: TempleProfile,
  head: { x: number; y: number },
  clearance: number = TEMPLE_CLEARANCE_METERS,
  max: number = MAX_TEMPLE_OPENING_RADIANS
): number {
  if (Math.sign(head.y) !== profile.side) return 0
  const reach = head.x - profile.pivot.x
  if (reach < MIN_TEMPLE_REACH_METERS) return 0
  const gap = Math.abs(head.y) + clearance - templeInnerHalfWidth(profile, head.x)
  const angle = Math.min(Math.max(Math.atan2(gap, reach), -max), max)
  return profile.side * angle
}

/** A temple arm on its hinge pivot: set `pivot.rotation.z` to swing it. */
export interface RiggedTemple {
  profile: TempleProfile
  pivot: Group
}

export interface TempleRig {
  temples: RiggedTemple[]
  /** GLB scene root → temple node frame. */
  sceneToTemple: Matrix4
}

/**
 * Split the GLB's temple node into one mesh per arm, each under a pivot
 * group at its hinge. Both meshes share the original vertex buffers (only
 * the index is split) and the material. Null, with the scene untouched,
 * when the node is missing or not two mirrored arms.
 */
export function rigTemples(root: Object3D): TempleRig | null {
  const node = root.getObjectByName(TEMPLE_NODE_NAME)
  if (!(node instanceof Mesh) || !node.parent || Array.isArray(node.material)) return null
  const geometry = node.geometry as BufferGeometry
  const position = geometry.getAttribute('position')
  if (!position) return null

  const vertexCount = position.count
  const index = geometry.getIndex()
  const triangleCount = (index ? index.count : vertexCount) / 3
  const vertexAt = (corner: number) => (index ? index.getX(corner) : corner)
  const sides = { 1: [] as number[], [-1]: [] as number[] } as Record<1 | -1, number[]>
  for (let t = 0; t < triangleCount; t++) {
    const a = vertexAt(t * 3)
    const b = vertexAt(t * 3 + 1)
    const c = vertexAt(t * 3 + 2)
    const y = position.getY(a) + position.getY(b) + position.getY(c)
    sides[y >= 0 ? 1 : -1].push(a, b, c)
  }
  if (sides[1].length === 0 || sides[-1].length === 0) return null

  const rigNode = new Group()
  rigNode.name = node.name
  rigNode.position.copy(node.position)
  rigNode.quaternion.copy(node.quaternion)
  rigNode.scale.copy(node.scale)

  const temples: RiggedTemple[] = []
  for (const side of [1, -1] as const) {
    const corners = sides[side]
    const points = new Float32Array(corners.length * 3)
    corners.forEach((vertex, i) => {
      points[i * 3] = position.getX(vertex)
      points[i * 3 + 1] = position.getY(vertex)
      points[i * 3 + 2] = position.getZ(vertex)
    })
    const profile = templeProfile(points, side)
    if (!profile) return null

    const half = new BufferGeometry()
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      half.setAttribute(name, attribute)
    }
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array
    half.setIndex(new BufferAttribute(IndexArray.from(corners), 1))

    const mesh = new Mesh(half, node.material)
    mesh.name = `${node.name}_${side > 0 ? 'plus' : 'minus'}_y`
    mesh.position.set(-profile.pivot.x, -profile.pivot.y, -profile.pivot.z)
    mesh.castShadow = node.castShadow
    mesh.receiveShadow = node.receiveShadow
    mesh.renderOrder = node.renderOrder
    const pivot = new Group()
    pivot.name = `${mesh.name}_hinge`
    pivot.position.set(profile.pivot.x, profile.pivot.y, profile.pivot.z)
    pivot.add(mesh)
    rigNode.add(pivot)
    temples.push({ profile, pivot })
  }

  const parent = node.parent
  parent.add(rigNode)
  parent.remove(node)
  root.updateMatrixWorld(true)
  const sceneToTemple = new Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(rigNode.matrixWorld)
    .invert()
  return { temples, sceneToTemple }
}

const headPoint = new Vector3()

/** Points in the GLB scene root's frame, in the temple node's frame. */
export function templeFramePoints(
  rig: TempleRig,
  points: readonly { x: number; y: number; z: number }[]
): { x: number; y: number; z: number }[] {
  return points.map((point) => {
    headPoint.set(point.x, point.y, point.z).applyMatrix4(rig.sceneToTemple)
    return { x: headPoint.x, y: headPoint.y, z: headPoint.z }
  })
}

/**
 * Opening angle of each rigged temple (in `rig.temples` order) for points on
 * the side of the head, given in the GLB scene root's frame.
 *
 * Both arms get the same opening: the front is rigid and centres itself on
 * the nose, so the arms spread as far as the wider side needs. Per-side
 * angles would follow noise instead — the far side's oval point slides
 * inward on a turned head (it is the visible silhouette, not the side of
 * the skull), and a frame a few millimetres off-centre would show one arm
 * open and the other shut on a frontal face.
 */
export function templeAngles(
  rig: TempleRig,
  headPoints: readonly { x: number; y: number; z: number }[]
): number[] {
  const local = templeFramePoints(rig, headPoints)
  let opening = -Infinity
  for (const { profile } of rig.temples) {
    const point = local.find((p) => Math.sign(p.y) === profile.side)
    if (point) opening = Math.max(opening, profile.side * templeOpeningAngle(profile, point))
  }
  if (!Number.isFinite(opening) || opening === 0) return rig.temples.map(() => 0)
  return rig.temples.map(({ profile }) => profile.side * opening)
}

/**
 * Ear bend (issue #83, optional): an optician bends the temple tips down
 * behind the ear. The catalog GLBs have straight (trimmed) tips, so past the
 * ear the arm runs on level behind the head, which shows on a profile view.
 * The bend rotates everything past the ear's resting point down about a
 * line across the arm, with the angle easing in over `EAR_BEND_RAMP_METERS`
 * so the arm curves instead of kinking. It is a vertex-shader deformation
 * (`earBendShaderChunk`); `earBendPoint` is the same maths for tests.
 */

/**
 * How far behind the tracked oval point at temple height (234/454) the
 * temple rests on the ear, in GLB metres. The oval point is the furthest
 * back tracked point of the face, at the front of the ear; the helix root
 * the temple rests on is about 1.5 cm behind it.
 */
export const EAR_REST_OFFSET_METERS = 0.015

/** Down-bend of the tip past the ear: a typical fitted temple drops 25–40°. */
export const EAR_BEND_RADIANS = (30 * Math.PI) / 180

/** Length over which the bend eases in. */
export const EAR_BEND_RAMP_METERS = 0.012

export interface EarBend {
  /** Depth (temple-node x) where the bend starts: the ear's resting point. */
  start: number
  /** Height (temple-node z) of the bend line: the arm's own height there. */
  z: number
  /** Full bend angle, radians (0: no bend). */
  angle: number
}

/** Bend for an arm whose head point (temple-node frame) is `head`. */
export function earBendFor(
  profile: TempleProfile,
  head: { x: number },
  angle: number = EAR_BEND_RADIANS
): EarBend {
  return { start: head.x + EAR_REST_OFFSET_METERS, z: profile.pivot.z, angle }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * A temple-node point bent down by `bend` (identity in front of the ear).
 * Mirrors `earBendShaderChunk`.
 */
export function earBendPoint(
  point: { x: number; y: number; z: number },
  bend: EarBend,
  ramp: number = EAR_BEND_RAMP_METERS
): { x: number; y: number; z: number } {
  const dx = point.x - bend.start
  if (dx <= 0 || bend.angle === 0) return { ...point }
  const theta = bend.angle * smoothstep(0, ramp, dx)
  const dz = point.z - bend.z
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return { x: bend.start + dx * c + dz * s, y: point.y, z: bend.z - dx * s + dz * c }
}

/**
 * GLSL for the bend, applied to `transformed` (and `objectNormal`) in the
 * mesh's own frame. A rigged arm's geometry is in the temple node's frame
 * (the mesh is only offset by `-pivot`), so `uEarBend` = (start, z, angle,
 * ramp) is in temple-node units.
 */
export const EAR_BEND_UNIFORMS = /* glsl */ `
uniform vec4 uEarBend;
vec3 tryOnEarBend(vec3 p, out float theta) {
  float dx = p.x - uEarBend.x;
  theta = dx > 0.0 ? uEarBend.z * smoothstep(0.0, uEarBend.w, dx) : 0.0;
  if (theta == 0.0) return p;
  float dz = p.z - uEarBend.y;
  float c = cos(theta);
  float s = sin(theta);
  return vec3(uEarBend.x + dx * c + dz * s, p.y, uEarBend.y - dx * s + dz * c);
}
`

/**
 * Patch a standard-material vertex shader (`onBeforeCompile`) with the ear
 * bend: positions and normals past the ear rotate down by `uEarBend`.
 */
export function patchEarBendShader(vertexShader: string): string {
  return `${EAR_BEND_UNIFORMS}\n${vertexShader}`
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      float earBendTheta;
      tryOnEarBend(position, earBendTheta);
      objectNormal = vec3(
        objectNormal.x * cos(earBendTheta) + objectNormal.z * sin(earBendTheta),
        objectNormal.y,
        -objectNormal.x * sin(earBendTheta) + objectNormal.z * cos(earBendTheta)
      );`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float earBendThetaPosition;
      transformed = tryOnEarBend(transformed, earBendThetaPosition);`
    )
}
