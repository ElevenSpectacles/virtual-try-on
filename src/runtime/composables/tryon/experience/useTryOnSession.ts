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
  camera: {
    isActive: Ref<boolean>
    isStarting: Ref<boolean>
    error: Ref<WebcamError | null>
    start: () => Promise<void>
  }
  tracking: { initFaceLandmarker: () => Promise<void>; faceReady: Ref<boolean> }
  faceTracking: Ref<boolean>
  frameShown: () => boolean
  metrics: MetricsAccumulator | null
  track: TryOnTrack
}

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

  let trackerRequestedAt: number | null = null
  function initTracker() {
    if (trackerRequestedAt === null) trackerRequestedAt = performance.now()
    const requestedAt = trackerRequestedAt
    tracking
      .initFaceLandmarker()
      .then(() => {
        if (tracking.faceReady.value) metrics?.onAssetTiming('tracker', performance.now() - requestedAt)
      })
      .catch(() => {})
  }

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

  function prefetch() {
    initTracker()
  }

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

  let grantedAt: number | null = null
  watch(camera.isActive, (active) => {
    grantedAt = active ? performance.now() : null
  })
  watch(options.frameShown, (shown) => {
    if (!shown || grantedAt === null || !metrics) return
    const since = grantedAt
    grantedAt = null
    requestAnimationFrame(() => metrics.onFirstFrame(performance.now() - since))
  })

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
      initTracker()
    }
  })

  return { status, hasConsented, hasReportedFaceDetected, start, prefetch, onSceneTiming }
}
