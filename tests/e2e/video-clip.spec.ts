import { existsSync } from 'node:fs'
import { expect, test } from './camera-test'
import { VIDEO_CLIP, missingPrerequisite } from './fixtures'
import {
  MIN_DETECTION_RATE,
  detectionRate,
  medianJitterPx,
  p95,
  runTracking
} from './tracking-harness'

/**
 * Tracking on a real video clip (`TRYON_VIDEO_CLIP`), through the same fake
 * camera path as the portrait fixtures. The model is only the one rendered in
 * the prototype: the assertions are on detection, not on the frame's fit.
 */

const MODEL = 'iris-moss'

const clipSkip = !VIDEO_CLIP
  ? 'TRYON_VIDEO_CLIP not set'
  : !existsSync(VIDEO_CLIP)
    ? `no clip at ${VIDEO_CLIP}`
    : null
const skipReason = missingPrerequisite() ?? clipSkip

test.describe('real video clip', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : VIDEO_CLIP })

  test('tracks the face in the clip', async ({ cameraPage: page }, testInfo) => {
    const { results, frameIntervals, latencyMs, blink } = await runTracking(
      page,
      MODEL
    )
    const rate = detectionRate(results)
    const jitter = medianJitterPx(results)
    const frameP95 = p95(frameIntervals)

    testInfo.annotations.push({
      type: 'metrics',
      description:
        `${results.length} results · detection ${(rate * 100).toFixed(1)}% · ` +
        `jitter ${jitter.toFixed(2)} px · frame p95 ${frameP95.toFixed(1)} ms · ` +
        `latency ${latencyMs.toFixed(0)} ms · blink ${blink?.toFixed(2) ?? 'n/a'}`
    })
    console.log(`  video clip: ${testInfo.annotations.at(-1)!.description}`)

    expect(results.length, 'detector produced results').toBeGreaterThan(10)
    expect(rate, 'detection rate').toBeGreaterThanOrEqual(MIN_DETECTION_RATE)
    expect(blink, 'blendshape blink score').not.toBeNull()
  })
})
