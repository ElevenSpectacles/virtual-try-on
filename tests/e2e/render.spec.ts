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
      // loaded and found the face; then give the One-Euro smoothing a moment
      // to settle on the still input.
      await expect(page.getByRole('button', { name: 'Start camera' })).toBeHidden()
      await page.waitForTimeout(1_000)
      await expect(stage.getByText('Position your face in view')).toBeHidden({
        timeout: 45_000
      })
      await page.waitForTimeout(4_000)

      await expect(stage).toHaveScreenshot(`${face}.png`, { timeout: 20_000 })
    })
  })
}
