import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { missingPrerequisite } from './fixtures'
import { changedPixels, waitForScene } from './readiness'

const skipReason = missingPrerequisite()

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
  { name: 'iris-moss-lens-standard', face: 'iris-moss', query: { lens: 'standard' } },
  { name: 'kairos-crystal-on-iris-moss', face: 'iris-moss', query: { model: 'kairos-crystal' } },
  { name: 'pteron-azure-background-dark', face: 'pteron-azure', query: { background: 'dark' } },
  { name: 'iris-moss-hair-band', face: 'iris-moss', query: { hair: 'band', hairBand: '0.66-0.8' } },
  { name: 'synthetic-profile-hair-band', face: 'synthetic-profile', query: { hair: 'band', hairBand: '0.4-0.5' } },
  { name: 'pteron-azure-base', face: 'pteron-azure', query: {} },
  { name: 'kairos-amber-base', face: 'kairos-amber', query: {} },
  { name: 'synthetic-profile-base', face: 'synthetic-profile', query: {} },
  { name: 'upna-frontal-base', face: 'upna-frontal', query: {} },
  { name: 'iris-moss-camera-match', face: 'iris-moss', query: { match: 'on' } }
]

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/tryon-pose/', import.meta.url))

const runnable = CASES.filter((c) => existsSync(`${FIXTURES_DIR}${c.face}.json`))

async function shoot(page: Page, c: Case): Promise<ReturnType<Page['locator']>> {
  const params = new URLSearchParams({ view: 'scene', face: c.face, ...c.query })
  await page.goto(`/?${params.toString()}`)
  return waitForScene(page)
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
    expect((await changedPixels(page, first, second)).changed, 'run 1 vs run 2').toBe(0)
    expect((await changedPixels(page, first, third)).changed, 'run 1 vs run 3').toBe(0)
  })

  for (const c of runnable) {
    test(`golden: ${c.name}`, async ({ page }) => {
      const scene = await shoot(page, c)
      await expect(scene).toHaveScreenshot(`${c.name}.png`, STRICT)
    })
  }
})
