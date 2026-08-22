/**
 * Dedicated worker running MediaPipe FaceLandmarker's synchronous
 * `detectForVideo` calls off the main thread. The main thread grabs each
 * video frame as a transferable `ImageBitmap` and posts it here; only the
 * small landmark/matrix result comes back, so the worker never touches the
 * DOM.
 */

// Classic (non-module) worker: this file must contain zero static
// `import`/`export` syntax. esbuild treats any top-level import/export as an
// ES module and appends a trailing `export {}` marker to the bundle — a hard
// SyntaxError outside a module worker — even for a type-only `import type`.
// The request/response types are therefore duplicated here (source of truth
// lives in `./face-landmarker.worker.types`, consumed via normal import by
// the main-thread composable) instead of imported.
type FaceLandmarkerWorkerRequest =
  | { type: 'init'; basePath?: string; modelAssetPath?: string }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'destroy' }

type FaceLandmarkerWorkerResponse =
  | { type: 'ready' }
  | { type: 'load_failed'; message: string }
  | {
      type: 'result'
      id: number
      landmarks: { x: number; y: number; z: number }[]
      transformationMatrix: number[] | null
    }
  | { type: 'detect_failed'; id: number; message: string }

interface FaceLandmarkerInstance {
  detectForVideo(
    image: ImageBitmap,
    timestamp: number
  ): {
    faceLandmarks?: { x: number; y: number; z: number }[][]
    facialTransformationMatrixes?: { data: Float32Array }[]
  }
  close?(): void
}

// The landmarker is created in VIDEO mode and never leaves it — the camera
// is the only input source.
let faceLandmarker: FaceLandmarkerInstance | null = null

function post(message: FaceLandmarkerWorkerResponse) {
  self.postMessage(message)
}

// Defaults used when the host doesn't pass a self-hosted path — kept as the
// fallback rather than a hard requirement, since FilesetResolver.forVisionTasks
// accepts any basePath (see docs on the class) and modelAssetPath is just a
// URL/path string.
const DEFAULT_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm'
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
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    })

    try {
      faceLandmarker = (await FaceLandmarker.createFromOptions(
        vision,
        landmarkerOptions('GPU')
      )) as unknown as FaceLandmarkerInstance
    } catch {
      // GPU delegate needs OffscreenCanvas/WebGL2 in-worker support; fall
      // back to CPU the same way the main-thread path does.
      faceLandmarker = (await FaceLandmarker.createFromOptions(
        vision,
        landmarkerOptions('CPU')
      )) as unknown as FaceLandmarkerInstance
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

function toResult(
  id: number,
  raw: {
    faceLandmarks?: { x: number; y: number; z: number }[][]
    facialTransformationMatrixes?: { data: Float32Array }[]
  }
): FaceLandmarkerWorkerResponse {
  const landmarks = raw.faceLandmarks?.[0] ?? []
  const matrixData = raw.facialTransformationMatrixes?.[0]?.data
  return {
    type: 'result',
    id,
    landmarks,
    transformationMatrix: matrixData ? Array.from(matrixData) : null
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
        const { id, bitmap, timestamp } = message
        try {
          if (!faceLandmarker) throw new Error('FaceLandmarker not ready')
          const raw = faceLandmarker.detectForVideo(bitmap, timestamp)
          post(toResult(id, raw))
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
