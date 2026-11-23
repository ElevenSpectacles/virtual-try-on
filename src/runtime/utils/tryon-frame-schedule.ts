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
