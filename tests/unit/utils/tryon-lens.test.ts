import { describe, expect, it } from 'vitest'
import {
  LENS_F0,
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
    expect(resolveLens(undefined)).toEqual({ tint: null, density: null })
  })

  it('clamps density to 0…1', () => {
    expect(resolveLens({ density: 1.4 }).density).toBe(1)
    expect(resolveLens({ density: -0.2 }).density).toBe(0)
  })

  it('drops malformed fields only', () => {
    expect(resolveLens({ tint: 'blue', density: 0.5 })).toEqual({ tint: null, density: 0.5 })
    expect(resolveLens({ tint: '#000000', density: Number.NaN })).toEqual({
      tint: [0, 0, 0],
      density: null
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
