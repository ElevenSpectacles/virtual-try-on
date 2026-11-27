import { describe, it, expect } from 'vitest'
import {
  FEATURE_MIN_TIER,
  FRAME_BUDGET_MS,
  MAX_FRAME_GAP_MS,
  MIN_WINDOW_SAMPLES,
  SUSTAIN_MS,
  WARMUP_MS,
  advanceTierSampler,
  classifyTier,
  createTierSampler,
  isFeatureAllowed,
  percentile95,
  resetTierSampler,
  type TierSampler,
  type TierSignals
} from '../../../src/runtime/utils/tryon-capability'

const FAST_MS = 16
const VSYNC_60_MS = 1000 / 60
const SLOW_MS = 50

const signals = (overrides: Partial<TierSignals> = {}): TierSignals => ({
  webgl2: true,
  maxTextureSize: 16384,
  deviceMemoryGb: 8,
  ...overrides
})

function warmed(tier: 'low' | 'mid' | 'high', forced = false): TierSampler {
  const sampler = createTierSampler(tier, forced)
  sampler.warmupLeftMs = 0
  return sampler
}

function feed(sampler: TierSampler, frameMs: number, count: number) {
  let first = null
  for (let i = 0; i < count; i++) {
    const step = advanceTierSampler(sampler, frameMs)
    first ??= step
  }
  return first
}

describe('classifyTier', () => {
  it('is low without WebGL2, whatever the other signals say', () => {
    expect(classifyTier(signals({ webgl2: false }))).toBe('low')
  })

  it('is high on a large texture limit and ample memory', () => {
    expect(classifyTier(signals({ maxTextureSize: 16384, deviceMemoryGb: 8 }))).toBe('high')
  })

  it('is mid on a mid texture limit and mid memory', () => {
    expect(classifyTier(signals({ maxTextureSize: 4096, deviceMemoryGb: 4 }))).toBe('mid')
  })

  it('is low on a small texture limit or low memory', () => {
    expect(classifyTier(signals({ maxTextureSize: 2048, deviceMemoryGb: 8 }))).toBe('low')
    expect(classifyTier(signals({ maxTextureSize: 16384, deviceMemoryGb: 2 }))).toBe('low')
  })

  it('takes the lowest vote, so one weak signal caps the device', () => {
    expect(classifyTier(signals({ maxTextureSize: 16384, deviceMemoryGb: 4 }))).toBe('mid')
  })

  it('does not drop an iPhone to low when deviceMemory is hidden', () => {
    const iphone = signals({ maxTextureSize: 16384, deviceMemoryGb: undefined })
    expect(classifyTier(iphone)).toBe('high')
  })

  it('is mid when no usable signal is known, not low', () => {
    expect(classifyTier(signals({ maxTextureSize: 0, deviceMemoryGb: undefined }))).toBe('mid')
  })
})

describe('isFeatureAllowed', () => {
  it('gates features by their minimum tier', () => {
    expect(FEATURE_MIN_TIER.occluder).toBe('low')
    expect(isFeatureAllowed('low', 'occluder')).toBe(true)
    expect(isFeatureAllowed('low', 'contactShadow')).toBe(false)
    expect(isFeatureAllowed('mid', 'contactShadow')).toBe(true)
    expect(isFeatureAllowed('mid', 'segmentationOccluder')).toBe(false)
    expect(isFeatureAllowed('high', 'segmentationOccluder')).toBe(true)
    expect(isFeatureAllowed('low', 'physicalLens')).toBe(false)
  })
})

describe('percentile95', () => {
  it('ignores the slowest 5% of frames', () => {
    const frames = [...Array(114).fill(FAST_MS), ...Array(6).fill(SLOW_MS)]
    expect(percentile95(frames)).toBe(FAST_MS)
  })

  it('reports a slow tail once it reaches 5% of the window', () => {
    const frames = [...Array(108).fill(FAST_MS), ...Array(12).fill(SLOW_MS)]
    expect(percentile95(frames)).toBe(SLOW_MS)
  })
})

