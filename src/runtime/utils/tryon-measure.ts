/**
 * True-to-size measurement (issue #92): the shopper's pupillary distance in
 * millimetres, from the iris. Pure math, no Vue.
 *
 * Every scale source in the placement is a normalized on-screen measure that
 * needs a real-world length to become metres. Until now that length was an
 * assumed population average (`ASSUMED_IPD_METERS`, `ASSUMED_EAR_WIDTH_METERS`),
 * so a 56 mm-PD face and a 70 mm-PD face got frames sized against the same
 * ruler. The iris is a better ruler: the horizontal visible iris diameter
 * (HVID) of adults is ~11.7 mm with a spread of only ~0.5 mm, and MediaPipe's
 * FaceLandmarker returns each iris ring (468–477). Iris diameter → mm per
 * normalized unit → the PD in millimetres, which then replaces the assumed
 * IPD as the ruler of every other measure.
 *
 * A single frame is noisy (the iris is ~20 px wide in the 480 px detection
 * input, so half a pixel of landmark noise is ~2.5 %), so samples are
 * accepted only on frontal, open-eyed frames, and the PD is the median of a
 * few seconds of them. Once the spread is small it freezes, so the frame
 * doesn't "breathe" with the noise. While samples accumulate, `pdConfidence`
 * ramps from 0 to 1 and callers blend from the assumed value, so the switch
 * to the measured size has no visible jump.
 *
 * Sources: HVID 11.7 ± 0.5 mm (Caroline & Andre); the MediaPipe Iris paper
 * (Ablavatski et al., 2020, arXiv:2006.11341) uses the same constant for
 * metric depth.
 */

import {
  ASSUMED_IPD_METERS,
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  IRIS_CENTER_LEFT,
  IRIS_CENTER_RIGHT
} from './tryon'
import type { NormalizedLandmark } from './tryon'

/** Mean adult horizontal visible iris diameter, millimetres. */
export const IRIS_DIAMETER_MM = 11.7

/** Iris-ring landmarks around each iris centre (FaceLandmarker, 478 points). */
export const IRIS_RING_RIGHT = [469, 470, 471, 472] as const
export const IRIS_RING_LEFT = [474, 475, 476, 477] as const

/**
 * Plausible adult PD range, millimetres. Samples outside it are tracker
 * glitches (a ring collapsed during a squint, an iris mislocated), not faces.
 */
export const PD_MIN_MM = 50
export const PD_MAX_MM = 80

/**
 * Head turn and nod beyond which a sample is rejected. The IPD foreshortens
 * by cos(yaw) while the iris ring (a circle) only partly does, so the ratio
 * is only trustworthy near frontal: 12° keeps the bias under 1 %.
 */
export const PD_MAX_YAW_RAD = (12 * Math.PI) / 180
export const PD_MAX_PITCH_RAD = (15 * Math.PI) / 180

/** Samples kept for the median (~3 s of accepted frames at 30 fps). */
export const PD_WINDOW = 90

/** Accepted samples before the PD can freeze (and confidence reaches 1). */
export const PD_STABLE_SAMPLES = 45

/**
 * Relative spread (half the interquartile range / median) under which the PD
 * freezes. 2 % of a 63 mm PD is 1.3 mm. The interquartile range, not the
 * median absolute deviation: a tracker flipping between two values would
 * give a MAD of 0 and freeze on one of them.
 */
export const PD_STABLE_SPREAD = 0.02

/**
 * Distance from the eye's centre of rotation to the front of the cornea, mm.
 * Converging on a screen turns each eye inward, which moves the iris centres
 * closer together by about this lever arm times the vergence angle.
 */
export const EYE_ROTATION_RADIUS_MM = 13.5

/**
 * A distance between two normalized landmarks in "width units" (fractions of
 * the image width): normalized y is a fraction of the height, so it is scaled
 * by height / width. `aspect` is the image's width / height.
 */
