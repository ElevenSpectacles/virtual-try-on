import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  createObserverErrorReporter,
  useTryOnTrackEvents,
  type TryOnTrack
} from '../../../../../src/runtime/composables/tryon/experience/useTryOnTrackEvents'
import type { FaceLandmarkerError, WebcamError } from '../../../../../src/runtime/types/tryon-experience'

describe('createObserverErrorReporter', () => {
  it('reports each observer once, under its own source', () => {
    const track = vi.fn<TryOnTrack>()
    const report = createObserverErrorReporter(track)
    report('sample', 'getImageData failed')
    report('sample', 'getImageData failed again')
    report('card', 'OffscreenCanvas 2d context unavailable')
    expect(track.mock.calls).toEqual([
      [
        'TRY_ON_ERROR',
        { errorType: 'runtime_failed', source: 'room_lighting', message: 'getImageData failed' }
      ],
      [
        'TRY_ON_ERROR',
        {
          errorType: 'runtime_failed',
          source: 'card_calibration',
          message: 'OffscreenCanvas 2d context unavailable'
        }
      ]
    ])
  })
})

describe('useTryOnTrackEvents', () => {
  function setup() {
    const track = vi.fn<TryOnTrack>()
    const calibrationLoadError = ref<string | null>(null)
    const scope = effectScope()
    scope.run(() =>
      useTryOnTrackEvents({
        track,
        camera: { error: ref<WebcamError | null>(null), errorDetail: ref(null) },
        tracking: {
          faceError: ref<FaceLandmarkerError | null>(null),
          faceErrorDetail: ref(null),
          hasFace: ref(false),
          confidence: ref(0)
        },
        hairError: () => null,
        hairOcclusion: () => false,
        calibrationFile: () => 'frame.glb',
        calibrationLoadError: () => calibrationLoadError.value,
        getCalibrationProblems: () => [],
        hasReportedFaceDetected: ref(false),
        tier: () => 'mid',
        fit: {
          verdict: ref(null),
          faceWidthEstimate: ref(null),
          frameWidthMm: ref(0),
          faceShape: ref(null)
        }
      })
    )
    return { track, calibrationLoadError }
  }

  it('reports a calibration manifest that failed to load', async () => {
    const { track, calibrationLoadError } = setup()
    calibrationLoadError.value = '/calibration.json: [GET] 404'
    await nextTick()
    expect(track).toHaveBeenCalledWith('TRY_ON_ERROR', {
      errorType: 'load_failed',
      source: 'calibration',
      message: '/calibration.json: [GET] 404'
    })
  })
})
