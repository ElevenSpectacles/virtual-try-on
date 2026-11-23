import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three'

export const TEMPLE_NODE_NAME = 'pt2'

export const MAX_TEMPLE_OPENING_RADIANS = (8 * Math.PI) / 180

export const TEMPLE_CLEARANCE_METERS = 0.001

export const MIN_TEMPLE_REACH_METERS = 0.015

export const TEMPLE_HINGE_BAND_METERS = 0.003

export const TEMPLE_PROFILE_STEP_METERS = 0.01

export interface TempleProfile {
  side: 1 | -1
  pivot: { x: number; y: number; z: number }
  inner: { x: number; halfWidth: number }[]
}

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

export interface RiggedTemple {
  profile: TempleProfile
  pivot: Group
}

export interface TempleRig {
  temples: RiggedTemple[]
  sceneToTemple: Matrix4
}

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

export function templeFramePoints(
  rig: TempleRig,
  points: readonly { x: number; y: number; z: number }[]
): { x: number; y: number; z: number }[] {
  return points.map((point) => {
    headPoint.set(point.x, point.y, point.z).applyMatrix4(rig.sceneToTemple)
    return { x: headPoint.x, y: headPoint.y, z: headPoint.z }
  })
}

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

export const EAR_REST_OFFSET_METERS = 0.015

export const EAR_BEND_RADIANS = (30 * Math.PI) / 180

export const EAR_BEND_RAMP_METERS = 0.012

export interface EarBend {
  start: number
  z: number
  angle: number
}

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
