import type { Page } from '@playwright/test'
import { expect, test } from './camera-test'
import {
  FACE_FIXTURES,
  faceClip,
  missingPrerequisite,
  type ClipKind
} from './fixtures'

/**
 * Real tracking path — fake camera → worker MediaPipe → playground prototype —
 * asserted through the prototype's `?harness=true` hook (raw detector results
 * with landmarks in stage pixels).
 */

interface HarnessResult {
  at: number
  landmarks: [number, number][]
}

const MIN_DETECTION_RATE = 0.95
// Median frame-to-frame landmark movement on a perfectly still input: the
// tracker's own noise floor. Above this the frame visibly shimmers.
const MAX_STILL_JITTER_PX = 0.75
const SAMPLE_MS = 6_000

async function runTracking(page: Page, model: string) {
  await page.goto(`/?model=${model}&harness=true`)
  await page.waitForFunction(() => '__tryOnHarness' in window)
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await page.getByRole('switch', { name: /track my face/i }).click()

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
        }
      }
    ).__tryOnHarness
    return {
      results: h.results.filter((r) => r.at >= from),
      frameIntervals: h.frameIntervals.slice(-200),
      latencyMs: h.latencyMs()
    }
  }, start)
}

function detectionRate(results: HarnessResult[]): number {
  return results.filter((r) => r.landmarks.length > 0).length / results.length
}

/** Median over consecutive detections of the mean per-landmark displacement. */
function medianJitterPx(results: HarnessResult[]): number {
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

function p95(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0
}

const skipReason = missingPrerequisite()

for (const face of FACE_FIXTURES) {
  for (const kind of ['still', 'motion'] as ClipKind[]) {
    test.describe(`${face} · ${kind}`, () => {
      test.skip(!!skipReason, skipReason ?? '')
      test.use({ clip: skipReason ? '' : faceClip(face, kind) })

      test('tracks the face', async ({ cameraPage: page }, testInfo) => {
        const { results, frameIntervals, latencyMs } = await runTracking(
          page,
          face
        )
        const rate = detectionRate(results)
        const jitter = medianJitterPx(results)
        const frameP95 = p95(frameIntervals)

        // Logged, not asserted: headless GPU timing varies by machine.
        testInfo.annotations.push({
          type: 'metrics',
          description:
            `${results.length} results · detection ${(rate * 100).toFixed(1)}% · ` +
            `jitter ${jitter.toFixed(2)} px · frame p95 ${frameP95.toFixed(1)} ms · ` +
            `latency ${latencyMs.toFixed(0)} ms`
        })
        console.log(`  ${face} · ${kind}: ${testInfo.annotations.at(-1)!.description}`)

        expect(results.length, 'detector produced results').toBeGreaterThan(10)
        expect(rate, 'detection rate').toBeGreaterThanOrEqual(MIN_DETECTION_RATE)
        if (kind === 'still') {
          expect(jitter, 'still-input jitter (px)').toBeLessThanOrEqual(
            MAX_STILL_JITTER_PX
          )
        }
      })
    })
  }
}
