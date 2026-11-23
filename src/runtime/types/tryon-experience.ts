import type { TryOnCardCalibration } from '../composables/tryon/useTryOnCardCalibration'
import type { TryOnCaptureOptions } from '../utils/tryon-capture'
import type { TryOnFit } from '../utils/tryon-fit'

export type WebcamError = 'unsupported' | 'denied' | 'unavailable'

export type FaceLandmarkerError =
  | 'unsupported'
  | 'load_failed'
  | 'runtime_failed'

export type TryOnStatus = 'idle' | 'starting' | 'active' | 'error'

export type TryOnGuideHint = 'noFace' | 'aligned' | 'turnBack' | 'tooDark'

export interface TryOnMeasurements {
  pdMm: number | null
  faceWidthMm: number | null
  confidence: number
  stable: boolean
  faceShape: 'oval' | 'round' | 'square' | 'heart' | 'oblong' | null
  faceShapeConfidence: number
}

export interface VirtualTryOnExperienceSlotProps {
  status: TryOnStatus
  isStarting: boolean
  error: WebcamError | null
  faceError: FaceLandmarkerError | null
  hasFace: boolean
  guideHint: TryOnGuideHint | null
  fit: TryOnFit | null
  measurements: TryOnMeasurements | null
  start: () => Promise<void>
  stop: () => void
  calibration: TryOnCardCalibration
  startCalibration: () => Promise<void>
  cancelCalibration: () => void
  capture: (options?: TryOnCaptureOptions) => Promise<Blob>
  frozen: boolean
  freeze: () => Promise<void>
  unfreeze: () => Promise<void>
}
