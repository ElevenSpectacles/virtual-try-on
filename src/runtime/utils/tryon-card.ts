/**
 * Card calibration (issue #96): ±1 mm PD from a standard ID-1 card held
 * flat against the forehead. Pure math, no DOM.
 *
 * The iris ruler (utils/tryon-measure) is good to ~±2–3 mm. A bank, ID or
 * loyalty card is ISO/IEC 7810 ID-1, 85.60 mm wide to ±0.1 mm, which makes
 * it a far better ruler: held horizontally against the forehead, its two
 * vertical edges are ~250 px apart in a 480 px detection frame at arm's
 * length, so a one-pixel edge error is ~0.4 %.
 *
 * The pipeline, per detection while calibrating:
 * 1. `cardRegion`: the forehead band above the brows, from the landmarks,
 *    wide enough for an off-centre card. The face-landmarker worker crops it
 *    from the frame it just tracked and returns it as a small grey image.
 *    (The crop stays in the browser, like every other frame sample.)
 * 2. `findCardEdges`: the card's left and right edges are the two strongest
 *    vertical-gradient columns at a plausible card width apart, with the
 *    edge running down most of the band (a stray vertical line in the hair
 *    is short).
 * 3. `nearPdFromCard`: mm per pixel at the card, corrected to the eyes'
 *    depth (the card sits ~12 mm in front of them, closer to the camera),
 *    times the IPD in pixels, then vergence-corrected to a distance PD
 *    (`distancePdMm`), like the iris measurement.
 * 4. `updateCardCalibration`: a median over a few agreeing frames, or a
 *    failure after a timeout.
 */

import { distancePdMm } from './tryon-measure'
import type { NormalizedLandmark } from './tryon'

/** ISO/IEC 7810 ID-1 card width, millimetres. */
export const CARD_WIDTH_MM = 85.6

/**
 * How far in front of the pupils the card sits when pressed to the
 * forehead: the brow ridge stands ~8–12 mm proud of the corneas, and the
 * pupil is ~3 mm behind the cornea. 12 mm puts the card's ruler ~2–3 %
 * closer to the camera than the eyes at 40–60 cm.
 */
export const CARD_STANDOFF_MM = 12

/** Agreeing frames for a result. */
export const CARD_SAMPLES = 12

/** Relative spread (half IQR / median) the samples must stay under. */
export const CARD_MAX_SPREAD = 0.012

/** Give up when no stable result after this long, ms. */
export const CARD_TIMEOUT_MS = 10_000

/** Size of the grey crop the worker returns. */
export const CARD_CROP_WIDTH = 320
export const CARD_CROP_HEIGHT = 96

/** A region of the camera frame, normalized `[0, 1]` (raw camera space). */
export interface CardRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The forehead band to search, from the landmarks: centred on the forehead
 * midline (landmark 151), `CARD_REGION_WIDTH_FACTOR`× the ear-level width wide (an 86 mm card is
 * ~0.6× a 145 mm face, so there is room either side), from just above the
 * brows (landmark 9) up by 0.5× the face width (a 54 mm card is ~0.37×). Null when a
 * landmark is missing.
 */
/** Search band width over the ear-level face width. */
export const CARD_REGION_WIDTH_FACTOR = 1.3

/**
 * Card width over the ear-level face width: 85.6 mm against adult faces of
 * ~120–165 mm, with margin. Spans outside it are not a card (a forehead
 * between two hairlines is ~0.8).
 */
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
  // Heights in y units: a width-unit length is `aspect` times longer in y.
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

/**
 * Weakest edge a card may have, relative to the crop's mean gradient. On
 * the face fixtures a drawn card scored 5.4–13.6 and the strongest false
 * pair on a bare forehead (hair strands either side) 2.0: a missed frame is
 * cheap, a hairline taken for a card is a wrong PD.
 */
export const CARD_MIN_EDGE_SCORE = 3

/** Largest difference (grey levels) between the card's two inner sides. */
export const CARD_INNER_TOLERANCE = 24

