import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Vector3 } from 'three'
import {
  MAX_SEAT_OFFSET_MM,
  NOSE_SIDE_PAIRS,
  REFERENCE_NOSE_PROFILE,
  headUpOffset,
  noseProfile,
  seatDropMm,
  seatOffsetMm,
  updateNoseProfile,
  type NoseProfilePoint
} from '../../../src/runtime/utils/tryon-seat'
import type { NormalizedLandmark } from '../../../src/runtime/utils/tryon'

/** The reference nose scaled in width by `k` (k < 1: narrower). */
const scaled = (k: number): NoseProfilePoint[] =>
  REFERENCE_NOSE_PROFILE.map((p) => ({ dropMm: p.dropMm, widthMm: p.widthMm * k }))

describe('seatDropMm', () => {
  it('seats pads at the top of a nose already wider than they are apart', () => {
    expect(seatDropMm(REFERENCE_NOSE_PROFILE, 18)).toBe(0)
  })

  it('interpolates where the nose reaches the pad spacing', () => {
    // Between 21.0 mm at 15.4 and 30.6 mm at 18.6.
    expect(seatDropMm(REFERENCE_NOSE_PROFILE, 25.8)).toBeCloseTo(15.4 + 0.5 * 3.2, 6)
  })

  it('stops at the bottom of the profile', () => {
    expect(seatDropMm(REFERENCE_NOSE_PROFILE, 50)).toBe(25.5)
  })
})

describe('seatOffsetMm', () => {
  it('is zero on the reference nose', () => {
    expect(seatOffsetMm(REFERENCE_NOSE_PROFILE, 24)).toBe(0)
  })

  it('seats lower on a narrow nose and higher on a wide one', () => {
    expect(seatOffsetMm(scaled(0.9), 24)).toBeGreaterThan(0)
    expect(seatOffsetMm(scaled(1.15), 24)).toBeLessThan(0)
  })

  it('is clamped', () => {
    expect(seatOffsetMm(scaled(0.5), 24)).toBe(MAX_SEAT_OFFSET_MM)
  })
})

describe('noseProfile', () => {
  it('measures each side pair, drops from the top pair, in mm', () => {
    const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
    NOSE_SIDE_PAIRS.forEach(([right, left], i) => {
      points[right] = { x: 0.5 - 0.02 - i * 0.002, y: 0.4 + i * 0.01 }
      points[left] = { x: 0.5 + 0.02 + i * 0.002, y: 0.4 + i * 0.01 }
    })
    // 1 width unit = 1000 mm (a 480-px frame 1 m across, say).
    const profile = noseProfile(points, 1, 1000)!
    expect(profile[0]!.dropMm).toBe(0)
    expect(profile[0]!.widthMm).toBeCloseTo(40, 6)
    expect(profile[4]!.dropMm).toBeCloseTo(40, 6)
    expect(profile[4]!.widthMm).toBeCloseTo(56, 6)
  })

  it('is null without the landmarks', () => {
    expect(noseProfile([], 1, 1000)).toBeNull()
  })

  it('averages profiles over detections', () => {
    const first = updateNoseProfile(null, scaled(1))!
    const next = updateNoseProfile(first, scaled(2), 0.5)!
    expect(next.samples).toBe(2)
    expect(next.mean[0]!.widthMm).toBeCloseTo(REFERENCE_NOSE_PROFILE[0]!.widthMm * 1.5, 6)
  })
})

describe('headUpOffset', () => {
  it('matches three.js rotating (0, d, 0) by an XYZ Euler', () => {
    const euler = { x: 0.2, y: -0.4, z: 0.3 }
    const expected = new Vector3(0, 0.05, 0).applyMatrix4(
      new Matrix4().makeRotationFromEuler(new Euler(euler.x, euler.y, euler.z, 'XYZ'))
    )
    const got = headUpOffset(euler, 0.05)
    expect(got.x).toBeCloseTo(expected.x, 9)
    expect(got.y).toBeCloseTo(expected.y, 9)
    expect(got.z).toBeCloseTo(expected.z, 9)
  })
})
