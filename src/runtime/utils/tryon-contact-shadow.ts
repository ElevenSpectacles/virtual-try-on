export const CONTACT_SHADOW_STRENGTH = 0.22

export const SHADOW_LIGHT_DIRECTION = { x: 0.6, y: 2, z: 6 } as const

export const SHADOW_HALF_EXTENT_METERS = 0.16

export const SHADOW_LIGHT_DISTANCE_METERS = 0.5

export interface ContactShadowLight {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  halfExtent: number
  near: number
  far: number
}

export function contactShadowLight(
  framePosition: { x: number; y: number; z?: number },
  scale: number,
  direction: { x: number; y: number; z: number } = SHADOW_LIGHT_DIRECTION
): ContactShadowLight {
  const d = direction
  const length = Math.hypot(d.x, d.y, d.z)
  const distance = SHADOW_LIGHT_DISTANCE_METERS * scale
  const target = { x: framePosition.x, y: framePosition.y, z: framePosition.z ?? 0 }
  return {
    position: {
      x: target.x + (d.x / length) * distance,
      y: target.y + (d.y / length) * distance,
      z: target.z + (d.z / length) * distance
    },
    target,
    halfExtent: SHADOW_HALF_EXTENT_METERS * scale,
    near: distance * 0.25,
    far: distance * 2
  }
}
