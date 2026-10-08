/**
 * Device capability tiering: one policy that decides which expensive
 * rendering features run on this device, and when a running session steps
 * down to a cheaper tier.
 *
 * Pure functions only (no Vue, no DOM) so the tier mapping and the step-down
 * logic are unit-testable. Browser signals are read in
 * `composables/tryon/useCapabilityTier.ts`.
 *
 * Tiers are ordered `low < mid < high`. A feature is allowed when the device
 * tier is at or above its minimum tier in `FEATURE_MIN_TIER`.
 */

export type TryOnTier = 'low' | 'mid' | 'high'

export type TryOnFeature =
  | 'occluder'
  | 'contactShadow'
  | 'lightingEstimate'
  | 'segmentationOccluder'
  | 'lensRefraction'

/** Ascending: a higher index is a more capable device. */
export const TRY_ON_TIERS: readonly TryOnTier[] = ['low', 'mid', 'high']

/**
 * Lowest tier that runs each feature — the single place that decides what a
 * feature costs. Features not built yet are listed so their gate is settled
 * before they land (see umbrella #4).
 */
export const FEATURE_MIN_TIER: Record<TryOnFeature, TryOnTier> = {
  occluder: 'low',
  contactShadow: 'mid',
  lightingEstimate: 'mid',
  segmentationOccluder: 'high',
  lensRefraction: 'high'
}

/**
 * Frame budget: 33 ms is 30 fps, the target on the mid tier. Placeholder
 * until the baseline measurement in umbrella #4 fills in agreed thresholds.
 */
export const FRAME_BUDGET_MS = 33
/** Rolling window of frame deltas the p95 is taken over (~4 s at 30 fps). */
export const FRAME_WINDOW_SIZE = 120
/** Samples needed before a p95 is trusted. */
export const MIN_WINDOW_SAMPLES = 30
/** Sampled time over budget before stepping down one tier. */
export const SUSTAIN_MS = 5000
/**
 * Sampled time after start or a model switch during which frames are
 * ignored: shader compile, GLB load and first-detection setup all look like
 * slow frames.
 */
export const WARMUP_MS = 5000
/**
 * A frame delta above this is a stall (hidden tab, debugger pause, GC
 * hitch), not a slow frame. It is dropped and clears the over-budget timer.
 */
export const MAX_FRAME_GAP_MS = 500

/** Browser signals the tier is classified from. */
export interface TierSignals {
  /** WebGL2 available. three r186 has no WebGL1 renderer, so false means no try-on. */
  webgl2: boolean
  /** WebGL `MAX_TEXTURE_SIZE`; 0 when unknown. */
  maxTextureSize: number
  /**
   * `navigator.deviceMemory` in GB. Chromium only: undefined on Safari and
   * Firefox, which must not be read as a low-memory device.
   */
  deviceMemoryGb?: number | undefined
}

function tierRank(tier: TryOnTier): number {
  return TRY_ON_TIERS.indexOf(tier)
}

/** True when `tier` is at or above the minimum tier of `feature`. */
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

/**
 * Classify the device from its static signals. Each known signal votes for
 * a tier and the lowest vote wins, so one weak signal caps the device.
 *
 * Missing signals are ignored, and with no usable signal the result is
 * `mid`, not `low`: a browser that hides its memory and texture limits (every
 * iPhone for `deviceMemory`) must not be pinned to the floor.
 *
 * `hardwareConcurrency` is deliberately not a vote. Browsers clamp it
 * (Safari), so it can't tell a slow device from a masked fast one.
 */
export function classifyTier(signals: TierSignals): TryOnTier {
  if (!signals.webgl2) return 'low'

  const votes: TryOnTier[] = []
  if (signals.maxTextureSize > 0) votes.push(textureTier(signals.maxTextureSize))
  if (signals.deviceMemoryGb !== undefined) votes.push(memoryTier(signals.deviceMemoryGb))
  if (votes.length === 0) return 'mid'

  return votes.reduce((lowest, vote) => (tierRank(vote) < tierRank(lowest) ? vote : lowest))
}

/**
 * Mutable step-down state, advanced one frame at a time by
 * `advanceTierSampler`. Mutated in place: it runs once per animation frame,
 * so copying the window each time would be wasted work.
 */
export interface TierSampler {
  tier: TryOnTier
  /** A forced tier never steps down (tests and goldens stay deterministic). */
  forced: boolean
  /** Sampled time still to be ignored before frames count. */
  warmupLeftMs: number
  /** Sampled time the p95 has stayed over budget. */
  overBudgetMs: number
  /** Most recent frame deltas, newest last. */
  frames: number[]
}

export interface TierStep {
  from: TryOnTier
  to: TryOnTier
  /** p95 frame time that triggered the step. */
  p95Ms: number
}

/** Start a sampler at `tier`, in warm-up. */
export function createTierSampler(tier: TryOnTier, forced = false): TierSampler {
  return { tier, forced, warmupLeftMs: WARMUP_MS, overBudgetMs: 0, frames: [] }
}

/**
 * Restart warm-up and drop the window, keeping the current tier. Call on a
 * model switch, since loading and compiling the new model is not a frame cost.
 */
export function resetTierSampler(sampler: TierSampler): void {
  sampler.warmupLeftMs = WARMUP_MS
  sampler.overBudgetMs = 0
  sampler.frames.length = 0
}

/** 95th percentile of `values` (nearest-rank). Expects a non-empty array. */
export function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0
}

/**
 * Feed one frame delta. Returns the step when the tier drops, else null.
 *
 * - `frameMs` null means "not sampling" (camera off, no face, hidden tab);
 *   it clears the over-budget timer, so a gap never counts toward a step-down.
 * - The first frame reports 0 and is skipped without touching the timer.
 * - The tier only steps down, one tier at a time, and never below `low`.
 *   There is no step back up, so the tier cannot oscillate mid-session.
 * - After a step the window is cleared, so the new tier is judged on its own
 *   frames, not the ones that caused the step.
 */
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
