import type { Page } from '@playwright/test'

/**
 * Shared driver for the fake-camera tracking specs: opens the playground
 * prototype with `?harness=true`, waits for the first detection, then samples
 * the raw detector results (landmarks in stage pixels) for a fixed window.
 */

export interface HarnessResult {
  at: number
  landmarks: [number, number][]
  /** Head pose in degrees; undefined or null when the tracker returned none. */
  pose?: { yaw: number; pitch: number; roll: number } | null
}

export const MIN_DETECTION_RATE = 0.95

/**
 * Per-kind detection-rate floors (issue #99). Measured with MediaPipe's CPU
 * delegate on the fixture frames (2026-10-17): 100 % on still, dim, dark,
 * backlit and occluded, 96.7 % on dropout (its 200 ms of black frames).
 */
export const MIN_DETECTION_RATE_BY_KIND: Record<string, number> = {
  still: MIN_DETECTION_RATE,
  motion: MIN_DETECTION_RATE,
  backlit: MIN_DETECTION_RATE,
  occluded: MIN_DETECTION_RATE,
  dropout: 0.93
}

/**
 * Largest frame-to-frame move of the mean landmark allowed on a still
 * subject: a "pop" is a discontinuity well above the jitter floor. Measured
 * in camera pixels (480×640); the harness reports stage pixels, so recheck
 * the margin if the prototype's stage is much larger than the camera frame.
 * Measured: still 0.5–2.9, backlit 1.0–1.6, occluded 1.2–6.3 (the box
 * edge), dropout 1.8–6.8 (re-acquiring after the black frames).
 */
export const MAX_POP_PX: Record<string, number> = {
  still: 4,
  backlit: 4,
  dropout: 10
}

/** Largest frame-to-frame move of the mean landmark position, stage px. */
export function maxPopPx(results: HarnessResult[]): number {
  const tracked = results.filter((r) => r.landmarks.length > 0)
  let worst = 0
  for (let i = 1; i < tracked.length; i++) {
    const a = tracked[i - 1]!.landmarks
    const b = tracked[i]!.landmarks
    let sum = 0
    for (let j = 0; j < a.length; j++) {
      sum += Math.hypot(b[j]![0] - a[j]![0], b[j]![1] - a[j]![1])
    }
    worst = Math.max(worst, sum / a.length)
  }
  return worst
}
// Median frame-to-frame landmark movement on a perfectly still input: the
// tracker's own noise floor. Above this the frame visibly shimmers.
export const MAX_STILL_JITTER_PX = 0.75
export const SAMPLE_MS = 6_000

export async function runTracking(page: Page, model: string, sampleMs = SAMPLE_MS) {
  await page.goto(`/?model=${model}&harness=true`)
  await page.waitForFunction(() => '__tryOnHarness' in window)
  // The prototype switches tracking on by itself once the camera is live.
  await page.getByRole('button', { name: 'Allow camera access' }).click()

  // Measure from the first detection: MediaPipe's Wasm + model download is
  // load time, not tracking quality.
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __tryOnHarness: { results: HarnessResult[] } }
      ).__tryOnHarness.results.some((r) => r.landmarks.length > 0),
    null,
    { timeout: 45_000 }
  )
  const start = await page.evaluate(() => performance.now())
  await page.waitForTimeout(sampleMs)

  return page.evaluate((from) => {
    const h = (
      window as unknown as {
        __tryOnHarness: {
          results: HarnessResult[]
          frameIntervals: number[]
          latencyMs: () => number
          blink: () => number | null
        }
      }
    ).__tryOnHarness
    return {
      results: h.results.filter((r) => r.at >= from),
      frameIntervals: h.frameIntervals.slice(-200),
      latencyMs: h.latencyMs(),
      blink: h.blink()
    }
  }, start)
}

export function detectionRate(results: HarnessResult[]): number {
  return results.filter((r) => r.landmarks.length > 0).length / results.length
}

/** Median over consecutive detections of the mean per-landmark displacement. */
export function medianJitterPx(results: HarnessResult[]): number {
  const tracked = results.filter((r) => r.landmarks.length > 0)
  const steps: number[] = []
  for (let i = 1; i < tracked.length; i++) {
    const a = tracked[i - 1]!.landmarks
    const b = tracked[i]!.landmarks
    let sum = 0
    for (let j = 0; j < a.length; j++) {
      sum += Math.hypot(b[j]![0] - a[j]![0], b[j]![1] - a[j]![1])
    }
    steps.push(sum / a.length)
  }
  steps.sort((x, y) => x - y)
  return steps[Math.floor(steps.length / 2)] ?? Number.POSITIVE_INFINITY
}

export function p95(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0
}