export function widthUnitDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  aspect: number
): number {
  const dx = a.x - b.x
  const dy = (a.y - b.y) / (aspect > 0 ? aspect : 1)
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Mean iris diameter of both eyes, in width units: twice the mean distance
 * of each eye's four ring points from its centre. Order-independent, so it
 * does not care which ring point MediaPipe lists first. 0 when the result
 * has no iris landmarks (468-point model).
 */
export function irisDiameter(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  let sum = 0
  let count = 0
  for (const [center, ring] of [
    [IRIS_CENTER_RIGHT, IRIS_RING_RIGHT],
    [IRIS_CENTER_LEFT, IRIS_RING_LEFT]
  ] as const) {
    const c = landmarks[center]
    if (!c) return 0
    for (const index of ring) {
      const point = landmarks[index]
      if (!point) return 0
      sum += widthUnitDistance(c, point, aspect)
      count++
    }
  }
  return count ? (2 * sum) / count : 0
}

/** Ear-level face width (234 ↔ 454), in width units; 0 when absent. */
export function earLevelWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const right = landmarks[EAR_LEVEL_RIGHT]
  const left = landmarks[EAR_LEVEL_LEFT]
  if (!right || !left) return 0
  return widthUnitDistance(right, left, aspect)
}

/** Distance between the iris centres, in width units; 0 when absent. */
export function pupillaryWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const right = landmarks[IRIS_CENTER_RIGHT]
  const left = landmarks[IRIS_CENTER_LEFT]
  if (!right || !left) return 0
  return widthUnitDistance(right, left, aspect)
}

/**
 * PD in millimetres from the IPD and the iris diameter (same units, so the
 * camera distance cancels out). 0 when either is missing.
 */
export function pdFromIris(
  ipd: number,
  iris: number,
  irisDiameterMm: number = IRIS_DIAMETER_MM
): number {
  if (ipd <= 0 || iris <= 0) return 0
  return (ipd / iris) * irisDiameterMm
}

/**
 * Camera-to-eye distance in millimetres from the iris's apparent size, for a
 * camera of horizontal field of view `hFovDeg`. A webcam's FOV is not known,
 * so this is a ±20 % estimate: good enough for the small vergence correction
 * below, not for anything else.
 */
export function viewingDistanceMm(
  iris: number,
  hFovDeg: number,
  irisDiameterMm: number = IRIS_DIAMETER_MM
): number {
  if (iris <= 0 || hFovDeg <= 0) return 0
  const halfWidthAtUnitDistance = Math.tan((hFovDeg * Math.PI) / 360)
  return irisDiameterMm / (iris * 2 * halfWidthAtUnitDistance)
}

/**
 * Horizontal field of view assumed for the vergence correction. Laptop
 * webcams are ~60–70° wide, phone front cameras in portrait ~50–60°; the
 * correction is ~1.7 mm, so a 25 % error in the distance moves the PD by
 * ~0.4 mm.
 */
export const ASSUMED_CAMERA_HFOV_DEG = 62

/**
 * Distance PD (what an optician measures, eyes looking far) from the PD
 * measured while the eyes converge on a screen `distanceMm` away. Each eye
 * turns inward by atan((PD/2) / distance), pulling its iris centre in by
 * `EYE_ROTATION_RADIUS_MM` times that: about 1.7 mm in total at 50 cm.
 */
export function distancePdMm(
  nearPdMm: number,
  distanceMm: number,
  rotationRadiusMm: number = EYE_ROTATION_RADIUS_MM
): number {
  if (nearPdMm <= 0 || distanceMm <= 0) return nearPdMm
  const vergence = Math.atan(nearPdMm / 2 / distanceMm)
  return nearPdMm + 2 * rotationRadiusMm * Math.sin(vergence)
}

/** Whether a detection is frontal and open-eyed enough to measure the PD on. */
export function acceptPdSample({
  yaw,
  pitch,
  blinking
}: {
  yaw: number
  pitch: number
  blinking: boolean
}): boolean {
  return !blinking && Math.abs(yaw) <= PD_MAX_YAW_RAD && Math.abs(pitch) <= PD_MAX_PITCH_RAD
}

