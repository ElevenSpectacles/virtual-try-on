import { describe, it, expect } from 'vitest'
import {
  compareAxis,
  parseGroundTruth,
  pearson,
  resampleToFrames
} from '../../e2e/pose-metrics'

/**
 * 300 frames of a sweep in degrees. Two sinusoids with incommensurate periods,
 * so no shifted or negated copy lines up with it: a pure sine aliases every
 * half period, and the lag search would pick the alias.
 */
const truth = Array.from(
  { length: 300 },
  (_, f) => 25 * Math.sin((2 * Math.PI * f) / 90) + 10 * Math.sin((2 * Math.PI * f) / 37)
)

describe('compareAxis', () => {
  it('finds the frame lag of a tracker that starts late', () => {
    const lag = 12
    const tracker = Array.from({ length: 200 }, (_, k) => truth[k + lag]!)
    const result = compareAxis(tracker, truth)
    expect(result?.lag).toBe(lag)
    expect(result?.r).toBeCloseTo(1, 5)
    expect(result?.rmsDeg).toBeLessThan(1e-6)
  })

  it('finds a start frame late in the loop, wrapping past the end', () => {
    const lag = 280
    const tracker = Array.from({ length: 200 }, (_, k) => truth[(k + lag) % truth.length]!)
    const result = compareAxis(tracker, truth)
    expect(result?.lag).toBe(lag)
    expect(result?.r).toBeCloseTo(1, 5)
  })

  it('reports a mirrored axis as a negative correlation, not a failure', () => {
    const tracker = Array.from({ length: 200 }, (_, k) => -truth[k]!)
    const result = compareAxis(tracker, truth)
    expect(result?.lag).toBe(0)
    expect(result?.r).toBeCloseTo(-1, 5)
  })

  it('scores a mirrored, half-amplitude tracker as a perfect shape match', () => {
    const tracker = Array.from({ length: 200 }, (_, k) => -0.5 * truth[k]!)
    const result = compareAxis(tracker, truth)
    expect(result?.r).toBeCloseTo(-1, 5)
    expect(result?.slope).toBeCloseTo(-0.5, 5)
    expect(result?.rmsDeg).toBeLessThan(1e-6)
  })

  it('ignores a constant offset between the two zeros', () => {
    const tracker = Array.from({ length: 200 }, (_, k) => truth[k]! + 40)
    const result = compareAxis(tracker, truth)
    expect(result?.r).toBeCloseTo(1, 5)
    expect(result?.rmsDeg).toBeLessThan(1e-6)
  })

  it('reports the error that remains when the tracker is noisy', () => {
    const tracker = Array.from({ length: 200 }, (_, k) => truth[k]! + (k % 2 === 0 ? 2 : -2))
    const result = compareAxis(tracker, truth)
    expect(result?.rmsDeg).toBeCloseTo(2, 1)
  })

  it('returns null when there are too few overlapping frames', () => {
    expect(compareAxis([1, 2, 3], truth)).toBeNull()
  })

  it('skips frames with no tracker sample', () => {
    const tracker: (number | null)[] = Array.from({ length: 200 }, (_, k) =>
      k % 5 === 0 ? null : truth[k]!
    )
    const result = compareAxis(tracker, truth)
    expect(result?.r).toBeCloseTo(1, 5)
    expect(result?.pairs).toBe(160)
  })
})

describe('pearson', () => {
  it('is zero for a constant series instead of NaN', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0)
  })
})

describe('resampleToFrames', () => {
  it('takes the nearest sample for each frame and nulls out gaps', () => {
    const samples = [
      { atMs: 0, value: 10 },
      { atMs: 33, value: 11 },
      { atMs: 500, value: 99 }
    ]
    const frames = resampleToFrames(samples, 0, 30, 20)
    expect(frames[0]).toBe(10)
    expect(frames[2]).toBe(11)
    expect(frames[10]).toBeNull()
  })
})

describe('parseGroundTruth', () => {
  it('reads Roll, Yaw and Pitch from the Tx Ty Tz Roll Yaw Pitch rows', () => {
    const text = ' 1 2 3  4.5  -6.5  7.5 \n 0 0 0 1 2 3\n'
    expect(parseGroundTruth(text)).toEqual({
      roll: [4.5, 1],
      yaw: [-6.5, 2],
      pitch: [7.5, 3]
    })
  })
})
