import { onBeforeUnmount, watch, type Ref } from 'vue'
import { createMetricsAccumulator, type TryOnSessionMetrics } from '../../../utils/tryon-metrics'
import { useTryOnFrameLoop } from '../useTryOnFrameLoop'

export interface UseTryOnSessionMetricsOptions {
  /** `reportMetrics`, read once at setup. */
  enabled: boolean
  isActive: Ref<boolean>
  /** The raw tracker has a face (not the held one): a dropout counts as lost. */
  tracking: Ref<boolean>
  /** The active frame file, for the report. */
  model: () => string
  /** The report's `features` block (see useTryOnFeatures' `snapshot`). */
  features: () => TryOnSessionMetrics['features']
  emit: (event: 'metrics', payload: TryOnSessionMetrics) => void
}

/**
 * Session metrics for the `metrics` event (opt-in): every 30 s of camera
 * time, and once more when the camera stops. With reportMetrics off there is
 * no accumulator and no extra frame loop, so there is no cost to hosts that
 * don't use it. Returns the accumulator (null when off) for the component's
 * other hooks (latency, tier, asset timings, model switches), and
 * `watchSessionEnd`, which registers the final report.
 */
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

  /**
   * Register the final report: a watcher on `isActive` and an unmount hook.
   * Not done above because the component registers them last, after its
   * track-event watchers: watchers on the same source, and unmount hooks,
   * run in registration order.
   */
  function watchSessionEnd() {
    // Camera stopped: send the session's final report and start the next session fresh.
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
