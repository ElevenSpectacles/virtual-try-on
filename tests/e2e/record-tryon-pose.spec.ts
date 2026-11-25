import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from './camera-test'
import { FACE_FIXTURES, faceClip, missingPrerequisite } from './fixtures'
import { waitForSettledPose, type HarnessResult } from './tracking-harness'

const FACE = (process.env.RECORD_FACE ?? FACE_FIXTURES[0]) as (typeof FACE_FIXTURES)[number]
const NAME = process.env.RECORD_NAME ?? FACE
const CLIP = process.env.RECORD_CLIP ?? ''
const OUT_DIR = fileURLToPath(new URL('../fixtures/tryon-pose', import.meta.url))

const skipReason = !process.env.RECORD_TRYON_POSE
  ? 'RECORD_TRYON_POSE not set'
  : missingPrerequisite()

interface HarnessSnapshotHost {
  __tryOnHarness: { results: HarnessResult[]; snapshot: () => unknown }
}

test.describe('record tryon pose', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({
    clip: skipReason ? '' : (CLIP || faceClip(FACE, 'still')),
    gl: (process.env.RECORD_GL ?? 'swiftshader') as 'hardware' | 'swiftshader'
  })
  test.setTimeout(300_000)

  test(`record ${NAME}`, async ({ cameraPage: page }) => {
    await page.goto(`/?model=${FACE}&harness=true`)
    await page.waitForFunction(() => '__tryOnHarness' in window)
    await page.getByRole('button', { name: 'Allow camera access' }).click()
    await page.waitForFunction(
      () => (window as unknown as HarnessSnapshotHost).__tryOnHarness.results.some((r) => r.landmarks.length > 0),
      null,
      { timeout: 120_000 }
    )
    await waitForSettledPose(page)

    const snapshot = await page.evaluate(
      () => (window as unknown as HarnessSnapshotHost).__tryOnHarness.snapshot()
    )
    expect(snapshot, 'snapshot has a tracked occluder mesh').toHaveProperty('occluderPositions')
    expect((snapshot as { occluderPositions: unknown }).occluderPositions, 'occluder mesh present').not.toBeNull()

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(`${OUT_DIR}/${NAME}.json`, `${JSON.stringify({ face: FACE, ...snapshot }, null, 2)}\n`)
  })
})
