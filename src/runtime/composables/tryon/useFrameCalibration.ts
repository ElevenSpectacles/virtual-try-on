import type {
  TryOnCalibrationFile,
  TryOnFrameCalibration,
  TryOnModelCalibration
} from '../../types/tryon-calibration'
import { NO_LENS_OVERRIDE, resolveLens } from '../../utils/tryon-lens'
import { useFetch } from '#imports'

const DEFAULT_CALIBRATION: TryOnFrameCalibration = {
  model: 'unknown',
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
  lens: NO_LENS_OVERRIDE,
  padSpacingMm: null,
  frameWidthMm: 0
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function vector(
  value: unknown,
  field: string,
  problems: string[],
  limit: number
): { x: number; y: number; z: number } | null {
  const v = value as Record<string, unknown> | null | undefined
  if (
    v &&
    typeof v === 'object' &&
    finite(v.x) &&
    finite(v.y) &&
    finite(v.z) &&
    Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) <= limit
  ) {
    return { x: v.x, y: v.y, z: v.z }
  }
  problems.push(`${field} must be { x, y, z } numbers within ±${limit}`)
  return null
}

/**
 * Calibration of `model` from a manifest, plus what is wrong with its entry
 * (issue #103). A typo used to show only as a misplaced frame; now each
 * invalid field falls back to its default and is listed in `problems`, for
 * the component to report (`TRY_ON_ERROR`, source `calibration`). A model
 * without an entry is not a problem: it gets the identity calibration.
 */
export function validateCalibration(
  manifest: TryOnCalibrationFile | null | undefined,
  model: string
): { calibration: TryOnFrameCalibration; problems: string[] } {
  const entry = manifest?.models?.[model] as Record<string, unknown> | undefined
  if (!entry) return { calibration: DEFAULT_CALIBRATION, problems: [] }
  const problems: string[] = []
  // Translations are metres (a frame is ~0.14 m), rotations radians.
  const translation = vector(entry.translation, 'translation', problems, 0.5)
  const rotation = vector(entry.rotation, 'rotation', problems, Math.PI)
  let scale = 1
  if (finite(entry.scale) && entry.scale >= 0.2 && entry.scale <= 5) scale = entry.scale
  else problems.push('scale must be a number between 0.2 and 5')
  // `templeWidthBoost` (removed in 5.0) is ignored in older manifests.
  const lensEntry = entry.lens as TryOnModelCalibration['lens'] | undefined
  const lens = resolveLens(lensEntry)
  if (lensEntry !== undefined) {
    if (typeof lensEntry !== 'object' || lensEntry === null) problems.push('lens must be an object')
    else {
      if (lensEntry.tint !== undefined && !lens.tint) problems.push('lens.tint must be #rrggbb')
      const unit = (value: unknown) => finite(value) && value >= 0 && value <= 1
      if (lensEntry.density !== undefined && !unit(lensEntry.density)) {
        problems.push('lens.density must be between 0 and 1')
      }
      if (lensEntry.transmittance !== undefined && !unit(lensEntry.transmittance)) {
        problems.push('lens.transmittance must be between 0 and 1')
      }
      if (
        lensEntry.category !== undefined &&
        !(Number.isInteger(lensEntry.category) && lensEntry.category >= 0 && lensEntry.category <= 4)
      ) {
        problems.push('lens.category must be an ISO 12312-1 category 0-4')
      }
      // resolveLens clamps, so check the raw values: a sheet in percent
      // (top: 85) would otherwise become an opaque lens without a report.
      const gradient = lensEntry.gradient as { top?: unknown; bottom?: unknown } | undefined
      if (gradient !== undefined && !(unit(gradient?.top) && unit(gradient?.bottom))) {
        problems.push('lens.gradient must be { top, bottom } between 0 and 1')
      }
    }
  }
  let padSpacingMm: number | null = null
  const pads = entry.pads as { spacingMm?: unknown } | undefined
  if (pads !== undefined) {
    if (finite(pads?.spacingMm) && pads.spacingMm > 0) padSpacingMm = pads.spacingMm
    else problems.push('pads.spacingMm must be a positive number of millimetres')
  }
  let frameWidthMm = 0
  if (entry.frameWidthMm !== undefined) {
    if (finite(entry.frameWidthMm) && entry.frameWidthMm > 0) frameWidthMm = entry.frameWidthMm
    else problems.push('frameWidthMm must be a positive number of millimetres')
  }
  return {
    calibration: {
      model: typeof entry.model === 'string' ? entry.model : model,
      translation: translation ?? DEFAULT_CALIBRATION.translation,
      rotation: rotation ?? DEFAULT_CALIBRATION.rotation,
      scale,
      lens,
      padSpacingMm,
      frameWidthMm
    },
    problems
  }
}

/**
 * The calibration of `model` from a manifest, identity when absent. Fields
 * removed in 5.0 (`templeWidthBoost`) are ignored if a manifest still has
 * them.
 */
export function getCalibrationFromManifest(
  manifest: TryOnCalibrationFile | null | undefined,
  model: string
): TryOnFrameCalibration {
  return validateCalibration(manifest, model).calibration
}

/**
 * Load a calibration manifest once and return a lookup for per-frame
 * calibration.
 *
 * The manifest is fetched with `useFetch` so it participates in SSR/hydration
 * and is cached across model switches. Errors fall back to identity values.
 */
export function useFrameCalibration(calibrationUrl: string) {
  const { data: manifest } = useFetch<TryOnCalibrationFile | null>(
    calibrationUrl,
    {
      key: `tryon-frame-calibration-${calibrationUrl}`,
      server: false,
      default: () => null
    }
  )

  function getCalibration(model: string): TryOnFrameCalibration {
    return getCalibrationFromManifest(manifest.value, model)
  }

  /** What is wrong with `model`'s entry (empty when valid or absent). */
  function getCalibrationProblems(model: string): string[] {
    return validateCalibration(manifest.value, model).problems
  }

  return {
    manifest,
    getCalibration,
    getCalibrationProblems
  }
}
