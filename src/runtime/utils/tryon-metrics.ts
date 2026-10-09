import { MAX_FRAME_GAP_MS, type TryOnTier } from './tryon-capability'

/**
 * Session metrics for the host's analytics: aggregated numbers only, with no
 * frames, landmarks or other image-derived data.
 *
 * Pure functions only (no Vue, no DOM). The component feeds it frame deltas,
 * detection latencies and events; it returns a snapshot the host can forward.
 */

/** How often an active session reports, in active milliseconds. */
export const METRICS_INTERVAL_MS = 30_000
/** Latency samples kept for the percentiles: about 30 s at 30 detections/s. */
export const LATENCY_WINDOW = 1000

export interface TryOnMetrics {
  /** Camera-on time in milliseconds. Stalls longer than MAX_FRAME_GAP_MS are excluded. */
  activeMs: number
  /** Active time until the first tracked face, or null if none was tracked. */
  timeToFirstTrackMs: number | null
  /** Share of active time with a tracked face, 0…100. */
  trackUptimePct: number
  /** Tracked-to-lost transitions per active minute. */
  trackLossPerMin: number
  /** Mean camera-to-result detection latency, or null before any detection. */
  detectLatencyMeanMs: number | null
  /** 95th-percentile detection latency, or null before any detection. */
  detectLatencyP95Ms: number | null
  /** Mean render frame rate over the active time, or null before any frame. */
  renderFpsMean: number | null
  /** Frame-model switches in the session. */
  modelSwitches: number
  /** Step-downs of the device capability tier. */
  tierChanges: number
  /** Current device capability tier, or null before classification. */
  tier: TryOnTier | null
  /**
   * The session never tracked a face and the user never switched frames: the
   * "looked broken" proxy.
   */
  endedWithoutTrack: boolean
}

/** Nearest-rank percentile of `values`, q in [0, 1]. Null for an empty list. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]!
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export interface MetricsAccumulator {
  /**
   * Feed one rendered frame. `active` is the camera state, `tracking` whether
   * a face is tracked. Returns true when a periodic report is due.
   */
  onFrame(deltaMs: number, active: boolean, tracking: boolean): boolean
  /** One camera-to-result detection latency sample, in ms. */
  onLatency(ms: number): void
  onModelSwitch(): void
  onTierChange(tier: TryOnTier, isStepDown: boolean): void
  /** Snapshot of the session so far. */
  snapshot(): TryOnMetrics
  /** Clear everything, for the next session. */
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

  return {
    onFrame(deltaMs, active, tracking) {
      if (!active) {
        wasTracking = false
        return false
      }
      // Frames the browser stalled (hidden tab, debugger) are not frames the
      // user saw, so they count toward neither the time nor the frame rate.
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
      latencies.push(ms)
      if (latencies.length > LATENCY_WINDOW) latencies.shift()
    },

    onModelSwitch() {
      modelSwitches++
    },

    onTierChange(next, isStepDown) {
      tier = next
      if (isStepDown) tierChanges++
    },

    snapshot() {
      const activeMinutes = activeMs / 60_000
      const latencyMean =
        latencies.length > 0
          ? latencies.reduce((sum, v) => sum + v, 0) / latencies.length
          : null
      const p95 = percentile(latencies, 0.95)
      return {
        activeMs: Math.round(activeMs),
        timeToFirstTrackMs: firstTrackAtMs === null ? null : Math.round(firstTrackAtMs),
        trackUptimePct: activeMs > 0 ? round1((trackedMs / activeMs) * 100) : 0,
        trackLossPerMin: activeMinutes > 0 ? round1(losses / activeMinutes) : 0,
        detectLatencyMeanMs: latencyMean === null ? null : round1(latencyMean),
        detectLatencyP95Ms: p95 === null ? null : round1(p95),
        renderFpsMean: frames > 0 && activeMs > 0 ? round1(frames / (activeMs / 1000)) : null,
        modelSwitches,
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
      // `tier` is kept: it describes the device, not the session.
      nextReportAtMs = METRICS_INTERVAL_MS
      latencies.length = 0
    }
  }
}

/** A `metrics` event payload: the session snapshot plus what it was measured on. */
export interface TryOnSessionMetrics extends TryOnMetrics {
  /** True on the report sent when the camera stops or the component unmounts. */
  final: boolean
  /** Active frame file at the time of the report. */
  model: string
  /** Which opt-in features were running at the time of the report. */
  features: {
    occluder: boolean
    contactShadow: boolean
    adaptiveLighting: boolean
  }
}
