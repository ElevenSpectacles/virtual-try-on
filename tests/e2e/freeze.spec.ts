import { expect, test } from './camera-test'
import { faceClip, missingPrerequisite } from './fixtures'

/**
 * `freeze()` / `unfreeze()` (issue #97) on the shipped component: freeze a
 * fixture's pose, switch to another catalog frame, and the new frame renders
 * where the old one sat, on the held camera frame. Golden: the switched
 * frame on the frozen pose (SwiftShader, like the other goldens).
 */

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
    const stage = page.locator('.vto-stage')
    await expect(stage.getByText('Position your face in view')).toBeHidden({ timeout: 75_000 })
    await page.waitForTimeout(20_000)

    await page.getByRole('button', { name: 'Freeze' }).click()
    await expect(stage.locator('[data-frozen="true"]')).toBeVisible()
    // The video holds its frame while frozen.
    const paused = await stage.locator('video').evaluate((v: HTMLVideoElement) => v.paused)
    expect(paused).toBe(true)

    await page.getByRole('button', { name: 'Next frame' }).click()
    // GLB load + a few SwiftShader frames for the smoothing to settle.
    await page.waitForTimeout(10_000)
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
