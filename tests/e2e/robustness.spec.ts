import { expect, test } from './camera-test'
import { faceClip, missingPrerequisite } from './fixtures'

/**
 * Tracking robustness on the shipped component (issue #99):
 * - `dropout`: 200 ms of black frames. The tracker loses the face, but the
 *   hold keeps the frame on its last pose, so the canvas layer is never
 *   hidden (`vto-frame--hidden`) while the clip loops through the dropout.
 * - `dark`: a very dark room. The guide hint reads `tooDark`.
 */

const skipReason = missingPrerequisite()
const face = 'iris-moss'

async function startExperience(page: import('@playwright/test').Page) {
  await page.goto(`/?view=experience&model=${face}`)
  await page.waitForFunction(
    () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
  )
  await page.getByRole('button', { name: 'Start camera' }).click()
}

test.describe('dropout', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : faceClip(face, 'dropout') })

  test('keeps the frame up through a 200 ms tracking loss', async ({ cameraPage: page }) => {
    await startExperience(page)
    const frame = page.locator('.vto-frame')
    await expect(frame).not.toHaveClass(/vto-frame--hidden/, { timeout: 45_000 })
    // Count hides over two loops of the 6 s clip (two dropouts).
    await frame.evaluate((el) => {
      const w = window as unknown as { __hides: number }
      w.__hides = 0
      new MutationObserver(() => {
        if (el.classList.contains('vto-frame--hidden')) w.__hides++
      }).observe(el, { attributes: true, attributeFilter: ['class'] })
    })
    await page.waitForTimeout(12_500)
    const hides = await page.evaluate(() => (window as unknown as { __hides: number }).__hides)
    expect(hides, 'frame hidden during a short dropout').toBe(0)
  })
})

test.describe('dark room', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : faceClip(face, 'dark') })

  test('asks for more light', async ({ cameraPage: page }) => {
    await startExperience(page)
    await expect(page.locator('[data-guide="tooDark"]')).toBeVisible({ timeout: 60_000 })
  })
})
