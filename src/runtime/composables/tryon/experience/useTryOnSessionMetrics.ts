import { onScopeDispose, watch, type Ref } from 'vue'
import { createMetricsAccumulator, type TryOnSessionMetrics } from '../../../utils/tryon-metrics'
import { useTryOnFrameLoop } from '../useTryOnFrameLoop'

export interface UseTryOnSessionMetricsOptions {
  enabled: boolean
  isActive: Ref<boolean>
  tracking: Ref<boolean>
  model: () => string
  features: () => TryOnSessionMetrics['features']
  emit: (event: 'metrics', payload: TryOnSessionMetrics) => void
}

export function useTryOnSessionMetrics(options: UseTryOnSessionMetricsOptions) {
  if (!options.enabled) return { metrics: null }
  const metrics = createMetricsAccumulator()

  function emitMetrics(final: boolean) {
    options.emit('metrics', {
      ...metrics.snapshot(),
      final,
      model: options.model(),
      features: options.features()
    })
  }

  let sessionOpen = options.isActive.value

  function endSession() {
    if (!sessionOpen) return
    sessionOpen = false
    emitMetrics(true)
    metrics.reset()
  }

  useTryOnFrameLoop((deltaMs) => {
    if (metrics.onFrame(deltaMs, options.isActive.value, options.tracking.value)) emitMetrics(false)
  })

  watch(options.isActive, (active) => {
    if (active) sessionOpen = true
  })
  watch(
    options.isActive,
    (active) => {
      if (!active) endSession()
    },
    { flush: 'post' }
  )
  onScopeDispose(endSession)

  return { metrics }
}
