import { describe, it, expect, vi } from 'vitest'
import {
  scheduleOnCameraFrame,
  type FrameScheduler
} from '../../../src/runtime/utils/tryon-frame-schedule'

/** A video element with rVFC: `deliverFrame()` plays the presented-frame callbacks. */
function videoWithRvfc() {
  const pending = new Map<number, () => void>()
  let nextHandle = 1
  const video = {
    requestVideoFrameCallback: vi.fn((cb: () => void) => {
      pending.set(nextHandle, cb)
      return nextHandle++
    }),
    cancelVideoFrameCallback: vi.fn((handle: number) => pending.delete(handle))
  }
  return {
    video,
    deliverFrame() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const cb of callbacks) cb()
    }
  }
}

/** A rAF stand-in that records requests and runs them on `flush()`. */
function fakeFrames() {
  const pending = new Map<number, FrameRequestCallback>()
  let nextHandle = 1
  const frames: FrameScheduler = {
    requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
      pending.set(nextHandle, cb)
      return nextHandle++
    }),
    cancelAnimationFrame: vi.fn((handle: number) => pending.delete(handle))
  }
  return {
    frames,
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const cb of callbacks) cb(0)
    }
  }
}

describe('scheduleOnCameraFrame', () => {
  it('runs once per presented video frame via requestVideoFrameCallback', () => {
    const { video, deliverFrame } = videoWithRvfc()
    const { frames } = fakeFrames()
    const callback = vi.fn()

    scheduleOnCameraFrame(video, callback, frames)
    deliverFrame()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(frames.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('does not run again without a new video frame', () => {
    const { video, deliverFrame } = videoWithRvfc()
    const callback = vi.fn()

    scheduleOnCameraFrame(video, callback)
    deliverFrame()
    deliverFrame()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('falls back to requestAnimationFrame when rVFC is missing', () => {
    const { frames, flush } = fakeFrames()
    const callback = vi.fn()

    scheduleOnCameraFrame({}, callback, frames)
    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(1)
    flush()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending rVFC callback', () => {
    const { video, deliverFrame } = videoWithRvfc()
    const callback = vi.fn()

    const cancel = scheduleOnCameraFrame(video, callback)
    cancel()
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1)
    deliverFrame()
    expect(callback).not.toHaveBeenCalled()
  })

  it('cancels a pending rAF callback in the fallback path', () => {
    const { frames, flush } = fakeFrames()
    const callback = vi.fn()

    const cancel = scheduleOnCameraFrame({}, callback, frames)
    cancel()
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    flush()
    expect(callback).not.toHaveBeenCalled()
  })
})
