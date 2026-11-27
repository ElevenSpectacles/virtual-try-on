import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { expect, test } from './camera-test'
import { FACE_FIXTURES, MODELS_DIR, faceClip, missingPrerequisite } from './fixtures'
import { runTracking, type HarnessResult } from './tracking-harness'
import {
  compensateMeasureForPose,
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  IRIS_CENTER_LEFT,
  IRIS_CENTER_RIGHT
} from '../../src/runtime/utils/tryon'
import { parseCalibrationFile } from '../../scripts/lib/calibration'
import {
  FIT_DEFAULT_TOLERANCE,
  FIT_IDEAL_RATIO,
  estimateFaceWidthMm,
  faceWidthVerdict
} from '../../src/runtime/utils/tryon-fit'

async function calibratedFrameWidthMm(model: string): Promise<number> {
  const calibrationPath = join(MODELS_DIR, 'calibration.json')
  const entry = existsSync(calibrationPath)
    ? parseCalibrationFile(JSON.parse(readFileSync(calibrationPath, 'utf8')) as unknown).models[model]
    : undefined
  if (entry?.frameWidthMm) return entry.frameWidthMm
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })
  const root = (await io.read(join(MODELS_DIR, `${model}.glb`))).getRoot()
  const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0]!)
  return (max[0] - min[0]) * (entry?.scale ?? 1) * 1000
}

const CLIP_ASPECT = 480 / 640

const skipReason = missingPrerequisite()

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function faceWidthMm(result: HarnessResult): number {
  const lm = result.landmarks
  const dist = (a: number, b: number) =>
    Math.hypot(lm[a]![0] - lm[b]![0], (lm[a]![1] - lm[b]![1]) / CLIP_ASPECT)
  if (lm.length <= IRIS_CENTER_LEFT) return 0
  const yaw = ((result.pose?.yaw ?? 0) * Math.PI) / 180
  const pitch = ((result.pose?.pitch ?? 0) * Math.PI) / 180
  const roll = ((result.pose?.roll ?? 0) * Math.PI) / 180
  return estimateFaceWidthMm(
    compensateMeasureForPose(dist(EAR_LEVEL_RIGHT, EAR_LEVEL_LEFT), yaw, pitch, roll),
    compensateMeasureForPose(dist(IRIS_CENTER_RIGHT, IRIS_CENTER_LEFT), yaw, pitch, roll)
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
      const frameMm = await calibratedFrameWidthMm(face)
      const ratio = frameMm / faceMm
      const verdict = faceWidthVerdict(faceMm, frameMm)
      testInfo.annotations.push({
        type: 'metrics',
        description: `face ${faceMm.toFixed(1)} mm · frame ${frameMm.toFixed(1)} mm · frame/face ${ratio.toFixed(3)} · ${verdict}`
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
    await expect(badge).toContainText('frame 141 mm')
  })
})
