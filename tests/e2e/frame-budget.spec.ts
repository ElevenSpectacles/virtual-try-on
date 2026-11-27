import { expect, test } from './camera-test'
import { faceClip, missingPrerequisite } from './fixtures'
import { percentile95, type TryOnTier } from '../../src/runtime/utils/tryon-capability'

const skipReason = !process.env.RECORD_FRAME_BUDGET
  ? 'RECORD_FRAME_BUDGET not set'
  : missingPrerequisite()

const TIERS: TryOnTier[] = ['low', 'mid', 'high']
const CPU_THROTTLE = [1, 4, 6]
const SETTLE_MS = 6_000
const SAMPLE_MS = 8_000

interface FrameHost {
  __frameDeltas: number[]
}

for (const gl of ['hardware', 'swiftshader'] as const) {
  test.describe(`frame budget · ${gl}`, () => {
    test.skip(!!skipReason, skipReason ?? '')
    test.use({ clip: skipReason ? '' : faceClip('iris-moss', 'still'), gl })
    test.setTimeout(600_000)

    for (const throttle of CPU_THROTTLE) {
      test(`cpu ×${throttle}`, async ({ cameraPage: page }) => {
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.setCPUThrottlingRate', { rate: throttle })
        for (const tier of TIERS) {
          const hair = tier === 'high' ? '&hair=on' : ''
          await page.goto(`/?view=experience&tier=${tier}${hair}`)
          await page.getByRole('button', { name: 'Start camera' }).click()
          const experience = page.locator('[data-experience]')
          await expect(experience).toHaveAttribute('data-has-face', 'true', { timeout: 120_000 })
          await expect(experience).toHaveAttribute('data-model-loaded', 'true', { timeout: 120_000 })
          await page.waitForTimeout(SETTLE_MS)
          const deltas = await page.evaluate(async (sampleMs) => {
            const host = window as unknown as FrameHost
            host.__frameDeltas = []
            let previous = 0
            await new Promise<void>((resolve) => {
              const end = performance.now() + sampleMs
              const tick = (now: number) => {
                if (previous) host.__frameDeltas.push(now - previous)
                previous = now
                if (now < end) requestAnimationFrame(tick)
                else resolve()
              }
              requestAnimationFrame(tick)
            })
            return host.__frameDeltas
          }, SAMPLE_MS)
          const sorted = [...deltas].sort((a, b) => a - b)
          const share = (ms: number) => deltas.filter((d) => d > ms).length / deltas.length
          console.log(
            `  [frame-budget] ${JSON.stringify({
              gl,
              throttle,
              tier,
              frames: deltas.length,
              p50: +sorted[Math.floor(sorted.length / 2)]!.toFixed(1),
              p95: +percentile95(deltas).toFixed(1),
              max: +sorted.at(-1)!.toFixed(1),
              over33: +share(33).toFixed(3),
              over34: +share(34).toFixed(3),
              over40: +share(40).toFixed(3)
            })}`
          )
          expect(deltas.length).toBeGreaterThan(0)
        }
      })
    }
  })
}
