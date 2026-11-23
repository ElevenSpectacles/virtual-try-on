import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  computeAnchorCentroid,
  getFaceWidth,
  TRYON_ANCHOR_INDICES,
  type NormalizedLandmark
} from '../../utils/tryon'
import { matrixToFacePose, type FacePose } from '../../utils/tryon-pose'
import { scheduleOnCameraFrame } from '../../utils/tryon-frame-schedule'
import type { CardRegion } from '../../utils/tryon-card'
import type {
  FaceLandmarkerWorkerRequest,
  FaceLandmarkerWorkerResponse
} from '../../types/face-landmarker-worker'
import type { FaceLandmarkerError } from '../../types/tryon-experience'

export type { FaceLandmarkerError }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface UseFaceLandmarkerOptions {
  anchorIndices?: readonly number[]
  mediapipeBasePath?: string | undefined
  mediapipeModelAssetPath?: string | undefined
  wantFrameSample?: (() => boolean) | undefined
  onFrameSample?:
    | ((
        rgba: Uint8ClampedArray,
        width: number,
        height: number,
        sampleMs: number
      ) => void)
    | undefined
  onLatency?: ((ms: number) => void) | undefined
  wantCardRegion?: (() => CardRegion | null) | undefined
  onCardCrop?:
    | ((gray: Uint8ClampedArray, width: number, height: number, region: CardRegion) => void)
    | undefined
}

function supportsMediaPipe(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.WebAssembly !== 'undefined' &&
    typeof window.WebAssembly.instantiate === 'function' &&
    typeof window.Worker !== 'undefined' &&
    typeof window.createImageBitmap === 'function'
  )
}

