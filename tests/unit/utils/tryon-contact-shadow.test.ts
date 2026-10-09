import { describe, it, expect } from 'vitest'
import {
  CONTACT_SHADOW_DROP,
  CONTACT_SHADOW_STRENGTH,
  bridgeContact,
  computeContactShadowColors,
  contactShadowEllipse
} from '../../../src/runtime/utils/tryon-contact-shadow'
import { FACE_MESH_VERTEX_COUNT } from '../../../src/runtime/utils/face-mesh-triangles'

/** Positions with every vertex parked far away, except those set by `place`. */
function farPositions(vertexCount: number) {
  return new Float32Array(vertexCount * 3).fill(100)
}

function alphaOf(colors: Float32Array, vertex: number) {
  return colors[vertex * 4 + 3]!
}

describe('computeContactShadowColors', () => {
  const centre = { x: 0, y: 0 }
  const radius = { x: 1, y: 1 }

  it('is full strength at the centre of the frame', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([0, 0, 0], 0)
    const colors = computeContactShadowColors(positions, centre, radius)
    expect(alphaOf(colors, 0)).toBeCloseTo(CONTACT_SHADOW_STRENGTH)
  })

  it('is zero at and beyond the radius', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([1, 0, 0], 0)
    positions.set([0, 2, 0], 3)
    const colors = computeContactShadowColors(positions, centre, radius)
    expect(alphaOf(colors, 0)).toBe(0)
    expect(alphaOf(colors, 1)).toBe(0)
  })

  it('falls off toward the edge, so the shadow has no hard border', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([0, 0, 0], 0)
    positions.set([0.5, 0, 0], 3)
    positions.set([0.9, 0, 0], 6)
    const colors = computeContactShadowColors(positions, centre, radius)
    expect(alphaOf(colors, 0)).toBeGreaterThan(alphaOf(colors, 1))
    expect(alphaOf(colors, 1)).toBeGreaterThan(alphaOf(colors, 2))
    expect(alphaOf(colors, 2)).toBeGreaterThan(0)
  })

  it('writes black, so the alpha alone carries the shadow', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([0, 0, 0], 0)
    const colors = computeContactShadowColors(positions, centre, radius)
    expect(colors.slice(0, 3)).toEqual(new Float32Array([0, 0, 0]))
  })

  it('leaves the collar ring clear, even when it sits in the shadow', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT + 2)
    const collar = FACE_MESH_VERTEX_COUNT
    positions.set([0, 0, 0], collar * 3)
    const colors = computeContactShadowColors(positions, centre, radius)
    expect(alphaOf(colors, collar)).toBe(0)
  })

  it('returns an all-clear buffer for a degenerate radius', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([0, 0, 0], 0)
    const colors = computeContactShadowColors(positions, centre, { x: 0, y: 1 })
    expect(alphaOf(colors, 0)).toBe(0)
  })

  it('scales with the strength argument', () => {
    const positions = farPositions(FACE_MESH_VERTEX_COUNT)
    positions.set([0, 0, 0], 0)
    const half = computeContactShadowColors(positions, centre, radius, CONTACT_SHADOW_STRENGTH / 2)
    expect(alphaOf(half, 0)).toBeCloseTo(CONTACT_SHADOW_STRENGTH / 2)
  })
})

describe('contactShadowEllipse', () => {
  it('drops the centre below the anchor by CONTACT_SHADOW_DROP face half-widths', () => {
    const { centre } = contactShadowEllipse({ x: 0.2, y: 0.5 }, 1)
    expect(centre.x).toBe(0.2)
    expect(centre.y).toBeCloseTo(0.5 - CONTACT_SHADOW_DROP)
  })

  it('scales the radii with the face half-width', () => {
    const { radius } = contactShadowEllipse({ x: 0, y: 0 }, 2)
    expect(radius.x).toBeCloseTo(1.1)
    expect(radius.y).toBeCloseTo(0.8)
  })
})

describe('bridgeContact', () => {
  it('is the frame position when the head is not turned', () => {
    const contact = bridgeContact({ x: 0.3, y: -0.1 }, { x: 0, y: 0, z: 0 }, 13)
    expect(contact.x).toBeCloseTo(0.3)
    expect(contact.y).toBeCloseTo(-0.1)
  })

  it('moves back toward the face by the standoff when the head is turned', () => {
    const contact = bridgeContact({ x: 0, y: 0 }, { x: 0, y: 0.5, z: 0 }, 13)
    // Yaw 0.5 rad: the standoff points sideways, so the contact sits on the other side.
    expect(contact.x).toBeLessThan(0)
  })
})
