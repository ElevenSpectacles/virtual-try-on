#!/usr/bin/env node
// Screenshot the playground PROTOTYPE (occluder on, debug panel) on a face
// fixture through Chromium's fake camera, real GPU.
//   node proto-shot.mjs <face> <out.png> [--occluder-off] [--occluder-debug]
// Needs the playground served on :3298 (see SKILL.md) and the fixture clip
// rendered once by `npm run verify:e2e` (os.tmpdir()/virtual-try-on-face-clips).
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../../package.json', import.meta.url))
const { chromium } = createRequire(repo)('@playwright/test')

const [face, out, ...flags] = process.argv.slice(2)
if (!face || !out) {
  console.error('usage: proto-shot.mjs <face> <out.png> [--occluder-off] [--occluder-debug]')
  process.exit(1)
}
const clip = join(tmpdir(), 'virtual-try-on-face-clips', `${face}-still.y4m`)
if (!existsSync(clip)) {
  console.error(`missing ${clip} — run \`npm run verify:e2e\` once to render clips`)
  process.exit(1)
}

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${clip}`,
    '--enable-gpu',
    '--ignore-gpu-blocklist'
  ]
})
const page = await (
  await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 900 } })
).newPage()
await page.goto(`http://localhost:3298/?model=${face}&harness=true&debug_tryon=true`)
await page.waitForFunction(() => '__tryOnHarness' in window)
// The prototype turns tracking on by itself once the camera is live —
// clicking "Track my face" would turn it OFF.
await page.getByRole('button', { name: 'Allow camera access' }).click()
if (flags.includes('--occluder-off')) {
  await page.getByRole('switch', { name: 'Occluder enabled' }).click()
}
if (flags.includes('--occluder-debug')) {
  await page.getByRole('switch', { name: 'Show occluder (red)' }).click()
}
await page.waitForFunction(
  () => window.__tryOnHarness.results.filter((r) => r.landmarks.length).length > 30,
  null,
  { timeout: 45_000 }
)
await page.waitForTimeout(2_500)
await page.locator('video').first().locator('xpath=..').screenshot({ path: out })
console.log(out, 'pose', JSON.stringify(await page.evaluate(() => window.__tryOnHarness.pose())))
await browser.close()
