import { watch, type Ref } from 'vue'
import type { TierChange } from '../useCapabilityTier'
import type { TryOnTier } from '../../../utils/tryon-capability'
import type { FaceShapeResult } from '../../../utils/tryon-face-shape'
import type { FaceWidthEstimate, TryOnFitVerdict } from '../../../utils/tryon-fit'
import type { MetricsAccumulator } from '../../../utils/tryon-metrics'
import type { FaceLandmarkerError, WebcamError } from '../../../types/tryon-experience'

/** Events the component reports through `track`. */
export type TryOnTrackEvent =
  | 'TRY_ON_OPENED'
  | 'TRY_ON_CAMERA_GRANTED'
  | 'TRY_ON_CAMERA_DENIED'
  | 'TRY_ON_FACE_DETECTED'
  | 'TRY_ON_FRAME_CHANGED'
  | 'TRY_ON_TIER'
  | 'TRY_ON_FIT'
  | 'TRY_ON_CALIBRATED'
  | 'TRY_ON_FACE_SHAPE'
  | 'TRY_ON_CAPTURE'
  | 'TRY_ON_FREEZE'
  | 'TRY_ON_ERROR'

export type TryOnTrack = (event: TryOnTrackEvent, extra?: Record<string, unknown>) => void

/** The `track` emitter: every payload names the active model. */
export function createTryOnTrack(
  emit: (event: 'track', name: string, payload: Record<string, unknown>) => void,
  model: () => string | undefined
): TryOnTrack {
  return (event, extra = {}) => {
    emit('track', event, {
      contentType: 'product',
      contentName: model(),
      customData: {
        model: model(),
        ...extra
      }
    })
  }
}

/**
 * A capability tier change (`useCapabilityTier`'s `onChange`): the session
 * metrics count it, and a step-down is reported as TRY_ON_TIER.
 */
export function reportTierChange(
  track: TryOnTrack,
  metrics: MetricsAccumulator | null,
  change: TierChange
) {
  metrics?.onTierChange(change.tier, change.previousTier !== null)
  // The initial classification is reported with TRY_ON_FACE_DETECTED,
  // which fires after consent. Only step-downs need an event of their own.
  if (change.previousTier === null) return
  track('TRY_ON_TIER', {
    tier: change.tier,
    previousTier: change.previousTier,
    p95Ms: change.p95Ms,
    maxTextureSize: change.signals?.maxTextureSize,
    deviceMemoryGb: change.signals?.deviceMemoryGb
  })
}

export interface UseTryOnTrackEventsOptions {
  track: TryOnTrack
  /** The camera (`useWebcamStream`). */
  camera: { error: Ref<WebcamError | null>; errorDetail: Ref<string | null> }
  /** The tracker's failures, the held face and the detection confidence (`useTryOnTracking`). */
  tracking: {
    faceError: Ref<FaceLandmarkerError | null>
    faceErrorDetail: Ref<string | null>
    hasFace: Ref<boolean>
    confidence: Ref<number>
  }
  /** Hair segmenter failure, reported only with hair occlusion on. */
  hairError: () => string | null
  hairOcclusion: () => boolean
  /** The selected model, whose calibration entry is checked. */
  calibrationFile: () => string
  getCalibrationProblems: (file: string) => string[]
  /** Reset by `start()` for each consented session. */
  hasReportedFaceDetected: Ref<boolean>
  /** The capability tier, reported with the first face. */
  tier: () => TryOnTier
  /** The selected frame's fit and the face shape (`useTryOnFrameFit`). */
  fit: {
    verdict: Ref<TryOnFitVerdict | null>
    faceWidthEstimate: Ref<FaceWidthEstimate | null>
    frameWidthMm: Ref<number>
    faceShape: Ref<FaceShapeResult | null>
  }
}

/**
 * The `track` events that only report: camera denial and failures, tracker,
 * hair-segmenter and calibration-manifest failures, the first face of a
 * session, fit verdict changes and the face shape. Returns the handler for
 * `TryOnScene`'s `error` (a GLB or environment map that failed to load).
 */
export function useTryOnTrackEvents(options: UseTryOnTrackEventsOptions) {
  const { track, camera, tracking, fit } = options

  watch(camera.error, (err) => {
    if (err === 'denied') {
      track('TRY_ON_CAMERA_DENIED')
    } else if (err) {
      track('TRY_ON_ERROR', {
        errorType: err,
        source: 'camera',
        message: camera.errorDetail.value
      })
    }
  })

  watch(options.hairError, (message) => {
    if (!message || !options.hairOcclusion()) return
    track('TRY_ON_ERROR', {
      errorType: message === 'unsupported' ? 'unsupported' : 'load_failed',
      source: 'hair_segmenter',
      message
    })
  })

  watch(tracking.faceError, (err) => {
    if (err) {
      track('TRY_ON_ERROR', {
        errorType: err,
        source: 'face_landmarker',
        message: tracking.faceErrorDetail.value
      })
    }
  })

  // A bad calibration entry is reported once per model (the frame still
  // renders, with the invalid fields at their defaults).
  const reportedCalibration = new Set<string>()
  watch(
    () => {
      const file = options.calibrationFile()
      return { file, problems: options.getCalibrationProblems(file) }
    },
    ({ file, problems }) => {
      if (!problems.length || reportedCalibration.has(file)) return
      reportedCalibration.add(file)
      track('TRY_ON_ERROR', {
        errorType: 'invalid_calibration',
        source: 'calibration',
        message: `${file}: ${problems.join('; ')}`
      })
    },
    { immediate: true }
  )

  function onSceneError(source: 'model' | 'environment', message: string) {
    track('TRY_ON_ERROR', {
      errorType: 'load_failed',
      source,
      message
    })
  }

  watch(tracking.hasFace, (detected) => {
    if (detected && !options.hasReportedFaceDetected.value) {
      options.hasReportedFaceDetected.value = true
      track('TRY_ON_FACE_DETECTED', {
        confidence: tracking.confidence.value,
        tier: options.tier()
      })
    }
  })

  // One event per verdict change (per frame model too, since the frame width
  // changes), so the host can relate fit to conversion. Widths are rounded to
  // whole millimetres.
  watch(fit.verdict, (verdict) => {
    const estimate = fit.faceWidthEstimate.value
    if (!verdict || !estimate) return
    track('TRY_ON_FIT', {
      verdict,
      faceWidthMm: Math.round(estimate.mean),
      frameWidthMm: Math.round(fit.frameWidthMm.value)
    })
  })

  // Face shape as a coarse class only (never measurements), once it appears
  // and on each change.
  watch(
    () => fit.faceShape.value?.shape ?? null,
    (shape) => {
      if (shape) track('TRY_ON_FACE_SHAPE', { faceShape: shape })
    }
  )

  return { onSceneError }
}
