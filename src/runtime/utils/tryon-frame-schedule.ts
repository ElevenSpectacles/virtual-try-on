/**
 * Camera-paced scheduling for detection: run a callback once per camera frame
 * the video element presents, instead of once per display refresh.
 *
 * `HTMLVideoElement.requestVideoFrameCallback` fires once per delivered video
 * frame. rAF is display-paced (60–120 Hz), so on a fast screen it would
 * re-detect the same camera frame several times. Where rVFC is missing (older
 * Safari) the callback falls back to rAF.
 *
 * rVFC isn't in every TS lib.dom yet, so the element is typed structurally.
 * The frame-request functions are injectable so this stays unit-testable.
 */

export interface VideoFrameElement {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

export interface FrameScheduler {
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (handle: number) => void
}

const browserFrames: FrameScheduler = {
  requestAnimationFrame: (callback) => requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => cancelAnimationFrame(handle)
}

/**
 * Schedule `callback` for the next camera frame. Returns a cancel function
 * that drops it if it has not run yet.
 */
export function scheduleOnCameraFrame(
  video: VideoFrameElement,
  callback: () => void,
  frames: FrameScheduler = browserFrames
): () => void {
  if (typeof video.requestVideoFrameCallback === 'function') {
    const handle = video.requestVideoFrameCallback(callback)
    return () => video.cancelVideoFrameCallback?.(handle)
  }

  const handle = frames.requestAnimationFrame(() => callback())
  return () => frames.cancelAnimationFrame(handle)
}
