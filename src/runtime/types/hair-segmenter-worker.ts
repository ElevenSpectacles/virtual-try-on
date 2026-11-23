export type HairSegmenterWorkerRequest =
  | {
      type: 'init'
      basePath?: string | undefined
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
      confidence: Float32Array
      width: number
      height: number
      ms: number
    }
  | { type: 'segment_failed'; id: number; message: string }
