/**
 * Match the webcam (issue #86): grain, a slight blur and light wrap on the
 * rendered frame, so it reads as filmed with the face instead of pasted on.
 * Pure parameters and the shader patch; no three.js objects.
 *
 * A webcam frame is noisy and a little soft, worst in dim rooms; the render
 * is clean and sharp. Three cheap cues close the gap:
 * - **Grain**: per-pixel noise on the frame's materials, stronger as the
 *   room's luma drops (the camera's gain rises), re-seeded per video frame
 *   like sensor noise. Low amplitude, so a still frame doesn't shimmer.
 * - **Blur**: a sub-pixel CSS blur of the canvas layer, which holds only the
 *   frame and its shadow (the video is its own element).
 * - **Light wrap**: at the frame's silhouette (grazing view angles) its
 *   colour leans toward the room's, the way bright background light bleeds
 *   over an edge in a real photo.
 *
 * Sources: ARKit's `cameraGrainTexture`; US11308652B2 (rendering objects to
 * match camera noise); Fischer et al., camera image effects for AR
 * compositing (TU Wien).
 */

import { NEUTRAL_LUMA } from './tryon-lighting'

/** Grain amplitude (fraction of full scale) in a neutral room. */
export const GRAIN_AT_NEUTRAL = 0.012

/** Grain bounds: a bright room still has a little, a dark one not too much. */
export const GRAIN_RANGE = { min: 0.006, max: 0.04 } as const

/**
 * Grain amplitude for a room luma: webcam noise grows as the gain rises in
 * a dim room, roughly with 1/√luma (shot noise). Null luma (unsampled) keeps
 * the neutral amount.
 */
export function grainAmount(luma: number | null): number {
  if (luma === null) return GRAIN_AT_NEUTRAL
  const amount = GRAIN_AT_NEUTRAL * Math.sqrt(NEUTRAL_LUMA / Math.max(luma, 0.01))
  return Math.min(Math.max(amount, GRAIN_RANGE.min), GRAIN_RANGE.max)
}

/** CSS blur of the canvas layer, in CSS pixels: a webcam is a touch soft. */
export const CAMERA_BLUR_PX = 0.6

/** How far the silhouette leans toward the room colour at a full grazing angle. */
export const LIGHT_WRAP_STRENGTH = 0.25

/** Exponent of the grazing-angle falloff of the light wrap (higher: thinner rim). */
export const LIGHT_WRAP_POWER = 3

/**
 * Light wrap weight at a view angle (`cosTheta` between the view direction
 * and the normal): zero face-on, `LIGHT_WRAP_STRENGTH` at the silhouette.
 * Mirrors the shader.
 */
export function lightWrapAt(cosTheta: number): number {
  const c = Math.min(Math.max(Math.abs(cosTheta), 0), 1)
  return LIGHT_WRAP_STRENGTH * (1 - c) ** LIGHT_WRAP_POWER
}

/**
 * Hash noise in [0, 1) for a pixel and seed (the shader's `cameraGrainHash`),
 * exposed so tests can check it stays bounded and changes with the seed.
 */
export function grainHash(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453
  return v - Math.floor(v)
}

/** Uniform names the patch adds (one shared object updates every material). */
export interface CameraMatchUniforms {
  uCameraGrain: { value: number }
  uCameraGrainSeed: { value: number }
  uCameraWrap: { value: number }
  uCameraWrapColor: { value: { r: number; g: number; b: number } }
}

/**
 * Patch a standard/physical material fragment shader: light wrap toward
 * `uCameraWrapColor` at grazing angles, then grain, scaled by the pixel's
 * alpha (so a semi-transparent lens gets proportionally less). Inserted
 * before `#include <dithering_fragment>`, after tone mapping and the
 * colour-space encode, so the amounts are in display terms.
 */
export function patchCameraMatchShader(fragmentShader: string): string {
  return fragmentShader
    .replace(
      'void main() {',
      `uniform float uCameraGrain;
uniform float uCameraGrainSeed;
uniform float uCameraWrap;
uniform vec3 uCameraWrapColor;
float cameraGrainHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) + uCameraGrainSeed ) * 43758.5453 );
}
void main() {`
    )
    .replace(
      '#include <dithering_fragment>',
      `float cameraFacing = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float cameraRim = pow( 1.0 - saturate( cameraFacing ), ${LIGHT_WRAP_POWER.toFixed(1)} );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uCameraWrapColor * gl_FragColor.a, uCameraWrap * cameraRim );
  gl_FragColor.rgb += ( cameraGrainHash( gl_FragCoord.xy ) - 0.5 ) * 2.0 * uCameraGrain * gl_FragColor.a;
  #include <dithering_fragment>`
    )
}

/**
 * The room's average colour in display terms, for the light wrap: its hue
 * (`tint`, brightest channel 1) at its brightness (`luma`, lifted a little
 * since a wrap comes from the brighter background). Neutral grey without a
 * sample.
 */
export function lightWrapColor(
  tint: readonly [number, number, number],
  luma: number | null
): { r: number; g: number; b: number } {
  const level = Math.min(Math.max((luma ?? 0.5) * 1.2, 0), 1)
  return { r: tint[0] * level, g: tint[1] * level, b: tint[2] * level }
}
