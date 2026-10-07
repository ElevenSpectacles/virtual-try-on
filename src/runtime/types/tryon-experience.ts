/** Camera failure reported by `useWebcamStream`. */
export type WebcamError = 'unsupported' | 'denied' | 'unavailable'

/** Face tracker failure reported by `useFaceLandmarker`. */
export type FaceLandmarkerError =
  | 'unsupported'
  | 'load_failed'
  | 'runtime_failed'

/** Camera lifecycle of `<VirtualTryOnExperience>`, for the host's UI. */
export type TryOnStatus = 'idle' | 'starting' | 'active' | 'error'

/**
 * Positioning hint for the host's guide UI: `noFace` while tracking runs
 * without a usable face, `aligned` once the anchor is found. `null` when the
 * camera is off.
 */
export type TryOnGuideHint = 'noFace' | 'aligned'
