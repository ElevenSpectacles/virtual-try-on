/**
 * Dedicated worker running MediaPipe FaceLandmarker's synchronous
 * `detectForVideo`/`detect` calls off the main thread. The main thread grabs
 * each video frame as a transferable `ImageBitmap` and posts it here; only
 * the small landmark/matrix result comes back, so the worker never touches
 * the DOM.
 */

// Classic (non-module) worker: this file must contain zero static
// `import`/`export` syntax. esbuild treats any top-level import/export as an
// ES module and appends a trailing `export {}` marker to the bundle — a hard
// SyntaxError outside a module worker — even for a type-only `import type`.
// The request/response types are therefore duplicated here (source of truth
// lives in `./face-landmarker.worker.types`, consumed via normal import by
// the main-thread composable) instead of imported.
type FaceLandmarkerWorkerRequest =
  | { type: 'init' }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'detectImage'; id: number; bitmap: ImageBitmap }
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
  detect(image: ImageBitmap): {
    faceLandmarks?: { x: number; y: number; z: number }[][]
    facialTransformationMatrixes?: { data: Float32Array }[]
  }
  detectForVideo(
    image: ImageBitmap,
    timestamp: number
  ): {
    faceLandmarks?: { x: number; y: number; z: number }[][]
    facialTransformationMatrixes?: { data: Float32Array }[]
  }
  setOptions(options: { runningMode: 'IMAGE' | 'VIDEO' }): Promise<void>
  close?(): void
}

let faceLandmarker: FaceLandmarkerInstance | null = null
// FaceLandmarker is a single stateful task bound to one runningMode; the
// component supports both a live-video loop and a static photo-upload
// fallback, so the mode is switched on demand via `setOptions()` rather than
// keeping two instances loaded.
let runningMode: 'IMAGE' | 'VIDEO' = 'VIDEO'

function post(message: FaceLandmarkerWorkerResponse) {
  self.postMessage(message)
}

async function init() {
  try {
    const { FilesetResolver, FaceLandmarker } =
      await import('@mediapipe/tasks-vision')

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm'
    )

    const baseOptions = {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
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

    runningMode = 'VIDEO'
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
        void init()
        break

      case 'detect': {
        const { id, bitmap, timestamp } = message
        void (async () => {
          try {
            if (!faceLandmarker) throw new Error('FaceLandmarker not ready')
            if (runningMode !== 'VIDEO') {
              await faceLandmarker.setOptions({ runningMode: 'VIDEO' })
              runningMode = 'VIDEO'
            }
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
        })()
        break
      }

      case 'detectImage': {
        const { id, bitmap } = message
        void (async () => {
          try {
            if (!faceLandmarker) throw new Error('FaceLandmarker not ready')
            if (runningMode !== 'IMAGE') {
              await faceLandmarker.setOptions({ runningMode: 'IMAGE' })
              runningMode = 'IMAGE'
            }
            const raw = faceLandmarker.detect(bitmap)
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
        })()
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
