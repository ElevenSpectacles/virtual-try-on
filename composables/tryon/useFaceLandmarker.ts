import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  computeAnchorCentroid,
  getFaceWidth,
  TRYON_ANCHOR_INDICES,
  type NormalizedLandmark
} from '../../utils/tryon'
import { matrixToFacePose, type FacePose } from '../../utils/tryon-pose'
import type {
  FaceLandmarkerWorkerRequest,
  FaceLandmarkerWorkerResponse
} from '../../workers/face-landmarker.worker.types'
import { useLogger } from '~/composables/useLogger'

export type FaceLandmarkerError =
  | 'unsupported'
  | 'load_failed'
  | 'runtime_failed'

export interface UseFaceLandmarkerOptions {
  /**
   * Landmark indices averaged into the anchor point used to position the
   * frame. Defaults to `TRYON_ANCHOR_INDICES` (nose-bridge ridge + iris
   * centres — see utils/tryon for why that set).
   */
  anchorIndices?: readonly number[]
  /**
   * Directory the MediaPipe Wasm fileset is served from, passed through to
   * the worker's `FilesetResolver.forVisionTasks`. Omit to use the worker's
   * jsDelivr CDN default; pass a same-origin path to self-host.
   */
  mediapipeBasePath?: string | undefined
  /**
   * URL/path to the `face_landmarker.task` model asset. Omit to use the
   * worker's Google-storage CDN default.
   */
  mediapipeModelAssetPath?: string | undefined
}

/**
 * Capability check: can this browser run detection off the main thread?
 *
 * WebAssembly is the hard requirement for MediaPipe itself; `Worker` +
 * `createImageBitmap` are required to hand video frames to it without
 * touching the DOM from the worker.
 */
function supportsMediaPipe(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.WebAssembly !== 'undefined' &&
    typeof window.WebAssembly.instantiate === 'function' &&
    typeof window.Worker !== 'undefined' &&
    typeof window.createImageBitmap === 'function'
  )
}

/**
 * MediaPipe Face Landmarker integration for the virtual try-on. Detection
 * runs in a dedicated Worker (`face-landmarker.worker.ts`) so the heavy
 * synchronous `detectForVideo()` call never blocks the main thread's render
 * loop; each frame is handed over as a transferable `ImageBitmap` and only
 * the small landmark/matrix result comes back.
 */
