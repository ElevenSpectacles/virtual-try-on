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

/** Per-model lens override from `calibration.json` (`lens` on a model entry). */
export interface TryOnLensCalibration {
  /** Lens colour as `#rrggbb`; replaces the authored base colour. */
  tint?: string
  /**
   * How dark the lens is, 0 (clear) … 1 (opaque), at normal incidence;
   * replaces the authored opacity.
   */
  density?: number
}

/** A resolved lens override: null fields keep the GLB's authored value. */
export interface TryOnLens {
  /** Linear-agnostic sRGB 0…1 channels, or null for the authored colour. */
  tint: [number, number, number] | null
  density: number | null
}

export const NO_LENS_OVERRIDE: TryOnLens = { tint: null, density: null }

/** `#rrggbb` (or `rrggbb`) → 0…1 channels; null when malformed. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** Validate a calibration lens entry. Malformed fields fall back to the authored value. */
export function resolveLens(entry: TryOnLensCalibration | undefined): TryOnLens {
  if (!entry) return NO_LENS_OVERRIDE
  const tint = typeof entry.tint === 'string' ? parseHexColor(entry.tint) : null
  const density =
    typeof entry.density === 'number' && Number.isFinite(entry.density)
      ? Math.min(Math.max(entry.density, 0), 1)
      : null
  return { tint, density }
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
