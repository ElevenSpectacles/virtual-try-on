/**
 * Contact shadow of the frame on the face (issue #6): the scene's key light
 * casts a soft shadow map from the frame's opaque parts (rims, bridge,
 * temples) onto the tracked face mesh, drawn with a shadow-only material.
 *
 * The receiver is the per-frame face-mesh occluder, so the shadow follows
 * the head's yaw and pitch, lands only on skin and stops at the face
 * silhouette. Because the frame stands off the face
 * (FRAME_BRIDGE_STANDOFF_METERS), the shadow falls a few millimetres below
 * and beside each rim, which is what grounds a real pair of glasses: a thin
 * band under the lenses on the cheeks, and under the pads beside the nose.
 *
 * This file holds the pure framing math for the shadow camera (no three.js).
 */

/** Peak opacity of the shadow on skin. Kept subtle: a cue, not a hard shadow. */
export const CONTACT_SHADOW_STRENGTH = 0.22

/**
 * Direction the shadow light shines from (unnormalized, world space): mostly
 * from the front, a little above and to the right. Its own light, with no
 * intensity, so the frame's shading keeps the studio key light. Steep light
 * throws the shadow of a lens 2–3 cm onto the cheek, which reads as a dark
 * patch; with this angle it lands about a centimetre below the rims, where
 * a real pair's shadow sits under ordinary room light.
 */
export const SHADOW_LIGHT_DIRECTION = { x: 0.6, y: 2, z: 6 } as const

/**
 * Half-size of the shadow camera's square frustum per unit of frame scale.
 * A frame is about 0.14 m wide; 0.16 m each way also covers the temples and
 * the shadow below the frame, so the shadow never ends on the frustum edge.
 */
export const SHADOW_HALF_EXTENT_METERS = 0.16

/** Distance from the frame to the shadow light along its direction, per unit of scale. */
export const SHADOW_LIGHT_DISTANCE_METERS = 0.5

export interface ContactShadowLight {
  /** Light position (world units). */
  position: { x: number; y: number; z: number }
  /** Light target: the frame's position. */
  target: { x: number; y: number; z: number }
  /** Half-size of the orthographic shadow camera (world units). */
  halfExtent: number
  /** Shadow camera near/far planes (world units). */
  near: number
  far: number
}

/**
 * Frame the shadow light's camera on the frame: aimed at the frame
 * position along `SHADOW_LIGHT_DIRECTION`, sized to the frame's scale (the GLB
 * is in metres, scaled into world units by `scale`).
 */
export function contactShadowLight(
  framePosition: { x: number; y: number; z?: number },
  scale: number
): ContactShadowLight {
  const d = SHADOW_LIGHT_DIRECTION
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
