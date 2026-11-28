import { patchShader, smoothstep } from './tryon-shader'

export const LENS_MATERIAL_NAME = /glass|lens/i

export type TryOnLensCategory = 0 | 1 | 2 | 3 | 4

export const LENS_CATEGORY_TRANSMITTANCE: Record<TryOnLensCategory, number> = {
  0: 0.9,
  1: 0.615,
  2: 0.305,
  3: 0.13,
  4: 0.055
}

export function densityFromTransmittance(transmittance: number): number {
  return Math.min(Math.max(1 - transmittance, 0), 1)
}

export function densityFromCategory(category: TryOnLensCategory): number {
  return densityFromTransmittance(LENS_CATEGORY_TRANSMITTANCE[category])
}

export interface TryOnLensCalibration {
  tint?: string
  density?: number
  transmittance?: number
  category?: TryOnLensCategory
  gradient?: { top: number; bottom: number }
}

export interface TryOnLens {
  tint: [number, number, number] | null
  density: number | null
  gradient: { top: number; bottom: number } | null
}

export const NO_LENS_OVERRIDE: TryOnLens = { tint: null, density: null, gradient: null }

export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null

export function resolveLens(entry: TryOnLensCalibration | undefined): TryOnLens {
  if (!entry) return NO_LENS_OVERRIDE
  const tint = typeof entry.tint === 'string' ? parseHexColor(entry.tint) : null
  const transmittance = unit(entry.transmittance)
  const category =
    typeof entry.category === 'number' && entry.category in LENS_CATEGORY_TRANSMITTANCE
      ? (entry.category as TryOnLensCategory)
      : null
  const density =
    unit(entry.density) ??
    (transmittance !== null ? densityFromTransmittance(transmittance) : null) ??
    (category !== null ? densityFromCategory(category) : null)
  const top = unit(entry.gradient?.top)
  const bottom = unit(entry.gradient?.bottom)
  const gradient = top !== null && bottom !== null ? { top, bottom } : null
  return { tint, density, gradient }
}

export const LENS_MIN_TRANSMITTANCE = 0.001

export function lensGradientLogTransmittance(gradient: { top: number; bottom: number }): [number, number] {
  const logT = (density: number) => Math.log(Math.max(1 - density, LENS_MIN_TRANSMITTANCE))
  return [logT(gradient.bottom), logT(gradient.top)]
}

export function gradientDensityAt(gradient: { top: number; bottom: number }, t: number): number {
  const s = smoothstep(0, 1, t)
  const [bottom, top] = lensGradientLogTransmittance(gradient)
  return 1 - Math.exp(bottom + (top - bottom) * s)
}

export const LENS_F0 = 0.04

export function schlickFresnel(cosTheta: number, f0: number = LENS_F0): number {
  const c = Math.min(Math.max(cosTheta, 0), 1)
  return f0 + (1 - f0) * (1 - c) ** 5
}

export function lensOpacityAt(opacity: number, cosTheta: number): number {
  const reflected = (schlickFresnel(Math.abs(cosTheta)) - LENS_F0) / (1 - LENS_F0)
  return opacity + (1 - opacity) * reflected
}

export const LENS_GLSL = /* glsl */ `
#ifndef TRY_ON_LENS_GLSL
#define TRY_ON_LENS_GLSL
float tryOnGradientAlpha( float height, vec2 logTransmittance ) {
  float t = smoothstep( 0.0, 1.0, clamp( height, 0.0, 1.0 ) );
  return 1.0 - exp( mix( logTransmittance.x, logTransmittance.y, t ) );
}
float tryOnLensOpacity( float opacity, float cosTheta ) {
  float grazing = pow( 1.0 - saturate( abs( cosTheta ) ), 5.0 );
  return opacity + ( 1.0 - opacity ) * grazing;
}
#endif
`

export const LENS_HEIGHT_ATTRIBUTE = 'tryOnLensHeight'

export function patchLensGradientShader(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = patchShader(
    patchShader(
      shader.vertexShader,
      '#include <common>',
      `#include <common>\nattribute float ${LENS_HEIGHT_ATTRIBUTE};\nvarying float vLensHeight;`
    ),
    '#include <begin_vertex>',
    `#include <begin_vertex>\nvLensHeight = ${LENS_HEIGHT_ATTRIBUTE};`
  )
  shader.fragmentShader = patchShader(
    patchShader(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>\nuniform float uLensGradient[2];\nvarying float vLensHeight;\n${LENS_GLSL}`
    ),
    '#include <alphamap_fragment>',
    `#include <alphamap_fragment>
      diffuseColor.a = tryOnGradientAlpha( vLensHeight, vec2( uLensGradient[ 0 ], uLensGradient[ 1 ] ) );`
  )
}

export function patchLensFresnelShader(fragmentShader: string): string {
  return patchShader(
    patchShader(
      patchShader(fragmentShader, '#include <common>', `#include <common>\n${LENS_GLSL}`),
      '#include <opaque_fragment>',
      `diffuseColor.a = tryOnLensOpacity( diffuseColor.a, dot( normal, geometryViewDir ) );
        vec3 lensReflected = max( outgoingLight - totalDiffuse, vec3( 0.0 ) );
        gl_FragColor = vec4( totalDiffuse * diffuseColor.a + lensReflected, diffuseColor.a );`
    ),
    '#include <premultiplied_alpha_fragment>',
    ''
  )
}
