import { NEUTRAL_LUMA } from './tryon-lighting'

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

export function grainHash(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453
  return v - Math.floor(v)
}

export interface CameraMatchUniforms {
  uCameraGrain: { value: number }
  uCameraGrainSeed: { value: number }
  uCameraWrap: { value: number }
  uCameraWrapColor: { value: { r: number; g: number; b: number } }
}

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

export function lightWrapColor(
  tint: readonly [number, number, number],
  luma: number | null
): { r: number; g: number; b: number } {
  const level = Math.min(Math.max((luma ?? 0.5) * 1.2, 0), 1)
  return { r: tint[0] * level, g: tint[1] * level, b: tint[2] * level }
}
