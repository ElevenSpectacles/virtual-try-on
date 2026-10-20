import { describe, expect, it } from 'vitest'
import {
  CONTACT_OCCLUSION_GAIN,
  FRAME_SPHERE_CELL_METERS,
  MAX_SPHERE_OCCLUSION,
  MIN_SPHERE_RADIUS_METERS,
  OCCLUSION_RANGE_METERS,
  contactOcclusion,
  contactShadowAlpha,
  fitFrameOccluders,
  fitFrameOccludersByPart,
  fitOccluderSpheres,
  silhouetteFade,
  sphereOcclusion
} from '../../../src/runtime/utils/tryon-contact-occlusion'

/** Points on a straight rod along x, like a temple arm. */
function rod(length: number, step = 0.001): number[] {
  const points: number[] = []
  for (let i = 0; i * step <= length; i++) points.push(i * step, 0.002, 0.004, i * step, 0.004, 0.002)
  return points
}

const up = { x: 0, y: 0, z: 1 }

describe('fitOccluderSpheres', () => {
  it('turns a thin rod into a chain of small spheres', () => {
    const spheres = fitOccluderSpheres(rod(0.08), FRAME_SPHERE_CELL_METERS)
    // 0…80 mm in 8 mm cells: 10 full cells and the end point's.
    expect(spheres.length).toBeGreaterThanOrEqual(10)
    expect(spheres.length).toBeLessThanOrEqual(11)
    for (const s of spheres) {
      expect(s.r).toBeLessThanOrEqual(FRAME_SPHERE_CELL_METERS / 2)
      expect(s.y).toBeCloseTo(0.003)
    }
  })

  it('floors the radius of a single-point cell', () => {
    const [sphere] = fitOccluderSpheres([0.001, 0.001, 0.001], 0.008)
    expect(sphere!.r).toBeCloseTo(MIN_SPHERE_RADIUS_METERS)
  })

  it('shrinks the radius by √weight', () => {
    const [full] = fitOccluderSpheres(rod(0.007), 0.008, 1)
    const [quarter] = fitOccluderSpheres(rod(0.007), 0.008, 0.25)
    expect(quarter!.r).toBeCloseTo(full!.r / 2)
  })
})

describe('fitFrameOccluders', () => {
  it('coarsens the cells until the spheres fit the budget', () => {
    const parts = [{ points: rod(0.5), cellSize: 0.004, weight: 1 }]
    expect(fitOccluderSpheres(parts[0]!.points, 0.004).length).toBeGreaterThan(20)
    expect(fitFrameOccluders(parts, 20).length).toBeLessThanOrEqual(20)
  })

  it('keeps each part\'s spheres apart, in order, under one shared budget', () => {
    const front = { points: rod(0.14), cellSize: 0.008, weight: 1 }
    const arm = { points: rod(0.1), cellSize: 0.008, weight: 1 }
    const byPart = fitFrameOccludersByPart([front, arm], 20)
    expect(byPart).toHaveLength(2)
    expect(byPart[0]!.length).toBeGreaterThan(0)
    expect(byPart[1]!.length).toBeGreaterThan(0)
    expect(byPart[0]!.length + byPart[1]!.length).toBeLessThanOrEqual(20)
    // Same spheres as the flat fit, part by part.
    expect(byPart.flat()).toEqual(fitFrameOccluders([front, arm], 20))
  })
})

describe('sphereOcclusion', () => {
  it('is capped inside the sphere', () => {
    expect(sphereOcclusion({ x: 0, y: 0, z: 0 }, up, { x: 0, y: 0, z: 0.001, r: 0.002 })).toBe(MAX_SPHERE_OCCLUSION)
  })

  it('falls off with the square of the distance without a range', () => {
    const near = sphereOcclusion({ x: 0, y: 0, z: 0 }, up, { x: 0, y: 0, z: 0.01, r: 0.002 }, Infinity)
    const far = sphereOcclusion({ x: 0, y: 0, z: 0 }, up, { x: 0, y: 0, z: 0.02, r: 0.002 }, Infinity)
    expect(near).toBeCloseTo(0.04)
    expect(far).toBeCloseTo(near / 4)
  })

  it('fades to zero at the range past the surface', () => {
    const sphere = { x: 0, y: 0, z: OCCLUSION_RANGE_METERS + 0.002, r: 0.002 }
    expect(sphereOcclusion({ x: 0, y: 0, z: 0 }, up, sphere)).toBeCloseTo(0, 12)
    const inside = { ...sphere, z: OCCLUSION_RANGE_METERS / 2 + 0.002 }
    expect(sphereOcclusion({ x: 0, y: 0, z: 0 }, up, inside)).toBeGreaterThan(0)
  })

  it('is continuous across the sphere surface', () => {
    // A sphere mostly below the skin, like a temple tip entering the head.
    const sphere = { x: 0, y: 0, z: -0.0015, r: 0.002 }
    const at = (x: number) => sphereOcclusion({ x, y: 0, z: 0 }, up, sphere)
    const edge = Math.sqrt(0.002 ** 2 - 0.0015 ** 2)
    expect(Math.abs(at(edge - 1e-6) - at(edge + 1e-6))).toBeLessThan(1e-3)
  })

  it('ignores spheres below the skin surface', () => {
    expect(sphereOcclusion({ x: 0, y: 0, z: 0 }, up, { x: 0, y: 0, z: -0.01, r: 0.002 })).toBe(0)
  })
})

describe('contactOcclusion', () => {
  it('combines spheres as independent occluders', () => {
    const s = { x: 0, y: 0, z: 0.01, r: 0.002 }
    const one = contactOcclusion({ x: 0, y: 0, z: 0 }, up, [s])
    const two = contactOcclusion({ x: 0, y: 0, z: 0 }, up, [s, s])
    expect(two).toBeCloseTo(1 - (1 - one) ** 2)
  })

  it('is 0 with no spheres', () => {
    expect(contactOcclusion({ x: 0, y: 0, z: 0 }, up, [])).toBe(0)
  })
})

describe('silhouetteFade', () => {
  it('keeps the occlusion on skin facing the camera', () => {
    expect(silhouetteFade(1)).toBe(1)
  })

  it('removes it at the silhouette', () => {
    expect(silhouetteFade(0)).toBe(0)
  })

  it('rises monotonically in between', () => {
    expect(silhouetteFade(0.25)).toBeLessThan(silhouetteFade(0.35))
  })
})

describe('contactShadowAlpha', () => {
  it('is 0 when lit and unoccluded', () => {
    expect(contactShadowAlpha(0, 0, 0.22)).toBe(0)
  })

  it('is the shadow strength in full shadow without occlusion', () => {
    expect(contactShadowAlpha(1, 0, 0.22)).toBeCloseTo(0.22)
  })

  it('scales occlusion by the gain', () => {
    expect(contactShadowAlpha(0, 1, 0.22)).toBeCloseTo(0.22 * CONTACT_OCCLUSION_GAIN)
  })

  it('multiplies the two visibilities', () => {
    const a = contactShadowAlpha(1, 1, 0.2)
    expect(a).toBeCloseTo(1 - (1 - 0.2) * (1 - 0.2 * CONTACT_OCCLUSION_GAIN))
  })
})
