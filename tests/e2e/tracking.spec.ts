import { expect, test } from './camera-test'
import {
  FACE_FIXTURES,
  faceClip,
  missingPrerequisite,
  type ClipKind
} from './fixtures'
import {
  MAX_STILL_JITTER_PX,
  MIN_DETECTION_RATE,
  detectionRate,
  medianJitterPx,
  p95,
  runTracking
} from './tracking-harness'

/**
 * Real tracking path — fake camera → worker MediaPipe → playground prototype —
 * asserted through the prototype's `?harness=true` hook (raw detector results
 * with landmarks in stage pixels).
 */

const skipReason = missingPrerequisite()

for (const face of FACE_FIXTURES) {
  for (const kind of ['still', 'motion'] as ClipKind[]) {
    test.describe(`${face} · ${kind}`, () => {
      test.skip(!!skipReason, skipReason ?? '')
      test.use({ clip: skipReason ? '' : faceClip(face, kind) })

      test('tracks the face', async ({ cameraPage: page }, testInfo) => {
        const { results, frameIntervals, latencyMs, blink } = await runTracking(
          page,
          face
        )
        const rate = detectionRate(results)
        const jitter = medianJitterPx(results)
        const frameP95 = p95(frameIntervals)

        // Logged, not asserted: headless GPU timing varies by machine.
        testInfo.annotations.push({
          type: 'metrics',
          description:
            `${results.length} results · detection ${(rate * 100).toFixed(1)}% · ` +
            `jitter ${jitter.toFixed(2)} px · frame p95 ${frameP95.toFixed(1)} ms · ` +
            `latency ${latencyMs.toFixed(0)} ms · blink ${blink?.toFixed(2) ?? 'n/a'}`
        })
        console.log(`  ${face} · ${kind}: ${testInfo.annotations.at(-1)!.description}`)

        expect(results.length, 'detector produced results').toBeGreaterThan(10)
        expect(rate, 'detection rate').toBeGreaterThanOrEqual(MIN_DETECTION_RATE)
        expect(blink, 'blendshape blink score').not.toBeNull()
        if (kind === 'still') {
          expect(jitter, 'still-input jitter (px)').toBeLessThanOrEqual(
            MAX_STILL_JITTER_PX
          )
        }
      })
    })
  }
}
