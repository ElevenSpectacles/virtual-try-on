import { distancePdMm } from './tryon-measure'
import type { NormalizedLandmark } from './tryon'

export const CARD_WIDTH_MM = 85.6

export const CARD_STANDOFF_MM = 12

export const CARD_SAMPLES = 12

export const CARD_MAX_SPREAD = 0.012

export const CARD_TIMEOUT_MS = 10_000

export const CARD_CROP_WIDTH = 320
export const CARD_CROP_HEIGHT = 96

export interface CardRegion {
  x: number
  y: number
  width: number
  height: number
}

export const CARD_REGION_WIDTH_FACTOR = 1.3

export const CARD_FACE_RATIO = { min: 0.45, max: 0.76 } as const

export function cardRegion(landmarks: NormalizedLandmark[], aspect: number = 1): CardRegion | null {
  const right = landmarks[234]
  const left = landmarks[454]
  const forehead = landmarks[151]
  const glabella = landmarks[9]
  if (!right || !left || !forehead || !glabella) return null
  const faceWidth = Math.abs(left.x - right.x)
  if (faceWidth <= 0) return null
  const width = Math.min(faceWidth * CARD_REGION_WIDTH_FACTOR, 1)
  const height = Math.min(faceWidth * 0.5 * (aspect > 0 ? aspect : 1), 1)
  const bottom = glabella.y - faceWidth * 0.02 * aspect
  const clamp = (v: number, size: number) => Math.min(Math.max(v, 0), 1 - size)
  return {
    x: clamp(forehead.x - width / 2, width),
    y: clamp(bottom - height, height),
    width,
    height
  }
}

export const CARD_MIN_EDGE_SCORE = 3

export const CARD_INNER_TOLERANCE = 24

export interface CardEdges {
  left: number
  right: number
  score: number
}

export function findCardEdges(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  {
    minFraction = CARD_FACE_RATIO.min / CARD_REGION_WIDTH_FACTOR,
    maxFraction = CARD_FACE_RATIO.max / CARD_REGION_WIDTH_FACTOR
  }: { minFraction?: number; maxFraction?: number } = {}
): CardEdges | null {
  if (width < 8 || height < 4) return null
  const gradient = new Float32Array(width * height)
  let total = 0
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width - 1; x++) {
      const g = Math.abs(gray[y * width + x + 1]! - gray[y * width + x - 1]!)
      gradient[y * width + x] = g
      total += g
    }
  }
  const mean = total / (height * (width - 2))
  if (mean <= 0) return null
  const threshold = mean * 2
  const profile = new Float32Array(width)
  for (let x = 1; x < width - 1; x++) {
    let sum = 0
    for (let y = 0; y < height; y++) {
      const g = gradient[y * width + x]!
      if (g > threshold) sum += g
    }
    profile[x] = sum / height
  }
  const peaks: { x: number; value: number }[] = []
  for (let x = 2; x < width - 2; x++) {
    const v = profile[x]!
    if (v > 0 && v >= profile[x - 1]! && v > profile[x + 1]!) {
      const a = profile[x - 1]!
      const c = profile[x + 1]!
      const denominator = a - 2 * v + c
      const offset = denominator !== 0 ? (0.5 * (a - c)) / denominator : 0
      peaks.push({ x: x + Math.max(-0.5, Math.min(0.5, offset)), value: v })
    }
  }
  const columnMedian = (x: number) => {
    const column = Math.min(Math.max(Math.round(x), 0), width - 1)
    const values: number[] = []
    for (let y = 0; y < height; y++) values.push(gray[y * width + column]!)
    values.sort((p, q) => p - q)
    return values[values.length >> 1]!
  }
  const inset = Math.max(2, Math.round(width * 0.012))

  const pairs: CardEdges[] = []
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const a = peaks[i]!
      const b = peaks[j]!
      const span = (b.x - a.x) / width
      if (span < minFraction || span > maxFraction) continue
      if (Math.abs(columnMedian(a.x + inset) - columnMedian(b.x - inset)) > CARD_INNER_TOLERANCE) {
        continue
      }
      pairs.push({ left: a.x, right: b.x, score: Math.min(a.value, b.value) / mean })
    }
  }
  let best: CardEdges | null = null
  for (const pair of pairs) if (!best || pair.score > best.score) best = pair
  return best && best.score >= CARD_MIN_EDGE_SCORE ? best : null
}

export function nearPdFromCard(
  cardWidth: number,
  ipd: number,
  viewingDistanceMm: number = 0
): number {
  if (cardWidth <= 0 || ipd <= 0) return 0
  const mmPerUnitAtCard = CARD_WIDTH_MM / cardWidth
  const depth =
    viewingDistanceMm > CARD_STANDOFF_MM
      ? viewingDistanceMm / (viewingDistanceMm - CARD_STANDOFF_MM)
      : 1
  return ipd * mmPerUnitAtCard * depth
}

export function cardWidthInFrame(edges: CardEdges, region: CardRegion, cropWidth: number): number {
  return ((edges.right - edges.left) / cropWidth) * region.width
}

export type TryOnCardCalibrationStatus = 'idle' | 'detecting' | 'done' | 'failed'

export interface CardCalibrationState {
  status: TryOnCardCalibrationStatus
  progress: number
  pdMm: number | null
  nearPdMm: number | null
  samples: number[]
  distances: number[]
  startedAt: number
}

export const IDLE_CARD_CALIBRATION: CardCalibrationState = {
  status: 'idle',
  progress: 0,
  pdMm: null,
  nearPdMm: null,
  samples: [],
  distances: [],
  startedAt: 0
}

export function startCardCalibration(now: number): CardCalibrationState {
  return { ...IDLE_CARD_CALIBRATION, status: 'detecting', startedAt: now }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function halfIqr(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.round((sorted.length - 1) * q)]!
  return (at(0.75) - at(0.25)) / 2
}

export function updateCardCalibration(
  state: CardCalibrationState,
  nearPdMm: number,
  distanceMm: number,
  now: number
): CardCalibrationState {
  if (state.status !== 'detecting') return state
  const plausible = nearPdMm >= 45 && nearPdMm <= 85
  const samples = plausible ? [...state.samples, nearPdMm].slice(-CARD_SAMPLES) : state.samples
  const distances = plausible
    ? [...state.distances, distanceMm].slice(-CARD_SAMPLES)
    : state.distances
  const centre = samples.length ? median(samples) : 0
  if (samples.length >= CARD_SAMPLES && halfIqr(samples) / centre <= CARD_MAX_SPREAD) {
    const known = distances.filter((d) => d > 0)
    const distance = known.length ? median(known) : 0
    return {
      ...state,
      status: 'done',
      progress: 1,
      nearPdMm: centre,
      pdMm: Math.round(distancePdMm(centre, distance) * 2) / 2,
      samples,
      distances
    }
  }
  if (now - state.startedAt >= CARD_TIMEOUT_MS) {
    return { ...state, status: 'failed', samples, distances }
  }
  return {
    ...state,
    progress: Math.min(samples.length / CARD_SAMPLES, 0.95),
    samples,
    distances
  }
}

export function expireCardCalibration(
  state: CardCalibrationState,
  now: number
): CardCalibrationState {
  return state.status === 'detecting' && now - state.startedAt >= CARD_TIMEOUT_MS
    ? { ...state, status: 'failed' }
    : state
}
