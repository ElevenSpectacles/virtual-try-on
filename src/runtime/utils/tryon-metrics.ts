import { MAX_FRAME_GAP_MS, type TryOnTier } from './tryon-capability'

export type TryOnAsset = 'tracker' | 'model' | 'environment'

export const METRICS_INTERVAL_MS = 30_000
export const LATENCY_WINDOW = 1000

export interface TryOnMetrics {
  activeMs: number
  timeToFirstTrackMs: number | null
  timeToFirstFrameMs: number | null
  assetTimings: Record<TryOnAsset, number | null>
  trackUptimePct: number
  trackLossPerMin: number
  detectLatencyMeanMs: number | null
  detectLatencyP95Ms: number | null
  renderFpsMean: number | null
  modelSwitches: number
  modelSwitchMeanMs: number | null
  modelSwitchP95Ms: number | null
  tierChanges: number
  tier: TryOnTier | null
  endedWithoutTrack: boolean
}

export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]!
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round1OrNull(value: number | null): number | null {
  return value === null ? null : round1(value)
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null
}

function pushWindowed(values: number[], value: number): void {
  values.push(value)
  if (values.length > LATENCY_WINDOW) values.shift()
}

export interface MetricsAccumulator {
  onFrame(deltaMs: number, active: boolean, tracking: boolean): boolean
  onLatency(ms: number): void
  onFirstFrame(ms: number): void
  onAssetTiming(asset: TryOnAsset, ms: number): void
  onModelSwitch(): void
  onModelSwitchLatency(ms: number): void
  onTierChange(tier: TryOnTier, isStepDown: boolean): void
  snapshot(): TryOnMetrics
  reset(): void
}

export function createMetricsAccumulator(): MetricsAccumulator {
  let activeMs = 0
  let trackedMs = 0
  let frames = 0
  let losses = 0
  let firstTrackAtMs: number | null = null
  let wasTracking = false
  let modelSwitches = 0
  let tierChanges = 0
  let tier: TryOnTier | null = null
  let nextReportAtMs = METRICS_INTERVAL_MS
  const latencies: number[] = []
  const switchLatencies: number[] = []
  let timeToFirstFrameMs: number | null = null
  let assetTimings: Record<TryOnAsset, number | null> = {
    tracker: null,
    model: null,
    environment: null
  }

  return {
    onFrame(deltaMs, active, tracking) {
      if (!active) {
        wasTracking = false
        return false
      }
      if (deltaMs <= 0 || deltaMs > MAX_FRAME_GAP_MS) return false

      frames++
      activeMs += deltaMs
      if (tracking) {
        trackedMs += deltaMs
        firstTrackAtMs ??= activeMs
      } else if (wasTracking) {
        losses++
      }
      wasTracking = tracking

      if (activeMs >= nextReportAtMs) {
        nextReportAtMs += METRICS_INTERVAL_MS
        return true
      }
      return false
    },

    onLatency(ms) {
      pushWindowed(latencies, ms)
    },

    onFirstFrame(ms) {
      timeToFirstFrameMs ??= Math.round(ms)
    },

    onAssetTiming(asset, ms) {
      if (assetTimings[asset] === null) assetTimings = { ...assetTimings, [asset]: Math.round(ms) }
    },

    onModelSwitch() {
      modelSwitches++
    },

    onModelSwitchLatency(ms) {
      pushWindowed(switchLatencies, ms)
    },

    onTierChange(next, isStepDown) {
      tier = next
      if (isStepDown) tierChanges++
    },

    snapshot() {
      const activeMinutes = activeMs / 60_000
      return {
        activeMs: Math.round(activeMs),
        timeToFirstTrackMs: firstTrackAtMs === null ? null : Math.round(firstTrackAtMs),
        timeToFirstFrameMs,
        assetTimings: { ...assetTimings },
        trackUptimePct: activeMs > 0 ? round1((trackedMs / activeMs) * 100) : 0,
        trackLossPerMin: activeMinutes > 0 ? round1(losses / activeMinutes) : 0,
        detectLatencyMeanMs: round1OrNull(mean(latencies)),
        detectLatencyP95Ms: round1OrNull(percentile(latencies, 0.95)),
        renderFpsMean: frames > 0 && activeMs > 0 ? round1(frames / (activeMs / 1000)) : null,
        modelSwitches,
        modelSwitchMeanMs: round1OrNull(mean(switchLatencies)),
        modelSwitchP95Ms: round1OrNull(percentile(switchLatencies, 0.95)),
        tierChanges,
        tier,
        endedWithoutTrack: firstTrackAtMs === null && modelSwitches === 0
      }
    },

    reset() {
      activeMs = 0
      trackedMs = 0
      frames = 0
      losses = 0
      firstTrackAtMs = null
      wasTracking = false
      modelSwitches = 0
      tierChanges = 0
      nextReportAtMs = METRICS_INTERVAL_MS
      latencies.length = 0
      switchLatencies.length = 0
      timeToFirstFrameMs = null
    }
  }
}

export interface TryOnSessionMetrics extends TryOnMetrics {
  final: boolean
  model: string
  features: {
    occluder: boolean
    contactShadow: boolean
    adaptiveLighting: boolean
    physicalLens: boolean
    hairOcclusion: boolean
    tintedLensShadow: boolean
    cameraMatch: boolean
  }
}
