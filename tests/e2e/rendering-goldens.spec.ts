import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { missingPrerequisite } from './fixtures'

/**
 * Rendering goldens on frozen frames (umbrella #4, issue #14). Each case is one
 * recorded pose (tests/fixtures/tryon-pose) rendered through the playground's
 * `?view=scene` with one flag changed, so every flag gets its own golden and a
 * regression shows up as a changed image, not a changed number.
 *
 * Goldens are re-recorded after an intended visual change:
 *   npx playwright test tests/e2e/rendering-goldens.spec.ts --update-snapshots
 * then review the PNGs in tests/e2e/__screenshots__/rendering-goldens.spec.ts/.
 */

const skipReason = missingPrerequisite()

/** Strict per-pixel colour threshold: the default (0.2) ignores faint changes like a shadow or dim light. */
const STRICT = { threshold: 0.02, timeout: 30_000 }

interface Case {
  name: string
  face: string
  query: Record<string, string>
}

const CASES: Case[] = [
  { name: 'iris-moss-base', face: 'iris-moss', query: {} },
  { name: 'iris-moss-occluder-off', face: 'iris-moss', query: { occluder: 'off' } },
  { name: 'iris-moss-light-dim', face: 'iris-moss', query: { light: 'dim' } },
  { name: 'iris-moss-light-bright', face: 'iris-moss', query: { light: 'bright' } },
  { name: 'iris-moss-background-light', face: 'iris-moss', query: { background: 'light' } },
  { name: 'iris-moss-background-dark', face: 'iris-moss', query: { background: 'dark' } },
  { name: 'pteron-azure-base', face: 'pteron-azure', query: {} },
  { name: 'kairos-amber-base', face: 'kairos-amber', query: {} },
  // Synthetic profile (about -76 yaw): the recorded iris-moss frame rotated about
  // the head axis. Geometry only, not a real face; see synthetic-profile.json.
  { name: 'synthetic-profile-base', face: 'synthetic-profile', query: {} },
  // Frontal (yaw 0). The fixture is derived from a UPNA clip (non-commercial
  // licence), so it stays local and is not committed; the case skips without it.
  { name: 'upna-frontal-base', face: 'upna-frontal', query: {} }
]

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/tryon-pose/', import.meta.url))

// A case whose pose fixture is absent is skipped, not failed: some fixtures are
// local-only (footage-derived, not committed).
const runnable = CASES.filter((c) => existsSync(`${FIXTURES_DIR}${c.face}.json`))

async function shoot(page: Page, c: Case): Promise<ReturnType<Page['locator']>> {
  const params = new URLSearchParams({ view: 'scene', face: c.face, ...c.query })
  await page.goto(`/?${params.toString()}`)
  const scene = page.locator('[data-scene]').first()
  await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 })
  // The GLB loads and the first frames render before the stage is stable.
  await page.waitForTimeout(12_000)
  return scene
}

/** Pixel diff of two PNG buffers, decoded in the browser. Returns changed pixels. */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([aB64, bB64]) => {
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
      for (let i = 0; i < dA.length; i += 4) {
        if (Math.abs(dA[i]! - dB[i]!) > 2 || Math.abs(dA[i + 1]! - dB[i + 1]!) > 2 || Math.abs(dA[i + 2]! - dB[i + 2]!) > 2) {
          changed++
        }
      }
      return changed
    },
    [a.toString('base64'), b.toString('base64')] as const
  )
}

test.describe('rendering goldens, frozen frames', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ gl: 'swiftshader' })
  test.setTimeout(900_000)

  test('the same frozen frame renders identically three times', async ({ page }) => {
    const base = CASES[0]!
    const first = await (await shoot(page, base)).screenshot()
    const second = await (await shoot(page, base)).screenshot()
    const third = await (await shoot(page, base)).screenshot()
    expect(await changedPixels(page, first, second), 'run 1 vs run 2').toBe(0)
    expect(await changedPixels(page, first, third), 'run 1 vs run 3').toBe(0)
  })

  for (const c of runnable) {
    test(`golden: ${c.name}`, async ({ page }) => {
      const scene = await shoot(page, c)
      await expect(scene).toHaveScreenshot(`${c.name}.png`, STRICT)
    })
  }
})
