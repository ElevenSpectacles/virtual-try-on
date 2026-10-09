import { FACE_MESH_VERTEX_COUNT } from './face-mesh-triangles'
import { FRAME_BRIDGE_STANDOFF_METERS, headForwardOffset } from './tryon'

/**
 * Soft contact shadow of the frame on the skin, as per-vertex colours on the
 * face-mesh occluder.
 *
 * The occluder is the tracked face surface, so a shadow painted on its
 * vertices follows the head's yaw and pitch for free. The mesh is drawn
 * with its own depth, so the shadow sits on skin and stops at the face
 * silhouette.
 *
 * Pure functions only (no DOM, no Vue).
 */

/** Peak opacity of the shadow, at the frame's centre. Kept subtle: a cue, not a shadow. */
export const CONTACT_SHADOW_STRENGTH = 0.35

/**
 * RGBA colour per occluder vertex (`vertexCount * 4` floats). Black with
 * alpha falling off quadratically from `centre` to the `radius` ellipse,
 * zero outside it.
 *
 * Only the tracked skin vertices get shadow. The collar ring after them sits
 * behind the ears and must stay clear.
 */
export function computeContactShadowColors(
  positions: Float32Array,
  centre: { x: number; y: number },
  radius: { x: number; y: number },
  strength: number = CONTACT_SHADOW_STRENGTH
): Float32Array {
  const vertexCount = positions.length / 3
  const colors = new Float32Array(vertexCount * 4)
  if (radius.x <= 0 || radius.y <= 0 || strength <= 0) return colors

  const skinCount = Math.min(vertexCount, FACE_MESH_VERTEX_COUNT)
  for (let i = 0; i < skinCount; i++) {
    const dx = (positions[i * 3]! - centre.x) / radius.x
    const dy = (positions[i * 3 + 1]! - centre.y) / radius.y
    const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))
    colors[i * 4 + 3] = strength * falloff * falloff
  }
  return colors
}

/**
 * Where the shadow ellipse sits, relative to the face: centred `CONTACT_SHADOW_DROP`
 * face-half-widths below the frame's anchor (the bridge), so the shadow lands on
 * the cheeks and under the lenses rather than only above them.
 */
export const CONTACT_SHADOW_DROP = 0.6

/**
 * Where the frame touches the skin at the bridge, in the same world units as the
 * occluder. The frame stands off the face along the head's forward axis
 * (FRAME_BRIDGE_STANDOFF_METERS), so the contact is the frame position minus that
 * offset. The occluder centre is not the contact: it is pushed back into the head.
 */
export function bridgeContact(
  framePosition: { x: number; y: number },
  euler: { x: number; y: number; z: number },
  scale: number
): { x: number; y: number } {
  const standoff = headForwardOffset(euler, FRAME_BRIDGE_STANDOFF_METERS * scale)
  return { x: framePosition.x - standoff.x, y: framePosition.y - standoff.y }
}

export function contactShadowEllipse(
  contact: { x: number; y: number },
  faceHalfWidth: number
): { centre: { x: number; y: number }; radius: { x: number; y: number } } {
  return {
    centre: { x: contact.x, y: contact.y - CONTACT_SHADOW_DROP * faceHalfWidth },
    radius: { x: faceHalfWidth * 0.55, y: faceHalfWidth * 0.4 }
  }
}