/** Running PD measurement: the recent samples, their median and whether it froze. */
export interface PdEstimate {
  /** Recent accepted near-PD samples, mm (oldest first, at most `PD_WINDOW`). */
  samples: number[]
  /** Viewing distance of each sample, mm (0 when unknown). */
  distances: number[]
  /** Ear-level face width of each sample, mm (0 when unknown). */
  earWidths: number[]
  /** Accepted samples so far (not capped by the window). */
  accepted: number
  /** Median near PD, mm: the ruler for the on-screen measures. */
  nearPdMm: number
  /** Median distance PD, mm: what an optician would measure. */
  pdMm: number
  /** Median ear-level face width (landmarks 234/454), mm; 0 when unknown. */
  earWidthMm: number
  /** Half the interquartile range over the median. */
  spread: number
  /** Frozen: further samples are ignored. */
  stable: boolean
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** One frontal, open-eyed detection's measures, all in millimetres. */
export interface PdSample {
  /** PD with the eyes converged on the screen (`pdFromIris`). */
  nearPdMm: number
  /** Camera distance (`viewingDistanceMm`); 0 when unknown. */
  distanceMm?: number
  /** Ear-level face width on the same iris ruler; 0 when unknown. */
  earWidthMm?: number
}

/** Half the distance between the first and third quartiles. */
function halfInterquartile(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => {
    const position = (sorted.length - 1) * q
    const low = Math.floor(position)
    const high = Math.ceil(position)
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
  }
  return (at(0.75) - at(0.25)) / 2
}

/**
 * Add one sample. Samples whose PD is outside the plausible range are
 * dropped; a stable estimate is returned unchanged.
 */
export function updatePdEstimate(
  estimate: PdEstimate | null,
  { nearPdMm, distanceMm = 0, earWidthMm = 0 }: PdSample
): PdEstimate | null {
  if (estimate?.stable) return estimate
  if (!(nearPdMm >= PD_MIN_MM && nearPdMm <= PD_MAX_MM)) return estimate
  const samples = [...(estimate?.samples ?? []), nearPdMm].slice(-PD_WINDOW)
  const distances = [...(estimate?.distances ?? []), distanceMm].slice(-PD_WINDOW)
  const earWidths = [...(estimate?.earWidths ?? []), earWidthMm].slice(-PD_WINDOW)
  const accepted = (estimate?.accepted ?? 0) + 1
  const near = median(samples)
  const spread = near > 0 ? halfInterquartile(samples) / near : 1
  const distance = median(distances.filter((d) => d > 0))
  return {
    samples,
    distances,
    earWidths,
    accepted,
    nearPdMm: near,
    pdMm: distancePdMm(near, distance),
    earWidthMm: median(earWidths.filter((w) => w > 0)),
    spread,
    stable: accepted >= PD_STABLE_SAMPLES && spread <= PD_STABLE_SPREAD
  }
}

/**
 * 0 … 1: how much to trust the measured PD over the assumed one. Ramps with
 * the accepted samples, so the scale eases from the assumed size to the
 * measured one over the first second or two instead of jumping.
 */
export function pdConfidence(estimate: PdEstimate | null): number {
  if (!estimate) return 0
  if (estimate.stable) return 1
  return Math.min(estimate.accepted / PD_STABLE_SAMPLES, 1)
}

/**
 * The near PD to use as the ruler, mm: the assumed IPD blended toward the
 * measured median by `pdConfidence`.
 */
export function rulerPdMm(
  estimate: PdEstimate | null,
  assumedMm: number = ASSUMED_IPD_METERS * 1000
): number {
  return blendedMeters(estimate, estimate?.nearPdMm ?? 0, assumedMm / 1000) * 1000
}

/**
 * Real-world length (metres) to divide a normalized measure by: `assumed`
 * blended toward the measured length by `pdConfidence`. `measuredMm` 0 (not
 * measured) keeps `assumed`.
 */
export function blendedMeters(
  estimate: PdEstimate | null,
  measuredMm: number,
  assumedMeters: number
): number {
  const confidence = pdConfidence(estimate)
  if (confidence <= 0 || measuredMm <= 0) return assumedMeters
  return assumedMeters + (measuredMm / 1000 - assumedMeters) * confidence
}
