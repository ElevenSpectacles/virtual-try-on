import { getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * Reactive content-box size of an element, tracked with a ResizeObserver.
 * Stays `0 × 0` until the element mounts, and where ResizeObserver doesn't
 * exist (SSR).
 *
 * The module's own replacement for VueUse's `useElementSize` (see
 * `useTryOnFrameLoop`).
 */
export function useTryOnElementSize(target: Ref<HTMLElement | null>): {
  width: Ref<number>
  height: Ref<number>
} {
  const width = ref(0)
  const height = ref(0)
  if (typeof ResizeObserver === 'undefined') return { width, height }

  const observer = new ResizeObserver((entries) => {
    const rect = entries[entries.length - 1]?.contentRect
    if (!rect) return
    width.value = rect.width
    height.value = rect.height
  })

  watch(
    target,
    (el, _previous, onCleanup) => {
      if (!el) return
      observer.observe(el)
      onCleanup(() => observer.unobserve(el))
    },
    { immediate: true }
  )

  if (getCurrentScope()) {
    onScopeDispose(() => observer.disconnect())
  }

  return { width, height }
}
