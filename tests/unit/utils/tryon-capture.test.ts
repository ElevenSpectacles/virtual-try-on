import { describe, expect, it } from 'vitest'
import {
  CAPTURE_DEFAULT_QUALITY,
  captureLayout,
  captureQuality
} from '../../../src/runtime/utils/tryon-capture'

describe('captureLayout', () => {
  it('crops a landscape camera to a portrait stage, centred', () => {
    // 1280×720 into a 3:4 stage: cover keeps the full height, 540 px wide.
    const layout = captureLayout(1280, 720, 360, 480)!
    expect(layout.source.height).toBe(720)
    expect(layout.source.width).toBeCloseTo(540, 6)
    expect(layout.source.x).toBeCloseTo((1280 - 540) / 2, 6)
    expect(layout.source.y).toBe(0)
    // Camera resolution across the window, stage aspect.
    expect(layout.width).toBe(540)
    expect(layout.height).toBe(720)
  })

  it('crops top and bottom when the camera is taller than the stage', () => {
    const layout = captureLayout(720, 1280, 400, 400)!
    expect(layout.source.width).toBe(720)
    expect(layout.source.height).toBeCloseTo(720, 6)
    expect(layout.source.y).toBeCloseTo(280, 6)
    expect(layout.width).toBe(720)
    expect(layout.height).toBe(720)
  })

  it('keeps the whole frame when the aspects match', () => {
    const layout = captureLayout(640, 480, 800, 600)!
    expect(layout.source).toEqual({ x: 0, y: 0, width: 640, height: 480 })
    expect([layout.width, layout.height]).toEqual([640, 480])
  })

  it('caps the width and keeps the stage aspect', () => {
    const layout = captureLayout(1920, 1080, 300, 400, 300)!
    expect(layout.width).toBe(300)
    expect(layout.height).toBe(400)
  })

  it('never upscales past the camera resolution', () => {
    expect(captureLayout(640, 480, 300, 400, 4000)!.width).toBe(360)
  })

  it('is null while a size is unknown', () => {
    expect(captureLayout(0, 0, 300, 400)).toBeNull()
    expect(captureLayout(640, 480, 0, 400)).toBeNull()
  })
})

describe('captureQuality', () => {
  it('clamps to 0 … 1 and defaults when absent', () => {
    expect(captureQuality(undefined)).toBe(CAPTURE_DEFAULT_QUALITY)
    expect(captureQuality(Number.NaN)).toBe(CAPTURE_DEFAULT_QUALITY)
    expect(captureQuality(1.5)).toBe(1)
    expect(captureQuality(0.5)).toBe(0.5)
  })
})
