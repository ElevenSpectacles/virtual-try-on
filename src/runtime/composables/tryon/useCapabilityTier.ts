import { onMounted, ref, watch } from 'vue'
import { useTryOnFrameLoop } from './useTryOnFrameLoop'
import {
  advanceTierSampler,
  classifyTier,
  createTierSampler,
  isFeatureAllowed,
  resetTierSampler,
  type TierSignals,
  type TryOnFeature,
  type TryOnTier
} from '../../utils/tryon-capability'

export interface TierChange {
  tier: TryOnTier
  previousTier: TryOnTier | null
  reason: 'initial' | 'frame_budget'
  p95Ms: number | null
  signals: TierSignals | null
}

export interface UseCapabilityTierOptions {
  forcedTier?: () => TryOnTier | undefined
  sampling?: () => boolean
  onChange?: (change: TierChange) => void
}

function probeSignals(): TierSignals {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  let maxTextureSize = 0
  if (gl) {
    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return {
    webgl2: gl !== null,
    maxTextureSize,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  }
}

export function useCapabilityTier(options: UseCapabilityTierOptions = {}) {
  const forcedTier = options.forcedTier ?? (() => undefined)
  const tier = ref<TryOnTier>(forcedTier() ?? 'mid')
  const signals = ref<TierSignals | null>(null)
  const sampler = createTierSampler(tier.value, forcedTier() !== undefined)
  let deviceTier: TryOnTier | null = null

  onMounted(() => {
    if (forcedTier() !== undefined) return
    const probed = probeSignals()
    const initial = classifyTier(probed)
    deviceTier = initial
    signals.value = probed
    tier.value = initial
    sampler.tier = initial
    options.onChange?.({
      tier: initial,
      previousTier: null,
      reason: 'initial',
      p95Ms: null,
      signals: probed
    })
  })

  watch(forcedTier, (value) => {
    sampler.forced = value !== undefined
    const next = value ?? deviceTier ?? 'mid'
    sampler.tier = next
    tier.value = next
  })

  useTryOnFrameLoop((deltaMs) => {
    const sampling = options.sampling?.() === true && !document.hidden
    const step = advanceTierSampler(sampler, sampling ? deltaMs : null)
    if (!step) return
    tier.value = step.to
    options.onChange?.({
      tier: step.to,
      previousTier: step.from,
      reason: 'frame_budget',
      p95Ms: step.p95Ms,
      signals: signals.value
    })
  })

  function resetWarmup() {
    resetTierSampler(sampler)
  }

  function allows(feature: TryOnFeature): boolean {
    return isFeatureAllowed(tier.value, feature)
  }

  return { tier, signals, allows, resetWarmup }
}