describe('advanceTierSampler', () => {
  it('ignores frames during warm-up, even slow ones', () => {
    const sampler = createTierSampler('high')
    expect(feed(sampler, SLOW_MS, WARMUP_MS / SLOW_MS)).toBeNull()
    expect(sampler.frames).toHaveLength(0)
    expect(sampler.warmupLeftMs).toBe(0)
  })

  it('skips the first frame, which reports 0', () => {
    const sampler = warmed('high')
    expect(advanceTierSampler(sampler, 0)).toBeNull()
    expect(sampler.frames).toHaveLength(0)
  })

  it('does not step down before the window has enough samples', () => {
    const sampler = warmed('high')
    expect(feed(sampler, SLOW_MS, MIN_WINDOW_SAMPLES - 1)).toBeNull()
    expect(sampler.tier).toBe('high')
  })

  it('steps down one tier once the p95 is over budget for SUSTAIN_MS', () => {
    const sampler = warmed('high')
    const sustainFrames = Math.ceil(SUSTAIN_MS / SLOW_MS)
    expect(feed(sampler, SLOW_MS, MIN_WINDOW_SAMPLES + sustainFrames - 2)).toBeNull()
    expect(sampler.tier).toBe('high')

    const step = feed(sampler, SLOW_MS, 5)
    expect(step).toEqual({ from: 'high', to: 'mid', p95Ms: SLOW_MS })
    expect(sampler.tier).toBe('mid')
  })

  it('never steps down while frames stay within budget', () => {
    const sampler = warmed('high')
    expect(feed(sampler, FAST_MS, 2000)).toBeNull()
    expect(sampler.tier).toBe('high')
  })

  it('resets the sustain timer when the p95 recovers', () => {
    const sampler = warmed('high')
    feed(sampler, SLOW_MS, MIN_WINDOW_SAMPLES + 50)
    expect(sampler.overBudgetMs).toBeGreaterThan(0)
    feed(sampler, FAST_MS, 130)
    expect(sampler.overBudgetMs).toBe(0)
  })

  it('never steps below low', () => {
    const sampler = warmed('low')
    expect(feed(sampler, SLOW_MS, 2000)).toBeNull()
    expect(sampler.tier).toBe('low')
  })

  it('never steps up', () => {
    const sampler = warmed('mid')
    feed(sampler, FAST_MS, 2000)
    expect(sampler.tier).toBe('mid')
  })

  it('never steps down a forced tier', () => {
    const sampler = warmed('high', true)
    expect(feed(sampler, SLOW_MS, 2000)).toBeNull()
    expect(sampler.tier).toBe('high')
  })

  it('treats a not-sampling frame as a gap that clears the sustain timer', () => {
    const sampler = warmed('high')
    feed(sampler, SLOW_MS, MIN_WINDOW_SAMPLES + 50)
    advanceTierSampler(sampler, null)
    expect(sampler.overBudgetMs).toBe(0)
  })

  it('drops a stall longer than MAX_FRAME_GAP_MS instead of counting it as a frame', () => {
    const sampler = warmed('high')
    feed(sampler, FAST_MS, MIN_WINDOW_SAMPLES)
    const framesBefore = sampler.frames.length
    advanceTierSampler(sampler, MAX_FRAME_GAP_MS + 1)
    expect(sampler.frames).toHaveLength(framesBefore)
    expect(sampler.overBudgetMs).toBe(0)
  })

  it('starts a fresh window at the new tier after a step', () => {
    const sampler = warmed('high')
    let step = null
    while (!step) step = advanceTierSampler(sampler, SLOW_MS)
    expect(sampler.tier).toBe('mid')
    expect(sampler.frames).toHaveLength(0)
    expect(sampler.overBudgetMs).toBe(0)
    expect(feed(sampler, SLOW_MS, MIN_WINDOW_SAMPLES - 1)).toBeNull()
    expect(sampler.tier).toBe('mid')
  })

  it('restarts warm-up on reset while keeping the tier', () => {
    const sampler = warmed('mid')
    feed(sampler, FAST_MS, MIN_WINDOW_SAMPLES)
    resetTierSampler(sampler)
    expect(sampler.tier).toBe('mid')
    expect(sampler.frames).toHaveLength(0)
    expect(sampler.warmupLeftMs).toBe(WARMUP_MS)
  })

  it('judges the frame budget against FRAME_BUDGET_MS', () => {
    const sampler = warmed('high')
    expect(feed(sampler, FRAME_BUDGET_MS, 2000)).toBeNull()
    expect(sampler.tier).toBe('high')
  })

  it('holds a steady 30 fps on a 60 Hz display, the mid tier target, despite rAF jitter', () => {
    const sampler = warmed('mid')
    for (let i = 0; i < 2000; i++) {
      expect(advanceTierSampler(sampler, VSYNC_60_MS * 2 + (i % 2 ? 1.5 : -1.5))).toBeNull()
    }
    expect(sampler.tier).toBe('mid')
  })

  it('holds 60 fps with a tenth of the frames one refresh late', () => {
    const sampler = warmed('high')
    for (let i = 0; i < 2000; i++) {
      expect(advanceTierSampler(sampler, i % 10 ? VSYNC_60_MS : VSYNC_60_MS * 2)).toBeNull()
    }
  })

  it('steps down once a twentieth of the frames take three refreshes', () => {
    const sampler = warmed('high')
    let step = null
    for (let i = 0; i < 2000 && !step; i++) {
      step = advanceTierSampler(sampler, i % 10 < 8 ? VSYNC_60_MS : VSYNC_60_MS * 3)
    }
    expect(step).toMatchObject({ from: 'high', to: 'mid' })
  })
})
