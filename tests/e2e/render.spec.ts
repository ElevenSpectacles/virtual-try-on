import { expect, test } from './camera-test'
import {
  FACE_FIXTURES,
  faceClip,
  missingPrerequisite
} from './fixtures'

/**
 * Golden screenshots of the shipped component (`?view=experience`) fitting
 * each fixture's own frame onto a still portrait: real MediaPipe landmarks,
 * SwiftShader rendering. Catches fit, occlusion and material regressions
 * that unit tests can't see. Update after an intended visual change with
 * `npm run verify:e2e -- --update-snapshots` and review the new PNGs.
 */

const skipReason = missingPrerequisite()

for (const face of FACE_FIXTURES) {
  test.describe(face, () => {
    test.skip(!!skipReason, skipReason ?? '')
    test.use({
      clip: skipReason ? '' : faceClip(face, 'still'),
      gl: 'swiftshader'
    })

    test('fits the frame', async ({ cameraPage: page }) => {
      await page.goto(`/?view=experience&model=${face}`)
      await page.waitForFunction(
        () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
      )
      await page.getByRole('button', { name: 'Start camera' }).click()

      const stage = page.locator('.vto-stage')
      // Camera live → the slot shows "Position your face" until MediaPipe has
      // loaded and found the face; then let the smoothing settle.
      await expect(page.getByRole('button', { name: 'Start camera' })).toBeHidden()
      await page.waitForTimeout(1_000)
      // SwiftShader detection occasionally needs >45 s for the first face.
      await expect(stage.getByText('Position your face in view')).toBeHidden({
        timeout: 75_000
      })
      // SwiftShader renders a few frames a second, so the smoothed frame
      // pose and the occluder take seconds to settle onto the face — shoot
      // earlier and the depth-only occluder can still be in front of the
      // lenses (a real GPU settles in a few frames).
      await page.waitForTimeout(20_000)

      await expect(stage).toHaveScreenshot(`${face}.png`, { timeout: 20_000 })
    })
  })
}
