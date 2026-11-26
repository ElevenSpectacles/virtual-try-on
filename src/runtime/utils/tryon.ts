export type EnvPreset =
  | 'studio'
  | 'city'
  | 'sunset'
  | 'dawn'
  | 'forest'
  | 'night'
  | 'snow'

export interface NormalizedLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface NdcPoint {
  x: number
  y: number
}

export function mirrorNormalizedX(x: number): number {
  return 1 - x
}

export function landmarkToNdc(
  landmark: NormalizedLandmark,
  { mirror = true }: { mirror?: boolean } = {}
): NdcPoint {
  const nx = mirror ? mirrorNormalizedX(landmark.x) : landmark.x
  return {
    x: nx * 2 - 1,
    y: -(landmark.y * 2 - 1)
  }
}

export function frustumHalfExtents(
  aspect: number,
  fovDeg: number,
  distance: number
): { halfWidth: number; halfHeight: number } {
  const halfHeight = Math.tan((fovDeg * Math.PI) / 180 / 2) * distance
  return { halfWidth: halfHeight * aspect, halfHeight }
}

export const TRYON_CAMERA = {
  fovDeg: 63,
  distance: 3
} as const

export function landmarkToWorld(
  landmark: NormalizedLandmark,
  aspect: number,
  { mirror = true }: { mirror?: boolean } = {}
): { x: number; y: number } {
  const ndc = landmarkToNdc(landmark, { mirror })
  const { halfWidth, halfHeight } = frustumHalfExtents(
    aspect,
    TRYON_CAMERA.fovDeg,
    TRYON_CAMERA.distance
  )
  return { x: ndc.x * halfWidth, y: ndc.y * halfHeight }
}

export const ASSUMED_FACE_WIDTH_METERS = 0.14

export function worldPlaneWidth(
  aspect: number,
  fovDeg: number = TRYON_CAMERA.fovDeg,
  distance: number = TRYON_CAMERA.distance
): number {
  return frustumHalfExtents(aspect, fovDeg, distance).halfWidth * 2
}

export function computeMetricBaseScale(
  aspect: number,
  referenceFaceWidth: number,
  assumedFaceWidthMeters: number = ASSUMED_FACE_WIDTH_METERS
): number {
  if (referenceFaceWidth <= 0 || assumedFaceWidthMeters <= 0) return 1
  return (referenceFaceWidth * worldPlaneWidth(aspect)) / assumedFaceWidthMeters
}

export const ASSUMED_HEAD_DEPTH_METERS = 0.09

export interface HeadOccluderGeometry {
  radiusX: number
  radiusY: number
  radiusZ: number
}

export function computeHeadOccluderGeometry(
  faceWorldHalfWidth: number,
  {
    widthRatio = 1,
    heightRatio = 1.3,
    depthRatio = 1.2
  }: Partial<Record<'widthRatio' | 'heightRatio' | 'depthRatio', number>> = {}
): HeadOccluderGeometry {
  return {
    radiusX: faceWorldHalfWidth * widthRatio,
    radiusY: faceWorldHalfWidth * heightRatio,
    radiusZ: faceWorldHalfWidth * depthRatio
  }
}

export function landmarkDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  aspect: number = 1
): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) / (aspect > 0 ? aspect : 1))
}

export function getFaceWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const left = landmarks[127]
  const right = landmarks[356]
  if (!left || !right) return 0
  return landmarkDistance(left, right, aspect)
}

export const EAR_LEVEL_RIGHT = 234
export const EAR_LEVEL_LEFT = 454

export const ASSUMED_EAR_WIDTH_METERS = 0.148

export function getEarWidth(landmarks: NormalizedLandmark[], aspect: number = 1): number {
  const right = landmarks[EAR_LEVEL_RIGHT]
  const left = landmarks[EAR_LEVEL_LEFT]
  if (!right || !left) return 0
  return landmarkDistance(right, left, aspect)
}

export const ASSUMED_IPD_METERS = 0.063

