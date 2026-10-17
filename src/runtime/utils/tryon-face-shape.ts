/**
 * Face shape (issue #98): a coarse oval / round / square / heart / oblong
 * class from landmark proportions, for frame-advisor styling hints. Pure
 * math, no Vue.
 *
 * This is a styling hint, never a filter: the classes are a retail
 * convention, not anatomy, and real faces sit between them. So the result
 * carries a confidence (how much closer the face is to its class than to the
 * next one), and hosts should phrase it softly ("frames that suit oval
 * faces"), never hide frames because of it.
 *
 * Three proportions, each relative to the ear-level width (234 ↔ 454, the
 * widest stable span of the face oval):
 * - length: forehead (10) to chin (152);
 * - forehead: 54 ↔ 284, the upper face-oval points at the temples;
 * - jaw: 172 ↔ 397, the face-oval points at the jaw angle.
 *
 * A single frame's proportions are noisy and expressions move the jaw, so
 * callers average them over frontal frames (`updateFaceProportions`) and the
 * class has hysteresis (`classifyFaceShape` with `previous`).
 */

import { widthUnitDistance } from './tryon-measure'
import type { NormalizedLandmark } from './tryon'
import type { TryOnMeasurements } from '../types/tryon-experience'

export type TryOnFaceShape = NonNullable<TryOnMeasurements['faceShape']>

/** Face proportions, each relative to the ear-level width. */
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

/**
 * Prototype proportions of each class on the MediaPipe mesh (landmark 10 is
 * below the hairline, so lengths are shorter than a tape-measured face).
 * Oval is the balanced middle; round and square are short, with a soft or a
 * wide jaw; heart has a wide forehead over a narrow jaw; oblong is long.
 */
export const FACE_SHAPE_PROTOTYPES: Record<TryOnFaceShape, FaceProportions> = {
  oval: { length: 1.2, forehead: 0.8, jaw: 0.72 },
  round: { length: 1.04, forehead: 0.8, jaw: 0.77 },
  square: { length: 1.08, forehead: 0.85, jaw: 0.86 },
  heart: { length: 1.18, forehead: 0.88, jaw: 0.65 },
  oblong: { length: 1.38, forehead: 0.82, jaw: 0.76 }
}

/**
 * Weight of each proportion in the distance to a prototype. Width ratios
 * vary less between people than length does, so the same absolute
 * difference in them means more.
 */
const WEIGHTS: FaceProportions = { length: 1, forehead: 1.6, jaw: 1.6 }

/**
 * How much closer (relative distance) a new class must be than the current
 * one before the class changes.
 */
export const FACE_SHAPE_HYSTERESIS = 0.15

/** Frontal frames averaged before the first class (~1.5 s at 30 fps). */
export const FACE_SHAPE_MIN_SAMPLES = 45

/** Proportions of one detection; null when a landmark is missing. */
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

/** Running average of the proportions over frontal detections. */
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
  /**
   * 0 … 1: how much closer the face is to `shape` than to the runner-up.
   * Low values mean "between two classes".
   */
  confidence: number
}

/**
 * Nearest prototype. With `previous`, the class changes only when another
 * prototype is closer by more than `FACE_SHAPE_HYSTERESIS` (relative), so a
 * face between two classes doesn't flicker.
 */
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
