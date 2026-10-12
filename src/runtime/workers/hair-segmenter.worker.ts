/**
 * Dedicated worker running MediaPipe's hair segmenter for the hair occluder
 * (issue #9; see utils/tryon-hair.ts). Separate from the face-landmarker
 * worker so segmentation never delays tracking, and so a failure here only
 * switches hair occlusion off.
 *
 * Same constraints as face-landmarker.worker.ts: a classic worker with zero
 * static `import`/`export` (MediaPipe's loader needs `importScripts`), message
 * types duplicated from `../types/hair-segmenter-worker` (keep in sync).
 */
type HairSegmenterWorkerRequest =
  | { type: 'init'; basePath?: string; modelAssetPath?: string }
  | { type: 'segment'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'destroy' }

type HairSegmenterWorkerResponse =
  | { type: 'ready' }
  | { type: 'load_failed'; message: string }
  | {
      type: 'mask'
      id: number
      confidence: Float32Array
      width: number
      height: number
      ms: number
    }
  | { type: 'segment_failed'; id: number; message: string }

interface HairMask {
  width: number
  height: number
  getAsFloat32Array(): Float32Array
}

interface ImageSegmenterInstance {
  segmentForVideo(
    image: ImageBitmap,
    timestamp: number,
    callback: (result: { confidenceMasks?: HairMask[] }) => void
  ): void
  getLabels(): string[]
  close?(): void
}

let segmenter: ImageSegmenterInstance | null = null
// Index of the hair confidence mask, from the model's labels.
let hairIndex = 1

function post(message: HairSegmenterWorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}

// Must match the face-landmarker worker's (and the pinned
// `@mediapipe/tasks-vision`; enforced by tests/unit/mediapipe-version.test.ts).
const DEFAULT_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
// The hair-only model (782 KB, 512² input, labels background/hair), not the
// 16 MB multiclass selfie model: this is a download on every phone that
// turns the feature on.
const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite'

async function init(basePath?: string, modelAssetPath?: string) {
  try {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(basePath ?? DEFAULT_WASM_BASE_PATH)
    // GPU only. A CPU segmenter is too slow to be worth the frames it would
    // cost; failing here just switches hair occlusion off.
    const instance: ImageSegmenterInstance = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH,
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false
    })
    const labelIndex = instance.getLabels().findIndex((label) => /hair/i.test(label))
    hairIndex = labelIndex >= 0 ? labelIndex : 1
    segmenter = instance
    post({ type: 'ready' })
  } catch (err) {
    post({
      type: 'load_failed',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

self.addEventListener('message', (event: MessageEvent<HairSegmenterWorkerRequest>) => {
  const message = event.data
  switch (message.type) {
    case 'init':
      void init(message.basePath, message.modelAssetPath)
      break

    case 'segment': {
      const { id, bitmap, timestamp } = message
      try {
        if (!segmenter) throw new Error('hair segmenter not ready')
        const startedAt = performance.now()
        let sent = false
        // Callback form: the masks belong to the task and are freed when the
        // callback returns, so the confidence is copied out inside it (it may
        // be a view on Wasm memory, which must never be transferred).
        segmenter.segmentForVideo(bitmap, timestamp, (result) => {
          const mask = result.confidenceMasks?.[hairIndex]
          if (!mask) return
          const confidence = new Float32Array(mask.getAsFloat32Array())
          sent = true
          post(
            {
              type: 'mask',
              id,
              confidence,
              width: mask.width,
              height: mask.height,
              ms: performance.now() - startedAt
            },
            [confidence.buffer]
          )
        })
        if (!sent) throw new Error('no hair mask in the segmentation result')
      } catch (err) {
        post({
          type: 'segment_failed',
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
        segmenter?.close?.()
      } catch {
        // ignore
      }
      segmenter = null
      break
  }
})
