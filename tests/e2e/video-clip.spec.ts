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
 * Tracking on a real video clip (`TRYON_VIDEO_CLIP`; `npm run fetch-footage`
 * prepares some), through the same fake camera path as the portrait
 * fixtures. The model is only the one rendered in the prototype: the
 * assertions are on detection, not on the frame's fit. A second test renders
 * the shipped component on the clip and attaches a screenshot to the report,
 * for reviewing how the frame looks on real footage (no golden: the clip is
 * not committed).
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

  test('renders the shipped component on the clip', async ({ cameraPage: page }, testInfo) => {
    let faceDetected = false
    page.on('console', (msg) => {
      if (msg.text().startsWith('[track] TRY_ON_FACE_DETECTED')) faceDetected = true
    })
    await page.goto(`/?view=experience&model=${MODEL}`)
    await page.waitForFunction(
      () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
    )
    await page.getByRole('button', { name: 'Start camera' }).click()
    // The face hint stays hidden until the camera is live, so wait for the
    // real first detection, then let the smoothing settle on the face.
    await expect.poll(() => faceDetected, { timeout: 60_000 }).toBe(true)
    await page.waitForTimeout(3_000)
    const stage = page.locator('.vto-stage')
    await expect(stage.getByText('Position your face in view'), 'face tracked').toBeHidden()
    // Saved in test-results/ as well as attached, so it can be reviewed
    // without opening the HTML report.
    const path = testInfo.outputPath('experience.png')
    await stage.screenshot({ path })
    await testInfo.attach('experience on the clip', { path, contentType: 'image/png' })
  })
})
