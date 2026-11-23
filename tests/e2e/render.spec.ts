import { expect, test } from './camera-test'
import {
  FACE_FIXTURES,
  faceClip,
  missingPrerequisite
} from './fixtures'

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
      await expect(page.getByRole('button', { name: 'Start camera' })).toBeHidden()
      await page.waitForTimeout(1_000)
      await expect(stage.getByText('Position your face in view')).toBeHidden({
        timeout: 75_000
      })
      await page.waitForTimeout(20_000)

      await expect(stage).toHaveScreenshot(`${face}.png`, { timeout: 20_000 })
    })
  })
}
