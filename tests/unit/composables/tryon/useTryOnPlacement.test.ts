import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import {
  useTryOnPlacement,
  type UseTryOnPlacementOptions
} from '../../../../src/runtime/composables/tryon/useTryOnPlacement'
import {
  ASSUMED_EAR_WIDTH_METERS,
  FRAME_BRIDGE_STANDOFF_METERS,
  FRAME_FIT_SCALE_BOOST,
  computeMetricScaleFromMeasure,
  headForwardOffset,
  landmarkToWorld,
  worldPlaneWidth,
  type NormalizedLandmark,
  type ObjectCoverWindow
} from '../../../../src/runtime/utils/tryon'
import type { FacePose } from '../../../../src/runtime/utils/tryon-pose'
import type { TryOnFrameCalibration } from '../../../../src/runtime/types/tryon-calibration'
import { stubRaf } from '../../support/raf'

/**
 * The placement pipeline shared by VirtualTryOnExperience and the playground
 * prototype: deterministic synthetic face, fixed pose, driven through a
 * stubbed rAF so the smoothing settles.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

// 478 landmarks, with the points the pipeline reads placed on a frontal face.
function face(): NormalizedLandmark[] {
  const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const set = (i: number, x: number, y: number) => {
    points[i] = { x, y, z: 0 }
  }
  set(234, 0.36, 0.45) // ear level, right
  set(454, 0.64, 0.45) // ear level, left
  set(127, 0.37, 0.47) // cheeks
  set(356, 0.63, 0.47)
  set(468, 0.44, 0.44) // iris centres
  set(473, 0.56, 0.44)
  return points
}

const ANCHOR: NormalizedLandmark = { x: 0.5, y: 0.43, z: 0 }

const POSE: FacePose = {
  position: { x: 0, y: 0, z: -40 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  euler: { yaw: 0, pitch: 0, roll: 0 },
  scale: 1
}

const CALIBRATION: TryOnFrameCalibration = {
  model: 'iris-bronze',
  translation: { x: 0, y: -0.023, z: -0.004 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
  templeWidthBoost: 1,
  lens: { tint: null, density: null },
  padSpacingMm: null
}

const FULL_WINDOW: ObjectCoverWindow = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }

function inputs(): UseTryOnPlacementOptions {
  return {
    landmarks: ref(face()),
    anchor: ref(ANCHOR),
    pose: ref(POSE),
    blinkScore: ref(0),
    latencyMs: ref(0),
    hasFace: ref(true),
    faceTracking: () => true,
    aspect: ref(1),
    coverWindow: ref(FULL_WINDOW),
    mediaAspect: ref(1),
    calibration: ref(CALIBRATION)
  }
}

function settled(options: UseTryOnPlacementOptions) {
  const raf = stubRaf()
  const scope = effectScope()
  const placement = scope.run(() => useTryOnPlacement(options))!
  raf.frames(240)
  const out = {
    scaleSource: placement.scaleSource.value,
    scale: placement.smoothedScale.value,
    framePosition: { ...placement.framePosition.value },
    rotation: { ...placement.smoothedEuler.value },
    occluderPosition: { ...placement.occluderPosition.value },
    occluderGeometry: { ...placement.occluderGeometry.value },
    faceWorldHalfWidth: placement.faceWorldHalfWidth.value,
    occluderPositions: placement.occluderPositions.value
  }
  scope.stop()
  return out
}

describe('useTryOnPlacement', () => {
  it('scales from the ear width, metric, with the fit boost', () => {
    const out = settled(inputs())
    expect(out.scaleSource).toBe('ear')
    const expected =
      computeMetricScaleFromMeasure(1, 0.28, ASSUMED_EAR_WIDTH_METERS) * FRAME_FIT_SCALE_BOOST
    expect(out.scale).toBeCloseTo(expected, 4)
  })

  it('puts the frame front on the anchor, stood off along the head', () => {
    const out = settled(inputs())
    const world = landmarkToWorld(ANCHOR, 1, { mirror: true })
    const standoff = headForwardOffset(out.rotation, FRAME_BRIDGE_STANDOFF_METERS * out.scale)
    expect(out.framePosition.x).toBeCloseTo(world.x + standoff.x, 6)
    expect(out.framePosition.y).toBeCloseTo(world.y + standoff.y, 6)
    expect(out.framePosition.z).toBeCloseTo(standoff.z, 6)
  })

  it('builds the face-mesh occluder from a tracked face, and none without one', () => {
    expect(settled(inputs()).occluderPositions).toBeInstanceOf(Float32Array)
    const lost = inputs()
    lost.hasFace = ref(false)
    expect(settled(lost).occluderPositions).toBeNull()
  })

  it('gives the same placement with the prototype knobs at their defaults', () => {
    // The playground prototype passes its tuning refs; at their defaults they
    // must reproduce the experience exactly, so tuning there transfers 1:1.
    const experience = settled({ ...inputs(), scaleMultiplier: () => 1 })
    const prototype = settled({
      ...inputs(),
      scaleMultiplier: () => 1 * 1,
      autoScale: () => true,
      referenceFaceWidth: () => 0.32,
      fallbackAnchor: () => ({ x: 0.5, y: 0.45 }),
      fallbackRotation: () => ({ x: 0, y: 0, z: 0 }),
      offsetY: () => 0,
      offsetZ: () => 0,
      occluderRatios: () => ({ widthRatio: 1.3, heightRatio: 1.3, depthRatio: 1.4 }),
      occluderMesh: () => ({ skinSetbackMeters: 0.006, inflate: 1.04, collarDepthMeters: 0.2 })
    })
    expect(prototype).toEqual(experience)
  })

  it('falls back to the reference width with auto scale off', () => {
    const manual = settled({ ...inputs(), autoScale: () => false })
    expect(manual.scaleSource).toBe('manual')
    expect(manual.faceWorldHalfWidth).toBeCloseTo((worldPlaneWidth(1) * 0.32) / 2, 6)
  })

  it('applies the scale multiplier and the tuning offsets', () => {
    const base = settled(inputs())
    const tuned = settled({
      ...inputs(),
      scaleMultiplier: () => 1.1,
      offsetY: () => 0.05,
      offsetZ: () => -0.02
    })
    expect(tuned.scale).toBeCloseTo(base.scale * 1.1, 4)
    const standoff = (scale: number, rotation: { x: number; y: number; z: number }) =>
      headForwardOffset(rotation, FRAME_BRIDGE_STANDOFF_METERS * scale)
    expect(tuned.framePosition.y - standoff(tuned.scale, tuned.rotation).y).toBeCloseTo(
      base.framePosition.y - standoff(base.scale, base.rotation).y + 0.05,
      6
    )
    expect(tuned.framePosition.z - standoff(tuned.scale, tuned.rotation).z).toBeCloseTo(-0.02, 6)
  })

  it('seats a frame with pad spacing lower on a narrow nose (opt-in)', async () => {
    const { nextTick } = await import('vue')
    const { NOSE_SIDE_PAIRS } = await import('../../../../src/runtime/utils/tryon-seat')
    // A nose whose side wall is `widthMm` wide all the way down (ear 0.28 wide = 148 mm).
    const noseFace = (widthMm: number) => {
      const points = face()
      const half = ((widthMm / 148) * 0.28) / 2
      NOSE_SIDE_PAIRS.forEach(([right, left], i) => {
        points[right] = { x: 0.5 - half, y: 0.44 + i * 0.01, z: 0 }
        points[left] = { x: 0.5 + half, y: 0.44 + i * 0.01, z: 0 }
      })
      return points
    }
    async function placed(widthMm: number, padSpacingMm: number | null) {
      const raf = stubRaf()
      const options = { ...inputs(), calibration: ref({ ...CALIBRATION, padSpacingMm }) }
      const scope = effectScope()
      const placement = scope.run(() => useTryOnPlacement(options))!
      for (let i = 0; i < 40; i++) {
        options.landmarks.value = noseFace(widthMm)
        await nextTick()
        raf.frames(1)
      }
      raf.frames(240)
      const out = { y: placement.framePosition.value.y, seat: placement.seatOffset.value }
      scope.stop()
      return out
    }
    const without = await placed(16, null)
    const narrow = await placed(16, 24)
    const wide = await placed(40, 24)
    expect(without.seat).toBe(0)
    expect(narrow.seat).toBeGreaterThan(0)
    expect(narrow.y).toBeLessThan(without.y)
    expect(wide.seat).toBeLessThan(0)
    expect(wide.y).toBeGreaterThan(without.y)
  })
})
