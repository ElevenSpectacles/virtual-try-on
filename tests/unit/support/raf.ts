import { vi } from 'vitest'

/**
 * requestAnimationFrame stand-in for composables on `useTryOnFrameLoop`.
 * `frame(now)` runs the callbacks queued since the previous frame with that
 * timestamp; `frame()` advances the clock by `stepMs` first. Undo it with
 * `vi.unstubAllGlobals()`.
 */
export function stubRaf(stepMs = 1000 / 60) {
  const queue = new Map<number, FrameRequestCallback>()
  let nextId = 1
  let now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.set(nextId, cb)
    return nextId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))

  function frame(at = now + stepMs) {
    now = at
    const pending = [...queue.values()]
    queue.clear()
    for (const cb of pending) cb(now)
  }

  return {
    frame,
    frames(count: number) {
      for (let i = 0; i < count; i++) frame()
    },
    get pending() {
      return queue.size
    }
  }
}
