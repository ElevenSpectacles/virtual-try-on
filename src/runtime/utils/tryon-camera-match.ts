import { NEUTRAL_LUMA } from './tryon-lighting'
import { patchShader } from './tryon-shader'

export const GRAIN_AT_NEUTRAL = 0.012

export const GRAIN_RANGE = { min: 0.006, max: 0.04 } as const

export function grainAmount(luma: number | null): number {
  if (luma === null) return GRAIN_AT_NEUTRAL
  const amount = GRAIN_AT_NEUTRAL * Math.sqrt(NEUTRAL_LUMA / Math.max(luma, 0.01))
  return Math.min(Math.max(amount, GRAIN_RANGE.min), GRAIN_RANGE.max)
}

export const CAMERA_BLUR_PX = 0.6

export const LIGHT_WRAP_STRENGTH = 0.25

export const LIGHT_WRAP_POWER = 3

export function lightWrapAt(cosTheta: number): number {
  const c = Math.min(Math.max(Math.abs(cosTheta), 0), 1)
  return LIGHT_WRAP_STRENGTH * (1 - c) ** LIGHT_WRAP_POWER
}

export const GRAIN_HASH = { x: 12.9898, y: 78.233, scale: 43758.5453 } as const

export function grainHash(x: number, y: number, seed: number): number {
  const v = Math.sin(x * GRAIN_HASH.x + y * GRAIN_HASH.y + seed) * GRAIN_HASH.scale
  return v - Math.floor(v)
}

export const CAMERA_MATCH_GLSL = /* glsl */ `
float tryOnGrainHash( vec2 p, float seed ) {
  return fract( sin( dot( p, vec2( ${GRAIN_HASH.x}, ${GRAIN_HASH.y} ) ) + seed ) * ${GRAIN_HASH.scale} );
}
float tryOnLightWrapRim( float cosTheta ) {
  return pow( 1.0 - saturate( abs( cosTheta ) ), ${LIGHT_WRAP_POWER.toFixed(1)} );
}
`

export interface CameraMatchUniforms {
  uCameraGrain: { value: number }
  uCameraGrainSeed: { value: number }
  uCameraWrap: { value: number }
  uCameraWrapColor: { value: { r: number; g: number; b: number } }
}

export function patchCameraMatchShader(fragmentShader: string): string {
  const withUniforms = patchShader(
    fragmentShader,
    'void main() {',
    `uniform float uCameraGrain;
uniform float uCameraGrainSeed;
uniform float uCameraWrap;
uniform vec3 uCameraWrapColor;
${CAMERA_MATCH_GLSL}
void main() {`
  )
  return patchShader(
    withUniforms,
    '#include <dithering_fragment>',
    `float cameraRim = tryOnLightWrapRim( dot( normalize( normal ), normalize( vViewPosition ) ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uCameraWrapColor * gl_FragColor.a, uCameraWrap * cameraRim );
  gl_FragColor.rgb += ( tryOnGrainHash( gl_FragCoord.xy, uCameraGrainSeed ) - 0.5 ) * 2.0 * uCameraGrain * gl_FragColor.a;
  #include <dithering_fragment>`
  )
}

export function lightWrapColor(
  tint: readonly [number, number, number],
  luma: number | null
): { r: number; g: number; b: number } {
  const level = Math.min(Math.max((luma ?? 0.5) * 1.2, 0), 1)
  return { r: tint[0] * level, g: tint[1] * level, b: tint[2] * level }
}
