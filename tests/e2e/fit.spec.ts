import { expect, test } from './camera-test'
import { FACE_FIXTURES, faceClip, missingPrerequisite } from './fixtures'
import { runTracking, type HarnessResult } from './tracking-harness'
import {
  compensateMeasureForPose,
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  IRIS_CENTER_LEFT,
  IRIS_CENTER_RIGHT
} from '../../src/runtime/utils/tryon'
import {
  FIT_DEFAULT_TOLERANCE,
  FIT_IDEAL_RATIO,
  estimateFaceWidthMm,
  faceWidthVerdict
} from '../../src/runtime/utils/tryon-fit'

/**
 * Fit verdict on real tracking (issue #12): each face fixture is a person
 * wearing that catalog frame, which fits them, so the verdict should be
 * "good". Also the measurement FIT_IDEAL_RATIO was fitted on: the logged
 * frame/face ratio per fixture.
 *
 * Frame widths are the GLBs' bounding-box widths (calibration scale is 1 or
 * within 3% for these models), measured with gltf-transform.
 */
const FRAME_WIDTH_MM: Record<string, number> = {
  'iris-moss': 139.7,
  'pteron-azure': 139.7,
  'kairos-amber': 135.0
}

const skipReason = missingPrerequisite()

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function faceWidthMm(result: HarnessResult): number {
  const lm = result.landmarks
  const dist = (a: number, b: number) =>
    Math.hypot(lm[a]![0] - lm[b]![0], lm[a]![1] - lm[b]![1])
  if (lm.length <= IRIS_CENTER_LEFT) return 0
  const yaw = ((result.pose?.yaw ?? 0) * Math.PI) / 180
  const pitch = ((result.pose?.pitch ?? 0) * Math.PI) / 180
  return estimateFaceWidthMm(
    compensateMeasureForPose(dist(EAR_LEVEL_RIGHT, EAR_LEVEL_LEFT), yaw, pitch),
    compensateMeasureForPose(dist(IRIS_CENTER_RIGHT, IRIS_CENTER_LEFT), yaw, pitch)
  )
}

for (const face of FACE_FIXTURES) {
  test.describe(`fit · ${face}`, () => {
    test.skip(!!skipReason, skipReason ?? '')
    test.use({ clip: skipReason ? '' : faceClip(face, 'still') })

    test('a frame the wearer fits reads as a good fit', async ({ cameraPage: page }, testInfo) => {
      const { results } = await runTracking(page, face, 3_000)
      const widths = results.map(faceWidthMm).filter((w) => w > 0)
      expect(widths.length, 'tracked results with iris landmarks').toBeGreaterThan(10)

      const faceMm = median(widths)
      const frameMm = FRAME_WIDTH_MM[face]!
      const ratio = frameMm / faceMm
      const verdict = faceWidthVerdict(faceMm, frameMm)
      testInfo.annotations.push({
        type: 'metrics',
        description: `face ${faceMm.toFixed(1)} mm · frame ${frameMm} mm · frame/face ${ratio.toFixed(3)} · ${verdict}`
      })
      console.log(`  ${face}: ${testInfo.annotations.at(-1)!.description}`)

      expect(Math.abs(ratio / FIT_IDEAL_RATIO - 1)).toBeLessThan(FIT_DEFAULT_TOLERANCE)
      expect(verdict).toBe('good')
    })
  })
}

test.describe('fit · shipped component', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : faceClip('pteron-azure', 'still') })

  test('exposes the verdict on its slot', async ({ cameraPage: page }) => {
    await page.goto('/?view=experience&fit=true&model=pteron-azure')
    await page.waitForFunction(
      () => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__
    )
    await page.getByRole('button', { name: 'Start camera' }).click()
    const badge = page.locator('[data-fit]')
    await expect(badge).toBeVisible({ timeout: 60_000 })
    await expect(badge).toHaveAttribute('data-fit', 'good')
    // GLB width 139.7 mm times pteron-azure's calibration scale (1.012).
    await expect(badge).toContainText('frame 141 mm')
  })
})
