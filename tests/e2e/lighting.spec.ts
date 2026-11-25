import { expect, test, type Browser, type Page } from '@playwright/test'
import { faceClip, fakeCameraArgs, missingPrerequisite, type ClipKind } from './fixtures'
import { LIGHTING_SAMPLE_EVERY } from '../../src/runtime/utils/tryon-lighting'

const FACE = 'iris-moss'
const MIN_GAIN_GAP = 0.25
const MAX_STILL_GAIN_RANGE = 0.01
const MAX_MS_PER_DETECTION = 1

const skipReason = missingPrerequisite()

interface Reading {
  luma: number
  gain: number
  sampleMs: number | null
}

async function openOn(browser: Browser, baseURL: string, kind: ClipKind): Promise<Page> {
  const context = await browser.newContext({ baseURL, permissions: ['camera'] })
  const page = await context.newPage()
  await page.goto(`/?view=experience&model=${FACE}&lighting=true`)
  await page.waitForFunction(
    () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
  )
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(page.locator('[data-lighting]'), `${kind}: lighting estimate`).toBeVisible({
    timeout: 60_000
  })
  await waitForSettledLighting(page)
  return page
}

const SETTLED_DELTA = 0.005

async function waitForSettledLighting(page: Page, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  let previous = await read(page)
  let still = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(250)
    const next = await read(page)
    const moved =
      Math.abs(next.luma - previous.luma) > SETTLED_DELTA ||
      Math.abs(next.gain - previous.gain) > SETTLED_DELTA
    still = moved ? 0 : still + 1
    if (still >= 4) return
    previous = next
  }
  throw new Error(`lighting estimate did not settle within ${timeout} ms`)
}

async function read(page: Page): Promise<Reading> {
  return page.locator('[data-lighting]').evaluate((el) => {
    const data = (el as HTMLElement).dataset
    return {
      luma: Number(data.luma),
      gain: Number(data.gain),
      sampleMs: data.sampleMs ? Number(data.sampleMs) : null
    }
  })
}

async function readFor(page: Page, ms: number, everyMs = 200): Promise<Reading[]> {
  const readings: Reading[] = []
  for (let elapsed = 0; elapsed < ms; elapsed += everyMs) {
    readings.push(await read(page))
    await page.waitForTimeout(everyMs)
  }
  return readings
}

async function withClip<T>(
  playwright: { chromium: { launch: (o: { args: string[] }) => Promise<Browser> } },
  baseURL: string,
  kind: ClipKind,
  run: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await playwright.chromium.launch({
    args: fakeCameraArgs(faceClip(FACE, kind), 'hardware')
  })
  try {
    return await run(await openOn(browser, baseURL, kind))
  } finally {
    await browser.close()
  }
}

test.describe('room lighting estimate', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.setTimeout(240_000)

  test('the light gain follows a dim and a bright room', async ({ playwright, baseURL }, testInfo) => {
    const dim = await withClip(playwright, baseURL!, 'dim', read)
    const bright = await withClip(playwright, baseURL!, 'bright', read)
    const line =
      `dim: luma ${dim.luma.toFixed(3)} gain ${dim.gain.toFixed(3)} · ` +
      `bright: luma ${bright.luma.toFixed(3)} gain ${bright.gain.toFixed(3)}`
    testInfo.annotations.push({ type: 'metrics', description: line })
    console.log(`  ${line}`)

    expect(bright.luma, 'room luma').toBeGreaterThan(dim.luma)
    expect(bright.gain - dim.gain, 'gain gap').toBeGreaterThanOrEqual(MIN_GAIN_GAP)
  })

  test('the light holds steady on a still room and costs under 1 ms per detection', async ({ playwright, baseURL }, testInfo) => {
    const readings = await withClip(playwright, baseURL!, 'still', (page) => readFor(page, 4_000))
    const gains = readings.map((r) => r.gain)
    const range = Math.max(...gains) - Math.min(...gains)
    const samples = readings.map((r) => r.sampleMs).filter((ms): ms is number => ms !== null)
    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
    const perDetection = p95 / LIGHTING_SAMPLE_EVERY
    const line =
      `${readings.length} readings · gain range ${range.toFixed(4)} · ` +
      `worker sample p95 ${p95.toFixed(3)} ms, 1 per ${LIGHTING_SAMPLE_EVERY} detections ` +
      `→ ${perDetection.toFixed(3)} ms per detection`
    testInfo.annotations.push({ type: 'metrics', description: line })
    console.log(`  ${line}`)

    expect(range, 'gain range on a still clip').toBeLessThanOrEqual(MAX_STILL_GAIN_RANGE)
    expect(samples.length, 'timed samples').toBeGreaterThan(5)
    expect(perDetection, 'estimate cost per detection (ms)').toBeLessThan(MAX_MS_PER_DETECTION)
  })
})