export const IRIS_CENTER_RIGHT = 468
export const IRIS_CENTER_LEFT = 473

export const TRYON_ANCHOR_INDICES = [168, 6, 197, 5, 133, 362] as const

export function computeAnchorCentroid(
  landmarks: NormalizedLandmark[],
  indices: readonly number[]
): NormalizedLandmark | null {
  let x = 0
  let y = 0
  let z = 0
  let count = 0
  for (const index of indices) {
    const landmark = landmarks[index]
    if (!landmark) continue
    x += landmark.x
    y += landmark.y
    z += landmark.z ?? 0
    count++
  }
  if (count === 0) return null
  return { x: x / count, y: y / count, z: z / count }
}

export const FRAME_FIT_SCALE_BOOST = 1.12

export const FRAME_BRIDGE_STANDOFF_METERS = 0.012

export function headForwardOffset(
  euler: { x: number; y: number; z: number },
  distance: number
): { x: number; y: number; z: number } {
  const cosX = Math.cos(euler.x)
  return {
    x: distance * Math.sin(euler.y) * cosX,
    y: -distance * Math.sin(euler.x),
    z: distance * Math.cos(euler.y) * cosX
  }
}

export function getInterPupillaryDistance(
  landmarks: NormalizedLandmark[],
  aspect: number = 1
): number {
  const right = landmarks[IRIS_CENTER_RIGHT]
  const left = landmarks[IRIS_CENTER_LEFT]
  if (!right || !left) return 0
  return landmarkDistance(right, left, aspect)
}

export const EYE_RIGHT_TOP = 159
export const EYE_RIGHT_BOTTOM = 145
export const EYE_RIGHT_OUTER = 33
export const EYE_RIGHT_INNER = 133
export const EYE_LEFT_TOP = 386
export const EYE_LEFT_BOTTOM = 374
export const EYE_LEFT_OUTER = 263
export const EYE_LEFT_INNER = 362

export const BLINK_EYE_ASPECT_RATIO = 0.17

export function getEyeAspectRatio(
  landmarks: NormalizedLandmark[],
  aspect: number = 1
): number {
  const pairs: ReadonlyArray<readonly [number, number, number, number]> = [
    [EYE_RIGHT_TOP, EYE_RIGHT_BOTTOM, EYE_RIGHT_OUTER, EYE_RIGHT_INNER],
    [EYE_LEFT_TOP, EYE_LEFT_BOTTOM, EYE_LEFT_OUTER, EYE_LEFT_INNER]
  ]
  let sum = 0
  for (const [top, bottom, outer, inner] of pairs) {
    const t = landmarks[top]
    const b = landmarks[bottom]
    const o = landmarks[outer]
    const i = landmarks[inner]
    if (!t || !b || !o || !i) return 0
    const width = landmarkDistance(o, i)
    if (width <= 0 || aspect <= 0) return 0
    sum += landmarkDistance(t, b) / aspect / width
  }
  return sum / pairs.length
}

export function isBlinking(
  landmarks: NormalizedLandmark[],
  aspect: number = 1,
  threshold: number = BLINK_EYE_ASPECT_RATIO
): boolean {
  const ratio = getEyeAspectRatio(landmarks, aspect)
  return ratio > 0 && ratio < threshold
}

export const BLINK_SCORE_THRESHOLD = 0.5

export function shouldHoldScaleForBlink(
  blinkScore: number | null,
  landmarks: NormalizedLandmark[],
  aspect: number = 1
): boolean {
  if (blinkScore !== null) return blinkScore > BLINK_SCORE_THRESHOLD
  return isBlinking(landmarks, aspect)
}

export function compensateMeasureForPose(
  measure: number,
  yaw: number,
  pitch: number = 0,
  roll: number = 0,
  minFactor: number = 0.5
): number {
  const x = Math.cos(yaw) * Math.cos(roll) + Math.sin(yaw) * Math.sin(pitch) * Math.sin(roll)
  const y = Math.cos(pitch) * Math.sin(roll)
  return measure / Math.max(Math.hypot(x, y), minFactor)
}

