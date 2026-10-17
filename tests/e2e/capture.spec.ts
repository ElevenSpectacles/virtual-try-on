import { expect, test } from './camera-test'
import { FACE_FIXTURES, faceClip, missingPrerequisite } from './fixtures'

/**
 * `capture()` (issue #93) on the shipped component: the snapshot has the
 * stage's aspect and shows the same composite as the screen (mirrored feed,
 * frame on the face). Its own golden sits next to `render.spec.ts`'s stage
 * golden, so a reviewer can compare the two; both are SwiftShader renders of
 * the same still clip.
 */

const skipReason = missingPrerequisite()
const face = FACE_FIXTURES[0]!

test.describe('capture', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({
    clip: skipReason ? '' : faceClip(face, 'still'),
    gl: 'swiftshader'
  })

  test('snapshots the composited try-on', async ({ cameraPage: page }) => {
    await page.goto(`/?view=experience&capture=true&model=${face}`)
    await page.waitForFunction(
      () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
    )
    await page.getByRole('button', { name: 'Start camera' }).click()
    const stage = page.locator('.vto-stage')
    await expect(stage.getByText('Position your face in view')).toBeHidden({ timeout: 75_000 })
    await page.waitForTimeout(20_000)

    await page.getByRole('button', { name: 'Capture' }).click()
    const image = page.locator('img[data-capture]')
    await expect(image).toBeVisible()

    const captured = await image.evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const response = await fetch(img.src)
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return { width: img.naturalWidth, height: img.naturalHeight, png: btoa(binary) }
    })
    const box = (await stage.boundingBox())!
    expect(captured.width / captured.height).toBeCloseTo(box.width / box.height, 2)
    expect(Buffer.from(captured.png, 'base64')).toMatchSnapshot(`capture-${face}.png`, {
      threshold: 0.02,
      maxDiffPixelRatio: 0.02
    })
  })
})
