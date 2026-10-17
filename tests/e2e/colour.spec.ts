import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from './camera-test'
import { missingPrerequisite } from './fixtures'
import { deltaE2000, hexToLab, srgbToLab } from '../../scripts/lib/colour'

/**
 * Colour QA (issue #85): each catalog frame rendered on a frozen pose under
 * neutral (greyscale) light, where Khronos PBR Neutral keeps hue exact, and
 * its frame and lens swatches compared with the product photo in CIEDE2000.
 * Swatches and sample boxes come from tests/fixtures/colour-swatches.json;
 * ΔE above its threshold fails unless the model is listed under `known`.
 * Local-only and SwiftShader (the `gl` option of camera-test's page), so
 * pixels match across machines.
 */

interface Swatch {
  /** Product-photo colour, #rrggbb. */
  hex: string
  /** Sample box on the stage, fractions: [x, y, width, height]. */
  box: [number, number, number, number]
}

interface SwatchFile {
  face: string
  threshold: number
  models: Record<string, { frame?: Swatch; lens?: Swatch }>
  known: Record<string, string>
}

const swatches = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/colour-swatches.json', import.meta.url)), 'utf8')
) as SwatchFile

const skipReason =
  missingPrerequisite() ??
  (Object.keys(swatches.models).length === 0
    ? 'no product swatches yet (tests/fixtures/colour-swatches.json)'
    : null)

test.describe('colour QA', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ gl: 'swiftshader' })

  for (const [model, parts] of Object.entries(swatches.models)) {
    test(`${model} matches its product photo`, async ({ cameraPage: page }, testInfo) => {
      const params = new URLSearchParams({ view: 'scene', face: swatches.face, model, light: 'neutral' })
      await page.goto(`/?${params.toString()}`)
      const scene = page.locator('[data-scene]').first()
      await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(12_000)
      const png = await scene.screenshot()

      for (const [part, swatch] of Object.entries(parts)) {
        if (!swatch) continue
        const mean = await page.evaluate(
          async ([b64, box]) => {
            const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
            const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
            ctx.drawImage(img, 0, 0)
            const [x, y, w, h] = box as [number, number, number, number]
            const data = ctx.getImageData(
              Math.round(x * img.width),
              Math.round(y * img.height),
              Math.max(1, Math.round(w * img.width)),
              Math.max(1, Math.round(h * img.height))
            ).data
            const sum = [0, 0, 0]
            for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!
            const n = data.length / 4
            return sum.map((v) => v / n)
          },
          [png.toString('base64'), swatch.box] as const
        )
        const dE = deltaE2000(srgbToLab(mean[0]!, mean[1]!, mean[2]!), hexToLab(swatch.hex))
        testInfo.annotations.push({ type: 'deltaE', description: `${model} ${part}: ΔE2000 ${dE.toFixed(2)}` })
        console.log(`  ${model} ${part}: ΔE2000 ${dE.toFixed(2)}`)
        if (!(model in swatches.known)) {
          expect(dE, `${model} ${part} ΔE2000`).toBeLessThan(swatches.threshold)
        }
      }
    })
  }
})
