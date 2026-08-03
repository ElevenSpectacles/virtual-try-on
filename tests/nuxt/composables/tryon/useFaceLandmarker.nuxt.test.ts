import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { useFaceLandmarker } from '../../../../composables/tryon/useFaceLandmarker'
import type {
  FaceLandmarkerWorkerRequest,
  FaceLandmarkerWorkerResponse
} from '../../../../workers/face-landmarker.worker.types'

/**
 * Detection now runs in a Worker, so the tests fake the worker side: a
 * `postMessage` spy records requests, and each test drives responses back via
 * `emit()` exactly like the real worker's `onmessage` would.
 */
class FakeWorker {
  onmessage:
    | ((event: MessageEvent<FaceLandmarkerWorkerResponse>) => void) | null = null

  postMessage = vi.fn((message: FaceLandmarkerWorkerRequest) => {
    instances.push(this)
    lastRequest = message
  })

  terminate = vi.fn()

  emit(response: FaceLandmarkerWorkerResponse) {
    this.onmessage?.({
      data: response
    } as MessageEvent<FaceLandmarkerWorkerResponse>)
  }
}

let instances: FakeWorker[] = []
let lastRequest: FaceLandmarkerWorkerRequest | null = null

function latestWorker(): FakeWorker {
  const worker = instances.at(-1)
  if (!worker) throw new Error('No worker instantiated')
  return worker
}

const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap

