import { watch, type Ref } from 'vue'
import type { TierChange } from '../useCapabilityTier'
import type { TryOnTier } from '../../../utils/tryon-capability'
import type { FaceShapeResult } from '../../../utils/tryon-face-shape'
import type { FaceWidthEstimate, TryOnFitVerdict } from '../../../utils/tryon-fit'
import type { MetricsAccumulator } from '../../../utils/tryon-metrics'
import type { FaceLandmarkerError, WebcamError } from '../../../types/tryon-experience'
import type { TryOnObserver } from '../../../types/face-landmarker-worker'

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

const OBSERVER_SOURCE: Record<TryOnObserver, string> = {
  sample: 'room_lighting',
  card: 'card_calibration'
}

export function createObserverErrorReporter(track: TryOnTrack) {
  const reported = new Set<TryOnObserver>()
  return (observer: TryOnObserver, message: string) => {
    if (reported.has(observer)) return
    reported.add(observer)
    track('TRY_ON_ERROR', {
      errorType: 'runtime_failed',
      source: OBSERVER_SOURCE[observer],
      message
    })
  }
}

export function reportTierChange(
  track: TryOnTrack,
  metrics: MetricsAccumulator | null,
  change: TierChange
) {
  metrics?.onTierChange(change.tier, change.previousTier !== null)
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
  camera: { error: Ref<WebcamError | null>; errorDetail: Ref<string | null> }
  tracking: {
    faceError: Ref<FaceLandmarkerError | null>
    faceErrorDetail: Ref<string | null>
    hasFace: Ref<boolean>
    confidence: Ref<number>
  }
  hairError: () => string | null
  hairOcclusion: () => boolean
  calibrationFile: () => string
  calibrationLoadError: () => string | null
  getCalibrationProblems: (file: string) => string[]
  hasReportedFaceDetected: Ref<boolean>
  tier: () => TryOnTier
  fit: {
    verdict: Ref<TryOnFitVerdict | null>
    faceWidthEstimate: Ref<FaceWidthEstimate | null>
    frameWidthMm: Ref<number>
    faceShape: Ref<FaceShapeResult | null>
  }
}

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

  watch(options.calibrationLoadError, (message) => {
    if (!message) return
    track('TRY_ON_ERROR', {
      errorType: 'load_failed',
      source: 'calibration',
      message
    })
  })

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

  watch(fit.verdict, (verdict) => {
    const estimate = fit.faceWidthEstimate.value
    if (!verdict || !estimate) return
    track('TRY_ON_FIT', {
      verdict,
      faceWidthMm: Math.round(estimate.mean),
      frameWidthMm: Math.round(fit.frameWidthMm.value)
    })
  })

  watch(
    () => fit.faceShape.value?.shape ?? null,
    (shape) => {
      if (shape) track('TRY_ON_FACE_SHAPE', { faceShape: shape })
    }
  )

  return { onSceneError }
}
