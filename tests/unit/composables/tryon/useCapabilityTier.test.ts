import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCapabilityTier } from '../../../../src/runtime/composables/tryon/useCapabilityTier'
import { FRAME_BUDGET_MS, type TryOnTier } from '../../../../src/runtime/utils/tryon-capability'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** rAF stand-in: `frame(now)` runs the pending callbacks with that timestamp. */
function stubRaf() {
  let pending: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null
  })
  vi.stubGlobal('document', { hidden: false })
  return {
    frame(now: number) {
      const cb = pending
      pending = null
      cb?.(now)
    }
  }
}

describe('useCapabilityTier forced tier', () => {
  it('pins the tier and blocks step-downs while forced', () => {
    const raf = stubRaf()
    const forced = ref<TryOnTier | undefined>('high')
    const scope = effectScope()
    const tier = scope.run(() =>
      useCapabilityTier({ forcedTier: () => forced.value, sampling: () => true })
    )!.tier

    // Frames far over budget for well over the sustain window.
    let now = 0
    for (let i = 0; i < 400; i++) {
      now += FRAME_BUDGET_MS * 2
      raf.frame(now)
    }
    expect(tier.value).toBe('high')
    scope.stop()
  })

  it('applies a forced tier set after mount', async () => {
    stubRaf()
    const forced = ref<TryOnTier | undefined>(undefined)
    const scope = effectScope()
    const tier = scope.run(() =>
      useCapabilityTier({ forcedTier: () => forced.value })
    )!.tier
    expect(tier.value).toBe('mid')

    forced.value = 'low'
    await nextTick()
    expect(tier.value).toBe('low')
    scope.stop()
  })

  it('returns to the unforced tier when the forced value is cleared', async () => {
    stubRaf()
    const forced = ref<TryOnTier | undefined>('low')
    const scope = effectScope()
    const tier = scope.run(() =>
      useCapabilityTier({ forcedTier: () => forced.value })
    )!.tier
    expect(tier.value).toBe('low')

    forced.value = undefined
    await nextTick()
    // No device probe runs outside a mounted component, so the unforced
    // default applies.
    expect(tier.value).toBe('mid')
    scope.stop()
  })
})
