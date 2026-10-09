import { existsSync } from 'node:fs'
import { expect, test } from './camera-test'
import { VIDEO_CLIP, missingPrerequisite } from './fixtures'

/**
 * The `metrics` event end to end: the playground's experience view with
 * `?metrics=true` logs each report as `[metrics] {json}`. Starts the camera
 * on a real clip, lets it track, stops it, and checks the final report.
 *
 * Runs on the clip named by `TRYON_VIDEO_CLIP`, like video-clip.spec.ts.
 */

const clipSkip = !VIDEO_CLIP
  ? 'TRYON_VIDEO_CLIP not set'
  : !existsSync(VIDEO_CLIP)
    ? `no clip at ${VIDEO_CLIP}`
    : null
const skipReason = missingPrerequisite() ?? clipSkip

test.describe('metrics event', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : VIDEO_CLIP })

  test('emits a final report with the session numbers when the camera stops', async ({
    cameraPage: page
  }) => {
    const reports: Record<string, unknown>[] = []
    let faceDetected = false
    const prefix = '[metrics] '
    page.on('console', (msg) => {
      if (msg.text().startsWith(prefix)) {
        reports.push(JSON.parse(msg.text().slice(prefix.length)))
      } else if (msg.text().startsWith('[track] TRY_ON_FACE_DETECTED')) {
        faceDetected = true
      }
    })

    await page.goto('/?view=experience&metrics=true')
    await page.getByRole('button', { name: 'Start camera' }).click()
    // The detector loads for several seconds before the first face: wait for
    // the real detection event, then track for a few seconds more.
    await expect.poll(() => faceDetected, { timeout: 60_000 }).toBe(true)
    await page.waitForTimeout(4_000)
    await page.getByRole('button', { name: 'Stop camera' }).click()

    await expect
      .poll(() => reports.some((r) => r.final === true), { timeout: 10_000 })
      .toBe(true)
    const final = reports.find((r) => r.final === true)!
    console.log(`  final metrics: ${JSON.stringify(final)}`)

    // The payload is numbers and labels only: no frames, no landmarks.
    for (const key of ['landmarks', 'pose', 'frame']) {
      expect(final, `no ${key} in the report`).not.toHaveProperty(key)
    }

    expect(final.activeMs as number, 'active time').toBeGreaterThan(3_000)
    // No track losses on this clip, so uptime is the active time after the
    // first track, as a share of the whole session.
    expect(final.timeToFirstTrackMs as number, 'time to first track').not.toBeNull()
    const expectedUptime =
      (((final.activeMs as number) - (final.timeToFirstTrackMs as number)) / (final.activeMs as number)) * 100
    expect(final.trackUptimePct as number, 'track uptime %').toBeCloseTo(expectedUptime, 0)
    expect(final.trackLossPerMin, 'track losses per minute').toBe(0)
    expect(final.detectLatencyMeanMs, 'detection latency mean').not.toBeNull()
    expect(final.renderFpsMean as number, 'render fps').toBeGreaterThan(0)
    expect(final.endedWithoutTrack, 'session tracked a face').toBe(false)
    expect(final.model, 'active model').toEqual(expect.any(String))
    expect(final.features, 'features at report time').toEqual({
      occluder: expect.any(Boolean),
      contactShadow: expect.any(Boolean),
      adaptiveLighting: expect.any(Boolean)
    })
  })
})
