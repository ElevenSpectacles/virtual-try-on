/**
 * Dedicated worker running MediaPipe FaceLandmarker's synchronous
 * `detectForVideo` calls off the main thread. The main thread grabs each
 * video frame as a transferable `ImageBitmap` and posts it here; only the
 * small landmark/matrix result comes back, so the worker never touches the
 * DOM. On request it also sends back a 16×16 RGBA downsample of the frame
 * for the room-lighting estimate: reading pixels back from a GPU-backed
 * bitmap costs about a millisecond, which belongs here, not on the render
 * thread.
 */

// Classic (non-module) worker: this file must contain zero static
// `import`/`export` syntax. esbuild treats any top-level import/export as an
// ES module and appends a trailing `export {}` marker to the bundle — a hard
// SyntaxError outside a module worker — even for a type-only `import type`.
// The request/response types are therefore duplicated here (source of truth
// lives in `../types/face-landmarker-worker`, consumed via normal import by
// the main-thread composable) instead of imported.
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

// The landmarker is created in VIDEO mode and never leaves it — the camera
// is the only input source.
let faceLandmarker: FaceLandmarkerInstance | null = null

function post(message: FaceLandmarkerWorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}

// Side of the lighting downsample. 16×16 is 256 pixels: enough for a mean
// luma and colour cast (see utils/tryon-lighting).
const SAMPLE_SIZE = 16
// undefined until first use; null when OffscreenCanvas 2D is unavailable,
// in which case samples are silently skipped (lighting stays neutral).
let sampleContext: OffscreenCanvasRenderingContext2D | null | undefined

// Draw the frame into a 16×16 canvas and read it back. The readback waits
// on the GPU (the bitmap is GPU-backed and MediaPipe has just queued work),
// about 1.2 ms on a laptop; it runs here, after the result is posted, and the
// main thread asks for one sample every LIGHTING_SAMPLE_EVERY detections.
// (A GPU-side `createImageBitmap` resize first was slower: 2.5 ms.)
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
    if (!sampleContext) return
    const startedAt = performance.now()
    sampleContext.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const ms = performance.now() - startedAt
    post(
      { type: 'sample', id, pixels: data, width: SAMPLE_SIZE, height: SAMPLE_SIZE, ms },
      [data.buffer]
    )
  } catch {
    // A failed sample only costs the lighting estimate one frame.
  }
}

// Card calibration crop (keep in step with CARD_CROP_WIDTH/HEIGHT in
// utils/tryon-card): the forehead band, scaled down and turned grey here so
// only ~30 KB crosses back, and only while the host runs a calibration.
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
    if (!cardContext) return
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
  } catch {
    // A failed crop only costs the calibration one frame.
  }
}

// Defaults used when the host doesn't pass a self-hosted path — kept as the
// fallback rather than a hard requirement, since FilesetResolver.forVisionTasks
// accepts any basePath (see docs on the class) and modelAssetPath is just a
// URL/path string.
// The WASM must match the bundled JS exactly: keep this version equal to the
// pinned `@mediapipe/tasks-vision` dependency (enforced by a unit test).
const DEFAULT_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
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
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      // Only eyeBlinkLeft/Right are read (see `blinkScore`): calibrated
      // blink scores that stay valid while the eyelid hides the iris.
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    })

    try {
      // The dynamically-imported FaceLandmarker satisfies the narrowed
      // FaceLandmarkerInstance structurally (VIDEO-mode detectForVideo result
      // is a superset), so no cast is needed — assign directly.
      const gpu: FaceLandmarkerInstance = await FaceLandmarker.createFromOptions(
        vision,
        landmarkerOptions('GPU')
      )
      faceLandmarker = gpu
    } catch {
      // GPU delegate needs OffscreenCanvas/WebGL2 in-worker support; fall
      // back to CPU the same way the main-thread path does.
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

// Stronger of the two eye-blink blendshapes (0 open … 1 closed), or null
// when the model emitted no blendshapes (e.g. a self-hosted model without
// the blendshape head) — callers fall back to the landmark heuristic.
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
          // After the result, so the downsample never delays the landmarks.
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
        } catch {
          // ignore
        }
        faceLandmarker = null
        break
    }
  }
)
