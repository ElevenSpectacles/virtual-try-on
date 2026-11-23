import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from './camera-test'
import { VIDEO_CLIP, missingPrerequisite } from './fixtures'
import { runTracking, type HarnessResult } from './tracking-harness'
import {
  compareAxis,
  parseGroundTruth,
  resampleToFrames,
  type AxisComparison,
  type TimedValue
} from './pose-metrics'

const GT_PATH = process.env.TRYON_UPNA_GT ?? ''
const MODEL = 'iris-moss'
const CLIP_FPS = 30
const CLIP_MS = 9_000
const MIN_MOTION_CORRELATION = 0.8
const MAX_SHAPE_RMS_DEG = 3
const AMPLITUDE_SLOPE_RANGE: [number, number] = [0.7, 1.3]

const gtSkip = !GT_PATH
  ? 'TRYON_UPNA_GT not set'
  : !existsSync(GT_PATH)
    ? `no ground truth at ${GT_PATH}`
    : null
const clipSkip = !VIDEO_CLIP
  ? 'TRYON_VIDEO_CLIP not set'
  : !existsSync(VIDEO_CLIP)
    ? `no clip at ${VIDEO_CLIP}`
    : null
const skipReason = missingPrerequisite() ?? clipSkip ?? gtSkip

function describeAxis(name: string, c: AxisComparison | null): string {
  if (!c) return `${name}: too few overlapping frames`
  return (
    `${name}: r ${c.r.toFixed(3)} · lag ${c.lag} f · ` +
    `slope ${c.slope.toFixed(2)} · rms ${c.rmsDeg.toFixed(1)}° · ${c.pairs} frames`
  )
}

test.describe('UPNA head-pose accuracy', () => {
  test.skip(!!skipReason, skipReason ?? '')
  test.use({ clip: skipReason ? '' : VIDEO_CLIP })

  test('tracked yaw/pitch/roll follow the ground truth', async ({ cameraPage: page }, testInfo) => {
    const { results } = await runTracking(page, MODEL, CLIP_MS)
    const truth = parseGroundTruth(readFileSync(GT_PATH, 'utf8'))

    const tracked = results.filter((r): r is HarnessResult & { pose: NonNullable<HarnessResult['pose']> } =>
      !!r.pose
    )
    expect(tracked.length, 'tracker returned poses').toBeGreaterThan(30)

    const t0 = results[0]!.at
    const series = (axis: 'yaw' | 'pitch' | 'roll'): TimedValue[] =>
      tracked.map((r) => ({ atMs: r.at, value: r.pose[axis] }))
    const frames = (axis: 'yaw' | 'pitch' | 'roll') =>
      resampleToFrames(series(axis), t0, CLIP_FPS, Math.round((CLIP_MS / 1000) * CLIP_FPS))

    const comparisons = {
      yaw: compareAxis(frames('yaw'), truth.yaw),
      pitch: compareAxis(frames('pitch'), truth.pitch),
      roll: compareAxis(frames('roll'), truth.roll)
    }

    const range = (values: number[]) => Math.max(...values) - Math.min(...values)
    const motion = (['yaw', 'pitch', 'roll'] as const).reduce((best, axis) =>
      range(truth[axis]) > range(truth[best]) ? axis : best
    )

    const lines = (['yaw', 'pitch', 'roll'] as const).map((axis) =>
      `${axis === motion ? '*' : ' '} ${describeAxis(axis, comparisons[axis])}`
    )
    testInfo.annotations.push({ type: 'metrics', description: lines.join(' | ') })
    console.log(`  UPNA pose (* = motion axis):\n${lines.map((l) => `    ${l}`).join('\n')}`)

    const motionComparison = comparisons[motion]
    expect(motionComparison, `motion axis ${motion} compared`).not.toBeNull()
    expect(
      Math.abs(motionComparison!.r),
      `${motion} correlation with ground truth`
    ).toBeGreaterThanOrEqual(MIN_MOTION_CORRELATION)
    expect(motionComparison!.rmsDeg, `${motion} shape error (deg)`).toBeLessThanOrEqual(
      MAX_SHAPE_RMS_DEG
    )
    expect(
      Math.abs(motionComparison!.slope),
      `${motion} amplitude vs ground truth`
    ).toBeGreaterThanOrEqual(AMPLITUDE_SLOPE_RANGE[0])
    expect(Math.abs(motionComparison!.slope)).toBeLessThanOrEqual(AMPLITUDE_SLOPE_RANGE[1])
  })
})
