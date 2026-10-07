import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  FACE_MESH_OCCLUDER_INDEX,
  FACE_MESH_OCCLUDER_VERTEX_COUNT,
  buildFaceMeshOccluderPositions,
  type FaceMeshOccluderOptions
} from '../../../src/runtime/utils/tryon-occluder'
import { FACE_MESH_VERTEX_COUNT } from '../../../src/runtime/utils/face-mesh-triangles'
import {
  landmarkToWorld,
  worldPlaneWidth,
  type NormalizedLandmark
} from '../../../src/runtime/utils/tryon'

const ASPECT = 3 / 4
const SCALE = 6

/** 468 landmarks, all at the same point unless overridden. */
function makeLandmarks(
  center: NormalizedLandmark,
  overrides: Record<number, Partial<NormalizedLandmark>> = {}
): NormalizedLandmark[] {
  return Array.from({ length: FACE_MESH_VERTEX_COUNT }, (_, i) => ({
    ...center,
    ...overrides[i]
  }))
}

const anchor: NormalizedLandmark = { x: 0.5, y: 0.5, z: 0 }
const identityEuler = { x: 0, y: 0, z: 0 }

function baseOptions(
  overrides: Partial<FaceMeshOccluderOptions> = {}
): FaceMeshOccluderOptions {
  return {
    landmarks: makeLandmarks(anchor),
    aspect: ASPECT,
    rawAnchor: anchor,
    rawEuler: identityEuler,
    smoothedAnchor: anchor,
    smoothedEuler: identityEuler,
    scale: SCALE,
    ...overrides
  }
}

function vertexAt(positions: Float32Array, index: number): Vector3 {
  return new Vector3(
    positions[index * 3]!,
    positions[index * 3 + 1]!,
    positions[index * 3 + 2]!
  )
}

