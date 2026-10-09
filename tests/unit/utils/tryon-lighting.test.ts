import { describe, it, expect } from 'vitest'
import {
  LIGHT_GAIN_RANGE,
  estimateFrameLighting,
  lightingColor,
  lightingGain,
  smoothFrameLighting
} from '../../../src/runtime/utils/tryon-lighting'

/** RGBA buffer filled with one colour. */
function solid(r: number, g: number, b: number, pixels: number) {
  const data = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    data.set([r, g, b, 255], i * 4)
  }
  return data
}

describe('estimateFrameLighting', () => {
  it('reads a white frame as full luma with a neutral tint', () => {
    const { luma, tint } = estimateFrameLighting(solid(255, 255, 255, 16), 4, 4)
    expect(luma).toBeCloseTo(1)
    expect(tint).toEqual([1, 1, 1])
  })

  it('reads a black frame as zero luma', () => {
    const { luma } = estimateFrameLighting(solid(0, 0, 0, 16), 4, 4)
    expect(luma).toBe(0)
  })

  it('reads a mid-grey frame as about half luma', () => {
    const { luma } = estimateFrameLighting(solid(128, 128, 128, 16), 4, 4)
    expect(luma).toBeCloseTo(128 / 255)
  })

  it('reports the hue of a coloured frame, normalised to its brightest channel', () => {
    const { tint } = estimateFrameLighting(solid(255, 128, 0, 16), 4, 4)
    expect(tint[0]).toBeCloseTo(1)
    expect(tint[1]).toBeCloseTo(128 / 255)
    expect(tint[2]).toBeCloseTo(0)
  })

  it('weights luma by the BT.709 coefficients, so green counts most', () => {
    const red = estimateFrameLighting(solid(255, 0, 0, 16), 4, 4).luma
    const green = estimateFrameLighting(solid(0, 255, 0, 16), 4, 4).luma
    const blue = estimateFrameLighting(solid(0, 0, 255, 16), 4, 4).luma
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('averages a half-dark, half-bright frame', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) {
      const value = i < 8 ? 0 : 255
      data.set([value, value, value, 255], i * 4)
    }
    expect(estimateFrameLighting(data, 4, 4).luma).toBeCloseTo(0.5)
  })

  it('reads an empty buffer as dark with a white tint', () => {
    expect(estimateFrameLighting(new Uint8ClampedArray(0), 0, 0)).toEqual({
      luma: 0,
      tint: [1, 1, 1]
    })
  })

  it('treats an all-black frame as having no colour cast', () => {
    expect(estimateFrameLighting(solid(0, 0, 0, 16), 4, 4).tint).toEqual([1, 1, 1])
  })
})

describe('smoothFrameLighting', () => {
  const dim = { luma: 0.2, tint: [1, 1, 1] as [number, number, number] }
  const bright = { luma: 0.8, tint: [1, 0.5, 0.5] as [number, number, number] }

  it('takes the first estimate as-is', () => {
    expect(smoothFrameLighting(null, dim)).toEqual(dim)
  })

  it('moves toward the new estimate by alpha, not all at once', () => {
    const next = smoothFrameLighting(dim, bright, 0.1)
    expect(next.luma).toBeCloseTo(0.2 + 0.1 * (0.8 - 0.2))
    expect(next.tint[1]).toBeCloseTo(1 + 0.1 * (0.5 - 1))
  })

  it('does not flicker on a single outlier frame', () => {
    const settled = smoothFrameLighting(dim, dim, 0.1)
    const flicker = smoothFrameLighting(settled, bright, 0.1)
    expect(flicker.luma - settled.luma).toBeLessThan(0.1)
  })
})

describe('lightingGain', () => {
  it('is 1 for a neutral room', () => {
    expect(lightingGain(0.5)).toBeCloseTo(1)
  })

  it('dims the lights in a dark room, down to the floor', () => {
    expect(lightingGain(0.25)).toBeCloseTo(0.5)
    expect(lightingGain(0)).toBe(LIGHT_GAIN_RANGE.min)
  })

  it('brightens the lights in a bright room, up to the ceiling', () => {
    expect(lightingGain(0.75)).toBeCloseTo(1.5)
    expect(lightingGain(1)).toBe(LIGHT_GAIN_RANGE.max)
  })
})

describe('lightingColor', () => {
  it('is white for a neutral tint', () => {
    expect(lightingColor([1, 1, 1])).toEqual([1, 1, 1])
  })

  it('pulls a coloured tint halfway toward white', () => {
    expect(lightingColor([1, 0, 0])).toEqual([1, 0.5, 0.5])
  })
})
