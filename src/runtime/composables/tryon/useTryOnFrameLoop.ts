import { getCurrentScope, onScopeDispose } from 'vue'

/**
 * Run `callback` once per animation frame with the milliseconds elapsed since
 * the previous frame (0 on the first), until the calling scope is disposed.
 * A no-op where `requestAnimationFrame` doesn't exist (SSR).
 *
 * The module's own replacement for VueUse's `useRafFn`, so hosts don't have
 * to provide a matching VueUse major. Prefixed to stay clear of host
 * auto-imports.
 */
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
