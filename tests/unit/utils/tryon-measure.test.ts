import { describe, expect, it } from 'vitest'
import {
  IRIS_DIAMETER_MM,
  IRIS_RING_LEFT,
  IRIS_RING_RIGHT,
  PD_MAX_YAW_RAD,
  PD_STABLE_SAMPLES,
  PD_WINDOW,
  acceptPdSample,
  blendedMeters,
  distancePdMm,
  earLevelWidth,
  irisDiameter,
  pdConfidence,
  pdFromIris,
  pupillaryWidth,
  rulerPdMm,
  updatePdEstimate,
  viewingDistanceMm,
  type PdEstimate
} from '../../../src/runtime/utils/tryon-measure'
import {
  ASSUMED_EAR_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  IRIS_CENTER_LEFT,
  IRIS_CENTER_RIGHT,
  type NormalizedLandmark
} from '../../../src/runtime/utils/tryon'
import { gaussian, mulberry32 } from '../support/landmark-stream'

/**
 * A frontal face in a `aspect`-wide image: iris centres `ipd` apart (in
 * width units), each ring a circle of `diameter` (width units), ring points
 * listed in the given order.
 */
function face({
  ipd = 0.12,
  diameter = 0.0223,
  aspect = 1,
  ringOrder = [0, 1, 2, 3]
}: { ipd?: number; diameter?: number; aspect?: number; ringOrder?: number[] } = {}) {
  const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const centres: Array<[number, readonly number[], number]> = [
    [IRIS_CENTER_RIGHT, IRIS_RING_RIGHT, 0.5 - ipd / 2],
    [IRIS_CENTER_LEFT, IRIS_RING_LEFT, 0.5 + ipd / 2]
  ]
  for (const [center, ring, x] of centres) {
    points[center] = { x, y: 0.44, z: 0 }
    ring.forEach((index, i) => {
      const angle = (ringOrder[i]! * Math.PI) / 2
      points[index] = {
        x: x + (diameter / 2) * Math.cos(angle),
        // y is a fraction of the height: a circle is `aspect` times taller in y units.
        y: 0.44 + (diameter / 2) * Math.sin(angle) * aspect,
        z: 0
      }
    })
  }
  points[234] = { x: 0.36, y: 0.45, z: 0 }
  points[454] = { x: 0.64, y: 0.45, z: 0 }
  return points
}

describe('irisDiameter', () => {
  it('measures the ring diameter, whatever the ring order', () => {
    expect(irisDiameter(face())).toBeCloseTo(0.0223, 6)
    expect(irisDiameter(face({ ringOrder: [2, 0, 3, 1] }))).toBeCloseTo(0.0223, 6)
  })

  it('corrects for the image aspect', () => {
    expect(irisDiameter(face({ aspect: 16 / 9 }), 16 / 9)).toBeCloseTo(0.0223, 6)
  })

  it('is 0 without iris landmarks', () => {
    expect(irisDiameter(face().slice(0, 468))).toBe(0)
  })
})

describe('pdFromIris', () => {
  it('converts the IPD to millimetres on the iris ruler', () => {
    const landmarks = face({ ipd: 0.12, diameter: (0.12 * IRIS_DIAMETER_MM) / 63 })
    expect(pdFromIris(pupillaryWidth(landmarks), irisDiameter(landmarks))).toBeCloseTo(63, 6)
  })

  it('does not depend on the distance to the camera', () => {
    // Twice as close: everything twice as big on screen.
    const far = face({ ipd: 0.1, diameter: 0.019 })
    const near = face({ ipd: 0.2, diameter: 0.038 })
    expect(pdFromIris(pupillaryWidth(near), irisDiameter(near))).toBeCloseTo(
      pdFromIris(pupillaryWidth(far), irisDiameter(far)),
      6
    )
  })

  it('tells a narrow PD from a wide one', () => {
    const narrow = face({ diameter: (0.12 * IRIS_DIAMETER_MM) / 56 })
    const wide = face({ diameter: (0.12 * IRIS_DIAMETER_MM) / 70 })
    expect(pdFromIris(pupillaryWidth(narrow), irisDiameter(narrow))).toBeCloseTo(56, 6)
    expect(pdFromIris(pupillaryWidth(wide), irisDiameter(wide))).toBeCloseTo(70, 6)
  })

  it('is 0 when a measure is missing', () => {
    expect(pdFromIris(0, 0.02)).toBe(0)
    expect(pdFromIris(0.12, 0)).toBe(0)
  })
})

describe('earLevelWidth', () => {
  it('measures 234 ↔ 454 in width units', () => {
    expect(earLevelWidth(face())).toBeCloseTo(0.28, 6)
  })
})

describe('viewing distance and vergence', () => {
  it('puts a 12 mm iris that spans 2.5 % of a 62° image at about 39 cm', () => {
    expect(viewingDistanceMm(0.025, 62)).toBeCloseTo(
      IRIS_DIAMETER_MM / (0.025 * 2 * Math.tan((31 * Math.PI) / 180)),
      6
    )
    expect(viewingDistanceMm(0.025, 62)).toBeGreaterThan(380)
    expect(viewingDistanceMm(0.025, 62)).toBeLessThan(400)
  })

  it('adds about 1.7 mm of vergence at 50 cm, less further away', () => {
    expect(distancePdMm(61.3, 500) - 61.3).toBeCloseTo(1.65, 1)
    expect(distancePdMm(61.3, 1000) - 61.3).toBeLessThan(distancePdMm(61.3, 500) - 61.3)
  })

  it('leaves the PD alone when the distance is unknown', () => {
    expect(distancePdMm(62, 0)).toBe(62)
  })
})

