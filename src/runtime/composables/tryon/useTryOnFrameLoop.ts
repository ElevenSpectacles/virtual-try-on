import { getCurrentScope, onScopeDispose } from 'vue'

export function useTryOnFrameLoop(callback: (deltaMs: number) => void): void {
  if (typeof requestAnimationFrame === 'undefined') return

  let handle = 0
  let previous: number | null = null
  const tick = (now: number) => {
    const delta = previous === null ? 0 : now - previous
    previous = now
    callback(delta)
    handle = requestAnimationFrame(tick)
  }
  handle = requestAnimationFrame(tick)

  if (getCurrentScope()) {
    onScopeDispose(() => cancelAnimationFrame(handle))
  }
}
