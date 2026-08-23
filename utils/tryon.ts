/**
 * Virtual try-on compositing helpers.
 *
 * These functions answer the "how do the tracked landmarks agree with a
 * mirrored front-camera preview?" half of the compositing question. They are
 * pure math so they can be unit-tested without a camera, a GPU, or MediaPipe.
 *
 * Coordinate conventions
 * ----------------------
 * A face-tracking graph (MediaPipe FaceLandmarker) runs on the *raw* camera
 * frame and returns landmarks normalized to `[0, 1]`, with `x` measured from
 * the LEFT edge of that raw frame and `y` from the TOP.
 *
 * The front-camera preview, by convention, is displayed mirrored
 * (`transform: scaleX(-1)` on the `<video>`) so it reads like a mirror. We
 * mirror the video ONCE, on the DOM element, and flip the landmark `x` to
 * match — never mirror the canvas as well. Mirroring both layers is the
 * classic way to get a frame that tracks the head backwards.
 */

/** Preset HDRIs shipped by @tresjs/cientos (loaded from the Tresjs/assets CDN). */
export type EnvPreset =
  | 'studio'
  | 'city'
  | 'sunset'
  | 'dawn'
  | 'forest'
  | 'night'
  | 'snow'

/** A normalized landmark as emitted by MediaPipe (raw-camera space). */
export interface NormalizedLandmark {
  /** `[0, 1]`, from the left edge of the raw (un-mirrored) camera frame. */
  x: number
  /** `[0, 1]`, from the top edge of the frame. */
  y: number
  /** Optional normalized depth; unused by the 2D prototype. */
  z?: number
  /** Likelihood of the landmark being visible within the image ([0, 1]). */
  visibility?: number
}

/** A point in Three.js normalized device coordinates (`[-1, 1]`, y-up). */
export interface NdcPoint {
  x: number
  y: number
}

/**
 * Mirror a normalized `x` so it lines up with a horizontally-mirrored
 * (`scaleX(-1)`) front-camera preview.
 *
 * @example mirrorNormalizedX(0) === 1 // left edge of the raw frame is the
 * right edge of the mirrored preview.
 */
export function mirrorNormalizedX(x: number): number {
  return 1 - x
}

/**
 * Convert a normalized landmark (raw-camera space, y-down) into Three.js
 * normalized device coordinates (`[-1, 1]`, y-up), applying the front-camera
 * mirror on `x` so the point sits under the same spot of the mirrored
 * `<video>` layer.
 *
 * Pass `mirror: false` to see the "mirror the canvas too" bug: the frame ends
 * up on the opposite side of the head from where the user sees their face.
 */
export function landmarkToNdc(
  landmark: NormalizedLandmark,
  { mirror = true }: { mirror?: boolean } = {}
): NdcPoint {
  const nx = mirror ? mirrorNormalizedX(landmark.x) : landmark.x
  return {
    x: nx * 2 - 1,
    // Image space is top-down; NDC (and Three.js world) is bottom-up.
    y: -(landmark.y * 2 - 1)
  }
}

/**
 * Half-extents of the world plane visible at `distance` in front of a
 * perspective camera — i.e. how much world space the frustum spans at the
 * depth the frame sits at. Used to turn NDC into world units.
 */
export function frustumHalfExtents(
  aspect: number,
  fovDeg: number,
  distance: number
): { halfWidth: number; halfHeight: number } {
  const halfHeight = Math.tan((fovDeg * Math.PI) / 180 / 2) * distance
  return { halfWidth: halfHeight * aspect, halfHeight }
}

/**
 * Perspective camera used by the try-on scene (kept in one place so the
 * DOM overlay and the WebGL scene agree on the projection).
 *
 * The vertical FOV matches the ~63° canonical camera MediaPipe's facial
 * transformation matrix assumes (and real phone front cameras approximate).
 */
export const TRYON_CAMERA = {
  fovDeg: 63,
  /** Distance from the camera to the frame plane (world units). */
  distance: 3
} as const

/**
 * Map a normalized landmark straight to a world-space `{ x, y }` on the frame
 * plane, honouring the front-camera mirror. This is the one call the scene
 * needs per frame to place the glasses over the tracked face.
 */
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

/** Assumed real-world face width (cheek-to-cheek) used to derive a metric base scale. */
export const ASSUMED_FACE_WIDTH_METERS = 0.14

/**
 * Full width (in world units) of the frame plane visible at `distance` in
 * front of the camera, at the given aspect ratio.
 */
export function worldPlaneWidth(
  aspect: number,
  fovDeg: number = TRYON_CAMERA.fovDeg,
  distance: number = TRYON_CAMERA.distance
): number {
  return frustumHalfExtents(aspect, fovDeg, distance).halfWidth * 2
}

