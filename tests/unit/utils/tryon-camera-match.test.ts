import { describe, expect, it } from 'vitest'
import {
  GRAIN_AT_NEUTRAL,
  GRAIN_RANGE,
  LIGHT_WRAP_STRENGTH,
  grainAmount,
  grainHash,
  lightWrapAt,
  lightWrapColor,
  patchCameraMatchShader
} from '../../../src/runtime/utils/tryon-camera-match'
import { NEUTRAL_LUMA } from '../../../src/runtime/utils/tryon-lighting'

describe('grainAmount', () => {
  it('is the neutral amount in a neutral room or unsampled', () => {
    expect(grainAmount(NEUTRAL_LUMA)).toBeCloseTo(GRAIN_AT_NEUTRAL, 9)
    expect(grainAmount(null)).toBe(GRAIN_AT_NEUTRAL)
  })

  it('grows in dim rooms, with 1/√luma, within bounds', () => {
    expect(grainAmount(NEUTRAL_LUMA / 4)).toBeCloseTo(GRAIN_AT_NEUTRAL * 2, 9)
    expect(grainAmount(0.001)).toBe(GRAIN_RANGE.max)
    expect(grainAmount(1)).toBeGreaterThanOrEqual(GRAIN_RANGE.min)
    expect(grainAmount(1)).toBeLessThan(GRAIN_AT_NEUTRAL)
  })
})

describe('light wrap', () => {
  it('is zero face-on and full at the silhouette', () => {
    expect(lightWrapAt(1)).toBe(0)
    expect(lightWrapAt(0)).toBe(LIGHT_WRAP_STRENGTH)
    expect(lightWrapAt(-0.5)).toBe(lightWrapAt(0.5))
  })

  it('takes the room hue at its brightness', () => {
    expect(lightWrapColor([1, 0.5, 0.25], 0.5)).toEqual({ r: 0.6, g: 0.3, b: 0.15 })
    expect(lightWrapColor([1, 1, 1], null).r).toBeCloseTo(0.6, 9)
    expect(lightWrapColor([1, 1, 1], 2).r).toBe(1)
  })
})

describe('grainHash', () => {
  it('stays in [0, 1) and changes with the seed', () => {
    let changed = 0
    for (let x = 0; x < 50; x++) {
      const a = grainHash(x, 3, 1)
      const b = grainHash(x, 3, 2.618)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
      if (Math.abs(a - b) > 1e-6) changed++
    }
    expect(changed).toBeGreaterThan(45)
  })
})

describe('patchCameraMatchShader', () => {
  it('declares the uniforms and applies wrap then grain before dithering', () => {
    const patched = patchCameraMatchShader('void main() {\n  #include <dithering_fragment>\n}')
    expect(patched).toMatch(/uniform float uCameraGrain;[\s\S]*void main\(\)/)
    expect(patched).toMatch(/cameraRim[\s\S]*cameraGrainHash\( gl_FragCoord.xy \)[\s\S]*#include <dithering_fragment>/)
  })
})
