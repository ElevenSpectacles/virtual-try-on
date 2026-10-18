import { describe, expect, it } from 'vitest'
import {
  FACE_CHIN,
  FACE_EAR_LEFT,
  FACE_EAR_RIGHT,
  FACE_FOREHEAD_LEFT,
  FACE_FOREHEAD_RIGHT,
  FACE_JAW_LEFT,
  FACE_JAW_RIGHT,
  FACE_SHAPE_MIN_SAMPLES,
  FACE_SHAPE_PROTOTYPES,
  FACE_TOP,
  classifyFaceShape,
  faceProportions,
  updateFaceProportions,
  type FaceProportions,
  type FaceProportionsEstimate,
  type TryOnFaceShape
} from '../../../src/runtime/utils/tryon-face-shape'
import type { NormalizedLandmark } from '../../../src/runtime/utils/tryon'
import { gaussian, mulberry32 } from '../support/landmark-stream'

/**
 * A frontal face with the given proportions, `width` wide (width units) in
 * an image of `aspect`, plus seeded landmark noise of `noise` (normalized).
 */
function face(
  p: FaceProportions,
  { width = 0.3, aspect = 1, noise = 0, rand = mulberry32(1) } = {}
): NormalizedLandmark[] {
  const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const jitter = () => noise * gaussian(rand)
  const pair = (right: number, left: number, span: number, y: number) => {
    points[right] = { x: 0.5 - span / 2 + jitter(), y: y + jitter(), z: 0 }
    points[left] = { x: 0.5 + span / 2 + jitter(), y: y + jitter(), z: 0 }
  }
  pair(FACE_EAR_RIGHT, FACE_EAR_LEFT, width, 0.45)
  pair(FACE_FOREHEAD_RIGHT, FACE_FOREHEAD_LEFT, width * p.forehead, 0.32)
  pair(FACE_JAW_RIGHT, FACE_JAW_LEFT, width * p.jaw, 0.58)
  // Lengths are in width units: y is a fraction of the height.
  const half = (width * p.length * aspect) / 2
  points[FACE_TOP] = { x: 0.5 + jitter(), y: 0.45 - half + jitter(), z: 0 }
  points[FACE_CHIN] = { x: 0.5 + jitter(), y: 0.45 + half + jitter(), z: 0 }
  return points
}

describe('faceProportions', () => {
  it('measures the proportions relative to the ear-level width', () => {
    const p = { length: 1.2, forehead: 0.8, jaw: 0.7 }
    const measured = faceProportions(face(p))!
    expect(measured.length).toBeCloseTo(1.2, 6)
    expect(measured.forehead).toBeCloseTo(0.8, 6)
    expect(measured.jaw).toBeCloseTo(0.7, 6)
  })

  it('does not depend on distance or image aspect', () => {
    const p = { length: 1.2, forehead: 0.8, jaw: 0.7 }
    const near = faceProportions(face(p, { width: 0.5, aspect: 16 / 9 }), 16 / 9)!
    expect(near.length).toBeCloseTo(1.2, 6)
    expect(near.jaw).toBeCloseTo(0.7, 6)
  })

  it('is null without the landmarks', () => {
    expect(faceProportions([])).toBeNull()
  })
})

describe('classifyFaceShape', () => {
  for (const shape of Object.keys(FACE_SHAPE_PROTOTYPES) as TryOnFaceShape[]) {
    it(`classifies its own prototype as ${shape}, confidently`, () => {
      const result = classifyFaceShape(FACE_SHAPE_PROTOTYPES[shape])
      expect(result.shape).toBe(shape)
      expect(result.confidence).toBeGreaterThan(0.3)
    })
  }

  it('reads a long face as oblong and a wide jaw as square', () => {
    expect(classifyFaceShape({ length: 1.45, forehead: 0.8, jaw: 0.74 }).shape).toBe('oblong')
    expect(classifyFaceShape({ length: 1.06, forehead: 0.86, jaw: 0.9 }).shape).toBe('square')
    expect(classifyFaceShape({ length: 1.16, forehead: 0.9, jaw: 0.62 }).shape).toBe('heart')
  })

  it('is unsure halfway between two classes', () => {
    const { oval, oblong } = FACE_SHAPE_PROTOTYPES
    const between = {
      length: (oval.length + oblong.length) / 2,
      forehead: (oval.forehead + oblong.forehead) / 2,
      jaw: (oval.jaw + oblong.jaw) / 2
    }
    expect(classifyFaceShape(between).confidence).toBeLessThan(0.1)
  })

  it('holds the previous class near a boundary (hysteresis)', () => {
    const { oval, oblong } = FACE_SHAPE_PROTOTYPES
    // Slightly closer to oblong than to oval.
    const nearBoundary = {
      length: oval.length + (oblong.length - oval.length) * 0.53,
      forehead: oval.forehead + (oblong.forehead - oval.forehead) * 0.53,
      jaw: oval.jaw + (oblong.jaw - oval.jaw) * 0.53
    }
    expect(classifyFaceShape(nearBoundary).shape).toBe('oblong')
    expect(classifyFaceShape(nearBoundary, 'oval').shape).toBe('oval')
    // Clearly oblong: the class changes.
    expect(classifyFaceShape(oblong, 'oval').shape).toBe('oblong')
  })
})

describe('a still clip', () => {
  it('gives one class for 5 s of noisy detections, no flicker', () => {
    const rand = mulberry32(11)
    // A face near the oval/round boundary, 0.5 px landmark noise at 480 px.
    const truth = { length: 1.13, forehead: 0.8, jaw: 0.745 }
    let estimate: FaceProportionsEstimate | null = null
    let shape: TryOnFaceShape | null = null
    const shapes = new Set<TryOnFaceShape>()
    for (let frame = 0; frame < 150; frame++) {
      estimate = updateFaceProportions(estimate, faceProportions(face(truth, { noise: 0.001, rand })))
      if (estimate!.samples < FACE_SHAPE_MIN_SAMPLES) continue
      shape = classifyFaceShape(estimate!.mean, shape).shape
      shapes.add(shape)
    }
    expect(shapes.size).toBe(1)
  })
})
