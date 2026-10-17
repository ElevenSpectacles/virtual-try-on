import { describe, expect, it } from 'vitest'
import { auditTilt, fitDepthPlane, pantoscopicTiltDeg } from '../../../scripts/lib/tilt'

/** A 50×40 mm lens front tilted by `deg` (bottom back), with a little curve. */
function lens(deg: number, curve = 0): number[] {
  const t = Math.tan((deg * Math.PI) / 180)
  const points: number[] = []
  for (let x = -0.025; x <= 0.025; x += 0.005) {
    for (let y = -0.02; y <= 0.02; y += 0.004) {
      points.push(x, y, 0.004 + t * y - curve * (x * x))
    }
  }
  return points
}

describe('pantoscopic tilt', () => {
  it('reads the tilt of a flat tilted lens', () => {
    expect(pantoscopicTiltDeg(fitDepthPlane(lens(9))!)).toBeCloseTo(9, 6)
    expect(pantoscopicTiltDeg(fitDepthPlane(lens(0))!)).toBeCloseTo(0, 6)
  })

  it('ignores a symmetric horizontal wrap', () => {
    expect(pantoscopicTiltDeg(fitDepthPlane(lens(8, 3))!)).toBeCloseTo(8, 6)
  })

  it('adds the calibration rotation and suggests the fix', () => {
    const flat = auditTilt('a', lens(2), 0)!
    expect(flat.ok).toBe(false)
    expect(flat.effectiveDeg).toBeCloseTo(2, 6)
    expect(flat.suggestedRotationX).toBeCloseTo((7 * Math.PI) / 180, 6)
    const fixed = auditTilt('a', lens(2), flat.suggestedRotationX)!
    expect(fixed.effectiveDeg).toBeCloseTo(9, 6)
    expect(fixed.ok).toBe(true)
  })

  it('needs a few points', () => {
    expect(fitDepthPlane([0, 0, 0, 1, 0, 0])).toBeNull()
  })
})
