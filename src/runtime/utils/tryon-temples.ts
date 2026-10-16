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
  const local = headPoints.map((point) => {
    headPoint.set(point.x, point.y, point.z).applyMatrix4(rig.sceneToTemple)
    return { x: headPoint.x, y: headPoint.y }
  })
  let opening = -Infinity
  for (const { profile } of rig.temples) {
    const point = local.find((p) => Math.sign(p.y) === profile.side)
    if (point) opening = Math.max(opening, profile.side * templeOpeningAngle(profile, point))
  }
  if (!Number.isFinite(opening) || opening === 0) return rig.temples.map(() => 0)
  return rig.temples.map(({ profile }) => profile.side * opening)
}
