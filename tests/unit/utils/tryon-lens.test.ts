import { describe, expect, it } from 'vitest'
import {
  LENS_CATEGORY_TRANSMITTANCE,
  LENS_F0,
  densityFromCategory,
  densityFromTransmittance,
  gradientDensityAt,
  lensOpacityAt,
  parseHexColor,
  resolveLens,
  schlickFresnel
} from '../../../src/runtime/utils/tryon-lens'

describe('parseHexColor', () => {
  it('parses #rrggbb and rrggbb', () => {
    expect(parseHexColor('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(parseHexColor('00FF00')).toEqual([0, 1, 0])
  })

  it('rejects malformed colours', () => {
    expect(parseHexColor('#fff')).toBeNull()
    expect(parseHexColor('red')).toBeNull()
    expect(parseHexColor('#12345g')).toBeNull()
  })
})

describe('resolveLens', () => {
  it('keeps the authored lens without an entry', () => {
    expect(resolveLens(undefined)).toEqual({ tint: null, density: null, gradient: null })
  })

  it('clamps density to 0…1', () => {
    expect(resolveLens({ density: 1.4 }).density).toBe(1)
    expect(resolveLens({ density: -0.2 }).density).toBe(0)
  })

  it('drops malformed fields only', () => {
    expect(resolveLens({ tint: 'blue', density: 0.5 })).toEqual({ tint: null, density: 0.5, gradient: null })
    expect(resolveLens({ tint: '#000000', density: Number.NaN })).toEqual({
      tint: [0, 0, 0],
      density: null,
      gradient: null
    })
  })
})

describe('schlickFresnel', () => {
  it('reflects F0 head-on and everything at grazing', () => {
    expect(schlickFresnel(1)).toBeCloseTo(LENS_F0)
    expect(schlickFresnel(0)).toBeCloseTo(1)
  })

  it('rises monotonically toward grazing', () => {
    const values = [1, 0.8, 0.6, 0.4, 0.2, 0].map((c) => schlickFresnel(c))
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!)
  })
})

describe('lensOpacityAt', () => {
  it('is the authored opacity head-on', () => {
    expect(lensOpacityAt(0.55, 1)).toBeCloseTo(0.55)
  })

  it('reaches opaque at grazing and stays within 0…1', () => {
    expect(lensOpacityAt(0.55, 0)).toBeCloseTo(1)
    for (const c of [0, 0.25, 0.5, 0.75, 1]) {
      const o = lensOpacityAt(0.3, c)
      expect(o).toBeGreaterThanOrEqual(0.3)
      expect(o).toBeLessThanOrEqual(1)
    }
  })
})

describe('physical lens darkness', () => {
  it('turns a transmittance into a density', () => {
    expect(densityFromTransmittance(0.12)).toBeCloseTo(0.88, 9)
    expect(densityFromTransmittance(1.2)).toBe(0)
  })

  it('maps ISO 12312-1 categories inside their τv bands', () => {
    const bands: Record<number, [number, number]> = {
      0: [0.8, 1],
      1: [0.43, 0.8],
      2: [0.18, 0.43],
      3: [0.08, 0.18],
      4: [0.03, 0.08]
    }
    for (const [category, [low, high]] of Object.entries(bands)) {
      const tau = LENS_CATEGORY_TRANSMITTANCE[Number(category) as 0]
      expect(tau).toBeGreaterThanOrEqual(low)
      expect(tau).toBeLessThanOrEqual(high)
    }
    expect(densityFromCategory(2)).toBeCloseTo(0.695, 3)
    expect(densityFromCategory(3)).toBeCloseTo(0.87, 3)
  })

  it('takes density, else transmittance, else category', () => {
    expect(resolveLens({ category: 3 }).density).toBeCloseTo(0.87, 9)
    expect(resolveLens({ category: 3, transmittance: 0.1 }).density).toBeCloseTo(0.9, 9)
    expect(resolveLens({ category: 3, transmittance: 0.1, density: 0.5 }).density).toBe(0.5)
    expect(resolveLens({ category: 7 as 0 }).density).toBeNull()
  })

  it('reads a gradient, dropping a malformed one', () => {
    expect(resolveLens({ gradient: { top: 0.9, bottom: 0.2 } }).gradient).toEqual({ top: 0.9, bottom: 0.2 })
    expect(resolveLens({ gradient: { top: 0.9 } as never }).gradient).toBeNull()
    expect(resolveLens({ gradient: { top: 2, bottom: -1 } }).gradient).toEqual({ top: 1, bottom: 0 })
  })

  it('shades a gradient dark to light top to bottom, smooth in the middle', () => {
    const g = { top: 0.9, bottom: 0.2 }
    expect(gradientDensityAt(g, 1)).toBeCloseTo(0.9, 9)
    expect(gradientDensityAt(g, 0)).toBeCloseTo(0.2, 9)
    expect(gradientDensityAt(g, 0.5)).toBeCloseTo(0.55, 9)
    expect(gradientDensityAt(g, 0.9)).toBeGreaterThan(gradientDensityAt(g, 0.6))
  })
})