export function useFaceLandmarker(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseFaceLandmarkerOptions = {}
) {
  const anchorIndices = options.anchorIndices ?? TRYON_ANCHOR_INDICES
  const isLoading = ref(false)
  const isReady = ref(false)
  const error: Ref<FaceLandmarkerError | null> = ref(null)
  const errorDetail = ref<string | null>(null)
  const worker = shallowRef<Worker | null>(null)
  const landmarks = ref<NormalizedLandmark[]>([])
  const transformationMatrixes = ref<Float32Array[]>([])
  const pose = ref<FacePose | null>(null)
  const blinkScore = ref<number | null>(null)
  const hasFace = computed(() => landmarks.value.length > 0)
  const noFace = computed(() => isReady.value && !hasFace.value)
  const faceWidth = computed(() => getFaceWidth(landmarks.value))

  const CONFIDENCE_HISTORY_SIZE = 15
  const detectionHistory = ref<boolean[]>([])
  const confidence = computed(() => {
    const history = detectionHistory.value
    if (history.length === 0) return 0
    const detected = history.filter(Boolean).length
    return detected / history.length
  })

  const anchor = computed<NormalizedLandmark | null>(() => {
    if (!hasFace.value) return null
    const list = landmarks.value
    return computeAnchorCentroid(list, anchorIndices) ?? list[0] ?? null
  })

  let nextRequestId = 0
  let pendingRequestId: number | null = null
  let pendingSentAt = 0
  const resultWaiters = new Map<number, () => void>()
  let idleWaiters: (() => void)[] = []
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null

  const LATENCY_EMA_ALPHA = 0.2
  const latencyMs = ref(0)

  function recordLatency(sentAt: number) {
    const sample = performance.now() - sentAt
    options.onLatency?.(sample)
    latencyMs.value =
      latencyMs.value > 0
        ? latencyMs.value + LATENCY_EMA_ALPHA * (sample - latencyMs.value)
        : sample
  }

  function applyResult(
    landmarksResult: NormalizedLandmark[],
    matrix: number[] | null,
    blink: number | null
  ) {
    landmarks.value = landmarksResult
    blinkScore.value = blink
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
        errorDetail.value = message.message
        error.value = 'load_failed'
        readyReject?.(new Error(message.message))
        readyResolve = null
        readyReject = null
        break

      case 'result':
        if (message.id !== pendingRequestId) return
        pendingRequestId = null
        recordLatency(pendingSentAt)
        applyResult(
          message.landmarks,
          message.transformationMatrix,
          message.blink ?? null
        )
        settleRequest(message.id)
        break

      case 'detect_failed':
        if (message.id !== pendingRequestId) return
        pendingRequestId = null
        errorDetail.value = message.message
        error.value = 'runtime_failed'
        settleRequest(message.id)
        break

      case 'card':
        try {
          options.onCardCrop?.(message.gray, message.width, message.height, message.region)
        } catch {}
        break

      case 'sample':
        try {
          options.onFrameSample?.(
            message.pixels,
            message.width,
            message.height,
            message.ms
          )
        } catch {}
        break
    }
  }

  function settleRequest(id: number) {
    resultWaiters.get(id)?.()
    resultWaiters.delete(id)
    const waiting = idleWaiters
    idleWaiters = []
    for (const wake of waiting) wake()
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
    errorDetail.value = null

    try {
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
    } catch (err) {
      errorDetail.value ??= errorMessage(err)
      error.value = 'load_failed'
      worker.value?.terminate()
      worker.value = null
    } finally {
      isLoading.value = false
    }
  }

  function destroy() {
    for (const wake of resultWaiters.values()) wake()
    resultWaiters.clear()
    for (const wake of idleWaiters) wake()
    idleWaiters = []
    post({ type: 'destroy' })
    worker.value?.terminate()
    worker.value = null
    isReady.value = false
    landmarks.value = []
    transformationMatrixes.value = []
    pose.value = null
    blinkScore.value = null
    detectionHistory.value = []
    pendingRequestId = null
    pendingSentAt = 0
    latencyMs.value = 0
  }

  let lastTimestamp = -1

  const DETECT_MAX_WIDTH = 480

  function captureFrame(video: HTMLVideoElement, fullResolution = false): Promise<ImageBitmap> {
    if (!fullResolution && video.videoWidth > DETECT_MAX_WIDTH) {
      const scale = DETECT_MAX_WIDTH / video.videoWidth
      return createImageBitmap(video, {
        resizeWidth: DETECT_MAX_WIDTH,
        resizeHeight: Math.round(video.videoHeight * scale),
        resizeQuality: 'low'
      })
    }
    return createImageBitmap(video)
  }

  function detect(timestamp: number, { held = false }: { held?: boolean } = {}): number | null {
    if (!import.meta.client) return null
    const video = videoRef.value
    if (!video || !worker.value || !isReady.value) return null
    if (video.ended || (video.paused && !held)) return null
    if (timestamp === lastTimestamp) return null
    if (pendingRequestId !== null) return null
    lastTimestamp = timestamp

    const id = ++nextRequestId
    pendingRequestId = id
    const detectTimestamp = performance.now()
    pendingSentAt = detectTimestamp

    const card = options.wantCardRegion?.() ?? null
    captureFrame(video, card !== null)
      .then((bitmap) => {
        if (!worker.value || pendingRequestId !== id) {
          bitmap.close()
          return
        }
        post(
          {
            type: 'detect',
            id,
            bitmap,
            timestamp: detectTimestamp,
            sample: options.wantFrameSample?.() ?? false,
            ...(card ? { card } : {})
          },
          [bitmap]
        )
      })
      .catch((err) => {
        if (pendingRequestId !== id) return
        pendingRequestId = null
        errorDetail.value = errorMessage(err)
        error.value = 'runtime_failed'
        settleRequest(id)
      })
    return id
  }

  function detectHeld(): Promise<void> {
    return new Promise((resolve) => {
      const attempt = () => {
        if (pendingRequestId !== null) {
          idleWaiters.push(attempt)
          return
        }
        const id = detect(performance.now(), { held: true })
        if (id === null) resolve()
        else resultWaiters.set(id, resolve)
      }
      attempt()
    })
  }

  let loopActive = false
  let cancelFrame: (() => void) | null = null

  function scheduleLoop() {
    if (!loopActive) return
    const video = videoRef.value
    if (!video) {
      loopActive = false
      return
    }
    cancelFrame = scheduleOnCameraFrame(video, () => {
      cancelFrame = null
      detect(performance.now())
      scheduleLoop()
    })
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
    errorDetail,
    hasFace,
    noFace,
    confidence,
    faceWidth,
    landmarks,
    transformationMatrixes,
    pose,
    blinkScore,
    anchor,
    latencyMs,
    init,
    detect,
    detectHeld,
    destroy
  }
}
