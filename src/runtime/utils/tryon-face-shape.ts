import { widthUnitDistance } from './tryon-measure'
import type { NormalizedLandmark } from './tryon'
import type { TryOnMeasurements } from '../types/tryon-experience'

export type TryOnFaceShape = NonNullable<TryOnMeasurements['faceShape']>

export interface FaceProportions {
  length: number
  forehead: number
  jaw: number
}

export const FACE_TOP = 10
export const FACE_CHIN = 152
export const FACE_EAR_RIGHT = 234
export const FACE_EAR_LEFT = 454
export const FACE_FOREHEAD_RIGHT = 54
export const FACE_FOREHEAD_LEFT = 284
export const FACE_JAW_RIGHT = 172
export const FACE_JAW_LEFT = 397

export const FACE_SHAPE_PROTOTYPES: Record<TryOnFaceShape, FaceProportions> = {
  oval: { length: 1.2, forehead: 0.8, jaw: 0.72 },
  round: { length: 1.04, forehead: 0.8, jaw: 0.77 },
  square: { length: 1.08, forehead: 0.85, jaw: 0.86 },
  heart: { length: 1.18, forehead: 0.88, jaw: 0.65 },
  oblong: { length: 1.38, forehead: 0.82, jaw: 0.76 }
}

const WEIGHTS: FaceProportions = { length: 1, forehead: 1.6, jaw: 1.6 }

export const FACE_SHAPE_HYSTERESIS = 0.15

export const FACE_SHAPE_MIN_SAMPLES = 45

export function faceProportions(
  landmarks: NormalizedLandmark[],
  aspect: number = 1
): FaceProportions | null {
  const at = (i: number) => landmarks[i]
  const span = (a: number, b: number) => {
    const p = at(a)
    const q = at(b)
    return p && q ? widthUnitDistance(p, q, aspect) : 0
  }
  const width = span(FACE_EAR_RIGHT, FACE_EAR_LEFT)
  const length = span(FACE_TOP, FACE_CHIN)
  const forehead = span(FACE_FOREHEAD_RIGHT, FACE_FOREHEAD_LEFT)
  const jaw = span(FACE_JAW_RIGHT, FACE_JAW_LEFT)
  if (width <= 0 || length <= 0 || forehead <= 0 || jaw <= 0) return null
  return { length: length / width, forehead: forehead / width, jaw: jaw / width }
}

export interface FaceProportionsEstimate {
  mean: FaceProportions
  samples: number
}

export function updateFaceProportions(
  estimate: FaceProportionsEstimate | null,
  sample: FaceProportions | null,
  alpha = 0.05
): FaceProportionsEstimate | null {
  if (!sample) return estimate
  if (!estimate) return { mean: { ...sample }, samples: 1 }
  const mix = (key: keyof FaceProportions) =>
    estimate.mean[key] + alpha * (sample[key] - estimate.mean[key])
  return {
    mean: { length: mix('length'), forehead: mix('forehead'), jaw: mix('jaw') },
    samples: estimate.samples + 1
  }
}

function distance(a: FaceProportions, b: FaceProportions): number {
  return Math.sqrt(
    WEIGHTS.length * (a.length - b.length) ** 2 +
      WEIGHTS.forehead * (a.forehead - b.forehead) ** 2 +
      WEIGHTS.jaw * (a.jaw - b.jaw) ** 2
  )
}

export interface FaceShapeResult {
  shape: TryOnFaceShape
  confidence: number
}

export function classifyFaceShape(
  proportions: FaceProportions,
  previous: TryOnFaceShape | null = null
): FaceShapeResult {
  const ranked = (Object.keys(FACE_SHAPE_PROTOTYPES) as TryOnFaceShape[])
    .map((shape) => ({ shape, d: distance(proportions, FACE_SHAPE_PROTOTYPES[shape]) }))
    .sort((a, b) => a.d - b.d)
  const best = ranked[0]!
  const second = ranked[1]!
  let chosen = best
  if (previous && previous !== best.shape) {
    const held = ranked.find((r) => r.shape === previous)!
    if (best.d > held.d * (1 - FACE_SHAPE_HYSTERESIS)) chosen = held
  }
  const runnerUp = chosen === best ? second : best
  const sum = chosen.d + runnerUp.d
  const confidence = sum > 0 ? Math.max(0, (runnerUp.d - chosen.d) / sum) : 0
  return { shape: chosen.shape, confidence }
}
