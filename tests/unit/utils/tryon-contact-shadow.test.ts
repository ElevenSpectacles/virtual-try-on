import { describe, expect, it } from 'vitest'
import {
  SHADOW_LIGHT_DIRECTION,
  SHADOW_HALF_EXTENT_METERS,
  contactShadowLight
} from '../../../src/runtime/utils/tryon-contact-shadow'

describe('contactShadowLight', () => {
  it('aims the light at the frame', () => {
    const light = contactShadowLight({ x: 0.3, y: -0.1, z: 0.05 }, 7)
    expect(light.target).toEqual({ x: 0.3, y: -0.1, z: 0.05 })
  })

  it('places the light along the shadow-light direction', () => {
    const light = contactShadowLight({ x: 0, y: 0 }, 7)
    const d = SHADOW_LIGHT_DIRECTION
    const length = Math.hypot(d.x, d.y, d.z)
    const p = light.position
    const distance = Math.hypot(p.x, p.y, p.z)
    expect(p.x / distance).toBeCloseTo(d.x / length)
    expect(p.y / distance).toBeCloseTo(d.y / length)
    expect(p.z / distance).toBeCloseTo(d.z / length)
    // Light above and in front: the shadow drops below the rims, toward the face.
    expect(p.y).toBeGreaterThan(0)
    expect(p.z).toBeGreaterThan(0)
  })

  it('sizes the shadow camera with the frame', () => {
    const near = contactShadowLight({ x: 0, y: 0 }, 10)
    const far = contactShadowLight({ x: 0, y: 0 }, 5)
    expect(near.halfExtent).toBeCloseTo(SHADOW_HALF_EXTENT_METERS * 10)
    expect(far.halfExtent).toBeCloseTo(near.halfExtent / 2)
  })

  it('keeps the frame between the near and far planes', () => {
    const light = contactShadowLight({ x: 0.1, y: 0.2, z: 0 }, 7)
    const p = light.position
    const t = light.target
    const distance = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)
    expect(light.near).toBeLessThan(distance)
    expect(light.far).toBeGreaterThan(distance + light.halfExtent)
  })
})
