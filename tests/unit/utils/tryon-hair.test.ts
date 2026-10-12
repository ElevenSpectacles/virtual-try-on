import { describe, expect, it } from 'vitest'
import {
  HAIR_BUDGET_MIN_SAMPLES,
  HAIR_SEGMENT_BUDGET_MS,
  HAIR_TIMING_WARMUP,
  blendMask,
  downsampleConfidence,
  maskCoverage,
  overSegmentBudget,
  screenToMedia,
  updateSegmentTiming,
  type SegmentTiming
} from '../../../src/runtime/utils/tryon-hair'
import { mapLandmarkToObjectCover, objectCoverWindow } from '../../../src/runtime/utils/tryon'

const FULL = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }

describe('screenToMedia', () => {
  it('mirrors x on the full frame', () => {
    expect(screenToMedia(0, 0, FULL)).toEqual({ x: 1, y: 0 })
    expect(screenToMedia(1, 1, FULL)).toEqual({ x: 0, y: 1 })
    expect(screenToMedia(0.25, 0.5, FULL)).toEqual({ x: 0.75, y: 0.5 })
  })

  it('stays inside the cover-cropped window', () => {
    // A 16:9 camera in a 3:4 stage: left/right cropped.
    const window = objectCoverWindow(16 / 9, 3 / 4)
    const left = screenToMedia(0, 0.5, window)
    const right = screenToMedia(1, 0.5, window)
    expect(left.x).toBeCloseTo(window.xMax)
    expect(right.x).toBeCloseTo(window.xMin)
  })

  it('is the inverse of the landmark mapping (cover remap + mirror)', () => {
    const window = objectCoverWindow(16 / 9, 3 / 4)
    const landmark = { x: 0.55, y: 0.4 }
    // A landmark lands on screen at x = 1 - coverX (mirror), y = coverY.
    const cover = mapLandmarkToObjectCover(landmark, window)
    const media = screenToMedia(1 - cover.x, cover.y, window)
    expect(media.x).toBeCloseTo(landmark.x)
    expect(media.y).toBeCloseTo(landmark.y)
  })
})

describe('downsampleConfidence', () => {
  it('box-averages to bytes', () => {
    // 4×2 → 2×1: left half 0 and 1 (mean 0.5), right half all 1.
    const mask = downsampleConfidence([0, 1, 1, 1, 1, 0, 1, 1], 4, 2, 2, 1)
    expect(Array.from(mask)).toEqual([128, 255])
  })

  it('clamps out-of-range confidences', () => {
    expect(Array.from(downsampleConfidence([-1, 2], 2, 1, 2, 1))).toEqual([0, 255])
  })

  it('handles upsampling (each output pixel reads at least one input pixel)', () => {
    expect(Array.from(downsampleConfidence([1], 1, 1, 2, 2))).toEqual([255, 255, 255, 255])
  })
})

describe('blendMask', () => {
  it('starts from a copy of the first mask', () => {
    const next = new Uint8Array([10, 20])
    const blended = blendMask(null, next)
    expect(Array.from(blended)).toEqual([10, 20])
    expect(blended).not.toBe(next)
  })

  it('moves halfway toward the new mask by default', () => {
    const blended = blendMask(new Uint8Array([0, 200]), new Uint8Array([200, 0]))
    expect(Array.from(blended)).toEqual([100, 100])
  })

  it('restarts when the size changes', () => {
    expect(Array.from(blendMask(new Uint8Array([0]), new Uint8Array([9, 9])))).toEqual([9, 9])
  })
})

describe('maskCoverage', () => {
  it('counts pixels at or above half confidence', () => {
    expect(maskCoverage(new Uint8Array([0, 127, 128, 255]))).toBe(0.5)
    expect(maskCoverage(new Uint8Array())).toBe(0)
  })
})

describe('segment budget', () => {
  it('leaves the warm-up segmentations out of the mean', () => {
    let timing: SegmentTiming | null = null
    timing = updateSegmentTiming(timing, 260)
    for (let i = 1; i < HAIR_TIMING_WARMUP; i++) timing = updateSegmentTiming(timing, 40)
    expect(timing!.meanMs).toBeNull()
    for (let i = 0; i < 20; i++) timing = updateSegmentTiming(timing, 14)
    expect(timing!.meanMs).toBeCloseTo(14)
    expect(overSegmentBudget(timing)).toBe(false)
  })

  it('needs enough samples before switching off', () => {
    let timing: SegmentTiming | null = null
    for (let i = 0; i < HAIR_TIMING_WARMUP; i++) timing = updateSegmentTiming(timing, 1)
    for (let i = 0; i < HAIR_BUDGET_MIN_SAMPLES - 1; i++) {
      timing = updateSegmentTiming(timing, HAIR_SEGMENT_BUDGET_MS * 3)
    }
    expect(overSegmentBudget(timing)).toBe(false)
    timing = updateSegmentTiming(timing, HAIR_SEGMENT_BUDGET_MS * 3)
    expect(overSegmentBudget(timing)).toBe(true)
  })

  it('tolerates a single slow segmentation', () => {
    let timing: SegmentTiming | null = null
    for (let i = 0; i < 20 + HAIR_TIMING_WARMUP; i++) timing = updateSegmentTiming(timing, 8)
    timing = updateSegmentTiming(timing, 60)
    expect(overSegmentBudget(timing)).toBe(false)
  })
})