describe('face-mesh occluder', () => {
  it('has a static index covering every vertex with full triangles', () => {
    expect(FACE_MESH_OCCLUDER_INDEX.length % 3).toBe(0)
    for (const index of FACE_MESH_OCCLUDER_INDEX) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(FACE_MESH_OCCLUDER_VERTEX_COUNT)
    }
  })

  it('emits one vertex per landmark plus the collar ring', () => {
    const positions = buildFaceMeshOccluderPositions(baseOptions())
    expect(positions).not.toBeNull()
    expect(positions!.length).toBe(FACE_MESH_OCCLUDER_VERTEX_COUNT * 3)
  })

  it('returns null when landmarks are missing', () => {
    const landmarks = makeLandmarks(anchor).slice(0, 100)
    expect(buildFaceMeshOccluderPositions(baseOptions({ landmarks }))).toBeNull()
  })

  it('returns null on a non-positive scale', () => {
    expect(buildFaceMeshOccluderPositions(baseOptions({ scale: 0 }))).toBeNull()
  })

  it('maps MediaPipe z (negative toward camera) to world z (positive toward camera)', () => {
    // The nose tip (landmark 4) is the foremost point of a real face — in
    // MediaPipe coordinates that is a NEGATIVE z. It must land closer to the
    // camera than a neutral-depth vertex or the whole occluder is inside-out
    // and depth-hides the frame front.
    const landmarks = makeLandmarks(anchor, { 4: { z: -0.05 } })
    const positions = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, skinSetbackMeters: 0, inflate: 1 })
    )!
    const noseZ = vertexAt(positions, 4).z
    const neutralZ = vertexAt(positions, 0).z
    expect(noseZ).toBeGreaterThan(neutralZ)
    expect(noseZ - neutralZ).toBeCloseTo(0.05 * worldPlaneWidth(ASPECT), 3)
  })

  it('keeps the mesh on the anchor plane relative to the anchor z', () => {
    // Anchor deeper than a vertex → that vertex sits toward the camera.
    const landmarks = makeLandmarks({ ...anchor, z: -0.02 })
    const positions = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, skinSetbackMeters: 0, inflate: 1 })
    )!
    expect(vertexAt(positions, 0).z).toBeCloseTo(0.02 * worldPlaneWidth(ASPECT), 3)
  })

  it('pushes the whole mesh away from the camera by the skin setback', () => {
    const landmarks = makeLandmarks(anchor)
    const flush = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, skinSetbackMeters: 0, inflate: 1 })
    )!
    const setback = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, skinSetbackMeters: 0.005, inflate: 1 })
    )!
    for (const i of [0, 100, 300, 467]) {
      expect(vertexAt(flush, i).z - vertexAt(setback, i).z).toBeCloseTo(
        0.005 * SCALE
      )
    }
  })

  it('honours the front-camera mirror convention', () => {
    const offCenter: NormalizedLandmark = { x: 0.6, y: 0.5, z: 0 }
    const options = baseOptions({
      landmarks: makeLandmarks(offCenter),
      rawAnchor: offCenter,
      smoothedAnchor: offCenter,
      skinSetbackMeters: 0,
      inflate: 1
    })
    const mirrored = buildFaceMeshOccluderPositions(options)!
    const unmirrored = buildFaceMeshOccluderPositions({
      ...options,
      mirror: false
    })!
    expect(vertexAt(mirrored, 0).x).toBeCloseTo(-vertexAt(unmirrored, 0).x)
  })

  it('places the mesh with the smoothed transform, not the raw one', () => {
    // Raw pose says the head is off-centre and yawed; the smoothed pose has
    // already settled at centre. The mesh must sit where the glasses are.
    const rawAnchor: NormalizedLandmark = { x: 0.6, y: 0.55, z: 0 }
    const settled = landmarkToWorld(anchor, ASPECT)
    const positions = buildFaceMeshOccluderPositions(
      baseOptions({
        landmarks: makeLandmarks(rawAnchor),
        rawAnchor,
        rawEuler: { x: 0, y: 0.5, z: 0 },
        skinSetbackMeters: 0,
        inflate: 1
      })
    )!
    const centroid = new Vector3()
    for (let i = 0; i < FACE_MESH_VERTEX_COUNT; i++) {
      centroid.add(vertexAt(positions, i))
    }
    centroid.divideScalar(FACE_MESH_VERTEX_COUNT)
    expect(centroid.x).toBeCloseTo(settled.x, 1)
    expect(centroid.y).toBeCloseTo(settled.y, 1)
  })

  it('inflates x/y about the anchor but leaves depth untouched', () => {
    const spread: Record<number, Partial<NormalizedLandmark>> = {
      1: { x: 0.6, z: -0.03 }
    }
    const landmarks = makeLandmarks(anchor, spread)
    const base = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, inflate: 1, skinSetbackMeters: 0 })
    )!
    const inflated = buildFaceMeshOccluderPositions(
      baseOptions({ landmarks, inflate: 1.1, skinSetbackMeters: 0 })
    )!
    const anchorWorld = landmarkToWorld(anchor, ASPECT)
    const dx = vertexAt(base, 1).x - anchorWorld.x
    const dxInflated = vertexAt(inflated, 1).x - anchorWorld.x
    expect(dxInflated).toBeCloseTo(dx * 1.1)
    expect(vertexAt(inflated, 1).z).toBeCloseTo(vertexAt(base, 1).z)
  })

  it('extrudes the collar behind the matching face-oval boundary point', () => {
    // Landmark 284 (face-oval slot 4, right temple/cheek arc) is the first
    // collar point — its back-vertex is appended right after the tracked
    // mesh. The forehead (landmark 10) and chin are excluded from the collar
    // entirely, so they have no back-vertex.
    const positions = buildFaceMeshOccluderPositions(
      baseOptions({ skinSetbackMeters: 0, collarDepthMeters: 0.1 })
    )!
    const front = vertexAt(positions, 284)
    const back = vertexAt(positions, FACE_MESH_VERTEX_COUNT)
    expect(front.x).toBeCloseTo(back.x)
    expect(front.y).toBeCloseTo(back.y)
    expect(front.z - back.z).toBeCloseTo(0.1 * SCALE)
  })
})
