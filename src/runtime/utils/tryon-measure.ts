import {
  ASSUMED_IPD_METERS,
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  IRIS_CENTER_LEFT,
  IRIS_CENTER_RIGHT
} from './tryon'
import type { NormalizedLandmark } from './tryon'

export const IRIS_DIAMETER_MM = 11.7

export const IRIS_RING_RIGHT = [469, 470, 471, 472] as const
export const IRIS_RING_LEFT = [474, 475, 476, 477] as const

export const PD_MIN_MM = 50
export const PD_MAX_MM = 80

export const PD_MAX_YAW_RAD = (12 * Math.PI) / 180
export const PD_MAX_PITCH_RAD = (15 * Math.PI) / 180

export const PD_WINDOW = 90

export const PD_STABLE_SAMPLES = 45

export const PD_STABLE_SPREAD = 0.02

export const EYE_ROTATION_RADIUS_MM = 13.5

export function widthUnitDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  aspect: number
): number {
  const dx = a.x - b.x
  const dy = (a.y - b.y) / (aspect > 0 ? aspect : 1)
  return Math.sqrt(dx * dx + dy * dy)
}

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

export function earLevelWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const right = landmarks[EAR_LEVEL_RIGHT]
  const left = landmarks[EAR_LEVEL_LEFT]
  if (!right || !left) return 0
  return widthUnitDistance(right, left, aspect)
}

export function pupillaryWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const right = landmarks[IRIS_CENTER_RIGHT]
  const left = landmarks[IRIS_CENTER_LEFT]
  if (!right || !left) return 0
  return widthUnitDistance(right, left, aspect)
}

export function pdFromIris(
  ipd: number,
  iris: number,
  irisDiameterMm: number = IRIS_DIAMETER_MM
): number {
  if (ipd <= 0 || iris <= 0) return 0
  return (ipd / iris) * irisDiameterMm
}

export function viewingDistanceMm(
  iris: number,
  hFovDeg: number,
  irisDiameterMm: number = IRIS_DIAMETER_MM
): number {
  if (iris <= 0 || hFovDeg <= 0) return 0
  const halfWidthAtUnitDistance = Math.tan((hFovDeg * Math.PI) / 360)
  return irisDiameterMm / (iris * 2 * halfWidthAtUnitDistance)
}

export const ASSUMED_CAMERA_HFOV_DEG = 62

export function distancePdMm(
  nearPdMm: number,
  distanceMm: number,
  rotationRadiusMm: number = EYE_ROTATION_RADIUS_MM
): number {
  if (nearPdMm <= 0 || distanceMm <= 0) return nearPdMm
  const vergence = Math.atan(nearPdMm / 2 / distanceMm)
  return nearPdMm + 2 * rotationRadiusMm * Math.sin(vergence)
}

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

export interface PdEstimate {
  samples: number[]
  distances: number[]
  earWidths: number[]
  accepted: number
  nearPdMm: number
  pdMm: number
  earWidthMm: number
  spread: number
  stable: boolean
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface PdSample {
  nearPdMm: number
  distanceMm?: number
  earWidthMm?: number
}

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

export function pdConfidence(estimate: PdEstimate | null): number {
  if (!estimate) return 0
  if (estimate.stable) return 1
  return Math.min(estimate.accepted / PD_STABLE_SAMPLES, 1)
}

export function rulerPdMm(
  estimate: PdEstimate | null,
  assumedMm: number = ASSUMED_IPD_METERS * 1000
): number {
  return blendedMeters(estimate, estimate?.nearPdMm ?? 0, assumedMm / 1000) * 1000
}

export function blendedMeters(
  estimate: PdEstimate | null,
  measuredMm: number,
  assumedMeters: number
): number {
  const confidence = pdConfidence(estimate)
  if (confidence <= 0 || measuredMm <= 0) return assumedMeters
  return assumedMeters + (measuredMm / 1000 - assumedMeters) * confidence
}
