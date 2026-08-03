import { describe, it, expect } from 'vitest'
import {
  mirrorNormalizedX,
  landmarkToNdc,
  frustumHalfExtents,
  landmarkToWorld,
  landmarkDistance,
  getFaceWidth,
  estimateDistanceScale,
  worldPlaneWidth,
  computeMetricBaseScale,
  computeHeadOccluderGeometry,
  objectCoverWindow,
  mapLandmarkToObjectCover,
  getInterPupillaryDistance,
  compensateMeasureForPose,
  computeMetricScaleFromMeasure,
  oneEuroFilter,
  IRIS_CENTER_RIGHT,
  IRIS_CENTER_LEFT,
  ASSUMED_IPD_METERS,
  TRYON_CAMERA
} from '../../../utils/tryon'

describe('try-on compositing helpers', () => {
  describe('mirrorNormalizedX', () => {
    it('maps the raw-frame left edge to the mirrored-preview right edge', () => {
      expect(mirrorNormalizedX(0)).toBe(1)
      expect(mirrorNormalizedX(1)).toBe(0)
    })

    it('leaves the centre fixed', () => {
      expect(mirrorNormalizedX(0.5)).toBe(0.5)
    })
  })

  describe('landmarkToNdc', () => {
    it('centres the middle of the frame at the origin', () => {
      const ndc = landmarkToNdc({ x: 0.5, y: 0.5 })
      expect(ndc.x).toBeCloseTo(0)
      expect(ndc.y).toBeCloseTo(0)
    })

    it('flips x for the mirrored preview and inverts y (image is top-down)', () => {
      // A landmark on the raw-frame left (x=0), upper area (y=0.25)…
      const ndc = landmarkToNdc({ x: 0, y: 0.25 })
      // …lands on the right in NDC (mirrored) and above the centre (y-up).
      expect(ndc.x).toBe(1)
      expect(ndc.y).toBe(0.5)
    })

    it('tracks backwards when the mirror is disabled (the classic bug)', () => {
      const mirrored = landmarkToNdc({ x: 0.2, y: 0.5 }, { mirror: true })
      const notMirrored = landmarkToNdc({ x: 0.2, y: 0.5 }, { mirror: false })
      // Same landmark, opposite horizontal sign — this is the "frame tracks
      // the head backwards" failure the prototype exists to rule out.
      expect(mirrored.x).toBeCloseTo(-notMirrored.x)
    })
  })

  describe('frustumHalfExtents', () => {
    it('scales width by aspect ratio', () => {
      const { halfWidth, halfHeight } = frustumHalfExtents(2, 90, 1)
      expect(halfHeight).toBeCloseTo(1) // tan(45°) * 1
      expect(halfWidth).toBeCloseTo(2)
    })
  })

  describe('landmarkToWorld', () => {
    it('places the frame plane centre at the world origin', () => {
      const world = landmarkToWorld({ x: 0.5, y: 0.5 }, 0.75)
      expect(world.x).toBeCloseTo(0)
      expect(world.y).toBeCloseTo(0)
    })

    it('stays within the visible frustum half-extents', () => {
      const aspect = 0.75 // portrait phone
      const { halfWidth, halfHeight } = frustumHalfExtents(
        aspect,
        TRYON_CAMERA.fovDeg,
        TRYON_CAMERA.distance
      )
      const corner = landmarkToWorld({ x: 0, y: 0 }, aspect)
      expect(Math.abs(corner.x)).toBeCloseTo(halfWidth)
      expect(Math.abs(corner.y)).toBeCloseTo(halfHeight)
    })
  })

  describe('landmarkDistance', () => {
    it('computes the Euclidean distance between two landmarks', () => {
      const a = { x: 0, y: 0 }
      const b = { x: 3, y: 4 }
      expect(landmarkDistance(a, b)).toBe(5)
    })
  })

  describe('getFaceWidth', () => {
    it('returns cheek-to-cheek distance when landmarks are present', () => {
      const landmarks = Array.from({ length: 468 }, (_, i) => ({
        x: i / 468,
        y: 0.5
      }))
      landmarks[127] = { x: 0.2, y: 0.5 }
      landmarks[356] = { x: 0.7, y: 0.5 }
      expect(getFaceWidth(landmarks)).toBeCloseTo(0.5)
    })

    it('returns 0 when required landmarks are missing', () => {
      expect(getFaceWidth([])).toBe(0)
      expect(getFaceWidth([{ x: 0, y: 0 }])).toBe(0)
    })
  })

  describe('estimateDistanceScale', () => {
    it('returns 1 for invalid inputs', () => {
      expect(estimateDistanceScale(0, 0.3)).toBe(1)
      expect(estimateDistanceScale(0.3, 0)).toBe(1)
    })

    it('scales up when the face is closer (larger width)', () => {
      expect(estimateDistanceScale(0.4, 0.2)).toBeCloseTo(2)
    })

    it('scales down when the face is farther (smaller width)', () => {
      expect(estimateDistanceScale(0.2, 0.4)).toBeCloseTo(0.5)
    })
  })

  describe('worldPlaneWidth', () => {
    it('doubles the frustum half-width', () => {
      const aspect = 0.75
      const { halfWidth } = frustumHalfExtents(
        aspect,
        TRYON_CAMERA.fovDeg,
        TRYON_CAMERA.distance
      )
      expect(worldPlaneWidth(aspect)).toBeCloseTo(halfWidth * 2)
    })
  })

  describe('computeMetricBaseScale', () => {
    it('returns 1 for invalid inputs', () => {
      expect(computeMetricBaseScale(0.75, 0)).toBe(1)
      expect(computeMetricBaseScale(0.75, 0.3, 0)).toBe(1)
    })

    it('matches the worked example for the default calibration', () => {
      expect(computeMetricBaseScale(0.75, 0.32)).toBeCloseTo(6.3, 1)
    })
  })

  describe('computeHeadOccluderGeometry', () => {
    it('applies default width/height/depth ratios', () => {
      const geometry = computeHeadOccluderGeometry(0.1)
      expect(geometry.radiusX).toBeCloseTo(0.1)
      expect(geometry.radiusY).toBeCloseTo(0.13)
      expect(geometry.radiusZ).toBeCloseTo(0.12)
    })

    it('honours custom ratios', () => {
      const geometry = computeHeadOccluderGeometry(0.1, {
        widthRatio: 2,
        heightRatio: 1,
        depthRatio: 0.5
      })
      expect(geometry.radiusX).toBeCloseTo(0.2)
      expect(geometry.radiusY).toBeCloseTo(0.1)
      expect(geometry.radiusZ).toBeCloseTo(0.05)
    })
  })

  describe('getInterPupillaryDistance', () => {
    it('measures the distance between the iris centres', () => {
      const landmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }))
      landmarks[IRIS_CENTER_RIGHT] = { x: 0.45, y: 0.5 }
      landmarks[IRIS_CENTER_LEFT] = { x: 0.59, y: 0.5 }
      expect(getInterPupillaryDistance(landmarks)).toBeCloseTo(0.14)
    })

    it('returns 0 when iris landmarks are absent (468-point result)', () => {
      const landmarks = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }))
      expect(getInterPupillaryDistance(landmarks)).toBe(0)
      expect(getInterPupillaryDistance([])).toBe(0)
    })
  })

  describe('compensateMeasureForPose', () => {
    it('leaves a frontal measure unchanged', () => {
      expect(compensateMeasureForPose(0.14, 0)).toBeCloseTo(0.14)
    })

    it('undoes cos(yaw) foreshortening at a 30° turn', () => {
      const yaw = Math.PI / 6
      expect(compensateMeasureForPose(0.14 * Math.cos(yaw), yaw)).toBeCloseTo(
        0.14
      )
    })

    it('clamps the divisor near profile so scale cannot explode', () => {
      // cos(80°) ≈ 0.17 < the 0.5 clamp — result divides by 0.5 instead.
      const compensated = compensateMeasureForPose(0.1, (80 * Math.PI) / 180)
      expect(compensated).toBeCloseTo(0.2)
    })
  })

  describe('computeMetricScaleFromMeasure', () => {
    it('returns 1 for invalid inputs', () => {
      expect(computeMetricScaleFromMeasure(0.75, 0, ASSUMED_IPD_METERS)).toBe(1)
      expect(computeMetricScaleFromMeasure(0.75, 0.14, 0)).toBe(1)
    })

    it('matches the ground-truth measurement worked example', () => {
      expect(
        computeMetricScaleFromMeasure(0.75, 0.1437, ASSUMED_IPD_METERS)
      ).toBeCloseTo(6.29, 1)
    })
  })

  describe('oneEuroFilter', () => {
    it('primes on a null state — the first sample passes through unfiltered', () => {
      const state = oneEuroFilter(null, 0.7, 1 / 60)
      expect(state).toEqual({ value: 0.7, derivative: 0 })
    })

    it('holds still (does not divide by zero) when dt is non-positive', () => {
      const primed = oneEuroFilter(null, 0, 1 / 60)
      expect(oneEuroFilter(primed, 1, 0)).toEqual(primed)
      expect(oneEuroFilter(primed, 1, -1)).toEqual(primed)
    })

    it('converges toward a constant target without overshoot', () => {
      let state = oneEuroFilter(null, 0, 1 / 60)
      for (let i = 0; i < 120; i++) {
        state = oneEuroFilter(state, 1, 1 / 60, { minCutoff: 1, beta: 0.5 })
      }
      expect(state.value).toBeGreaterThan(0.99)
      expect(state.value).toBeLessThanOrEqual(1)
    })

    it('suppresses jitter around a held value far more than it passes through', () => {
      // Small alternating noise around a constant signal, the classic "still
      // face, jittery landmarks" case — the filtered output should barely move.
      let state = oneEuroFilter(null, 0, 1 / 60)
      let maxDeviation = 0
      for (let i = 0; i < 120; i++) {
        const noisy = i % 2 === 0 ? 0.02 : -0.02
        state = oneEuroFilter(state, noisy, 1 / 60, { minCutoff: 1, beta: 0.5 })
        maxDeviation = Math.max(maxDeviation, Math.abs(state.value))
      }
      expect(maxDeviation).toBeLessThan(0.02)
    })

    it('tracks a fast-moving signal with less lag when beta is higher', () => {
      // A steadily increasing signal (e.g. walking toward the camera) — a
      // higher beta should let the filter keep up more closely.
      const ramp = (opts: { minCutoff: number; beta: number }) => {
        let state = oneEuroFilter(null, 0, 1 / 60)
        let target = 0
        for (let i = 0; i < 60; i++) {
          target += 0.05
          state = oneEuroFilter(state, target, 1 / 60, opts)
        }
        return target - state.value
      }
      const lowBetaLag = ramp({ minCutoff: 1, beta: 0 })
      const highBetaLag = ramp({ minCutoff: 1, beta: 2 })
      expect(highBetaLag).toBeLessThan(lowBetaLag)
    })
  })

  describe('objectCoverWindow', () => {
    it('returns the full frame when aspect ratios match', () => {
      expect(objectCoverWindow(0.75, 0.75)).toEqual({
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1
      })
    })

    it('returns the full frame when either aspect ratio is unknown', () => {
      expect(objectCoverWindow(0, 0.75)).toEqual({
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1
      })
      expect(objectCoverWindow(1.33, 0)).toEqual({
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1
      })
    })

    it('crops left/right when the media is relatively wider than the container', () => {
      // A 16:9 camera stream (1.78) inside a 3:4 portrait stage (0.75) —
      // `cover` crops the sides to fill the container's height.
      const window = objectCoverWindow(16 / 9, 3 / 4)
      expect(window.yMin).toBe(0)
      expect(window.yMax).toBe(1)
      expect(window.xMax - window.xMin).toBeCloseTo(3 / 4 / (16 / 9))
      expect(window.xMin).toBeCloseTo(1 - window.xMax)
    })

    it('crops top/bottom when the media is relatively taller than the container', () => {
      // A 3:4 portrait photo (0.75) inside a wide 4:3 stage (1.33) — `cover`
      // crops the top/bottom to fill the container's width.
      const window = objectCoverWindow(3 / 4, 4 / 3)
      expect(window.xMin).toBe(0)
      expect(window.xMax).toBe(1)
      expect(window.yMax - window.yMin).toBeCloseTo(3 / 4 / (4 / 3))
      expect(window.yMin).toBeCloseTo(1 - window.yMax)
    })
  })

  describe('mapLandmarkToObjectCover', () => {
    it('leaves a landmark unchanged for the full [0, 1] window', () => {
      const landmark = { x: 0.3, y: 0.6 }
      const window = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
      expect(mapLandmarkToObjectCover(landmark, window)).toEqual(landmark)
    })

    it('remaps a landmark into the cropped window', () => {
      // Raw-frame landmark at the crop-window centre should land at (0.5, 0.5).
      const window = { xMin: 0.25, xMax: 0.75, yMin: 0, yMax: 1 }
      const landmark = { x: 0.5, y: 0.5 }
      const mapped = mapLandmarkToObjectCover(landmark, window)
      expect(mapped.x).toBeCloseTo(0.5)
      expect(mapped.y).toBeCloseTo(0.5)
    })

    it('maps a landmark at the crop edge to the visible edge', () => {
      const window = { xMin: 0.25, xMax: 0.75, yMin: 0, yMax: 1 }
      const mapped = mapLandmarkToObjectCover({ x: 0.25, y: 0 }, window)
      expect(mapped.x).toBeCloseTo(0)
      expect(mapped.y).toBeCloseTo(0)
    })

    it('preserves extra landmark fields such as z/visibility', () => {
      const window = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
      const mapped = mapLandmarkToObjectCover(
        { x: 0.5, y: 0.5, z: 0.1, visibility: 0.9 },
        window
      )
      expect(mapped.z).toBe(0.1)
      expect(mapped.visibility).toBe(0.9)
    })
  })
})
