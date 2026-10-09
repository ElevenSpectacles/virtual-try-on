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
  /** The tier before this change; null for the initial classification. */
  previousTier: TryOnTier | null
  reason: 'initial' | 'frame_budget'
  /** p95 frame time that caused a step-down; null for the initial classification. */
  p95Ms: number | null
  signals: TierSignals | null
}

export interface UseCapabilityTierOptions {
  /**
   * Pin the tier while it returns a value: no step-down, and the device
   * classification is ignored. Read reactively, so setting or clearing it
   * after mount takes effect. Clearing returns to the device's own tier.
   * For tests and goldens.
   */
  forcedTier?: () => TryOnTier | undefined
  /**
   * Whether frames count right now: camera active and a face tracked. Frames
   * are sampled only while this is true, so idle time never counts as slow.
   */
  sampling?: () => boolean
  onChange?: (change: TierChange) => void
}

/** Read the static device signals. Call on the client only. */
function probeSignals(): TierSignals {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  let maxTextureSize = 0
  if (gl) {
    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    // Release the probe context now; browsers cap live WebGL contexts.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return {
    webgl2: gl !== null,
    maxTextureSize,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  }
}

/**
 * The device capability tier and the features it allows, with a step-down
 * when the frame p95 stays over budget. Call from component setup: it
 * registers a frame loop, a watcher and an `onMounted` probe.
 *
 * The tier starts at `mid` on the server and before mount, then is set from
 * the device probe in `onMounted`. It only steps down during a session.
 */
export function useCapabilityTier(options: UseCapabilityTierOptions = {}) {
  const forcedTier = options.forcedTier ?? (() => undefined)
  const tier = ref<TryOnTier>(forcedTier() ?? 'mid')
  const signals = ref<TierSignals | null>(null)
  const sampler = createTierSampler(tier.value, forcedTier() !== undefined)
  // The device's own classification, kept so clearing a forced tier can return to it.
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

  // A forced tier pins the sampler; clearing it resumes from the device tier.
  // No onChange here: a forced tier is the host's own choice, not a measured step.
  watch(forcedTier, (value) => {
    if (value !== undefined) {
      sampler.forced = true
      sampler.tier = value
      tier.value = value
      return
    }
    sampler.forced = false
    const resume = deviceTier ?? 'mid'
    sampler.tier = resume
    tier.value = resume
  })

  useTryOnFrameLoop((deltaMs) => {
    // A hidden tab resumes with one huge delta and throws frames away, so
    // it is not sampled.
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

  /** Restart warm-up. Call when the model changes, before the new GLB compiles. */
  function resetWarmup() {
    resetTierSampler(sampler)
  }

  /** Whether `feature` runs at the current tier. Opt-in is checked by the caller. */
  function allows(feature: TryOnFeature): boolean {
    return isFeatureAllowed(tier.value, feature)
  }

  return { tier, signals, allows, resetWarmup }
}
