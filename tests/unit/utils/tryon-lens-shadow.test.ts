import { describe, expect, it } from 'vitest'
import {
  lensTransmission,
  shadowCasterFilter,
  tintedShadowComposite,
  tintedShadowMultiply
} from '../../../src/runtime/utils/tryon-lens-shadow'

describe('lensTransmission', () => {
  it('keeps the hue and drops the darkness', () => {
    expect(lensTransmission([0.4, 0.2, 0.1])).toEqual([1, 0.5, 0.25])
  })

  it('is neutral without a tint, or for black', () => {
    expect(lensTransmission(null)).toEqual([1, 1, 1])
    expect(lensTransmission([0, 0, 0])).toEqual([1, 1, 1])
  })
})

describe('tintedShadowMultiply', () => {
  it('darkens every channel alike under the frame', () => {
    expect(tintedShadowMultiply(0.6, 1, 0, [1, 0.5, 0.25])).toEqual([0.6, 0.6, 0.6])
  })

  it('colours the lens shadow toward the lens hue', () => {
    const [r, g, b] = tintedShadowMultiply(1, 1, 0.8, [0.4, 1, 0.4])
    expect(g).toBe(1)
    expect(r).toBeCloseTo(0.52, 9)
    expect(b).toBeCloseTo(0.52, 9)
  })

  it('stacks frame shadow, occlusion and lens shadow', () => {
    const [r] = tintedShadowMultiply(0.5, 0.8, 0.5, [0, 1, 1])
    expect(r).toBeCloseTo(0.5 * 0.8 * 0.5, 9)
  })
})

describe('tintedShadowComposite', () => {
  // The browser composites the canvas premultiplied over the video:
  // result = rgb·alpha + video·(1 − alpha).
  const composite = (video: [number, number, number], m: [number, number, number]) => {
    const { rgb, alpha } = tintedShadowComposite(video, m)
    return rgb.map((c, i) => c * alpha + video[i]! * (1 - alpha))
  }

  it('reproduces video × multiply when the sample matches the video', () => {
    const video: [number, number, number] = [0.8, 0.6, 0.5]
    const m: [number, number, number] = [0.52, 1, 0.52]
    composite(video, m).forEach((c, i) => expect(c).toBeCloseTo(video[i]! * m[i]!, 9))
  })

  it('darkens by alpha alone for a neutral shadow (no video needed)', () => {
    const { rgb, alpha } = tintedShadowComposite([0.9, 0.1, 0.4], [0.7, 0.7, 0.7])
    expect(alpha).toBeCloseTo(0.3, 9)
    expect(rgb).toEqual([0, 0, 0])
  })

  it('keeps a stale video sample to the colour residual', () => {
    // The texture is a frame behind: off by 10 % everywhere. The error is
    // only in the residual, a fraction of the 10 %.
    const video: [number, number, number] = [0.8, 0.6, 0.5]
    const stale: [number, number, number] = [0.72, 0.54, 0.45]
    const m: [number, number, number] = [0.6, 0.75, 0.6]
    const { rgb, alpha } = tintedShadowComposite(stale, m)
    const result = rgb.map((c, i) => c * alpha + video[i]! * (1 - alpha))
    result.forEach((c, i) => expect(Math.abs(c - video[i]! * m[i]!)).toBeLessThan(0.01))
  })
})

describe('shadowCasterFilter', () => {
  const lensCamera = {}
  const frameCamera = {}

  it('keeps a lens out of the frame light map, and restores the material', () => {
    const filter = shadowCasterFilter(true, () => lensCamera)
    const depth = { colorWrite: true, depthWrite: true }
    filter.onBeforeShadow(null, null, null, frameCamera, null, depth)
    expect(depth).toEqual({ colorWrite: false, depthWrite: false })
    filter.onAfterShadow(null, null, null, frameCamera, null, depth)
    expect(depth).toEqual({ colorWrite: true, depthWrite: true })
    filter.onBeforeShadow(null, null, null, lensCamera, null, depth)
    expect(depth).toEqual({ colorWrite: true, depthWrite: true })
  })

  it('keeps a frame part out of the lens light map', () => {
    const filter = shadowCasterFilter(false, () => lensCamera)
    const depth = { colorWrite: true, depthWrite: true }
    filter.onBeforeShadow(null, null, null, lensCamera, null, depth)
    expect(depth.colorWrite).toBe(false)
    filter.onAfterShadow(null, null, null, lensCamera, null, depth)
    filter.onBeforeShadow(null, null, null, frameCamera, null, depth)
    expect(depth.colorWrite).toBe(true)
  })
})
