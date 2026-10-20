import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { useHead } from '#imports'
import { preconnectOrigins } from '../../../utils/tryon-preconnect'
import type { MetricsAccumulator } from '../../../utils/tryon-metrics'
import type { TryOnStatus, WebcamError } from '../../../types/tryon-experience'
import type { TryOnTrack } from './useTryOnTrackEvents'

export interface UseTryOnSessionOptions {
  props: {
    autoStart: boolean
    mediapipeBasePath?: string | undefined
    mediapipeModelAssetPath?: string | undefined
    hairOcclusion: boolean
    mediapipeHairModelAssetPath?: string | undefined
    draco: boolean
    dracoDecoderPath?: string | undefined
    environmentUrl?: string | undefined
  }
  /** The camera (`useWebcamStream`). */
  camera: {
    isActive: Ref<boolean>
    isStarting: Ref<boolean>
    error: Ref<WebcamError | null>
    start: () => Promise<void>
  }
  /** The face tracker (`useTryOnTracking`). */
  tracking: { initFaceLandmarker: () => Promise<void>; faceReady: Ref<boolean> }
  /** Face tracking drives the frame; turned on when the camera comes up. */
  faceTracking: Ref<boolean>
  /** The frame is on screen: shown on a tracked face, its GLB loaded. */
  frameShown: () => boolean
  metrics: MetricsAccumulator | null
  track: TryOnTrack
}

/**
 * The camera session, from consent to the first frame: `start()` (the first
 * call reports TRY_ON_OPENED and resets the session's TRY_ON_FACE_DETECTED),
 * `prefetch()`, the camera `status`, and `autoStart` on mount. Each time the
 * camera comes up it reports TRY_ON_CAMERA_GRANTED and turns face tracking
 * on. Also the time to first frame: the tracker loads early, the default CDNs
 * are preconnected, and the first loads are timed for the session metrics.
 */
export function useTryOnSession(options: UseTryOnSessionOptions) {
  const { props, camera, tracking, metrics, track } = options

  const hasConsented = ref(false)
  const hasReportedFaceDetected = ref(false)

  const status = computed<TryOnStatus>(() => {
    if (camera.isActive.value) return 'active'
    if (camera.isStarting.value) return 'starting'
    if (camera.error.value) return 'error'
    return 'idle'
  })

  // Time to first frame (issue #95). The tracker (MediaPipe Wasm + face
  // model, the largest first-load cost) starts loading with `start()` or
  // `prefetch()`, in parallel with the camera permission prompt and stream
  // start, instead of after the stream is up.
  let trackerRequestedAt: number | null = null
  function initTracker() {
    if (trackerRequestedAt === null) trackerRequestedAt = performance.now()
    const requestedAt = trackerRequestedAt
    tracking
      .initFaceLandmarker()
      .then(() => {
        if (tracking.faceReady.value) metrics?.onAssetTiming('tracker', performance.now() - requestedAt)
      })
      .catch(() => {
        // Failure is surfaced via faceError.
      })
  }

  /** Start (or retry) the camera. The first call reports TRY_ON_OPENED. */
  async function start() {
    if (!hasConsented.value) {
      hasConsented.value = true
      hasReportedFaceDetected.value = false
      track('TRY_ON_OPENED', {
        entryPoint: props.autoStart ? 'auto_start' : 'camera_consent'
      })
    }
    initTracker()
    await camera.start()
  }

  /**
   * Warm up before the shopper taps "Try on" (e.g. on hover of the button):
   * loads the face tracker. Does not touch the camera, so it needs no consent;
   * it does download the MediaPipe Wasm and model.
   */
  function prefetch() {
    initTracker()
  }

  // Open connections to the default CDNs early (skipped for self-hosted
  // assets), while the shopper reads the consent screen.
  useHead({
    link: preconnectOrigins({
      mediapipeBasePath: props.mediapipeBasePath,
      mediapipeModelAssetPath: props.mediapipeModelAssetPath,
      hairOcclusion: props.hairOcclusion,
      mediapipeHairModelAssetPath: props.mediapipeHairModelAssetPath,
      draco: props.draco,
      dracoDecoderPath: props.dracoDecoderPath,
      presetEnvironment: props.environmentUrl === undefined
    }).map((href) => ({ rel: 'preconnect', href, crossorigin: 'anonymous' as const }))
  })

  // Camera granted → first rendered frame on a face, once per camera session.
  let grantedAt: number | null = null
  watch(camera.isActive, (active) => {
    grantedAt = active ? performance.now() : null
  })
  watch(options.frameShown, (shown) => {
    if (!shown || grantedAt === null || !metrics) return
    const since = grantedAt
    grantedAt = null
    // The frame is on screen once the next frame has been drawn.
    requestAnimationFrame(() => metrics.onFirstFrame(performance.now() - since))
  })

  /** First-load time of the scene's GLB or environment map (`TryOnScene`'s `timing`). */
  function onSceneTiming(asset: 'model' | 'environment', ms: number) {
    metrics?.onAssetTiming(asset, ms)
  }

  onMounted(() => {
    if (props.autoStart) void start()
  })

  watch(camera.isActive, (active) => {
    if (active) {
      track('TRY_ON_CAMERA_GRANTED')
      options.faceTracking.value = true
      // Already loading since `start()`; this covers a retry after a failure.
      initTracker()
    }
  })

  return { status, hasConsented, hasReportedFaceDetected, start, prefetch, onSceneTiming }
}
