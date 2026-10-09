import { expect, test, type Page } from '@playwright/test'
import { missingPrerequisite } from './fixtures'

/**
 * Contact shadow on vs off on one frozen frame (#6 acceptance). The playground's
 * `?view=scene` renders TryOnScene from a recorded pose (tests/fixtures/tryon-pose),
 * with no camera and no tracker, so renders are deterministic: two shadow-on
 * shots must match exactly, and the shadow-off shot must differ only where the
 * shadow is painted.
 */

const CHANGE_TOLERANCE = 2
/** Changed pixels needed before the shadow counts as visible. */
const MIN_CHANGED_PIXELS = 100

const skipReason = missingPrerequisite()

interface Diff {
  width: number
  height: number
  changed: number
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null
}

async function shoot(page: Page, shadow: boolean): Promise<Buffer> {
  await page.goto(`/?view=scene&shadow=${shadow ? 'on' : 'off'}`)
  const scene = page.locator('[data-scene]').first()
  await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 })
  // Let the GLB load and the first frames render (SwiftShader is slow).
  await page.waitForTimeout(12_000)
  return scene.screenshot()
}

async function diffPng(page: Page, a: Buffer, b: Buffer): Promise<Diff> {
  return page.evaluate(
    async ([aB64, bB64, tol]) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const [imgA, imgB] = [await decode(aB64!), await decode(bB64!)]
      const width = imgA.width
      const height = imgA.height
      const pixels = (img: ImageBitmap) => {
        const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, width, height).data
      }
      const dA = pixels(imgA)
      const dB = pixels(imgB)
      let changed = 0
      let minX = width, minY = height, maxX = -1, maxY = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (Math.abs(dA[i]! - dB[i]!) > tol || Math.abs(dA[i + 1]! - dB[i + 1]!) > tol || Math.abs(dA[i + 2]! - dB[i + 2]!) > tol) {
            changed++
            minX = Math.min(minX, x); minY = Math.min(minY, y)
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
          }
        }
      }
      return { width, height, changed, bbox: changed ? { minX, minY, maxX, maxY } : null }
    },
    [a.toString('base64'), b.toString('base64'), CHANGE_TOLERANCE] as const
  )
}

test.describe('contact shadow, frozen frame', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.setTimeout(300_000)

  test('the shadow changes the skin under the bridge and nothing else', async ({ page }, testInfo) => {
    const onA = await shoot(page, true)
    const onB = await shoot(page, true)
    const off = await shoot(page, false)

    const determinism = await diffPng(page, onA, onB)
    const effect = await diffPng(page, onA, off)
    const describe = (d: Diff) =>
      d.bbox
        ? `${d.changed} px · bbox x ${d.bbox.minX}–${d.bbox.maxX} y ${d.bbox.minY}–${d.bbox.maxY} of ${d.width}×${d.height}`
        : `${d.changed} px`
    testInfo.annotations.push({
      type: 'metrics',
      description: `on vs on: ${describe(determinism)} · on vs off: ${describe(effect)}`
    })
    console.log(`  frozen frame · on vs on: ${describe(determinism)}`)
    console.log(`  frozen frame · on vs off: ${describe(effect)}`)

    // Renders are deterministic, so two identical settings must match.
    expect(determinism.changed, 'shadow-on renders are repeatable').toBe(0)

    expect(effect.changed, 'pixels the shadow changes').toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS)
    // The shadow is painted on the occluder skin, so its box sits inside the
    // stage, away from the edges.
    const bbox = effect.bbox!
    expect(bbox.minX, 'left edge of the shadow').toBeGreaterThan(effect.width * 0.1)
    expect(bbox.maxX, 'right edge of the shadow').toBeLessThan(effect.width * 0.9)
    expect(bbox.minY, 'top edge of the shadow').toBeGreaterThan(effect.height * 0.1)
    expect(bbox.maxY, 'bottom edge of the shadow').toBeLessThan(effect.height * 0.9)
  })
})
