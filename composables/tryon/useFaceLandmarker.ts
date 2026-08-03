import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { useRafFn } from '@vueuse/core'
import { getFaceWidth, type NormalizedLandmark } from '../../utils/tryon'
import { matrixToFacePose, type FacePose } from '../../utils/tryon-pose'
import type {
  FaceLandmarkerWorkerRequest,
  FaceLandmarkerWorkerResponse
} from '../../workers/face-landmarker.worker.types'

export type FaceLandmarkerError =
  | 'unsupported'
  | 'load_failed'
  | 'runtime_failed'

export interface UseFaceLandmarkerOptions {
  /**
   * Landmark index to use as the anchor for placing the frame. MediaPipe
   * indices: 1 = nose tip, 6 = between eyes, 168 = between eyebrows.
   * Defaults to 6 (glabella / between eyes).
   */
  anchorIndex?: number
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
  const anchorIndex = options.anchorIndex ?? 6
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

  /** The anchor landmark (between eyes by default) used to position the frame. */
  const anchor = computed<NormalizedLandmark | null>(() => {
    if (!hasFace.value) return null
    const list = landmarks.value
    return list[anchorIndex] ?? list[0] ?? null
  })

  // In-flight request bookkeeping: one outstanding detect/detectImage call
  // at a time, keyed by id so a stale response can never clobber a newer one.
  let nextRequestId = 0
  let pendingRequestId: number | null = null
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null

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
        post({ type: 'init' })
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
  }

  let lastTimestamp = -1

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

    createImageBitmap(video)
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

  /**
   * Run detection once on a static image. This is the fallback path for users
   * who cannot or do not want to use the live camera.
   */
  function detectOnImage(image: HTMLImageElement | HTMLCanvasElement) {
    if (!import.meta.client) return
    if (!worker.value || !isReady.value) return

    const id = ++nextRequestId
    pendingRequestId = id

    createImageBitmap(image)
      .then((bitmap) => {
        if (!worker.value || pendingRequestId !== id) {
          bitmap.close()
          return
        }
        post({ type: 'detectImage', id, bitmap }, [bitmap])
      })
      .catch((err) => {
        if (pendingRequestId !== id) return
        pendingRequestId = null
        error.value = 'runtime_failed'
        logger.error('[useFaceLandmarker] Image detection failed', { err })
      })
  }

  const { pause: pauseLoop, resume: resumeLoop } = useRafFn(
    ({ timestamp }) => detect(timestamp),
    { immediate: false }
  )

  watch(
    [() => videoRef.value, isReady],
    ([video, ready]) => {
      if (video && ready) {
        resumeLoop()
      } else {
        pauseLoop()
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    pauseLoop()
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
    init,
    detect,
    detectOnImage,
    destroy
  }
}
