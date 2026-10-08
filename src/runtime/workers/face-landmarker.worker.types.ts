/**
 * Message types shared between the main thread and
 * `face-landmarker.worker.ts`, split into their own file because the worker
 * is built as a classic (non-module) worker: any top-level `export` in the
 * worker's own source — even a type-only one that's erased at runtime —
 * makes the compiler emit a trailing `export {}` marker in the bundled
 * output, which is a syntax error outside a module worker.
 */

export type FaceLandmarkerWorkerRequest =
  | {
      type: 'init'
      /**
       * Directory the MediaPipe Wasm fileset is served from. Defaults to
       * jsDelivr's CDN when omitted — pass a same-origin path (e.g.
       * `/mediapipe/wasm`) to self-host and drop the CDN dependency.
       */
      basePath?: string | undefined
      /**
       * URL/path to the `face_landmarker.task` model asset. Defaults to
       * Google's model-zoo CDN when omitted.
       */
      modelAssetPath?: string | undefined
    }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'destroy' }

export type FaceLandmarkerWorkerResponse =
  | { type: 'ready' }
  | { type: 'load_failed'; message: string }
  | {
      type: 'result'
      id: number
      landmarks: { x: number; y: number; z: number }[]
      transformationMatrix: number[] | null
      /**
       * max(eyeBlinkLeft, eyeBlinkRight) blendshape score, 0 open … 1
       * closed; null when the model emits no blendshapes.
       */
      blink: number | null
    }
  | { type: 'detect_failed'; id: number; message: string }
