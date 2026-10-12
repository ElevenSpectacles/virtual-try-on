/**
 * Fit feedback: does the selected frame suit the width of the tracked face?
 * (issue #12). Pure math, no Vue.
 *
 * The rendered frame is always scaled to the face (see `autoMetricScale`), so
 * the picture alone can't tell a customer a frame is too wide for them. This
 * compares the frame's real width (catalog spec or GLB bounding box, both in
 * millimetres) with the customer's face width, estimated in millimetres from
 * two landmark measures: the ear-level width (234/454) and the inter-pupillary
 * distance, whose adult spread (63 mm, SD ~3 mm) is tight enough to act as
 * the ruler. The estimate inherits that spread (about ±5%), which is why the
 * default tolerance band is wider than an optician's.
 */

import { ASSUMED_IPD_METERS } from './tryon'

/** Fit verdict for the host's UI. `null` while there is no stable estimate. */
export type TryOnFitVerdict = 'narrow' | 'good' | 'wide'

export interface TryOnFit {
  verdict: TryOnFitVerdict
  /** Estimated face width at ear level, millimetres. */
  faceWidthMm: number
  /** Total frame width used for the comparison, millimetres. */
  frameWidthMm: number
}

/**
 * Frame width / ear-level face width of a good fit: a frame front about as
 * wide as the face at the temples. Measured on the face fixtures (people
 * wearing catalog frames that fit them, tests/e2e/fit.spec.ts, 2026-10-12):
 * 1.045, 0.970 and 0.979, mean 1.00.
 */
export const FIT_IDEAL_RATIO = 1

/** Default half-width of the "good" band, as a fraction of the ideal width. */
export const FIT_DEFAULT_TOLERANCE = 0.06

/**
 * Extra margin a verdict must cross before it changes, as a fraction of the
 * ideal width, so a face near a band edge doesn't flip the hint back and forth.
 */
export const FIT_HYSTERESIS = 0.015

/**
 * Face width at ear level in millimetres, from pose-compensated normalized
 * measures (ear width and IPD, same units). 0 when either is missing.
 */
export function estimateFaceWidthMm(
  earWidth: number,
  ipd: number,
  assumedIpdMm: number = ASSUMED_IPD_METERS * 1000
): number {
  if (earWidth <= 0 || ipd <= 0) return 0
  return (earWidth / ipd) * assumedIpdMm
}

/**
 * Narrow / good / wide for a frame on a face. `tolerance` is the half-width of
 * the good band as a fraction of the ideal frame width
 * (`faceWidthMm * FIT_IDEAL_RATIO`). With `previous`, the band edge the
 * verdict would cross moves outward by `hysteresis`, so a verdict sticks
 * until the measure clearly leaves it.
 */
export function faceWidthVerdict(
  faceWidthMm: number,
  frameWidthMm: number,
  {
    tolerance = FIT_DEFAULT_TOLERANCE,
    hysteresis = FIT_HYSTERESIS,
    previous = null
  }: {
    tolerance?: number
    hysteresis?: number
    previous?: TryOnFitVerdict | null
  } = {}
): TryOnFitVerdict | null {
  if (faceWidthMm <= 0 || frameWidthMm <= 0) return null
  const ratio = frameWidthMm / (faceWidthMm * FIT_IDEAL_RATIO) - 1
  // Leaving a verdict takes `hysteresis` more than entering it.
  const wideEdge = tolerance + (previous === 'wide' ? -hysteresis : previous ? hysteresis : 0)
  const narrowEdge = -tolerance + (previous === 'narrow' ? hysteresis : previous ? -hysteresis : 0)
  if (ratio > wideEdge) return 'wide'
  if (ratio < narrowEdge) return 'narrow'
  return 'good'
}

/**
 * Running estimate of the face width: an exponential moving average over
 * detections, reported only once `minSamples` have been seen so the first,
 * noisiest frames never produce a verdict.
 */
export interface FaceWidthEstimate {
  mean: number
  samples: number
}

export function updateFaceWidthEstimate(
  estimate: FaceWidthEstimate | null,
  faceWidthMm: number,
  alpha = 0.05
): FaceWidthEstimate | null {
  if (faceWidthMm <= 0) return estimate
  if (!estimate) return { mean: faceWidthMm, samples: 1 }
  return {
    mean: estimate.mean + alpha * (faceWidthMm - estimate.mean),
    samples: estimate.samples + 1
  }
}

/** Detections averaged before the first verdict (~1 s at 30 fps). */
export const FIT_MIN_SAMPLES = 30