export interface CardEdges {
  /** Column of the left and right edge, crop pixels (sub-pixel). */
  left: number
  right: number
  /** Edge strength relative to the crop's mean gradient (≥ 1 is above average). */
  score: number
}

/**
 * The card's left and right edges in a grey crop (`width` × `height`, one
 * byte per pixel): a column profile of the horizontal gradient, counting
 * only rows where the gradient is strong (so a long straight edge beats a
 * short bright texture), then the best pair of peaks between `minFraction`
 * and `maxFraction` of the crop width apart (by default, a card's width
 * relative to a face in a `cardRegion` crop). Null when nothing card-like.
 */
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
  // |I(x+1) − I(x−1)| per pixel; the threshold is the crop's mean gradient.
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
  // Peaks: local maxima, refined to sub-pixel with a parabola.
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
  // Median brightness of a column, for the inner-side check below.
  const columnMedian = (x: number) => {
    const column = Math.min(Math.max(Math.round(x), 0), width - 1)
    const values: number[] = []
    for (let y = 0; y < height; y++) values.push(gray[y * width + column]!)
    values.sort((p, q) => p - q)
    return values[values.length >> 1]!
  }
  const inset = Math.max(2, Math.round(width * 0.012))

  // Every plausible pair, scored by its weaker edge (a card has two). Just
  // inside both edges is the card itself, so the two inner sides must look
  // alike: that rejects a card edge paired with a hairline, the face's
  // outline, or the edge of a logo printed on the card (dark inside one
  // edge, card colour inside the other).
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

/**
 * PD in millimetres from one frame, as measured (eyes converged on the
 * screen): the card's width and the IPD, in the same units (camera pixels,
 * or fractions of the frame width), and the viewing distance (mm, for the
 * card-to-eye depth correction; 0 skips it). `distancePdMm` turns it into
 * the optician's distance PD.
 */
export function nearPdFromCard(
  cardWidth: number,
  ipd: number,
  viewingDistanceMm: number = 0
): number {
  if (cardWidth <= 0 || ipd <= 0) return 0
  const mmPerUnitAtCard = CARD_WIDTH_MM / cardWidth
  // The eyes are further away than the card: each pixel spans more there.
  const depth =
    viewingDistanceMm > CARD_STANDOFF_MM
      ? viewingDistanceMm / (viewingDistanceMm - CARD_STANDOFF_MM)
      : 1
  return ipd * mmPerUnitAtCard * depth
}

/**
 * The card's width as a fraction of the camera frame's width, from its
 * edges in a crop of `region` that is `cropWidth` pixels wide.
 */
export function cardWidthInFrame(edges: CardEdges, region: CardRegion, cropWidth: number): number {
  return ((edges.right - edges.left) / cropWidth) * region.width
}

export type TryOnCardCalibrationStatus = 'idle' | 'detecting' | 'done' | 'failed'

export interface CardCalibrationState {
  status: TryOnCardCalibrationStatus
  /** 0 … 1: agreeing frames so far. */
  progress: number
  /** The calibrated distance PD (what an optician measures), mm, once done. */
  pdMm: number | null
  /** The calibrated PD as measured at the screen, mm: the on-screen ruler. */
  nearPdMm: number | null
  /** Recent plausible near-PD readings and their viewing distances. */
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

/**
 * Add one frame's near PD (0 when no card was found) taken at
 * `distanceMm`, at time `now`. Done once the last `CARD_SAMPLES` plausible
 * readings agree within `CARD_MAX_SPREAD`; failed after `CARD_TIMEOUT_MS`
 * without that. Only a detecting state changes.
 */
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

/** Fail a calibration still detecting past the timeout (e.g. no face, so no frames). */
export function expireCardCalibration(
  state: CardCalibrationState,
  now: number
): CardCalibrationState {
  return state.status === 'detecting' && now - state.startedAt >= CARD_TIMEOUT_MS
    ? { ...state, status: 'failed' }
    : state
}
