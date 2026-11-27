export type TryOnTier = 'low' | 'mid' | 'high'

export type TryOnFeature =
  | 'occluder'
  | 'contactShadow'
  | 'lightingEstimate'
  | 'segmentationOccluder'
  | 'physicalLens'
  | 'tintedLensShadow'
  | 'cameraMatch'

export const TRY_ON_TIERS: readonly TryOnTier[] = ['low', 'mid', 'high']

export const FEATURE_MIN_TIER: Record<TryOnFeature, TryOnTier> = {
  occluder: 'low',
  contactShadow: 'mid',
  lightingEstimate: 'mid',
  segmentationOccluder: 'high',
  physicalLens: 'mid',
  tintedLensShadow: 'high',
  cameraMatch: 'mid'
}

export const FRAME_BUDGET_MS = 40
export const FRAME_WINDOW_SIZE = 120
export const MIN_WINDOW_SAMPLES = 30
export const SUSTAIN_MS = 5000
export const WARMUP_MS = 5000
export const MAX_FRAME_GAP_MS = 500

export interface TierSignals {
  webgl2: boolean
  maxTextureSize: number
  deviceMemoryGb?: number | undefined
}

function tierRank(tier: TryOnTier): number {
  return TRY_ON_TIERS.indexOf(tier)
}

export function isFeatureAllowed(tier: TryOnTier, feature: TryOnFeature): boolean {
  return tierRank(tier) >= tierRank(FEATURE_MIN_TIER[feature])
}

function textureTier(maxTextureSize: number): TryOnTier {
  if (maxTextureSize >= 8192) return 'high'
  if (maxTextureSize >= 4096) return 'mid'
  return 'low'
}

function memoryTier(deviceMemoryGb: number): TryOnTier {
  if (deviceMemoryGb >= 8) return 'high'
  if (deviceMemoryGb >= 4) return 'mid'
  return 'low'
}

export function classifyTier(signals: TierSignals): TryOnTier {
  if (!signals.webgl2) return 'low'

  const votes: TryOnTier[] = []
  if (signals.maxTextureSize > 0) votes.push(textureTier(signals.maxTextureSize))
  if (signals.deviceMemoryGb !== undefined) votes.push(memoryTier(signals.deviceMemoryGb))
  if (votes.length === 0) return 'mid'

  return votes.reduce((lowest, vote) => (tierRank(vote) < tierRank(lowest) ? vote : lowest))
}

export interface TierSampler {
  tier: TryOnTier
  forced: boolean
  warmupLeftMs: number
  overBudgetMs: number
  frames: number[]
}

export interface TierStep {
  from: TryOnTier
  to: TryOnTier
  p95Ms: number
}

export function createTierSampler(tier: TryOnTier, forced = false): TierSampler {
  return { tier, forced, warmupLeftMs: WARMUP_MS, overBudgetMs: 0, frames: [] }
}

export function resetTierSampler(sampler: TierSampler): void {
  sampler.warmupLeftMs = WARMUP_MS
  sampler.overBudgetMs = 0
  sampler.frames.length = 0
}

export function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0
}

export function advanceTierSampler(sampler: TierSampler, frameMs: number | null): TierStep | null {
  if (frameMs === null || frameMs > MAX_FRAME_GAP_MS) {
    sampler.overBudgetMs = 0
    return null
  }
  if (frameMs <= 0) return null

  if (sampler.warmupLeftMs > 0) {
    sampler.warmupLeftMs -= frameMs
    return null
  }

  sampler.frames.push(frameMs)
  if (sampler.frames.length > FRAME_WINDOW_SIZE) sampler.frames.shift()
  if (sampler.frames.length < MIN_WINDOW_SAMPLES) return null

  const p95Ms = percentile95(sampler.frames)
  if (p95Ms <= FRAME_BUDGET_MS) {
    sampler.overBudgetMs = 0
    return null
  }

  sampler.overBudgetMs += frameMs
  const rank = tierRank(sampler.tier)
  if (sampler.forced || rank === 0 || sampler.overBudgetMs < SUSTAIN_MS) return null

  const from = sampler.tier
  sampler.tier = TRY_ON_TIERS[rank - 1] as TryOnTier
  sampler.overBudgetMs = 0
  sampler.frames.length = 0
  return { from, to: sampler.tier, p95Ms }
}
