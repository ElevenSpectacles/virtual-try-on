import { onBeforeUnmount, watch, type Ref } from 'vue'
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
  const metrics = options.enabled ? createMetricsAccumulator() : null

  function emitMetrics(final: boolean) {
    if (!metrics) return
    options.emit('metrics', {
      ...metrics.snapshot(),
      final,
      model: options.model(),
      features: options.features()
    })
  }

  if (metrics) {
    useTryOnFrameLoop((deltaMs) => {
      if (metrics.onFrame(deltaMs, options.isActive.value, options.tracking.value)) emitMetrics(false)
    })
  }

  function watchSessionEnd() {
    watch(options.isActive, (active, wasActive) => {
      if (!active && wasActive && metrics) {
        emitMetrics(true)
        metrics.reset()
      }
    })

    onBeforeUnmount(() => {
      if (metrics && options.isActive.value) emitMetrics(true)
    })
  }

  return { metrics, watchSessionEnd }
}
