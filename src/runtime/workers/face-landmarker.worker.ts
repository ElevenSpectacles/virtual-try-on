type FaceLandmarkerWorkerRequest =
  | { type: 'init'; basePath?: string; modelAssetPath?: string }
  | {
      type: 'detect'
      id: number
      bitmap: ImageBitmap
      timestamp: number
      sample?: boolean
      card?: CardRegion
    }
  | { type: 'destroy' }

type FaceLandmarkerWorkerResponse =
  | { type: 'ready' }
  | { type: 'load_failed'; message: string }
  | {
      type: 'result'
      id: number
      landmarks: { x: number; y: number; z: number }[]
      transformationMatrix: number[] | null
      blink: number | null
    }
  | { type: 'detect_failed'; id: number; message: string }
  | {
      type: 'sample'
      id: number
      pixels: Uint8ClampedArray
      width: number
      height: number
      ms: number
    }
  | {
      type: 'card'
      id: number
      gray: Uint8ClampedArray
      width: number
      height: number
      region: CardRegion
    }
  | { type: 'observer_failed'; id: number; observer: 'sample' | 'card'; message: string }

interface CardRegion {
  x: number
  y: number
  width: number
  height: number
}

interface BlendshapeClassifications {
  categories: { categoryName: string; score: number }[]
}

interface FaceLandmarkerInstance {
  detectForVideo(
    image: ImageBitmap,
    timestamp: number
  ): {
    faceLandmarks?: { x: number; y: number; z: number }[][]
    facialTransformationMatrixes?: { data: Float32Array }[]
    faceBlendshapes?: BlendshapeClassifications[]
  }
  close?(): void
}

let faceLandmarker: FaceLandmarkerInstance | null = null

function post(message: FaceLandmarkerWorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}

function postObserverFailure(id: number, observer: 'sample' | 'card', err: unknown) {
  post({
    type: 'observer_failed',
    id,
    observer,
    message: err instanceof Error ? err.message : String(err)
  })
}

const SAMPLE_SIZE = 16
let sampleContext: OffscreenCanvasRenderingContext2D | null | undefined

function postSample(id: number, bitmap: ImageBitmap) {
  try {
    if (sampleContext === undefined) {
      sampleContext =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE).getContext('2d', {
              willReadFrequently: true
            })
          : null
    }
    if (!sampleContext) throw new Error('OffscreenCanvas 2d context unavailable')
    const startedAt = performance.now()
    sampleContext.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const ms = performance.now() - startedAt
    post(
      { type: 'sample', id, pixels: data, width: SAMPLE_SIZE, height: SAMPLE_SIZE, ms },
      [data.buffer]
    )
  } catch (err) {
    postObserverFailure(id, 'sample', err)
  }
}

const CARD_CROP_WIDTH = 320
const CARD_CROP_HEIGHT = 96
let cardContext: OffscreenCanvasRenderingContext2D | null | undefined

function postCard(id: number, bitmap: ImageBitmap, region: CardRegion) {
  try {
    if (cardContext === undefined) {
      cardContext =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(CARD_CROP_WIDTH, CARD_CROP_HEIGHT).getContext('2d', {
              willReadFrequently: true
            })
          : null
    }
    if (!cardContext) throw new Error('OffscreenCanvas 2d context unavailable')
    cardContext.drawImage(
      bitmap,
      region.x * bitmap.width,
      region.y * bitmap.height,
      region.width * bitmap.width,
      region.height * bitmap.height,
      0,
      0,
      CARD_CROP_WIDTH,
      CARD_CROP_HEIGHT
    )
    const { data } = cardContext.getImageData(0, 0, CARD_CROP_WIDTH, CARD_CROP_HEIGHT)
    const gray = new Uint8ClampedArray(CARD_CROP_WIDTH * CARD_CROP_HEIGHT)
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!
    }
    post(
      { type: 'card', id, gray, width: CARD_CROP_WIDTH, height: CARD_CROP_HEIGHT, region },
      [gray.buffer]
    )
  } catch (err) {
    postObserverFailure(id, 'card', err)
  }
}

const DEFAULT_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

async function init(basePath?: string, modelAssetPath?: string) {
  try {
    const { FilesetResolver, FaceLandmarker } =
      await import('@mediapipe/tasks-vision')

    const vision = await FilesetResolver.forVisionTasks(
      basePath ?? DEFAULT_WASM_BASE_PATH
    )

    const baseOptions = {
      modelAssetPath: modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH
    }

    const landmarkerOptions = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { ...baseOptions, delegate },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    })

    try {
      const gpu: FaceLandmarkerInstance = await FaceLandmarker.createFromOptions(
        vision,
        landmarkerOptions('GPU')
      )
      faceLandmarker = gpu
    } catch {
      const cpu: FaceLandmarkerInstance = await FaceLandmarker.createFromOptions(
        vision,
        landmarkerOptions('CPU')
      )
      faceLandmarker = cpu
    }

    post({ type: 'ready' })
  } catch (err) {
    post({
      type: 'load_failed',
      message:
        err instanceof Error
          ? `${err.message}\n${err.stack ?? ''}`
          : String(err)
    })
  }
}

function blinkScore(blendshapes?: BlendshapeClassifications): number | null {
  if (!blendshapes) return null
  let score: number | null = null
  for (const { categoryName, score: value } of blendshapes.categories) {
    if (categoryName === 'eyeBlinkLeft' || categoryName === 'eyeBlinkRight') {
      score = Math.max(score ?? 0, value)
    }
  }
  return score
}

function toResult(
  id: number,
  raw: ReturnType<FaceLandmarkerInstance['detectForVideo']>
): FaceLandmarkerWorkerResponse {
  const landmarks = raw.faceLandmarks?.[0] ?? []
  const matrixData = raw.facialTransformationMatrixes?.[0]?.data
  return {
    type: 'result',
    id,
    landmarks,
    transformationMatrix: matrixData ? Array.from(matrixData) : null,
    blink: blinkScore(raw.faceBlendshapes?.[0])
  }
}

self.addEventListener('error', (event: ErrorEvent) => {
  post({
    type: 'load_failed',
    message: `worker error: ${event.message}\n${event.filename}:${event.lineno}:${event.colno}\n${event.error?.stack ?? ''}`
  })
})

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason
  post({
    type: 'load_failed',
    message:
      reason instanceof Error
        ? `unhandled rejection: ${reason.message}\n${reason.stack ?? ''}`
        : `unhandled rejection: ${JSON.stringify(reason)}`
  })
})

self.addEventListener(
  'message',
  (event: MessageEvent<FaceLandmarkerWorkerRequest>) => {
    const message = event.data

    switch (message.type) {
      case 'init':
        void init(message.basePath, message.modelAssetPath)
        break

      case 'detect': {
        const { id, bitmap, timestamp, sample, card } = message
        try {
          if (!faceLandmarker) throw new Error('FaceLandmarker not ready')
          const raw = faceLandmarker.detectForVideo(bitmap, timestamp)
          post(toResult(id, raw))
          if (sample) postSample(id, bitmap)
          if (card) postCard(id, bitmap, card)
        } catch (err) {
          post({
            type: 'detect_failed',
            id,
            message: err instanceof Error ? err.message : String(err)
          })
        } finally {
          bitmap.close()
        }
        break
      }

      case 'destroy':
        try {
          faceLandmarker?.close?.()
        } catch {}
        faceLandmarker = null
        break
    }
  }
)
