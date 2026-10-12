import { expect, test } from '@playwright/test'
import { missingPrerequisite } from './fixtures'

/**
 * Hair occlusion (#9), positive case on frozen frames: the playground's
 * `?view=scene&hair=band` paints a hair band over the near temple arm
 * (`hairBand`, stage-width fractions). The arm behind the temple roots must
 * vanish inside the band, and nothing else may change: the frame front,
 * hinges and the far side stay. The live face fixtures have no hair over an
 * arm (see hair.spec.ts), so this is where the hiding itself is proven.
 */

const skipReason = missingPrerequisite()

test.describe('hair occlusion, frozen frame', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ gl: 'swiftshader' })
  test.setTimeout(240_000)

  /** Stage x range (px) of the band, from the playground's `hairBand` fractions. */
  const STAGE_WIDTH = 448
  const CASES = [
    { face: 'iris-moss', band: [0.66, 0.8] as const },
    { face: 'synthetic-profile', band: [0.4, 0.5] as const }
  ]

  for (const { face, band } of CASES) {
    test(`${face}: a hair band hides the arm under it and nothing else`, async ({ page }, testInfo) => {
      const shoot = async (hair: 'off' | 'band') => {
        await page.goto(`/?view=scene&face=${face}&hair=${hair}&hairBand=${band[0]}-${band[1]}`)
        const scene = page.locator('[data-scene]').first()
        await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 })
        await page.waitForTimeout(12_000)
        return scene.screenshot()
      }
      const off = await shoot('off')
      const on = await shoot('band')
      const diff = await page.evaluate(
        async ([aB64, bB64]) => {
          const decode = async (b64: string) =>
            createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
          const [a, b] = [await decode(aB64!), await decode(bB64!)]
          const read = (img: ImageBitmap) => {
            const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(img, 0, 0)
            return ctx.getImageData(0, 0, img.width, img.height).data
          }
          const pa = read(a)
          const pb = read(b)
          let changed = 0
          let minX = Infinity
          let maxX = -Infinity
          for (let i = 0; i < pa.length; i += 4) {
            const d = Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!)
            if (d > 6) {
              changed++
              const x = (i / 4) % a.width
              minX = Math.min(minX, x)
              maxX = Math.max(maxX, x)
            }
          }
          return { changed, minX, maxX }
        },
        [off.toString('base64'), on.toString('base64')] as const
      )
      const line = `${face}: ${diff.changed} px changed, x ${diff.minX}–${diff.maxX} (band ${Math.round(band[0] * STAGE_WIDTH)}–${Math.round(band[1] * STAGE_WIDTH)})`
      testInfo.annotations.push({ type: 'metrics', description: line })
      console.log(`  ${line}`)

      expect(diff.changed, 'arm pixels hidden').toBeGreaterThan(50)
      // Only inside the band, give or take the bilinear mask edge and the
      // antialiased arm pixel at it (3 px).
      expect(diff.minX).toBeGreaterThanOrEqual(band[0] * STAGE_WIDTH - 3)
      expect(diff.maxX).toBeLessThanOrEqual(band[1] * STAGE_WIDTH + 3)
    })
  }
})
