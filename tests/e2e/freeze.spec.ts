import { expect, test } from './camera-test'
import { faceClip, missingPrerequisite } from './fixtures'
import { waitForLiveStill, waitForTryOn } from './readiness'

const skipReason = missingPrerequisite()
const face = 'iris-moss'

test.describe('freeze', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({
    clip: skipReason ? '' : faceClip(face, 'still'),
    gl: 'swiftshader'
  })

  test('re-renders a switched frame on the held pose', async ({ cameraPage: page }) => {
    await page.goto(`/?view=experience&freeze=true&model=${face}`)
    await page.waitForFunction(
      () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
    )
    await page.getByRole('button', { name: 'Start camera' }).click()
    const stage = await waitForTryOn(page)

    await page.getByRole('button', { name: 'Freeze' }).click()
    await expect(stage.locator('[data-frozen="true"]')).toBeVisible()
    const paused = await stage.locator('video').evaluate((v: HTMLVideoElement) => v.paused)
    expect(paused).toBe(true)

    await page.getByRole('button', { name: 'Next frame' }).click()
    await expect(page.locator('[data-experience]')).toHaveAttribute('data-model-loaded', 'true', {
      timeout: 30_000
    })
    await waitForLiveStill(page, stage)
    await expect(stage).toHaveScreenshot(`${face}-frozen-next.png`, {
      threshold: 0.02,
      timeout: 20_000
    })

    await page.getByRole('button', { name: 'Unfreeze' }).click()
    await expect(stage.locator('[data-frozen="false"]')).toBeVisible()
    const playing = await stage.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)
    expect(playing).toBe(true)
  })
})
