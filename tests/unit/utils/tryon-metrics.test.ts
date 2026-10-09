import { describe, it, expect } from 'vitest'
import {
  METRICS_INTERVAL_MS,
  createMetricsAccumulator,
  percentile
} from '../../../src/runtime/utils/tryon-metrics'

const FRAME_MS = 10

/** Feed `count` frames of FRAME_MS, all active, with the given tracking state. */
function feed(acc: ReturnType<typeof createMetricsAccumulator>, count: number, tracking: boolean) {
  let due = false
  for (let i = 0; i < count; i++) {
    due = acc.onFrame(FRAME_MS, true, tracking) || due
  }
  return due
}

describe('percentile', () => {
  it('uses nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 0.5)).toBe(50)
    expect(percentile(values, 0.95)).toBe(95)
  })

  it('is null for no samples', () => {
    expect(percentile([], 0.95)).toBeNull()
  })
})

describe('createMetricsAccumulator', () => {
  it('reports track uptime as the share of active time with a face', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 50, false)
    feed(acc, 50, true)
    expect(acc.snapshot().trackUptimePct).toBe(50)
  })

  it('counts tracked-to-lost transitions per active minute', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 5000, true) // 50 s tracked
    acc.onFrame(FRAME_MS, true, false) // one loss
    feed(acc, 1000, true) // 10 s more, so 60 s total
    expect(acc.snapshot().trackLossPerMin).toBe(1)
  })

  it('reports time to the first tracked face in active time', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 30, false)
    feed(acc, 5, true)
    expect(acc.snapshot().timeToFirstTrackMs).toBe(31 * FRAME_MS)
  })

  it('reports null time to first track when no face was ever tracked', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 20, false)
    expect(acc.snapshot().timeToFirstTrackMs).toBeNull()
  })

  it('excludes stalls from active time and frame rate', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 100, true)
    acc.onFrame(5000, true, true)
    const snap = acc.snapshot()
    expect(snap.activeMs).toBe(100 * FRAME_MS)
    expect(snap.renderFpsMean).toBe(100)
  })

  it('ignores frames while the camera is off', () => {
    const acc = createMetricsAccumulator()
    acc.onFrame(FRAME_MS, false, true)
    expect(acc.snapshot().activeMs).toBe(0)
    expect(acc.snapshot().trackUptimePct).toBe(0)
  })

  it('reports mean and p95 detection latency', () => {
    const acc = createMetricsAccumulator()
    for (let ms = 1; ms <= 100; ms++) acc.onLatency(ms)
    const snap = acc.snapshot()
    expect(snap.detectLatencyMeanMs).toBe(50.5)
    expect(snap.detectLatencyP95Ms).toBe(95)
  })

  it('reports null latency before any detection', () => {
    const snap = createMetricsAccumulator().snapshot()
    expect(snap.detectLatencyMeanMs).toBeNull()
    expect(snap.detectLatencyP95Ms).toBeNull()
  })

  it('asks for a periodic report every METRICS_INTERVAL_MS of active time', () => {
    const acc = createMetricsAccumulator()
    const frames = METRICS_INTERVAL_MS / FRAME_MS
    expect(feed(acc, frames - 1, true)).toBe(false)
    expect(acc.onFrame(FRAME_MS, true, true)).toBe(true)
    expect(feed(acc, 10, true)).toBe(false)
  })

  it('counts step-downs but not the initial tier', () => {
    const acc = createMetricsAccumulator()
    acc.onTierChange('high', false)
    acc.onTierChange('mid', true)
    const snap = acc.snapshot()
    expect(snap.tierChanges).toBe(1)
    expect(snap.tier).toBe('mid')
  })

  it('flags a session that never tracked a face and never switched frames', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 20, false)
    expect(acc.snapshot().endedWithoutTrack).toBe(true)
  })

  it('does not flag a session that switched frames', () => {
    const acc = createMetricsAccumulator()
    feed(acc, 20, false)
    acc.onModelSwitch()
    expect(acc.snapshot().endedWithoutTrack).toBe(false)
  })

  it('clears the session on reset but keeps the device tier', () => {
    const acc = createMetricsAccumulator()
    acc.onTierChange('mid', false)
    feed(acc, 100, true)
    acc.onLatency(12)
    acc.reset()
    const snap = acc.snapshot()
    expect(snap.activeMs).toBe(0)
    expect(snap.detectLatencyMeanMs).toBeNull()
    expect(snap.tier).toBe('mid')
  })
})
