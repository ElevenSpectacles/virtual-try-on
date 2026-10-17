import type { TryOnCardCalibration } from '../composables/tryon/useTryOnCardCalibration'
import type { TryOnCaptureOptions } from '../utils/tryon-capture'
import type { TryOnFit } from '../utils/tryon-fit'

/** Camera failure reported by `useWebcamStream`. */
export type WebcamError = 'unsupported' | 'denied' | 'unavailable'

/** Face tracker failure reported by `useFaceLandmarker`. */
export type FaceLandmarkerError =
  | 'unsupported'
  | 'load_failed'
  | 'runtime_failed'

/** Camera lifecycle of `<VirtualTryOnExperience>`, for the host's UI. */
export type TryOnStatus = 'idle' | 'starting' | 'active' | 'error'

/**
 * Positioning hint for the host's guide UI: `noFace` while tracking runs
 * without a usable face, `aligned` once the anchor is found, `turnBack`
 * when the head is turned too far to fit well (or was, when the face was
 * lost), `tooDark` when the room is too dark for stable tracking. `null`
 * when the camera is off.
 */
export type TryOnGuideHint = 'noFace' | 'aligned' | 'turnBack' | 'tooDark'

/**
 * On-device face measurements for frame-advisor UIs (issue #98). Everything
 * stays in the browser; only coarse classes are reported on `track`.
 */
export interface TryOnMeasurements {
  /** Distance PD, mm (iris-measured, see `trueToSize`); null until measured. */
  pdMm: number | null
  /** Ear-level face width, mm (the fit verdict's measure); null until stable. */
  faceWidthMm: number | null
  /** 0 … 1: how far the PD measurement has come (1 once it froze). */
  confidence: number
  /** The PD measurement froze. */
  stable: boolean
  /**
   * Coarse face shape, a styling hint (never a filter); null until about
   * 1.5 s of frontal tracking.
   */
  faceShape: 'oval' | 'round' | 'square' | 'heart' | 'oblong' | null
  /** 0 … 1: margin of `faceShape` over the next-closest class. */
  faceShapeConfidence: number
}

/** Props of `<VirtualTryOnExperience>`'s default slot. */
export interface VirtualTryOnExperienceSlotProps {
  status: TryOnStatus
  isStarting: boolean
  /** Camera failure: 'denied' | 'unsupported' | 'unavailable'. */
  error: WebcamError | null
  /** Face tracker failure: 'unsupported' | 'load_failed' | 'runtime_failed'. */
  faceError: FaceLandmarkerError | null
  hasFace: boolean
  guideHint: TryOnGuideHint | null
  /**
   * Whether the selected frame suits the tracked face's width, with the
   * two widths in mm. Null until about a second of tracking has given a
   * stable estimate, and while no face is tracked.
   */
  fit: TryOnFit | null
  /**
   * On-device face measurements: PD, face width, face shape. Null until
   * something is measured.
   */
  measurements: TryOnMeasurements | null
  start: () => Promise<void>
  stop: () => void
  /** Card calibration: `{ status, progress, pdMm }` ('idle' until started). */
  calibration: TryOnCardCalibration
  startCalibration: () => void
  cancelCalibration: () => void
  /** Snapshot of the composited try-on as an image Blob (on-device). */
  capture: (options?: TryOnCaptureOptions) => Promise<Blob>
  /** The camera frame and pose are held (see `freeze`). */
  frozen: boolean
  /** Hold the current frame and pose, e.g. to compare frames on one look. */
  freeze: () => Promise<void>
  /** Back to the live camera. */
  unfreeze: () => Promise<void>
}
