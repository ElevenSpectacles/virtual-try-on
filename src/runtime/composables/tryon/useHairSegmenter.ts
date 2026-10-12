import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  HAIR_INPUT_WIDTH,
  HAIR_MASK_WIDTH,
  HAIR_SEGMENT_INTERVAL_MS,
  blendMask,
  downsampleConfidence,
  overSegmentBudget,
  updateSegmentTiming,
  type SegmentTiming
} from '../../utils/tryon-hair'
import { scheduleOnCameraFrame } from '../../utils/tryon-frame-schedule'
import type {
  HairSegmenterWorkerRequest,
  HairSegmenterWorkerResponse
} from '../../types/hair-segmenter-worker'

/** Hair confidence of the camera frame, 0…255 per pixel, row-major from the top. */
export interface HairMask {
  data: Uint8Array
  width: number
  height: number
}

export interface UseHairSegmenterOptions {
  /**
   * Whether to segment. Checked per camera frame; the worker and model load
   * the first time this is true (so they never delay the first try-on), and
   * segmentation pauses (mask cleared) while it is false.
   */
  enabled: () => boolean
  /** MediaPipe Wasm directory override (same as the face landmarker's). */
  mediapipeBasePath?: string | undefined
  /** `hair_segmenter.tflite` URL override, for self-hosting. */
  modelAssetPath?: string | undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Hair segmentation of the live camera frame in its own worker, for the hair
 * occluder (see utils/tryon-hair.ts). At most one request in flight, at most
 * one every HAIR_SEGMENT_INTERVAL_MS, on a small copy of the frame; the mask
 * comes back as confidence, is shrunk to HAIR_MASK_WIDTH and smoothed over
 * time.
 *
 * Switches itself off for the session (`overBudget`) when the worker's
 * segmentation time stays over HAIR_SEGMENT_BUDGET_MS. A load failure sets
 * `error` and leaves the mask null; the module never logs, the caller reports.
 */
export function useHairSegmenter(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseHairSegmenterOptions
) {
  const mask = shallowRef<HairMask | null>(null)
  const error = ref<string | null>(null)
  const ready = ref(false)
  /** Mean worker time per segmentation (EMA), ms. */
  const segmentMs = ref<number | null>(null)
  /** Masks received this session. */
  const masks = ref(0)
  const overBudget = ref(false)

  let worker: Worker | null = null
  let loading = false
  let nextId = 0
  let pendingId: number | null = null
  let lastRequestAt = -Infinity
  let timing: SegmentTiming | null = null
  let cancelFrame: (() => void) | null = null

  function post(message: HairSegmenterWorkerRequest, transfer: Transferable[] = []) {
    worker?.postMessage(message, transfer)
  }

  function onMessage(event: MessageEvent<HairSegmenterWorkerResponse>) {
    const message = event.data
    switch (message.type) {
      case 'ready':
        ready.value = true
        break
      case 'load_failed':
        error.value = message.message
        terminate()
        break
      case 'mask': {
        if (message.id !== pendingId) return
        pendingId = null
        timing = updateSegmentTiming(timing, message.ms)
        segmentMs.value = timing.meanMs
        if (overSegmentBudget(timing)) {
          overBudget.value = true
          mask.value = null
          return
        }
        const width = HAIR_MASK_WIDTH
        const height = Math.max(1, Math.round((width * message.height) / message.width))
        const next = downsampleConfidence(
          message.confidence,
          message.width,
          message.height,
          width,
          height
        )
        const previous = mask.value
        const data = blendMask(
          previous && previous.width === width && previous.height === height
            ? previous.data
            : null,
          next
        )
        masks.value++
        mask.value = { data, width, height }
        break
      }
      case 'segment_failed':
        if (message.id !== pendingId) return
        pendingId = null
        break
    }
  }

  function load() {
    if (worker || loading || error.value || !import.meta.client) return
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
      error.value = 'unsupported'
      return
    }
    loading = true
    try {
      worker = new Worker(new URL('../../workers/hair-segmenter.worker.ts', import.meta.url), {
        type: 'classic'
      })
      worker.onmessage = onMessage
      worker.onerror = (event: ErrorEvent) => {
        error.value = `worker error: ${event.message}`
        terminate()
      }
      post({
        type: 'init',
        ...(options.mediapipeBasePath !== undefined ? { basePath: options.mediapipeBasePath } : {}),
        ...(options.modelAssetPath !== undefined ? { modelAssetPath: options.modelAssetPath } : {})
      })
    } catch (err) {
      error.value = errorMessage(err)
      terminate()
    } finally {
      loading = false
    }
  }

  function terminate() {
    worker?.terminate()
    worker = null
    ready.value = false
    pendingId = null
    mask.value = null
  }

  function request(video: HTMLVideoElement) {
    if (!worker || !ready.value || pendingId !== null || overBudget.value) return
    if (!video.videoWidth || video.paused || video.ended) return
    const now = performance.now()
    if (now - lastRequestAt < HAIR_SEGMENT_INTERVAL_MS) return
    lastRequestAt = now
    const id = ++nextId
    pendingId = id
    const scale = Math.min(1, HAIR_INPUT_WIDTH / video.videoWidth)
    createImageBitmap(video, {
      resizeWidth: Math.round(video.videoWidth * scale),
      resizeHeight: Math.round(video.videoHeight * scale),
      resizeQuality: 'low'
    })
      .then((bitmap) => {
        if (!worker || pendingId !== id) {
          bitmap.close()
          return
        }
        post({ type: 'segment', id, bitmap, timestamp: now }, [bitmap])
      })
      .catch(() => {
        if (pendingId === id) pendingId = null
      })
  }

  function loop() {
    const video = videoRef.value
    if (!video) return
    cancelFrame = scheduleOnCameraFrame(video, () => {
      cancelFrame = null
      if (!options.enabled()) {
        mask.value = null
        return
      }
      load()
      request(video)
      loop()
    })
  }

  // Run while enabled: the check in `loop` stops it, this restarts it.
  watch(
    [() => options.enabled(), videoRef],
    ([enabled, video]) => {
      if (enabled && video && !cancelFrame) loop()
      if (!enabled) mask.value = null
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    cancelFrame?.()
    cancelFrame = null
    post({ type: 'destroy' })
    terminate()
  })

  return { mask, error, ready, segmentMs, masks, overBudget }
}
