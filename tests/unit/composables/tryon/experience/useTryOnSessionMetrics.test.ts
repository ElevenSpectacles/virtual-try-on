import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { useTryOnSessionMetrics } from '../../../../../src/runtime/composables/tryon/experience/useTryOnSessionMetrics'
import type { TryOnSessionMetrics } from '../../../../../src/runtime/utils/tryon-metrics'

function setup(active = false) {
  const isActive = ref(active)
  const emit = vi.fn<(event: 'metrics', payload: TryOnSessionMetrics) => void>()
  const scope = effectScope()
  scope.run(() => {
    const session = useTryOnSessionMetrics({
      enabled: true,
      isActive,
      tracking: ref(false),
      model: () => 'frame.glb',
      features: () => ({}) as TryOnSessionMetrics['features'],
      emit
    })
    watch(isActive, (value) => {
      if (!value) session.metrics?.onModelSwitch()
    })
  })
  const finals = () => emit.mock.calls.map(([, payload]) => payload).filter((p) => p.final)
  return { isActive, scope, finals }
}

describe('useTryOnSessionMetrics', () => {
  it('returns no accumulator when reporting is off', () => {
    const scope = effectScope()
    const session = scope.run(() =>
      useTryOnSessionMetrics({
        enabled: false,
        isActive: ref(true),
        tracking: ref(false),
        model: () => '',
        features: () => ({}) as TryOnSessionMetrics['features'],
        emit: vi.fn()
      })
    )!
    expect(session.metrics).toBeNull()
  })

  it('sends one final report when the camera stops, after every watcher of that tick', async () => {
    const { isActive, finals } = setup()
    isActive.value = true
    await nextTick()
    isActive.value = false
    await nextTick()
    expect(finals()).toHaveLength(1)
    expect(finals()[0]!.modelSwitches).toBe(1)
  })

  it('sends the final report on teardown even when the camera stopped first in the same tick', () => {
    const { isActive, scope, finals } = setup(true)
    isActive.value = false
    scope.stop()
    expect(finals()).toHaveLength(1)
  })

  it('sends nothing on teardown once the session already ended', async () => {
    const { isActive, scope, finals } = setup(true)
    isActive.value = false
    await nextTick()
    scope.stop()
    expect(finals()).toHaveLength(1)
  })

  it('sends nothing when the camera never started', () => {
    const { scope, finals } = setup()
    scope.stop()
    expect(finals()).toHaveLength(0)
  })
})
