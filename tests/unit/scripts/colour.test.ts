import { describe, expect, it } from 'vitest'
import { deltaE2000, hexToLab, srgbToLab, type Lab } from '../../../scripts/lib/colour'

describe('deltaE2000', () => {
  // Test pairs from Sharma, Wu & Dalal (2005), Table 1.
  const pairs: Array<[Lab, Lab, number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644]
  ]
  for (const [a, b, expected] of pairs) {
    it(`gives ${expected} for ${JSON.stringify(a)} vs ${JSON.stringify(b)}`, () => {
      expect(deltaE2000(a, b)).toBeCloseTo(expected, 4)
      expect(deltaE2000(b, a)).toBeCloseTo(expected, 4)
    })
  }

  it('is 0 for the same colour', () => {
    expect(deltaE2000([40, 10, -5], [40, 10, -5])).toBe(0)
  })
})

describe('srgbToLab', () => {
  it('maps white, black and mid grey', () => {
    const white = srgbToLab(255, 255, 255)
    expect(white[0]).toBeCloseTo(100, 2)
    expect(Math.abs(white[1])).toBeLessThan(0.01)
    expect(srgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 6)
    expect(srgbToLab(119, 119, 119)[0]).toBeCloseTo(50, 0)
  })

  it('reads #rrggbb', () => {
    expect(hexToLab('#ff0000')).toEqual(srgbToLab(255, 0, 0))
    // sRGB red is about L 53.2, a 80.1, b 67.2.
    expect(hexToLab('#ff0000')[0]).toBeCloseTo(53.24, 1)
  })
})