describe('acceptPdSample', () => {
  it('accepts a frontal, open-eyed detection', () => {
    expect(acceptPdSample({ yaw: 0.05, pitch: -0.1, blinking: false })).toBe(true)
  })

  it('rejects blinks and turned or nodding heads', () => {
    expect(acceptPdSample({ yaw: 0, pitch: 0, blinking: true })).toBe(false)
    expect(acceptPdSample({ yaw: PD_MAX_YAW_RAD + 0.01, pitch: 0, blinking: false })).toBe(false)
    expect(acceptPdSample({ yaw: -PD_MAX_YAW_RAD - 0.01, pitch: 0, blinking: false })).toBe(false)
    expect(acceptPdSample({ yaw: 0, pitch: 0.4, blinking: false })).toBe(false)
  })
})

function feed(samples: number[], start: PdEstimate | null = null): PdEstimate | null {
  return samples.reduce<PdEstimate | null>(
    (estimate, nearPdMm) => updatePdEstimate(estimate, { nearPdMm, distanceMm: 500 }),
    start
  )
}

describe('updatePdEstimate', () => {
  it('takes the median, so a glitch does not move it', () => {
    const estimate = feed([62, 62.2, 61.8, 79, 62.1])!
    expect(estimate.nearPdMm).toBeCloseTo(62.1, 6)
  })

  it('drops samples outside the plausible PD range', () => {
    expect(feed([30, 120])).toBeNull()
    expect(feed([62, 30])!.accepted).toBe(1)
  })

  it('reports the distance PD next to the near PD', () => {
    const estimate = feed([62, 62, 62])!
    expect(estimate.pdMm).toBeCloseTo(distancePdMm(62, 500), 6)
    expect(estimate.pdMm).toBeGreaterThan(estimate.nearPdMm)
  })

  it('freezes once enough samples agree, then ignores new ones', () => {
    const rand = mulberry32(7)
    const noisy = Array.from({ length: PD_STABLE_SAMPLES }, () => 64 + 0.6 * gaussian(rand))
    const estimate = feed(noisy)!
    expect(estimate.stable).toBe(true)
    expect(estimate.nearPdMm).toBeGreaterThan(63.5)
    expect(estimate.nearPdMm).toBeLessThan(64.5)
    expect(feed([55, 55, 55], estimate)).toBe(estimate)
  })

  it('does not freeze on a tracker flipping between two values', () => {
    const flipping = Array.from({ length: PD_STABLE_SAMPLES + 1 }, (_, i) => 60 + (i % 2) * 8)
    expect(feed(flipping)!.stable).toBe(false)
  })

  it('does not freeze while the samples disagree', () => {
    const rand = mulberry32(3)
    const scattered = Array.from({ length: PD_STABLE_SAMPLES * 2 }, () => 64 + 5 * gaussian(rand))
    expect(feed(scattered)!.stable).toBe(false)
  })

  it('keeps at most PD_WINDOW samples', () => {
    const many = Array.from({ length: PD_WINDOW + 20 }, (_, i) => 60 + (i % 2) * 8)
    const estimate = feed(many)!
    expect(estimate.samples).toHaveLength(PD_WINDOW)
    expect(estimate.accepted).toBe(PD_WINDOW + 20)
  })

  it('takes the median ear width, ignoring unknown ones', () => {
    let estimate: PdEstimate | null = null
    for (const earWidthMm of [150, 0, 152, 151]) {
      estimate = updatePdEstimate(estimate, { nearPdMm: 62, earWidthMm })
    }
    expect(estimate!.earWidthMm).toBe(151)
  })
})

describe('confidence and the ruler', () => {
  it('ramps the confidence with the samples, 1 once stable', () => {
    expect(pdConfidence(null)).toBe(0)
    const few = feed([70, 70, 70])!
    expect(pdConfidence(few)).toBeCloseTo(3 / PD_STABLE_SAMPLES, 6)
    const stable = feed(Array.from({ length: PD_STABLE_SAMPLES }, () => 70))!
    expect(pdConfidence(stable)).toBe(1)
  })

  it('eases the ruler from the assumed PD to the measured one', () => {
    const assumed = ASSUMED_IPD_METERS * 1000
    expect(rulerPdMm(null)).toBe(assumed)
    const few = feed([70])!
    const ruler = rulerPdMm(few)
    // One sample moves it by one step of the ramp: no visible jump.
    expect(ruler - assumed).toBeCloseTo((70 - assumed) / PD_STABLE_SAMPLES, 6)
    const stable = feed(Array.from({ length: PD_STABLE_SAMPLES }, () => 70))!
    expect(rulerPdMm(stable)).toBe(70)
  })

  it('keeps the assumed length for a measure that was not measured', () => {
    const stable = feed(Array.from({ length: PD_STABLE_SAMPLES }, () => 70))!
    expect(blendedMeters(stable, 0, ASSUMED_EAR_WIDTH_METERS)).toBe(ASSUMED_EAR_WIDTH_METERS)
    expect(blendedMeters(stable, 160, ASSUMED_EAR_WIDTH_METERS)).toBeCloseTo(0.16, 9)
  })
})
