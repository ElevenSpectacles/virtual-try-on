import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTryOnFrameLoop } from '../../../../src/runtime/composables/tryon/useTryOnFrameLoop'
import { useTryOnElementSize } from '../../../../src/runtime/composables/tryon/useTryOnElementSize'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTryOnFrameLoop', () => {
  function stubRaf() {
    const queue = new Map<number, FrameRequestCallback>()
    let nextId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.set(nextId, cb)
      return nextId++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
    return {
      frame(now: number) {
        const pending = [...queue.values()]
        queue.clear()
        for (const cb of pending) cb(now)
      },
      get pending() {
        return queue.size
      }
    }
  }

  it('reports 0 on the first frame, then ms since the previous frame', () => {
    const raf = stubRaf()
    const deltas: number[] = []
    const scope = effectScope()
    scope.run(() => useTryOnFrameLoop((delta) => deltas.push(delta)))

    raf.frame(1000)
    raf.frame(1016)
    raf.frame(1050)
    expect(deltas).toEqual([0, 16, 34])
    scope.stop()
  })

  it('stops when its scope is disposed', () => {
    const raf = stubRaf()
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => useTryOnFrameLoop(callback))

    raf.frame(0)
    scope.stop()
    expect(raf.pending).toBe(0)
    raf.frame(16)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without requestAnimationFrame (SSR)', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const callback = vi.fn()
    expect(() => useTryOnFrameLoop(callback)).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('useTryOnElementSize', () => {
  it('follows the observed element and disconnects with its scope', async () => {
    let notify: ResizeObserverCallback = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          notify = cb
        }
        observe = observe
        unobserve = vi.fn()
        disconnect = disconnect
      }
    )
    const el = ref<HTMLElement | null>(null)
    const scope = effectScope()
    const size = scope.run(() => useTryOnElementSize(el))!

    expect(size.width.value).toBe(0)
    const element = {} as HTMLElement
    el.value = element
    await nextTick()
    expect(observe).toHaveBeenCalledWith(element)

    notify(
      [{ contentRect: { width: 640, height: 480 } } as ResizeObserverEntry],
      {} as ResizeObserver
    )
    expect([size.width.value, size.height.value]).toEqual([640, 480])

    scope.stop()
    expect(disconnect).toHaveBeenCalled()
  })

  it('stays 0 × 0 without ResizeObserver (SSR)', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const size = useTryOnElementSize(ref(null))
    expect([size.width.value, size.height.value]).toEqual([0, 0])
  })
})