export function computeMetricScaleFromMeasure(
  aspect: number,
  normalizedMeasure: number,
  assumedMeters: number
): number {
  if (normalizedMeasure <= 0 || assumedMeters <= 0) return 1
  return (normalizedMeasure * worldPlaneWidth(aspect)) / assumedMeters
}

export interface OneEuroState {
  value: number
  derivative: number
}

export interface OneEuroFilterOptions {
  minCutoff?: number
  beta?: number
  dCutoff?: number
}

export function oneEuroAlpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dtSeconds)
}

export function oneEuroFilter(
  state: OneEuroState | null,
  value: number,
  dtSeconds: number,
  { minCutoff = 1, beta = 0, dCutoff = 1 }: OneEuroFilterOptions = {}
): OneEuroState {
  if (!state) return { value, derivative: 0 }
  if (dtSeconds <= 0) return state
  const rawDerivative = (value - state.value) / dtSeconds
  const dAlpha = oneEuroAlpha(dCutoff, dtSeconds)
  const derivative = dAlpha * rawDerivative + (1 - dAlpha) * state.derivative
  const cutoff = minCutoff + beta * Math.abs(derivative)
  const alpha = oneEuroAlpha(cutoff, dtSeconds)
  return { value: alpha * value + (1 - alpha) * state.value, derivative }
}

export const ONE_EURO_MAX_PREDICTION_SECONDS = 0.1

export function predictOneEuro(
  state: OneEuroState,
  measurement: number,
  dtSeconds: number,
  maxOvershoot = 1.2,
  minSpeed = 0
): number {
  if (dtSeconds <= 0) return state.value
  const dt = Math.min(dtSeconds, ONE_EURO_MAX_PREDICTION_SECONDS)
  const speed = Math.abs(state.derivative)
  const velocity =
    speed > minSpeed ? Math.sign(state.derivative) * (speed - minSpeed) : 0
  const predicted = state.value + velocity * dt
  const gap = measurement - state.value
  const overshoot = predicted - measurement
  if (
    gap !== 0 &&
    Math.sign(overshoot) === Math.sign(gap) &&
    Math.abs(overshoot) > Math.abs(gap) * (maxOvershoot - 1)
  ) {
    return measurement + gap * (maxOvershoot - 1)
  }
  return predicted
}

export function estimateDistanceScale(
  faceWidth: number,
  referenceWidth: number
): number {
  if (!faceWidth || faceWidth <= 0 || !referenceWidth || referenceWidth <= 0)
    return 1
  return faceWidth / referenceWidth
}

export interface ObjectCoverWindow {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const FULL_OBJECT_COVER_WINDOW: ObjectCoverWindow = {
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1
}

export function objectCoverWindow(
  mediaAspect: number,
  containerAspect: number
): ObjectCoverWindow {
  if (!mediaAspect || !containerAspect || mediaAspect === containerAspect) {
    return FULL_OBJECT_COVER_WINDOW
  }
  if (mediaAspect > containerAspect) {
    const visibleWidth = containerAspect / mediaAspect
    const margin = (1 - visibleWidth) / 2
    return { xMin: margin, xMax: 1 - margin, yMin: 0, yMax: 1 }
  }
  const visibleHeight = mediaAspect / containerAspect
  const margin = (1 - visibleHeight) / 2
  return { xMin: 0, xMax: 1, yMin: margin, yMax: 1 - margin }
}

export function mapLandmarkToObjectCover<T extends NormalizedLandmark>(
  landmark: T,
  window: ObjectCoverWindow
): T {
  const width = window.xMax - window.xMin
  const height = window.yMax - window.yMin
  return {
    ...landmark,
    x: width > 0 ? (landmark.x - window.xMin) / width : landmark.x,
    y: height > 0 ? (landmark.y - window.yMin) / height : landmark.y
  }
}
