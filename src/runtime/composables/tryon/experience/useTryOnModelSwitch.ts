import { computed, watch, type Ref } from 'vue'
import { getTryOnModel, type TryOnModel } from '../useTryOnModels'
import { useTryOnModelCache } from '../useTryOnModelCache'
import { modelCacheCapacity, neighbourFiles } from '../../../utils/tryon-model-cache'
import type { TryOnTier } from '../../../utils/tryon-capability'
import type { MetricsAccumulator } from '../../../utils/tryon-metrics'

export interface UseTryOnModelSwitchOptions {
  props: {
    models: TryOnModel[]
    modelBaseUrl: string
    draco: boolean
    dracoDecoderPath?: string | undefined
    preload: number | false
  }
  /** The selected frame (`v-model:model`). */
  model: Ref<string | undefined>
  /** Shown while `model` is unset. */
  initialModel: string
  /** The device tier (`useCapabilityTier`). */
  capability: { tier: Ref<TryOnTier> }
  /** Camera on and a face tracked: prefetch runs only then. */
  tracking: () => boolean
  metrics: MetricsAccumulator | null
  /** The scene loaded the selected frame's GLB, `widthMeters` wide (for the fit). */
  onLoaded: (widthMeters: number) => void
}

/**
 * Frame switching: the selected frame's GLB URL, the parsed-GLB cache with
 * its neighbour prefetch and `preloadModel()`, and the switch latency for
 * the session metrics. Call `onModelSwitch()` when `model` changes and pass
 * `onModelLoaded` to the scene's `loaded`.
 */
export function useTryOnModelSwitch(options: UseTryOnModelSwitchOptions) {
  const { props, model, capability } = options

  function srcFor(file: string): string {
    return `${props.modelBaseUrl}/${file}.glb`
  }
  const modelSrc = computed(() => srcFor(model.value ?? options.initialModel))

  // Parsed-GLB cache (issue #94): switching back to a frame, or to a
  // prefetched neighbour, mounts it at once. Prefetch runs only while a face is
  // tracked, so it never competes with the first frame or loads anything
  // before the camera starts; the low tier keeps two GLBs and never prefetches.
  const preloadPerSide = computed(() =>
    props.preload === false ? 0 : Math.max(0, Math.floor(props.preload))
  )
  const modelCache = useTryOnModelCache({
    draco: props.draco,
    dracoDecoderPath: props.dracoDecoderPath,
    capacity: modelCacheCapacity(false, preloadPerSide.value)
  })
  watch(
    [() => capability.tier.value, preloadPerSide],
    ([tier, perSide]) => modelCache.resize(modelCacheCapacity(tier === 'low', perSide)),
    { immediate: true }
  )
  watch(
    [model, options.tracking, () => capability.tier.value, preloadPerSide],
    ([file, tracking, tier, perSide]) => {
      if (!tracking || tier === 'low' || perSide <= 0) return
      const files = props.models.map((m) => m.file)
      modelCache.prefetch(neighbourFiles(files, file, perSide).map(srcFor))
    }
  )

  /**
   * Fetch and parse a frame ahead of a likely switch (e.g. hover on a swatch),
   * in idle time. Unknown files are ignored.
   */
  function preloadModel(file: string) {
    if (!getTryOnModel(props.models, file)) return
    modelCache.prefetch([srcFor(file)])
  }

  // Frame-switch latency for the metrics event: switch → new frame shown.
  let switchStartedAt: number | null = null

  /** `model` changed: count the switch and start its latency clock. */
  function onModelSwitch() {
    options.metrics?.onModelSwitch()
    switchStartedAt = performance.now()
  }

  function onModelLoaded(widthMeters: number) {
    options.onLoaded(widthMeters)
    if (switchStartedAt !== null) {
      options.metrics?.onModelSwitchLatency(performance.now() - switchStartedAt)
      switchStartedAt = null
    }
  }

  return { modelSrc, modelCache, preloadModel, onModelSwitch, onModelLoaded }
}
