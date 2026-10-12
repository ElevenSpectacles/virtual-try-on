import { expect, test, type Page } from './camera-test'
import { faceClip, fakeCameraArgs, missingPrerequisite } from './fixtures'
import { HAIR_SEGMENT_BUDGET_MS } from '../../src/runtime/utils/tryon-hair'

/**
 * Hair occlusion (#9).
 *
 * Live, on the shipped component (real GPU, face-fixture clip, tier pinned
 * to `high`, the feature's minimum):
 * - the segmenter, started on the first tracked face, finds the hair in a
 *   portrait at its cadence and inside its time budget;
 * - tracking keeps its latency and the render loop its frame rate with the
 *   segmenter running (metrics event, hair on vs off).
 *
 * The positive case (a hair band hiding the arm) is checked on frozen frames
 * in hair-scene.spec.ts: the face fixtures have no hair over an arm.
 */

const FACE = 'iris-moss'
/** Hair share of the frame the portrait's mask must reach (the photo shows a lot of hair). */
const MIN_HAIR_COVERAGE = 0.1
/** Detection latency the segmenter may add on average, ms. */
const MAX_ADDED_LATENCY_MS = 10
/** Share of the render frame rate the segmenter may cost. */
const MAX_FPS_LOSS = 0.15

const skipReason = missingPrerequisite()

async function startCamera(page: Page, query: string) {
  await page.goto(`/?view=experience&model=${FACE}&tier=high&${query}`)
  await page.waitForFunction(
    () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
  )
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeHidden()
}

test.describe('hair occlusion, live', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : faceClip(FACE, 'still') })
  test.setTimeout(240_000)

  test('the segmenter finds the hair within its budget', async ({ cameraPage: page }, testInfo) => {
    await startCamera(page, 'hair=on')
    const state = page.locator('[data-hair]')
    await expect(state).toBeVisible({ timeout: 60_000 })
    // Model download, warm-up, then a few seconds of masks.
    await expect
      .poll(async () => Number(await state.getAttribute('data-masks')), { timeout: 60_000 })
      .toBeGreaterThan(5)
    const startMasks = Number(await state.getAttribute('data-masks'))
    await page.waitForTimeout(3_000)
    const read = async (name: string) => (await state.getAttribute(name)) ?? ''
    const masks = Number(await read('data-masks')) - startMasks
    const coverage = Number(await read('data-coverage'))
    const segmentMs = Number(await read('data-segment-ms'))
    const line =
      `${masks} masks in 3 s · hair coverage ${(coverage * 100).toFixed(1)}% · ` +
      `segmentation ${segmentMs.toFixed(1)} ms (worker, mean after warm-up)`
    testInfo.annotations.push({ type: 'metrics', description: line })
    console.log(`  ${line}`)

    expect(await read('data-error'), 'segmenter error').toBe('')
    expect(await read('data-active'), 'still running').toBe('true')
    expect(coverage, 'hair share of the portrait').toBeGreaterThanOrEqual(MIN_HAIR_COVERAGE)
    expect(segmentMs, 'segmentation time').toBeLessThan(HAIR_SEGMENT_BUDGET_MS)
    // At most one per HAIR_SEGMENT_INTERVAL_MS (100 ms): ≤ 30 in 3 s, plus timing slack.
    expect(masks, 'segmentation cadence').toBeLessThanOrEqual(32)
    expect(masks, 'segmentations running').toBeGreaterThan(10)
  })

  test('tracking keeps its latency and frame rate with the segmenter on', async ({ playwright, baseURL }, testInfo) => {
    const session = async (hair: 'on' | 'off') => {
      const browser = await playwright.chromium.launch({
        args: fakeCameraArgs(faceClip(FACE, 'still'), 'hardware')
      })
      try {
        const page = await (await browser.newContext({ baseURL, permissions: ['camera'] })).newPage()
        const reports: Record<string, unknown>[] = []
        page.on('console', (msg) => {
          if (msg.text().startsWith('[metrics] ')) reports.push(JSON.parse(msg.text().slice(10)))
        })
        await startCamera(page, `hair=${hair}&metrics=true`)
        if (hair === 'on') {
          await expect
            .poll(async () => Number(await page.locator('[data-hair]').getAttribute('data-masks')), {
              timeout: 60_000
            })
            .toBeGreaterThan(5)
        } else {
          await expect(page.locator('.vto-stage').getByText('Position your face in view')).toBeHidden({
            timeout: 60_000
          })
        }
        await page.waitForTimeout(6_000)
        await page.getByRole('button', { name: 'Stop camera' }).click()
        await expect.poll(() => reports.some((r) => r.final === true), { timeout: 10_000 }).toBe(true)
        return reports.find((r) => r.final === true)!
      } finally {
        await browser.close()
      }
    }
    const off = await session('off')
    const on = await session('on')
    const latency = (r: Record<string, unknown>) => r.detectLatencyMeanMs as number
    const fps = (r: Record<string, unknown>) => r.renderFpsMean as number
    const line =
      `detection latency ${latency(off).toFixed(1)} → ${latency(on).toFixed(1)} ms · ` +
      `render ${fps(off).toFixed(1)} → ${fps(on).toFixed(1)} fps · ` +
      `features ${JSON.stringify(on.features)}`
    testInfo.annotations.push({ type: 'metrics', description: line })
    console.log(`  ${line}`)

    expect((on.features as Record<string, boolean>).hairOcclusion, 'hair ran').toBe(true)
    expect(latency(on) - latency(off), 'added detection latency (ms)').toBeLessThan(MAX_ADDED_LATENCY_MS)
    expect(fps(on), 'render fps with hair').toBeGreaterThan(fps(off) * (1 - MAX_FPS_LOSS))
  })
})