export function useFaceLandmarker(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseFaceLandmarkerOptions = {}
) {
  const anchorIndices = options.anchorIndices ?? TRYON_ANCHOR_INDICES
  const isLoading = ref(false)
  const isReady = ref(false)
  const error: Ref<FaceLandmarkerError | null> = ref(null)
  const worker = shallowRef<Worker | null>(null)
  const landmarks = ref<NormalizedLandmark[]>([])
  const transformationMatrixes = ref<Float32Array[]>([])
  const pose = ref<FacePose | null>(null)
  const hasFace = computed(() => landmarks.value.length > 0)
  const noFace = computed(() => isReady.value && !hasFace.value)
  const faceWidth = computed(() => getFaceWidth(landmarks.value))
  const logger = useLogger()

  // MediaPipe FaceLandmarker does not reliably populate per-landmark
  // visibility in video mode, so confidence is derived from detection
  // stability over a short rolling window instead.
  const CONFIDENCE_HISTORY_SIZE = 15
  const detectionHistory = ref<boolean[]>([])
  const confidence = computed(() => {
    const history = detectionHistory.value
    if (history.length === 0) return 0
    const detected = history.filter(Boolean).length
    return detected / history.length
  })

  /**
   * The anchor point used to position the frame — a centroid of the
   * configured indices (nose-bridge ridge + iris centres by default),
   * falling back to the first landmark if none of them are present.
   */
  const anchor = computed<NormalizedLandmark | null>(() => {
    if (!hasFace.value) return null
    const list = landmarks.value
    return computeAnchorCentroid(list, anchorIndices) ?? list[0] ?? null
  })

  // In-flight request bookkeeping: one outstanding detect call at a time,
  // keyed by id so a stale response can never clobber a newer one.
  let nextRequestId = 0
  let pendingRequestId: number | null = null
  let pendingSentAt = 0
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null

  // Measured camera→result round-trip latency (EMA), exposed so the smoothing
  // layer can extrapolate the pose forward by roughly this much and cancel the
  // pipeline delay instead of rendering where the head *was*. EMA alpha is
  // deliberately low — a single GC pause or background-tab hiccup shouldn't
  // swing the prediction horizon.
  const LATENCY_EMA_ALPHA = 0.2
  const latencyMs = ref(0)

  function recordLatency(sentAt: number) {
    const sample = performance.now() - sentAt
    latencyMs.value =
      latencyMs.value > 0
        ? latencyMs.value + LATENCY_EMA_ALPHA * (sample - latencyMs.value)
        : sample
  }

  function applyResult(
    landmarksResult: NormalizedLandmark[],
    matrix: number[] | null
  ) {
    landmarks.value = landmarksResult
    transformationMatrixes.value = matrix ? [Float32Array.from(matrix)] : []
    pose.value = matrix ? matrixToFacePose(matrix) : null

    const history = detectionHistory.value
    history.push(landmarksResult.length > 0)
    if (history.length > CONFIDENCE_HISTORY_SIZE) {
      history.shift()
    }
    detectionHistory.value = history
  }

  function handleWorkerMessage(
    event: MessageEvent<FaceLandmarkerWorkerResponse>
  ) {
    const message = event.data

    switch (message.type) {
      case 'ready':
        isReady.value = true
        readyResolve?.()
        readyResolve = null
        readyReject = null
        break

      case 'load_failed':
        error.value = 'load_failed'
        logger.error('[useFaceLandmarker] Failed to load FaceLandmarker', {
          message: message.message
        })
        readyReject?.(new Error(message.message))
        readyResolve = null
        readyReject = null
        break

      case 'result':
        if (message.id !== pendingRequestId) return
        pendingRequestId = null
        recordLatency(pendingSentAt)
        applyResult(message.landmarks, message.transformationMatrix)
        break

      case 'detect_failed':
        if (message.id !== pendingRequestId) return
        pendingRequestId = null
        error.value = 'runtime_failed'
        logger.error('[useFaceLandmarker] Detection failed', {
          message: message.message
        })
        break
    }
  }

  function post(
    message: FaceLandmarkerWorkerRequest,
    transfer: Transferable[] = []
  ) {
    worker.value?.postMessage(message, transfer)
  }

  async function init() {
    if (!import.meta.client) return
    if (isReady.value || isLoading.value) return
    if (!supportsMediaPipe()) {
      error.value = 'unsupported'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // Classic (non-module) worker: MediaPipe's own WASM/script loader
      // relies on synchronous `importScripts`, which module workers don't
      // support — it falls back to a broken `self.import` shim there and
      // throws "e is not a function" before any CDN fetch happens.
      const instance = new Worker(
        new URL('../../workers/face-landmarker.worker.ts', import.meta.url),
        { type: 'classic' }
      )
      instance.onmessage = handleWorkerMessage
      instance.onerror = (event: ErrorEvent) => {
        readyReject?.(
          new Error(
            `worker error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`
          )
        )
        readyResolve = null
        readyReject = null
      }
      worker.value = instance

      await new Promise<void>((resolve, reject) => {
        readyResolve = resolve
        readyReject = reject
        post({
          type: 'init',
          ...(options.mediapipeBasePath !== undefined
            ? { basePath: options.mediapipeBasePath }
            : {}),
          ...(options.mediapipeModelAssetPath !== undefined
            ? { modelAssetPath: options.mediapipeModelAssetPath }
            : {})
        })
      })

      logger.info('[useFaceLandmarker] FaceLandmarker ready (worker)')
    } catch (err) {
      error.value = 'load_failed'
      logger.error('[useFaceLandmarker] Failed to load FaceLandmarker', { err })
      worker.value?.terminate()
      worker.value = null
    } finally {
      isLoading.value = false
    }
  }

  function destroy() {
    post({ type: 'destroy' })
    worker.value?.terminate()
    worker.value = null
    isReady.value = false
    landmarks.value = []
    transformationMatrixes.value = []
    pose.value = null
    detectionHistory.value = []
    pendingRequestId = null
    pendingSentAt = 0
    latencyMs.value = 0
  }

  let lastTimestamp = -1

  // Detection input is downscaled before it crosses to the worker: the face
  // landmarker resizes every frame to its internal ~192px input anyway, so
  // shipping a full 1280×720 bitmap per detection only buys transfer and
  // preprocessing overhead. Landmarks come back normalized, so precision is
  // unaffected. The visible preview stays full-resolution. 480px and
  // 'low'-quality (box) resize keep the capture+detect cycle short enough to
  // sustain the camera's 30fps cadence — a slower cycle is felt directly as
  // tracking delay.
  const DETECT_MAX_WIDTH = 480

  function captureFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
    if (video.videoWidth > DETECT_MAX_WIDTH) {
      const scale = DETECT_MAX_WIDTH / video.videoWidth
      return createImageBitmap(video, {
        resizeWidth: DETECT_MAX_WIDTH,
        resizeHeight: Math.round(video.videoHeight * scale),
        resizeQuality: 'low'
      })
    }
    return createImageBitmap(video)
  }

  function detect(timestamp: number) {
    if (!import.meta.client) return
    const video = videoRef.value
    if (!video || !worker.value || !isReady.value) return
    if (video.paused || video.ended) return
    if (timestamp === lastTimestamp) return
    // One outstanding detect at a time — a slow frame naturally throttles
    // the request rate instead of queueing stale work behind it.
    if (pendingRequestId !== null) return
    lastTimestamp = timestamp

    const id = ++nextRequestId
    pendingRequestId = id
    const detectTimestamp = performance.now()
    pendingSentAt = detectTimestamp

    captureFrame(video)
      .then((bitmap) => {
        // The face-landmarker may have been torn down while the bitmap was
        // being created (e.g. component unmount mid-frame).
        if (!worker.value || pendingRequestId !== id) {
          bitmap.close()
          return
        }
        post({ type: 'detect', id, bitmap, timestamp: detectTimestamp }, [
          bitmap
        ])
      })
      .catch((err) => {
        if (pendingRequestId !== id) return
        pendingRequestId = null
        error.value = 'runtime_failed'
        logger.error('[useFaceLandmarker] Frame capture failed', { err })
      })
  }

  // Detect-loop scheduling: prefer requestVideoFrameCallback so detection
  // runs once per *produced video frame* (30–60fps depending on the camera)
  // instead of once per rAF (60–120Hz). Halving or quartering the detect rate
  // costs nothing — MediaPipe + smoothing interpolate fine at 30fps — while
  // freeing the render thread. The callback timestamp is deliberately NOT
  // used as the MediaPipe timestamp: a camera stop/start resets mediaTime,
  // and MediaPipe throws on non-monotonic timestamps, so detect() always
  // stamps frames with performance.now().
  //
  // rVFC isn't in every TS lib.dom yet and is unsupported in older Safari,
  // so access it via a structural type and fall back to rAF.
  type VideoFrameCallbackElement = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number
    cancelVideoFrameCallback?: (handle: number) => void
  }

  let loopActive = false
  let cancelFrame: (() => void) | null = null

  function scheduleLoop() {
    if (!loopActive) return
    const video = videoRef.value as VideoFrameCallbackElement | null
    if (!video) {
      loopActive = false
      return
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      const handle = video.requestVideoFrameCallback(() => {
        cancelFrame = null
        detect(performance.now())
        scheduleLoop()
      })
      cancelFrame = () => video.cancelVideoFrameCallback?.(handle)
    } else {
      const handle = requestAnimationFrame(() => {
        cancelFrame = null
        detect(performance.now())
        scheduleLoop()
      })
      cancelFrame = () => cancelAnimationFrame(handle)
    }
  }

  function startLoop() {
    if (loopActive) return
    loopActive = true
    scheduleLoop()
  }

  function stopLoop() {
    loopActive = false
    cancelFrame?.()
    cancelFrame = null
  }

  watch(
    [() => videoRef.value, isReady],
    ([video, ready]) => {
      if (video && ready) {
        startLoop()
      } else {
        stopLoop()
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    stopLoop()
    destroy()
  })

  return {
    isLoading,
    isReady,
    error,
    hasFace,
    noFace,
    confidence,
    faceWidth,
    landmarks,
    transformationMatrixes,
    pose,
    anchor,
    latencyMs,
    init,
    detect,
    destroy
  }
}
