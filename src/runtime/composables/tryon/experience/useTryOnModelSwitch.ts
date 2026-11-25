import { computed, ref, watch, type Ref } from 'vue'
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
  model: Ref<string | undefined>
  initialModel: string
  capability: { tier: Ref<TryOnTier> }
  tracking: () => boolean
  metrics: MetricsAccumulator | null
  onLoaded: (widthMeters: number) => void
}

export function useTryOnModelSwitch(options: UseTryOnModelSwitchOptions) {
  const { props, model, capability } = options

  function srcFor(file: string): string {
    return `${props.modelBaseUrl}/${file}.glb`
  }
  const modelSrc = computed(() => srcFor(model.value ?? options.initialModel))
  const loadedSrc = ref<string | null>(null)
  const modelLoaded = computed(() => loadedSrc.value === modelSrc.value)

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

  function preloadModel(file: string) {
    if (!getTryOnModel(props.models, file)) return
    modelCache.prefetch([srcFor(file)])
  }

  let switchStartedAt: number | null = null

  function onModelSwitch() {
    options.metrics?.onModelSwitch()
    switchStartedAt = performance.now()
  }

  function onModelLoaded(widthMeters: number) {
    loadedSrc.value = modelSrc.value
    options.onLoaded(widthMeters)
    if (switchStartedAt !== null) {
      options.metrics?.onModelSwitchLatency(performance.now() - switchStartedAt)
      switchStartedAt = null
    }
  }

  return { modelSrc, modelLoaded, modelCache, preloadModel, onModelSwitch, onModelLoaded }
}
