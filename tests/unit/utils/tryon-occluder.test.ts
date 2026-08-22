import { describe, it, expect } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  FACE_OVAL_INDICES,
  HEAD_OCCLUDER_INDEX,
  HEAD_OCCLUDER_VERTEX_COUNT,
  buildHeadOccluderPositions,
  type HeadOccluderOptions
} from '../../../utils/tryon-occluder'
import { landmarkToWorld, type NormalizedLandmark } from '../../../utils/tryon'

const ASPECT = 3 / 4
const SCALE = 6

/** 478 landmarks; oval indices on a circle centred on the anchor. */
function makeLandmarks(
  center: NormalizedLandmark,
  radius = 0.1
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from(
    { length: 478 },
    () => ({ ...center })
  )
  FACE_OVAL_INDICES.forEach((index, i) => {
    const angle = (i / FACE_OVAL_INDICES.length) * Math.PI * 2
    landmarks[index] = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      z: 0
    }
  })
  return landmarks
}

const anchor: NormalizedLandmark = { x: 0.5, y: 0.5, z: 0 }
const identityEuler = { x: 0, y: 0, z: 0 }

function baseOptions(
  overrides: Partial<HeadOccluderOptions> = {}
): HeadOccluderOptions {
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

describe('head occluder shell', () => {
  it('has a static index covering every vertex with full triangles', () => {
    expect(HEAD_OCCLUDER_INDEX.length % 3).toBe(0)
    for (const index of HEAD_OCCLUDER_INDEX) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(HEAD_OCCLUDER_VERTEX_COUNT)
    }
  })

  it('emits front ring + back ring for every oval landmark', () => {
    const positions = buildHeadOccluderPositions(baseOptions())
    expect(positions).not.toBeNull()
    expect(positions!.length).toBe(HEAD_OCCLUDER_VERTEX_COUNT * 3)
  })

  it('returns null when an oval landmark is missing', () => {
    const landmarks = makeLandmarks(anchor).slice(0, 100)
    expect(buildHeadOccluderPositions(baseOptions({ landmarks }))).toBeNull()
  })

  it('returns null on a non-positive scale', () => {
    expect(buildHeadOccluderPositions(baseOptions({ scale: 0 }))).toBeNull()
  })

  it('extrudes the back ring straight back at identity pose', () => {
    const depth = 0.11
    const positions = buildHeadOccluderPositions(
      baseOptions({ depthMeters: depth, surfaceOffsetMeters: 0 })
    )!
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      const front = vertexAt(positions, i)
      const back = vertexAt(positions, i + FACE_OVAL_INDICES.length)
      expect(back.x).toBeCloseTo(front.x)
      expect(back.y).toBeCloseTo(front.y)
      expect(front.z - back.z).toBeCloseTo(depth * SCALE)
    }
  })

  it('extrudes along the head axis, not camera Z, when yawed', () => {
    const yaw = Math.PI / 2
    const depth = 0.11
    const positions = buildHeadOccluderPositions(
      baseOptions({
        rawEuler: { x: 0, y: yaw, z: 0 },
        smoothedEuler: { x: 0, y: yaw, z: 0 },
        depthMeters: depth,
        surfaceOffsetMeters: 0
      })
    )!
    const expectedBack = new Vector3(0, 0, -1)
      .applyQuaternion(
        new Quaternion().setFromEuler(new Euler(0, yaw, 0, 'YXZ'))
      )
      .multiplyScalar(depth * SCALE)
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      const front = vertexAt(positions, i)
      const back = vertexAt(positions, i + FACE_OVAL_INDICES.length)
      expect(back.sub(front).distanceTo(expectedBack)).toBeLessThan(1e-6)
    }
  })

  it('honours the front-camera mirror convention', () => {
    const offCenter: NormalizedLandmark = { x: 0.6, y: 0.5, z: 0 }
    const options = baseOptions({
      landmarks: makeLandmarks(offCenter),
      rawAnchor: offCenter,
      smoothedAnchor: offCenter
    })
    const mirrored = buildHeadOccluderPositions(options)!
    const unmirrored = buildHeadOccluderPositions({
      ...options,
      mirror: false
    })!
    expect(vertexAt(mirrored, 0).x).toBeCloseTo(-vertexAt(unmirrored, 0).x)
  })

  it('hugs the (inflated) oval silhouette at identity pose', () => {
    const radius = 0.1
    const inflate = 1.04
    const positions = buildHeadOccluderPositions(
      baseOptions({
        landmarks: makeLandmarks(anchor, radius),
        inflate,
        surfaceOffsetMeters: 0
      })
    )!
    const anchorWorld = landmarkToWorld(anchor, ASPECT)
    // A normalized-space circle projects to a world-space ellipse (x scales
    // with aspect), so compare each vertex against its own projection.
    FACE_OVAL_INDICES.forEach((_, i) => {
      const angle = (i / FACE_OVAL_INDICES.length) * Math.PI * 2
      const probeWorld = landmarkToWorld(
        {
          x: anchor.x + Math.cos(angle) * radius,
          y: anchor.y + Math.sin(angle) * radius,
          z: 0
        },
        ASPECT
      )
      const expectedRadius =
        Math.hypot(probeWorld.x - anchorWorld.x, probeWorld.y - anchorWorld.y) *
        inflate
      const front = vertexAt(positions, i)
      const r = Math.hypot(front.x - anchorWorld.x, front.y - anchorWorld.y)
      expect(r).toBeCloseTo(expectedRadius)
    })
  })

  it('pushes the front ring toward the camera by a positive surface offset', () => {
    const offset = 0.004
    const positions = buildHeadOccluderPositions(
      baseOptions({ surfaceOffsetMeters: offset })
    )!
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      expect(vertexAt(positions, i).z).toBeCloseTo(offset * SCALE)
    }
  })

  it('places the front cap at the eye plane, behind the frame front, by default', () => {
    // Regression: calibration anchors each GLB at its front face (z≈0), but
    // that front curves back (~+11mm bridge to −15mm endpieces). The cap
    // must sit at the eye/cheek plane (~12mm back) so the whole frame front
    // wins the depth test — a cap at/above the anchor plane depth-hides most
    // of the frame inside the silhouette: the "glasses behind the face" bug.
    const positions = buildHeadOccluderPositions(baseOptions())!
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      expect(vertexAt(positions, i).z).toBeCloseTo(-0.012 * SCALE)
    }
  })

  it('extrudes far enough to cover the full temple length by default', () => {
    // The frame extends ~15.5cm back from its front face (front-at-anchor
    // convention); a shorter shell lets the temple tips escape it.
    const positions = buildHeadOccluderPositions(baseOptions())!
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      const front = vertexAt(positions, i)
      const back = vertexAt(positions, i + FACE_OVAL_INDICES.length)
      expect(front.z - back.z).toBeGreaterThanOrEqual(0.15 * SCALE)
    }
  })

  it('places the shell with the smoothed transform, not the raw one', () => {
    // Raw pose says the head is off-centre and yawed; the smoothed pose has
    // already settled at centre. The shell must sit where the glasses are.
    const rawAnchor: NormalizedLandmark = { x: 0.6, y: 0.55, z: 0 }
    const settled = landmarkToWorld(anchor, ASPECT)
    const positions = buildHeadOccluderPositions(
      baseOptions({
        landmarks: makeLandmarks(rawAnchor),
        rawAnchor,
        rawEuler: { x: 0, y: 0.5, z: 0 }
      })
    )!
    const centroid = new Vector3()
    for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
      centroid.add(vertexAt(positions, i))
    }
    centroid.divideScalar(FACE_OVAL_INDICES.length)
    expect(centroid.x).toBeCloseTo(settled.x, 1)
    expect(centroid.y).toBeCloseTo(settled.y, 1)
  })
})