/**
 * Derive a physically-grounded base scale for the GLB models (which are
 * authored in meters) from the calibration-time normalized face width.
 *
 * `referenceFaceWidth` is the normalized (`[0, 1]`) cheek-to-cheek width
 * measured at the distance the try-on is calibrated for. Converting that
 * fraction of the visible world-plane width into meters (via the assumed
 * real face width) gives the meters-per-world-unit scale the frame model
 * needs so 1 GLB meter renders as 1 world unit at that same distance.
 */
export function computeMetricBaseScale(
  aspect: number,
  referenceFaceWidth: number,
  assumedFaceWidthMeters: number = ASSUMED_FACE_WIDTH_METERS
): number {
  if (referenceFaceWidth <= 0 || assumedFaceWidthMeters <= 0) return 1
  return (referenceFaceWidth * worldPlaneWidth(aspect)) / assumedFaceWidthMeters
}

/** Assumed real-world head depth (front to back) used to size the occluder. */
export const ASSUMED_HEAD_DEPTH_METERS = 0.09

export interface HeadOccluderGeometry {
  radiusX: number
  radiusY: number
  radiusZ: number
}

/**
 * Size a depth-only ellipsoid occluder from the tracked face's world-space
 * half-width, so temple arms and other geometry that should sit behind the
 * head/ear are hidden by the depth buffer rather than rendered on top.
 */
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

/**
 * Euclidean distance between two normalized landmarks. Useful for estimating
 * face size / distance from the camera.
 */
export function landmarkDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/**
 * Approximate face width in normalized image coordinates using MediaPipe
 * face landmarks. Cheek-to-cheek (127 ↔ 356) gives a stable width that is
 * largely independent of expression.
 */
export function getFaceWidth(landmarks: NormalizedLandmark[]): number {
  const left = landmarks[127]
  const right = landmarks[356]
  if (!left || !right) return 0
  return landmarkDistance(left, right)
}

/**
 * Face-oval contour landmarks at temple/ear-attachment height — the
 * outermost points of the visible face silhouette, further out than the
 * 127/356 cheek points `getFaceWidth` uses. MediaPipe's face mesh has no true
 * ear landmark (the ear itself sits behind the visible silhouette), so this
 * is the closest available proxy for "how far apart the ears are" and is
 * preferred over cheek-width for driving temple-reach scale.
 */
export const EAR_LEVEL_RIGHT = 234
export const EAR_LEVEL_LEFT = 454

/**
 * Assumed real-world ear-to-ear width (bitragion breadth) at temple height,
 * used to derive metric scale from `getEarWidth`. Averages ~145-150mm across
 * adults, wider than cheek-to-cheek (~140mm) since it's measured further back
 * toward the ears.
 */
export const ASSUMED_EAR_WIDTH_METERS = 0.148

/**
 * Approximate ear-to-ear width in normalized image coordinates, using the
 * face-oval contour's outermost points (234/454). A better proxy for temple
 * reach than `getFaceWidth`'s cheek points, though still an approximation —
 * see `EAR_LEVEL_RIGHT`/`EAR_LEVEL_LEFT`.
 */
export function getEarWidth(landmarks: NormalizedLandmark[]): number {
  const right = landmarks[EAR_LEVEL_RIGHT]
  const left = landmarks[EAR_LEVEL_LEFT]
  if (!right || !left) return 0
  return landmarkDistance(right, left)
}

/**
 * Assumed real-world inter-pupillary distance. IPD averages ~63mm across
 * adults with a ~3mm standard deviation — far tighter than cheek-to-cheek
 * face width (~7mm SD) — and it is the measure the eyewear industry sizes
 * frames from, which is why it drives the try-on scale when iris landmarks
 * are available.
 */
export const ASSUMED_IPD_METERS = 0.063

/** Iris-center landmark indices (FaceLandmarker emits 478 landmarks). */
export const IRIS_CENTER_RIGHT = 468
export const IRIS_CENTER_LEFT = 473

/**
 * Landmark indices averaged into the frame anchor: the nose-bridge ridge
 * (168 between eyebrows, 6 glabella, 197/5 down the ridge) pins the anchor
 * vertically where the frame's bridge actually rests, and the iris centres
 * (468/473) pin it to the lens line. Averaging six points also smooths
 * single-landmark jitter for free. Brow/mouth/chin landmarks are
 * deliberately excluded — they move with expression and would make the
 * frame drift when the user talks or raises their eyebrows.
 */
export const TRYON_ANCHOR_INDICES = [168, 6, 197, 5, 468, 473] as const

/**
 * Average the given landmark indices into a single anchor point. Missing
 * indices (e.g. iris centres on a 468-point model) are skipped; returns
 * null when none of the indices are present so callers can fall back.
 */
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

