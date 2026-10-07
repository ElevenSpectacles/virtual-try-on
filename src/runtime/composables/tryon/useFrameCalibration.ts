import type {
  TryOnCalibrationFile,
  TryOnFrameCalibration
} from '../../types/tryon-calibration'
import { useFetch } from '#imports'

const DEFAULT_CALIBRATION: TryOnFrameCalibration = {
  model: 'unknown',
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
  templeWidthBoost: 1
}

export function getCalibrationFromManifest(
  manifest: TryOnCalibrationFile | null | undefined,
  model: string
): TryOnFrameCalibration {
  if (!manifest?.models) {
    return DEFAULT_CALIBRATION
  }

  const entry = manifest.models[model]
  if (!entry) {
    return DEFAULT_CALIBRATION
  }

  return {
    model: entry.model,
    translation: entry.translation,
    rotation: entry.rotation,
    scale: entry.scale,
    templeWidthBoost: entry.templeWidthBoost ?? 1
  }
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

  return {
    manifest,
    getCalibration
  }
}
