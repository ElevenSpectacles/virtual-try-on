import { describe, expect, it } from 'vitest'
import {
  FIT_DEFAULT_TOLERANCE,
  FIT_IDEAL_RATIO,
  FIT_MIN_SAMPLES,
  estimateFaceWidthMm,
  faceWidthVerdict,
  updateFaceWidthEstimate,
  type FaceWidthEstimate,
  type TryOnFitVerdict
} from '../../../src/runtime/utils/tryon-fit'

/** Seeded standard-normal samples (mulberry32 + Box–Muller), so the zoom test is deterministic. */
function seededGaussian(seed: number): () => number {
  let state = seed >>> 0
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return () =>
    Math.sqrt(-2 * Math.log(Math.max(rand(), Number.MIN_VALUE))) * Math.cos(2 * Math.PI * rand())
}

describe('estimateFaceWidthMm', () => {
  it('scales the ear width by the IPD ruler', () => {
    // Ear width 2.3x the IPD at a 63 mm IPD: 144.9 mm.
    expect(estimateFaceWidthMm(0.23, 0.1)).toBeCloseTo(144.9)
  })

  it('is independent of distance to the camera', () => {
    expect(estimateFaceWidthMm(0.46, 0.2)).toBeCloseTo(estimateFaceWidthMm(0.23, 0.1))
  })

  it('returns 0 without both measures', () => {
    expect(estimateFaceWidthMm(0, 0.1)).toBe(0)
    expect(estimateFaceWidthMm(0.23, 0)).toBe(0)
  })
})

describe('faceWidthVerdict', () => {
  const face = 145
  const ideal = face * FIT_IDEAL_RATIO
  const cases: Array<[string, number, TryOnFitVerdict]> = [
    ['much narrower frame', ideal * 0.85, 'narrow'],
    ['just past the narrow edge', ideal * (1 - FIT_DEFAULT_TOLERANCE - 0.005), 'narrow'],
    ['just inside the narrow edge', ideal * (1 - FIT_DEFAULT_TOLERANCE + 0.005), 'good'],
    ['ideal width', ideal, 'good'],
    ['just inside the wide edge', ideal * (1 + FIT_DEFAULT_TOLERANCE - 0.005), 'good'],
    ['just past the wide edge', ideal * (1 + FIT_DEFAULT_TOLERANCE + 0.005), 'wide'],
    ['much wider frame', ideal * 1.15, 'wide']
  ]
  for (const [name, frame, verdict] of cases) {
    it(`${name}: ${verdict}`, () => {
      expect(faceWidthVerdict(face, frame)).toBe(verdict)
    })
  }

  it('honours a custom tolerance', () => {
    expect(faceWidthVerdict(face, ideal * 1.08)).toBe('wide')
    expect(faceWidthVerdict(face, ideal * 1.08, { tolerance: 0.1 })).toBe('good')
  })

  it('needs both widths', () => {
    expect(faceWidthVerdict(0, 140)).toBeNull()
    expect(faceWidthVerdict(145, 0)).toBeNull()
  })

  it('keeps a verdict until the measure clearly leaves it', () => {
    const edge = ideal * (1 + FIT_DEFAULT_TOLERANCE)
    // Just inside the wide edge: still wide when it was wide, good otherwise.
    expect(faceWidthVerdict(face, edge - 0.5, { previous: 'wide' })).toBe('wide')
    expect(faceWidthVerdict(face, edge - 0.5, { previous: 'good' })).toBe('good')
    // Just past it: still good when it was good.
    expect(faceWidthVerdict(face, edge + 0.5, { previous: 'good' })).toBe('good')
    expect(faceWidthVerdict(face, edge + 0.5)).toBe('wide')
  })
})

describe('fit verdict over a slow zoom (layer 2)', () => {
  it('flips at most once when the face sits on a band edge', () => {
    // A 140 mm frame on a face whose ideal width puts it right on the wide edge.
    const frameWidthMm = 140
    const faceWidthMm = frameWidthMm / (FIT_IDEAL_RATIO * (1 + FIT_DEFAULT_TOLERANCE))
    const noise = seededGaussian(31)
    let estimate: FaceWidthEstimate | null = null
    let verdict: TryOnFitVerdict | null = null
    const verdicts: TryOnFitVerdict[] = []
    // 10 s at 30 fps, leaning from 60 cm to 30 cm: the IPD on screen doubles.
    for (let i = 0; i < 300; i++) {
      const ipd = 0.08 + (0.08 * i) / 300
      const ear = (ipd * faceWidthMm) / 63
      // Landmark noise of ~1 px at 640 px wide on each measure.
      const noisyIpd = ipd + 0.0015 * noise()
      const noisyEar = ear + 0.0015 * noise()
      estimate = updateFaceWidthEstimate(estimate, estimateFaceWidthMm(noisyEar, noisyIpd))
      if (!estimate || estimate.samples < FIT_MIN_SAMPLES) continue
      verdict = faceWidthVerdict(estimate.mean, frameWidthMm, { previous: verdict })
      if (verdict && verdict !== verdicts.at(-1)) verdicts.push(verdict)
    }
    expect(verdicts.length).toBeGreaterThan(0)
    expect(verdicts.length).toBeLessThanOrEqual(2)
  })
})

describe('updateFaceWidthEstimate', () => {
  it('starts at the first sample and averages after', () => {
    const first = updateFaceWidthEstimate(null, 140)!
    expect(first).toEqual({ mean: 140, samples: 1 })
    const second = updateFaceWidthEstimate(first, 150, 0.5)!
    expect(second).toEqual({ mean: 145, samples: 2 })
  })

  it('ignores missing measures', () => {
    const estimate = { mean: 140, samples: 3 }
    expect(updateFaceWidthEstimate(estimate, 0)).toBe(estimate)
    expect(updateFaceWidthEstimate(null, 0)).toBeNull()
  })
})
