/**
 * Message types shared between the main thread and
 * `workers/hair-segmenter.worker.ts`. Kept out of the worker for the same
 * reason as `face-landmarker.worker.types.ts`: the worker is a classic worker
 * and must not contain any `export`. Keep the inline copy in the worker in
 * sync.
 */

export type HairSegmenterWorkerRequest =
  | {
      type: 'init'
      /** Directory of the MediaPipe Wasm fileset (same as the face landmarker's). */
      basePath?: string | undefined
      /** URL/path of the `hair_segmenter.tflite` model. */
      modelAssetPath?: string | undefined
    }
  | { type: 'segment'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'destroy' }

export type HairSegmenterWorkerResponse =
  | { type: 'ready' }
  | { type: 'load_failed'; message: string }
  | {
      type: 'mask'
      id: number
      /** Hair confidence 0…1 per pixel, row-major from the top (a copy). */
      confidence: Float32Array
      width: number
      height: number
      /** Worker time for the segmentation, ms. */
      ms: number
    }
  | { type: 'segment_failed'; id: number; message: string }
