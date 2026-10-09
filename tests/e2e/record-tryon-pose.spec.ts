import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from './camera-test'
import { FACE_FIXTURES, faceClip, missingPrerequisite } from './fixtures'
import type { HarnessResult } from './tracking-harness'

/**
 * Records one settled frame of the prototype's scene inputs for the fixed-pose
 * render (tests/e2e/tryon-pose-scene.spec.ts). Writes
 * tests/fixtures/tryon-pose/<face>.json. Does nothing unless
 * RECORD_TRYON_POSE=1, so it never runs in a normal verify.
 *
 * Re-record after changing the tracker, the occluder or the frame layout:
 * the fixture is a snapshot of how those produce one frame.
 */

// RECORD_FACE picks the fixture (default: the first face fixture).
const FACE = (process.env.RECORD_FACE ?? FACE_FIXTURES[0]) as (typeof FACE_FIXTURES)[number]
// RECORD_NAME names the fixture file (default: the face). RECORD_CLIP replaces the
// portrait clip with a Y4M, e.g. a UPNA video; the fixture keeps the frame model.
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
  // RECORD_GL=hardware is needed for longer clips: SwiftShader is too slow for
  // MediaPipe to find the first face in a 10 s UPNA clip. The saved values are
  // tracker output, so the GL backend does not change the fixture.
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
    // Let the smoothing settle on the still face before taking the frame.
    await page.waitForTimeout(25_000)

    const snapshot = await page.evaluate(
      () => (window as unknown as HarnessSnapshotHost).__tryOnHarness.snapshot()
    )
    expect(snapshot, 'snapshot has a tracked occluder mesh').toHaveProperty('occluderPositions')
    expect((snapshot as { occluderPositions: unknown }).occluderPositions, 'occluder mesh present').not.toBeNull()

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(`${OUT_DIR}/${NAME}.json`, `${JSON.stringify({ face: FACE, ...snapshot }, null, 2)}\n`)
  })
})
