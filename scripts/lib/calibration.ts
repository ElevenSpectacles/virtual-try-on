/**
 * Calibration maths for `scripts/generate-calibration.ts`, kept free of file
 * and GLB I/O so it can be unit-tested (tests/unit/scripts/calibration.test.ts).
 *
 * GLB exports rarely share an origin or a scale, so each frame gets:
 * - `translation`: brings its bounding box onto the tracked anchor. X and Y
 *   centre the box; Z puts the FRONT of the frame (the lens plane, `max.z`)
 *   on it. Centring Z would put the middle of the temples at the anchor and
 *   push the lenses half a temple-length toward the camera.
 * - `scale`: normalises its size to the reference frame, from the mean of the
 *   width and height ratios. Depth is barely visible face-on, so it is left
 *   out.
 *
 * Fields tuned by hand (`rotation`, `templeWidthBoost`, `lens`) are carried
 * over from the previous manifest, so regenerating never wipes them.
 */
import type {
  TryOnCalibrationFile,
  TryOnModelCalibration
} from '../../src/runtime/types/tryon-calibration'

export interface Bounds {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export interface MeasuredModel {
  /** GLB filename without `.glb`. */
  name: string
  bounds: Bounds
}

export const CALIBRATION_SCHEMA_VERSION = '1.0.0'

function round(value: number, digits: number): number {
  // `+ 0` turns -0 into 0, so a centred axis serialises as 0, not -0.
  return Number(value.toFixed(digits)) + 0
}

export function modelCalibration(
  model: MeasuredModel,
  reference: MeasuredModel,
  previous?: TryOnModelCalibration
): TryOnModelCalibration {
  const { min, max } = model.bounds
  const width = max.x - min.x
  const height = max.y - min.y
  const refWidth = reference.bounds.max.x - reference.bounds.min.x
  const refHeight = reference.bounds.max.y - reference.bounds.min.y
  if (width <= 0 || height <= 0) {
    throw new Error(`${model.name}: empty bounding box`)
  }

  const entry: TryOnModelCalibration = {
    model: model.name,
    translation: {
      x: round(-(min.x + max.x) / 2, 6),
      y: round(-(min.y + max.y) / 2, 6),
      z: round(-max.z, 6)
    },
    rotation: previous?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: round((refWidth / width + refHeight / height) / 2, 4)
  }
  if (previous?.templeWidthBoost !== undefined) {
    entry.templeWidthBoost = previous.templeWidthBoost
  }
  if (previous?.lens !== undefined) entry.lens = previous.lens
  return entry
}

/**
 * The manifest for `models`, normalised against `referenceName`. `previous`
 * (the manifest being replaced, if any) supplies the hand-tuned fields.
 * Models are listed in name order, so regenerating gives a stable diff.
 */
export function buildCalibration(
  models: MeasuredModel[],
  referenceName: string,
  previous?: TryOnCalibrationFile | null
): TryOnCalibrationFile {
  const reference = models.find((m) => m.name === referenceName)
  if (!reference) {
    throw new Error(
      `Reference model ${referenceName} not found among ${models.map((m) => m.name).join(', ')}`
    )
  }
  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name))
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    reference: referenceName,
    models: Object.fromEntries(
      sorted.map((model) => [
        model.name,
        modelCalibration(model, reference, previous?.models?.[model.name])
      ])
    )
  }
}
