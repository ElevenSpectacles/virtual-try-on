import type { Page } from '@playwright/test'

/**
 * Shared driver for the fake-camera tracking specs: opens the playground
 * prototype with `?harness=true`, waits for the first detection, then samples
 * the raw detector results (landmarks in stage pixels) for a fixed window.
 */

export interface HarnessResult {
  at: number
  landmarks: [number, number][]
}

export const MIN_DETECTION_RATE = 0.95
// Median frame-to-frame landmark movement on a perfectly still input: the
// tracker's own noise floor. Above this the frame visibly shimmers.
export const MAX_STILL_JITTER_PX = 0.75
export const SAMPLE_MS = 6_000

export async function runTracking(page: Page, model: string) {
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
  await page.waitForTimeout(SAMPLE_MS)

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