/**
 * Frames are worn slightly wider than the skull they sit on — the temple
 * arms bow outward and the front overhangs the cheeks a touch — so sizing
 * exactly to the ear-to-ear measure reads as too tight. Bumped from 1.16 to
 * 1.2 (2026-08-23) after visual review: the frame still read a touch small
 * against the tracked face. Applied on top of the metric scale (all tracked
 * sources) so the frame sits like a real fit.
 */
export const FRAME_FIT_SCALE_BOOST = 1.2

/**
 * Inter-pupillary distance in normalized image units, from the iris-center
 * landmarks. Returns 0 when the model did not emit iris landmarks (e.g. a
 * 468-point result), letting callers fall back to the face-width path.
 */
export function getInterPupillaryDistance(
  landmarks: NormalizedLandmark[]
): number {
  const right = landmarks[IRIS_CENTER_RIGHT]
  const left = landmarks[IRIS_CENTER_LEFT]
  if (!right || !left) return 0
  return landmarkDistance(right, left)
}

/**
 * Eyelid landmarks for eye-aspect-ratio blink detection: top/bottom lid over
 * the pupil plus the inner/outer canthus of each eye. Chosen over the iris
 * landmarks precisely because they stay put when the eyelid closes.
 */
export const EYE_RIGHT_TOP = 159
export const EYE_RIGHT_BOTTOM = 145
export const EYE_RIGHT_OUTER = 33
export const EYE_RIGHT_INNER = 133
export const EYE_LEFT_TOP = 386
export const EYE_LEFT_BOTTOM = 374
export const EYE_LEFT_OUTER = 263
export const EYE_LEFT_INNER = 362

/**
 * Below this (aspect-corrected) ratio an eye counts as closed. Measured on
 * real detections: open eyes ≈ 0.23, a full blink ≈ 0.13. 0.17 sits between
 * with margin on both sides — a squint freezing the scale for a moment is
 * harmless, a missed blink lets the frame size jump.
 */
export const BLINK_EYE_ASPECT_RATIO = 0.17

/**
 * Eye aspect ratio (Soukupová-style, single vertical pair per eye): lid
 * opening divided by eye width, averaged over both eyes. Returns 0 when the
 * eye landmarks are absent, so callers can treat "no data" as "not a blink".
 *
 * `aspect` (media width/height) corrects the per-axis normalization:
 * landmark y is normalized by image height, x by width, so the raw ratio is
 * inflated by W/H — without the correction the blink threshold would shift
 * ~1.6× between a portrait photo and a landscape webcam.
 */
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

/**
 * Whether the current frame shows a blink. Iris-center landmarks (the scale
 * source via `getInterPupillaryDistance`) drift to garbage while the eyelid
 * covers the iris — callers should freeze scale updates while this is true.
 */
export function isBlinking(
  landmarks: NormalizedLandmark[],
  aspect: number = 1,
  threshold: number = BLINK_EYE_ASPECT_RATIO
): boolean {
  const ratio = getEyeAspectRatio(landmarks, aspect)
  return ratio > 0 && ratio < threshold
}

/**
 * Undo the perspective foreshortening of a projected horizontal facial
 * measure (IPD, face width) when the head is rotated. The projected width of
 * a rigid horizontal segment shrinks by ~cos(yaw)·cos(roll is irrelevant,
 * pitch only slightly) — without this, the frame visibly shrinks whenever
 * the user turns their head. The divisor is clamped so extreme/noisy pose
 * estimates near profile cannot explode the scale.
 */
export function compensateMeasureForPose(
  measure: number,
  yaw: number,
  pitch: number = 0,
  minFactor: number = 0.5
): number {
  const factor = Math.max(Math.abs(Math.cos(yaw) * Math.cos(pitch)), minFactor)
  return measure / factor
}

/**
 * Metric scale from any normalized horizontal facial measure and its assumed
 * real-world size — generalizes `computeMetricBaseScale` (which is the
 * face-width special case) so the same math serves the IPD path.
 */
export function computeMetricScaleFromMeasure(
  aspect: number,
  normalizedMeasure: number,
  assumedMeters: number
): number {
  if (normalizedMeasure <= 0 || assumedMeters <= 0) return 1
  return (normalizedMeasure * worldPlaneWidth(aspect)) / assumedMeters
}

/** Filter state carried between `oneEuroFilter` calls for one scalar signal. */
export interface OneEuroState {
  value: number
  derivative: number
}

export interface OneEuroFilterOptions {
  /** Cutoff frequency (Hz) at zero speed — lower means smoother but laggier. */
  minCutoff?: number
  /** How much the cutoff rises with signal speed — higher means less lag on fast motion, less jitter suppression while moving. */
  beta?: number
  /** Cutoff frequency (Hz) used to smooth the derivative estimate itself. */
  dCutoff?: number
}

export function oneEuroAlpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dtSeconds)
}