describe('useFaceLandmarker', () => {
  let originalWebAssembly: typeof window.WebAssembly | undefined
  let originalWorker: typeof window.Worker | undefined
  let originalCreateImageBitmap: typeof window.createImageBitmap | undefined

  beforeEach(() => {
    instances = []
    lastRequest = null

    originalWebAssembly = window.WebAssembly
    ;(window as unknown as { WebAssembly: unknown }).WebAssembly = {
      instantiate: vi.fn()
    }

    originalWorker = window.Worker
    ;(window as unknown as { Worker: unknown }).Worker = FakeWorker

    originalCreateImageBitmap = window.createImageBitmap
    ;(window as unknown as { createImageBitmap: unknown }).createImageBitmap =
      vi.fn().mockResolvedValue(mockBitmap)
  })

  afterEach(() => {
    if (originalWebAssembly === undefined) {
      delete (window as unknown as { WebAssembly?: unknown }).WebAssembly
    } else {
      window.WebAssembly = originalWebAssembly
    }

    if (originalWorker === undefined) {
      delete (window as unknown as { Worker?: unknown }).Worker
    } else {
      window.Worker = originalWorker
    }

    if (originalCreateImageBitmap === undefined) {
      delete (window as unknown as { createImageBitmap?: unknown })
        .createImageBitmap
    } else {
      window.createImageBitmap = originalCreateImageBitmap
    }
  })

  async function initReady(videoRef: Ref<HTMLVideoElement | null>) {
    const landmarker = useFaceLandmarker(videoRef)
    const initPromise = landmarker.init()
    // Let the worker be constructed and receive the 'init' postMessage.
    await Promise.resolve()
    latestWorker().emit({ type: 'ready' })
    await initPromise
    return landmarker
  }

  const sampleLandmarks = [
    { x: 0.1, y: 0.2, z: 0.3 },
    { x: 0.4, y: 0.5, z: 0.6 },
    { x: 0.7, y: 0.8, z: 0.9 },
    { x: 0.2, y: 0.3, z: 0.4 },
    { x: 0.5, y: 0.6, z: 0.7 },
    { x: 0.8, y: 0.9, z: 1.0 },
    { x: 0.3, y: 0.4, z: 0.5 }
  ]

  it('starts in an idle state', () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { isLoading, isReady, hasFace, anchor } = useFaceLandmarker(videoRef)

    expect(isLoading.value).toBe(false)
    expect(isReady.value).toBe(false)
    expect(hasFace.value).toBe(false)
    expect(anchor.value).toBeNull()
  })

  it('reports unsupported when WebAssembly is missing', async () => {
    delete (window as unknown as { WebAssembly?: unknown }).WebAssembly

    const videoRef = ref<HTMLVideoElement | null>(null)
    const { init, error, isReady } = useFaceLandmarker(videoRef)

    await init()

    expect(error.value).toBe('unsupported')
    expect(isReady.value).toBe(false)
    expect(instances).toHaveLength(0)
  })

  it('loads the model and becomes ready', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { isReady, isLoading, error } = await initReady(videoRef).then(
      async (landmarker) => landmarker
    )

    expect(isReady.value).toBe(true)
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(lastRequest).toEqual({ type: 'init' })
  })

  it('exposes the selected anchor landmark and pose after a detect round-trip', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detect, anchor, pose } = await initReady(videoRef)

    videoRef.value = {
      paused: false,
      ended: false
    } as unknown as HTMLVideoElement
    detect(performance.now())
    await Promise.resolve()
    await Promise.resolve()

    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: sampleLandmarks,
      transformationMatrix: Array.from(new Float32Array(16))
    })

    // Default anchor index is 6.
    expect(anchor.value).toEqual({ x: 0.3, y: 0.4, z: 0.5 })
    expect(pose.value).not.toBeNull()
    expect(pose.value?.position).toBeDefined()
    expect(pose.value?.euler).toBeDefined()
  })

  it('falls back to the first landmark when anchor index is out of range', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    // recreate with a custom, out-of-range anchorIndex.
    const landmarker = useFaceLandmarker(videoRef, { anchorIndex: 99 })
    const initPromise = landmarker.init()
    await Promise.resolve()
    latestWorker().emit({ type: 'ready' })
    await initPromise

    videoRef.value = {
      paused: false,
      ended: false
    } as unknown as HTMLVideoElement
    landmarker.detect(performance.now())
    await Promise.resolve()
    await Promise.resolve()
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: sampleLandmarks,
      transformationMatrix: null
    })

    expect(landmarker.anchor.value).toEqual(sampleLandmarks[0])
  })

  it('computes detection stability as confidence', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detect, confidence } = await initReady(videoRef)

    videoRef.value = {
      paused: false,
      ended: false
    } as unknown as HTMLVideoElement

    detect(performance.now())
    await Promise.resolve()
    await Promise.resolve()
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: sampleLandmarks,
      transformationMatrix: null
    })
    expect(confidence.value).toBeCloseTo(1)

    detect(performance.now() + 16)
    await Promise.resolve()
    await Promise.resolve()
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: [],
      transformationMatrix: null
    })
    expect(confidence.value).toBeCloseTo(0.5)
  })

  it('reports noFace when detection returns empty landmarks', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detect, hasFace, noFace } = await initReady(videoRef)

    videoRef.value = {
      paused: false,
      ended: false
    } as unknown as HTMLVideoElement
    detect(performance.now())
    await Promise.resolve()
    await Promise.resolve()
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: [],
      transformationMatrix: null
    })

    expect(hasFace.value).toBe(false)
    expect(noFace.value).toBe(true)
  })

  it('detects on a static image', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detectOnImage, hasFace, anchor } = await initReady(videoRef)

    detectOnImage({} as HTMLImageElement)
    await Promise.resolve()
    await Promise.resolve()

    expect(lastRequest?.type).toBe('detectImage')
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: sampleLandmarks,
      transformationMatrix: null
    })

    expect(hasFace.value).toBe(true)
    expect(anchor.value).toEqual({ x: 0.3, y: 0.4, z: 0.5 })
  })

  it('cleans up on destroy', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { destroy, isReady } = await initReady(videoRef)

    const worker = latestWorker()
    destroy()

    expect(isReady.value).toBe(false)
    expect(worker.terminate).toHaveBeenCalled()
  })
})
