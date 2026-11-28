import { ASSUMED_IPD_METERS } from './tryon'

export type TryOnFitVerdict = 'narrow' | 'good' | 'wide'

export interface TryOnFit {
  verdict: TryOnFitVerdict
  faceWidthMm: number
  frameWidthMm: number
}

export const FIT_IDEAL_RATIO = 1.01

export const FIT_DEFAULT_TOLERANCE = 0.06

export const FIT_HYSTERESIS = 0.015

export function estimateFaceWidthMm(
  earWidth: number,
  ipd: number,
  assumedIpdMm: number = ASSUMED_IPD_METERS * 1000
): number {
  if (earWidth <= 0 || ipd <= 0) return 0
  return (earWidth / ipd) * assumedIpdMm
}

function fitDeviation(frameWidthMm: number, faceWidthMm: number): number {
  return frameWidthMm / (faceWidthMm * FIT_IDEAL_RATIO) - 1
}

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
  const ratio = fitDeviation(frameWidthMm, faceWidthMm)
  const wideEdge = tolerance + (previous === 'wide' ? -hysteresis : previous ? hysteresis : 0)
  const narrowEdge = -tolerance + (previous === 'narrow' ? hysteresis : previous ? -hysteresis : 0)
  if (ratio > wideEdge) return 'wide'
  if (ratio < narrowEdge) return 'narrow'
  return 'good'
}

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

export const FIT_MIN_SAMPLES = 30

export function fitVerdictFor(
  frameWidthMm: number,
  faceWidthMm: number,
  tolerance: number = FIT_DEFAULT_TOLERANCE
): TryOnFitVerdict | null {
  return faceWidthVerdict(faceWidthMm, frameWidthMm, { tolerance })
}

export interface TryOnFitRank {
  file: string
  verdict: TryOnFitVerdict
  frameWidthMm: number
  deviation: number
}

export function rankByFit(
  frames: ReadonlyArray<{ file: string; frameWidthMm: number }>,
  faceWidthMm: number,
  tolerance: number = FIT_DEFAULT_TOLERANCE
): TryOnFitRank[] {
  if (faceWidthMm <= 0) return []
  const ranked: TryOnFitRank[] = []
  for (const { file, frameWidthMm } of frames) {
    const verdict = fitVerdictFor(frameWidthMm, faceWidthMm, tolerance)
    if (!verdict) continue
    ranked.push({ file, verdict, frameWidthMm, deviation: fitDeviation(frameWidthMm, faceWidthMm) })
  }
  return ranked.sort((a, b) => Math.abs(a.deviation) - Math.abs(b.deviation))
}
