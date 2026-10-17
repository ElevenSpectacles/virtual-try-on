/**
 * Lens look (issue #10): per-model tint resolution and the Fresnel term the
 * physical lens material uses. Pure math, no three.js.
 *
 * The catalog's lenses are plano sunglass lenses: they bend the background by
 * a fraction of a pixel, so screen-space refraction would cost a video
 * texture pass for nothing visible. What sells glass over a video feed is how
 * the lens reflects: stronger and more opaque toward grazing angles
 * (Fresnel), a faint thin-film sheen from the anti-reflective coating, and
 * sharp highlights from a polished surface. That is what the material does.
 */

/**
 * ISO 12312-1 filter category of a sunglass lens, from its luminous
 * transmittance τv: 0 (80–100 %), 1 (43–80 %), 2 (18–43 %), 3 (8–18 %),
 * 4 (3–8 %). Printed on every sunglass product sheet.
 */
export type TryOnLensCategory = 0 | 1 | 2 | 3 | 4

/**
 * Mid-range transmittance of each category (the arithmetic middle of its
 * band), used when only the category is known.
 */
export const LENS_CATEGORY_TRANSMITTANCE: Record<TryOnLensCategory, number> = {
  0: 0.9,
  1: 0.615,
  2: 0.305,
  3: 0.13,
  4: 0.055
}

/**
 * Lens density (0 clear … 1 opaque, what the renderer uses as opacity at
 * normal incidence) from a luminous transmittance τv: density = 1 − τv.
 */
export function densityFromTransmittance(transmittance: number): number {
  return Math.min(Math.max(1 - transmittance, 0), 1)
}

/** Lens density of an ISO 12312-1 category (its band's middle). */
export function densityFromCategory(category: TryOnLensCategory): number {
  return densityFromTransmittance(LENS_CATEGORY_TRANSMITTANCE[category])
}

/** Per-model lens override from `calibration.json` (`lens` on a model entry). */
export interface TryOnLensCalibration {
  /** Lens colour as `#rrggbb`; replaces the authored base colour. */
  tint?: string
  /**
   * How dark the lens is, 0 (clear) … 1 (opaque), at normal incidence;
   * replaces the authored opacity. Prefer the physical `transmittance` or
   * `category` from the product sheet; `density` wins when several are set.
   */
  density?: number
  /** Luminous transmittance τv, 0 … 1, from the product sheet (density = 1 − τv). */
  transmittance?: number
  /** ISO 12312-1 filter category, when the sheet gives no τv. */
  category?: TryOnLensCategory
  /**
   * Gradient lens: density at the top and bottom of the lens (0 … 1), dark
   * to light top to bottom for the usual gradient. Replaces the single
   * density. Use `densityFromCategory` for categories.
   */
  gradient?: { top: number; bottom: number }
}

/** A resolved lens override: null fields keep the GLB's authored value. */
export interface TryOnLens {
  /** Linear-agnostic sRGB 0…1 channels, or null for the authored colour. */
  tint: [number, number, number] | null
  density: number | null
  /** Densities at the lens's top and bottom, or null for a uniform lens. */
  gradient: { top: number; bottom: number } | null
}

export const NO_LENS_OVERRIDE: TryOnLens = { tint: null, density: null, gradient: null }

/** `#rrggbb` (or `rrggbb`) → 0…1 channels; null when malformed. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null

/**
 * Validate a calibration lens entry. Malformed fields fall back to the
 * authored value. Density comes from `density`, else `transmittance`, else
 * `category`.
 */
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

/**
 * Density across a gradient lens at height `t` (0 bottom … 1 top), with a
 * smooth middle like a real gradient tint. Mirrors the lens shader.
 */
export function gradientDensityAt(gradient: { top: number; bottom: number }, t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  const s = x * x * (3 - 2 * x)
  return gradient.bottom + (gradient.top - gradient.bottom) * s
}

/** Reflectance of uncoated crown glass / polycarbonate at normal incidence (IOR ≈ 1.5). */
export const LENS_F0 = 0.04

/**
 * Schlick's Fresnel approximation: the fraction of light a surface reflects
 * at `cosTheta` (cosine between the view direction and the surface normal).
 */
export function schlickFresnel(cosTheta: number, f0: number = LENS_F0): number {
  const c = Math.min(Math.max(cosTheta, 0), 1)
  return f0 + (1 - f0) * (1 - c) ** 5
}

/**
 * Lens opacity at an angle: the authored opacity at normal incidence, rising
 * toward 1 at grazing angles as more light is reflected than transmitted.
 * Mirrors the shader chunk in TryOnScene.vue.
 */
export function lensOpacityAt(opacity: number, cosTheta: number): number {
  // Fresnel above its head-on value, normalized to 0…1.
  const reflected = (schlickFresnel(cosTheta) - LENS_F0) / (1 - LENS_F0)
  return opacity + (1 - opacity) * reflected
}

/** Vertex attribute holding each lens vertex's height, 0 bottom … 1 top. */
export const LENS_HEIGHT_ATTRIBUTE = 'tryOnLensHeight'

/**
 * Patch a lens material's shaders for a gradient tint: the base opacity
 * follows the lens height (`LENS_HEIGHT_ATTRIBUTE`) between
 * `uLensGradient[0]` (bottom) and `[1]` (top), as `gradientDensityAt`.
 */
export function patchLensGradientShader(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nattribute float ${LENS_HEIGHT_ATTRIBUTE};\nvarying float vLensHeight;`
    )
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLensHeight = ${LENS_HEIGHT_ATTRIBUTE};`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uLensGradient[2];\nvarying float vLensHeight;')
    .replace(
      '#include <alphamap_fragment>',
      `#include <alphamap_fragment>
      float lensT = smoothstep( 0.0, 1.0, clamp( vLensHeight, 0.0, 1.0 ) );
      diffuseColor.a = mix( uLensGradient[ 0 ], uLensGradient[ 1 ], lensT );`
    )
}
