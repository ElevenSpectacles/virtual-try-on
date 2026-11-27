import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { useFaceLandmarker } from '../../../../src/runtime/composables/tryon/useFaceLandmarker'
import type {
  FaceLandmarkerWorkerRequest,
  FaceLandmarkerWorkerResponse
} from '../../../../src/runtime/types/face-landmarker-worker'

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
  beforeEach(() => {
    instances = []
    lastRequest = null
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebAssembly', { instantiate: vi.fn() })
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap))
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function initReady(videoRef: Ref<HTMLVideoElement | null>) {
    const landmarker = useFaceLandmarker(videoRef)
    const initPromise = landmarker.init()
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

  async function initWithObserver(onObserverError: (observer: string, message: string) => void) {
    const landmarker = useFaceLandmarker(ref<HTMLVideoElement | null>(null), {
      onFrameSample: () => {
        throw new Error('lighting broke')
      },
      onObserverError
    })
    const initPromise = landmarker.init()
    await Promise.resolve()
    latestWorker().emit({ type: 'ready' })
    await initPromise
    return landmarker
  }

  it('hands a worker-side observer failure to onObserverError', async () => {
    const onObserverError = vi.fn()
    const { error } = await initWithObserver(onObserverError)
    latestWorker().emit({
      type: 'observer_failed',
      id: 1,
      observer: 'card',
      message: 'OffscreenCanvas 2d context unavailable'
    })
    expect(onObserverError).toHaveBeenCalledWith('card', 'OffscreenCanvas 2d context unavailable')
    expect(error.value).toBeNull()
  })

  it('hands a throwing frame-sample callback to onObserverError', async () => {
    const onObserverError = vi.fn()
    const { error } = await initWithObserver(onObserverError)
    latestWorker().emit({
      type: 'sample',
      id: 1,
      pixels: new Uint8ClampedArray(16 * 16 * 4),
      width: 16,
      height: 16,
      ms: 1
    })
    expect(onObserverError).toHaveBeenCalledWith('sample', 'lighting broke')
    expect(error.value).toBeNull()
  })

  it('starts in an idle state', () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { isLoading, isReady, hasFace, anchor } = useFaceLandmarker(videoRef)

    expect(isLoading.value).toBe(false)
    expect(isReady.value).toBe(false)
    expect(hasFace.value).toBe(false)
    expect(anchor.value).toBeNull()
  })

  it('reports unsupported when WebAssembly is missing', async () => {
    vi.stubGlobal('WebAssembly', undefined)

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

    expect(anchor.value?.x).toBeCloseTo(0.55)
    expect(anchor.value?.y).toBeCloseTo(0.65)
    expect(anchor.value?.z).toBeCloseTo(0.75)
    expect(pose.value).not.toBeNull()
    expect(pose.value?.position).toBeDefined()
    expect(pose.value?.euler).toBeDefined()
  })

  it('falls back to the first landmark when no anchor index is in range', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const landmarker = useFaceLandmarker(videoRef, { anchorIndices: [99] })
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

  it('cleans up on destroy', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { destroy, isReady } = await initReady(videoRef)

    const worker = latestWorker()
    destroy()

    expect(isReady.value).toBe(false)
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('detects a paused (held) frame on demand and resolves on its result', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detect, detectHeld, anchor } = await initReady(videoRef)
    videoRef.value = {
      paused: true,
      ended: false
    } as unknown as HTMLVideoElement

    expect(detect(performance.now())).toBeNull()

    let resolved = false
    const held = detectHeld().then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    latestWorker().emit({
      type: 'result',
      id: (lastRequest as { id: number }).id,
      landmarks: sampleLandmarks,
      transformationMatrix: null,
      blink: null
    })
    await held
    expect(resolved).toBe(true)
    expect(anchor.value).not.toBeNull()
  })

  it('resolves a held detection at once while the tracker is not running', async () => {
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { detectHeld } = useFaceLandmarker(videoRef)
    await expect(detectHeld()).resolves.toBeUndefined()
  })
})
