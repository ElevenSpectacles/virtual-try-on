export type FaceLandmarkerWorkerRequest =
  | {
      type: 'init'
      basePath?: string | undefined
      modelAssetPath?: string | undefined
    }
  | {
      type: 'detect'
      id: number
      bitmap: ImageBitmap
      timestamp: number
      sample?: boolean
      card?: { x: number; y: number; width: number; height: number } | undefined
    }
  | { type: 'destroy' }

export type FaceLandmarkerWorkerResponse =
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
      region: { x: number; y: number; width: number; height: number }
    }
  | { type: 'observer_failed'; id: number; observer: TryOnObserver; message: string }

export type TryOnObserver = 'sample' | 'card'