/**
 * One Euro Filter (Casiez, Roussel & Vogel, 2012) — a low-pass filter whose
 * cutoff frequency adapts to the signal's own speed. A fixed-time-constant
 * smoother has to pick one point on the jitter-vs-lag tradeoff; this instead
 * smooths hard when the signal is nearly still (killing per-frame tracker
 * jitter) and loosens automatically during fast motion (so a quick head turn
 * or a step toward the camera doesn't visibly lag behind the real face).
 *
 * `state: null` primes the filter — the first sample passes through
 * unfiltered rather than smoothing from an arbitrary starting value. Callers
 * also pass `null` to reset the filter on discontinuities (e.g. the face
 * being re-acquired after tracking was lost), so it snaps instead of gliding
 * across the screen from the last known position.
 */
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

/** Hard cap on how far into the future `predictOneEuro` may extrapolate. */
export const ONE_EURO_MAX_PREDICTION_SECONDS = 0.1

/**
 * Latency compensation on top of `oneEuroFilter`: extrapolate the filtered
 * value along the filter's own velocity estimate by `dtSeconds` (typically
 * the measured camera→result pipeline latency), so the rendered pose matches
 * where the head is *now* rather than where it was when the frame was
 * captured.
 *
 * Two guards keep extrapolation from becoming a new artifact:
 *
 * - The lookahead is capped at `ONE_EURO_MAX_PREDICTION_SECONDS` so a latency
 *   spike (GC pause, background tab) cannot fling the value far away.
 * - The prediction may overshoot the latest raw measurement by at most
 *   `(maxOvershoot - 1)` times the remaining gap between filtered value and
 *   measurement — beyond that the filter, not the velocity estimate, is the
 *   better information source (e.g. the head just decelerated and the stale
 *   velocity would overshoot badly). Keep this tight: past-the-measurement
 *   overshoot is what makes the frame visibly swing past the face when a
 *   head turn stops.
 */
export function predictOneEuro(
  state: OneEuroState,
  measurement: number,
  dtSeconds: number,
  maxOvershoot = 1.2
): number {
  if (dtSeconds <= 0) return state.value
  const dt = Math.min(dtSeconds, ONE_EURO_MAX_PREDICTION_SECONDS)
  const predicted = state.value + state.derivative * dt
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

/**
 * Estimate a uniform scale factor for the frame based on detected face width.
 *
 * Under a pinhole model, apparent face width is inversely proportional to
 * distance from the camera. If the frame sits at the world plane, we want the
 * frame scale to grow when the face is closer (larger width) and shrink when
 * the face is farther away (smaller width).
 *
 * @param faceWidth - current normalized face width
 * @param referenceWidth - normalized face width at the calibration distance
 */
export function estimateDistanceScale(
  faceWidth: number,
  referenceWidth: number
): number {
  if (!faceWidth || faceWidth <= 0 || !referenceWidth || referenceWidth <= 0)
    return 1
  return faceWidth / referenceWidth
}

/**
 * The visible window (in raw-media-normalized `[0, 1]` coordinates) left
 * after `object-fit: cover` scales a media element to fill a container of a
 * different aspect ratio. `object-cover` crops symmetrically, so the window
 * is always centred.
 */
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

/**
 * Compute the `object-cover` visible window for a media element of
 * `mediaAspect` (width / height) displayed inside a container of
 * `containerAspect`. Falls back to the full `[0, 1]` frame (no crop) if
 * either aspect ratio is unknown.
 */
export function objectCoverWindow(
  mediaAspect: number,
  containerAspect: number
): ObjectCoverWindow {
  if (!mediaAspect || !containerAspect || mediaAspect === containerAspect) {
    return FULL_OBJECT_COVER_WINDOW
  }
  if (mediaAspect > containerAspect) {
    // Media is relatively wider than the container — `cover` crops the
    // left/right edges to fill the container's height.
    const visibleWidth = containerAspect / mediaAspect
    const margin = (1 - visibleWidth) / 2
    return { xMin: margin, xMax: 1 - margin, yMin: 0, yMax: 1 }
  }
  // Media is relatively taller than the container — `cover` crops the
  // top/bottom edges to fill the container's width.
  const visibleHeight = mediaAspect / containerAspect
  const margin = (1 - visibleHeight) / 2
  return { xMin: 0, xMax: 1, yMin: margin, yMax: 1 - margin }
}

/**
 * Remap a landmark normalized to the RAW media frame into a landmark
 * normalized to the visible, `object-fit: cover`-cropped window shown on
 * screen. Face trackers run on the raw frame, but every downstream consumer
 * (debug overlay, world-space placement) reasons in on-screen coordinates —
 * without this remap, any mismatch between the media's native aspect ratio
 * and the container's aspect ratio throws position and scale off by however
 * much `cover` cropped away.
 */
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
