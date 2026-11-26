import { expect, test } from './camera-test'
import {
  FACE_FIXTURES,
  faceClip,
  missingPrerequisite
} from './fixtures'
import { waitForTryOn } from './readiness'

const skipReason = missingPrerequisite()

const CASES = FACE_FIXTURES.flatMap((face) => [
  { face, kind: 'still' as const, golden: face },
  { face, kind: 'landscape' as const, golden: `${face}-landscape` }
])

for (const { face, kind, golden } of CASES) {
  test.describe(`${face} · ${kind}`, () => {
    test.skip(!!skipReason, skipReason ?? '')
    test.use({
      clip: skipReason ? '' : faceClip(face, kind),
      gl: 'swiftshader'
    })

    test('fits the frame', async ({ cameraPage: page }) => {
      await page.goto(`/?view=experience&model=${face}`)
      await page.waitForFunction(
        () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
      )
      await page.getByRole('button', { name: 'Start camera' }).click()

      const stage = await waitForTryOn(page)

      await expect(stage).toHaveScreenshot(`${golden}.png`, { timeout: 20_000 })
    })
  })
}
