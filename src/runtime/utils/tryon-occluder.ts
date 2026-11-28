import { Quaternion, Vector3 } from 'three'
import { headEuler } from './tryon-pose'
import {
  landmarkToWorld,
  worldPlaneWidth,
  type NormalizedLandmark
} from './tryon'
import { FACE_MESH_TRIANGLE_INDEX, FACE_MESH_VERTEX_COUNT } from './face-mesh-triangles'
import { tryOnSmoothstep } from './tryon-shader'

const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109
] as const

const COLLAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [4, 12],
  [24, 32]
]

interface CollarPoint {
  landmarkIndex: number
  backSlot: number
}

const COLLAR_POINTS: CollarPoint[] = []
for (const [start, end] of COLLAR_RANGES) {
  for (let slot = start; slot <= end; slot++) {
    COLLAR_POINTS.push({
      landmarkIndex: FACE_OVAL_INDICES[slot]!,
      backSlot: COLLAR_POINTS.length
    })
  }
}

const OVAL_SLOT = new Map(
  COLLAR_POINTS.map(({ landmarkIndex, backSlot }) => [landmarkIndex, backSlot])
)

export const FACE_MESH_OCCLUDER_VERTEX_COUNT =
  FACE_MESH_VERTEX_COUNT + COLLAR_POINTS.length

function buildCollarIndex(): Uint16Array {
  const triangles: number[] = []
  let cursor = 0
  for (const [start, end] of COLLAR_RANGES) {
    const count = end - start + 1
    for (let i = 0; i < count - 1; i++) {
      const frontA = FACE_OVAL_INDICES[start + i]!
      const frontB = FACE_OVAL_INDICES[start + i + 1]!
      const backA = FACE_MESH_VERTEX_COUNT + cursor + i
      const backB = FACE_MESH_VERTEX_COUNT + cursor + i + 1
      triangles.push(frontA, backA, frontB, frontB, backA, backB)
    }
    cursor += count
  }
  return Uint16Array.from(triangles)
}

export const FACE_MESH_OCCLUDER_INDEX = (() => {
  const collar = buildCollarIndex()
  const combined = new Uint16Array(FACE_MESH_TRIANGLE_INDEX.length + collar.length)
  combined.set(FACE_MESH_TRIANGLE_INDEX, 0)
  combined.set(collar, FACE_MESH_TRIANGLE_INDEX.length)
  return combined
})()

export interface FaceMeshOccluderOptions {
  landmarks: NormalizedLandmark[]
  aspect: number
  mirror?: boolean
  rawAnchor: NormalizedLandmark
  rawEuler: { x: number; y: number; z: number }
  smoothedAnchor: NormalizedLandmark
  smoothedEuler: { x: number; y: number; z: number }
  scale: number
  skinSetbackMeters?: number
  inflate?: number
  collarDepthMeters?: number
  collarFlare?: number
  nearSideSetbackMeters?: number
}

export function nearSideWeight(
  localX: number,
  camLocalX: number,
  midlineHalfWidth: number
): number {
  const facing = Math.sign(localX) * camLocalX
  const turn = tryOnSmoothstep(0.1, 0.35, facing)
  const lateral = tryOnSmoothstep(midlineHalfWidth, midlineHalfWidth * 2.5, Math.abs(localX))
  return turn * lateral
}

const tmpVec = new Vector3()
const backVec = new Vector3()

export function buildFaceMeshOccluderPositions(
  options: FaceMeshOccluderOptions
): Float32Array | null {
  const {
    landmarks,
    aspect,
    mirror = true,
    rawAnchor,
    rawEuler,
    smoothedAnchor,
    smoothedEuler,
    scale,
    skinSetbackMeters = 0.006,
    inflate = 1.04,
    collarDepthMeters = 0.2,
    collarFlare = 1.35,
    nearSideSetbackMeters = 0.03
  } = options

  if (scale <= 0 || landmarks.length < FACE_MESH_VERTEX_COUNT) return null

  const qRaw = new Quaternion().setFromEuler(headEuler(rawEuler))
  const qRawInv = qRaw.clone().invert()
  const qSmooth = new Quaternion().setFromEuler(headEuler(smoothedEuler))
  const rawAnchorWorld = landmarkToWorld(rawAnchor, aspect, { mirror })
  const smoothedAnchorWorld = landmarkToWorld(smoothedAnchor, aspect, {
    mirror
  })

  const zWorldPerNorm = worldPlaneWidth(aspect)
  const anchorZ = rawAnchor.z ?? 0

  const setback = new Vector3(0, 0, -skinSetbackMeters * scale).applyQuaternion(
    qSmooth
  )

  const camLocalX = new Vector3(0, 0, 1).applyQuaternion(qRawInv).x
  const midlineHalfWidth = 0.02 * scale

  const positions = new Float32Array(FACE_MESH_OCCLUDER_VERTEX_COUNT * 3)

  function writeSmoothed(local: Vector3, vertex: number): void {
    local.applyQuaternion(qSmooth)
    local.x += smoothedAnchorWorld.x + setback.x
    local.y += smoothedAnchorWorld.y + setback.y
    local.z += setback.z
    positions[vertex * 3] = local.x
    positions[vertex * 3 + 1] = local.y
    positions[vertex * 3 + 2] = local.z
  }

  for (let i = 0; i < FACE_MESH_VERTEX_COUNT; i++) {
    const landmark = landmarks[i]!
    const world = landmarkToWorld(landmark, aspect, { mirror })

    tmpVec.set(
      world.x - rawAnchorWorld.x,
      world.y - rawAnchorWorld.y,
      -((landmark.z ?? 0) - anchorZ) * zWorldPerNorm
    )
    tmpVec.applyQuaternion(qRawInv)
    const near = nearSideWeight(tmpVec.x, camLocalX, midlineHalfWidth)
    const vertexInflate = inflate + (1 - inflate) * near
    tmpVec.x *= vertexInflate
    tmpVec.y *= vertexInflate
    tmpVec.z -= near * nearSideSetbackMeters * scale

    const ovalSlot = OVAL_SLOT.get(i)
    if (ovalSlot !== undefined) {
      backVec.copy(tmpVec)
      backVec.x *= collarFlare
      backVec.y *= collarFlare
      backVec.z -= collarDepthMeters * scale
      backVec.lerp(tmpVec, near)
      writeSmoothed(backVec, FACE_MESH_VERTEX_COUNT + ovalSlot)
    }

    writeSmoothed(tmpVec, i)
  }

  return positions
}
