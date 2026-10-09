import { expect, test, type Page } from '@playwright/test'
import { missingPrerequisite } from './fixtures'

/**
 * Contact shadow on each recorded face (tests/fixtures/tryon-pose). For every
 * face the frozen frame is rendered with and without the shadow, and the
 * darkening is measured: how much there is, and where it lands relative to
 * the centre of the stage. The shadow sits on the bridge, so its weight should
 * split either side of the nose rather than piling up on one cheek.
 */

const FACES = ['iris-moss', 'pteron-azure'] as const
const CHANGE_TOLERANCE = 2
const MIN_CHANGED_PIXELS = 100

const skipReason = missingPrerequisite()

async function shoot(page: Page, face: string, shadow: boolean): Promise<Buffer> {
  await page.goto(`/?view=scene&face=${face}&shadow=${shadow ? 'on' : 'off'}`)
  const scene = page.locator('[data-scene]').first()
  await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(12_000)
  return scene.screenshot()
}

interface Darkening {
  changed: number
  /** Total darkening over changed pixels, in grey levels. */
  weight: number
  /** Weight-averaged x and y centre, in stage pixels. */
  centreX: number
  centreY: number
  /** Share of the weight on the left half of the stage. */
  leftShare: number
}

/** Darkening of the shadow-on frame relative to the shadow-off frame, in the browser. */
async function measure(page: Page, on: Buffer, off: Buffer): Promise<Darkening> {
  return page.evaluate(
    async ([onB64, offB64, tol]) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const [imgOn, imgOff] = [await decode(onB64!), await decode(offB64!)]
      const width = imgOn.width
      const height = imgOn.height
      const pixels = (img: ImageBitmap) => {
        const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, width, height).data
      }
      const a = pixels(imgOff)
      const b = pixels(imgOn)
      let changed = 0
      let weight = 0
      let sumX = 0
      let sumY = 0
      let leftWeight = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          // Grey levels the shadow removed, from the luma of each pixel.
          const luma = (p: Uint8ClampedArray) => 0.3 * p[i]! + 0.59 * p[i + 1]! + 0.11 * p[i + 2]!
          const drop = luma(a) - luma(b)
          if (drop > tol) {
            changed++
            weight += drop
            sumX += drop * x
            sumY += drop * y
            if (x < width / 2) leftWeight += drop
          }
        }
      }
      return {
        changed,
        weight,
        centreX: weight ? sumX / weight : 0,
        centreY: weight ? sumY / weight : 0,
        leftShare: weight ? leftWeight / weight : 0
      }
    },
    [on.toString('base64'), off.toString('base64'), CHANGE_TOLERANCE] as const
  )
}

test.describe('contact shadow on each recorded face', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ gl: 'swiftshader' })
  test.setTimeout(600_000)

  for (const face of FACES) {
    test(`${face}: the shadow darkens skin near the bridge`, async ({ page }, testInfo) => {
      const on = await shoot(page, face, true)
      const off = await shoot(page, face, false)
      const d = await measure(page, on, off)

      const line =
        `${d.changed} px · weight ${Math.round(d.weight)} · ` +
        `centre (${d.centreX.toFixed(0)}, ${d.centreY.toFixed(0)}) · left share ${(d.leftShare * 100).toFixed(0)}%`
      testInfo.annotations.push({ type: 'metrics', description: line })
      console.log(`  ${face}: ${line}`)

      expect(d.changed, 'pixels the shadow darkens').toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS)
      // Centre of the darkening inside the middle of the stage, not at an edge.
      expect(d.centreX).toBeGreaterThan(448 * 0.25)
      expect(d.centreX).toBeLessThan(448 * 0.75)
      expect(d.centreY).toBeGreaterThan(448 * 0.25)
      expect(d.centreY).toBeLessThan(448 * 0.75)
    })
  }
})
