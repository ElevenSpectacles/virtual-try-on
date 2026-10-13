/**
 * Per-model calibration for the Virtual Try-On module.
 *
 * Because GLB frame models do not share a consistent bounding-box baseline,
 * each model needs explicit offsets so the frame sits on the user's face in
 * the same way.
 *
 * The values are expressed in the model's local coordinate space and applied
 * before user-facing scale/yaw fine-tuning.
 */

import type { TryOnLens, TryOnLensCalibration } from '../utils/tryon-lens'

export interface TryOnModelCalibration {
  /** Model identifier — matches the GLB filename without extension. */
  model: string
  /** Translation offset applied to the face landmark position (metres). */
  translation: {
    x: number
    y: number
    z: number
  }
  /** Rotation offset applied on top of the tracked head pose (radians). */
  rotation: {
    x: number
    y: number
    z: number
  }
  /**
   * Scale multiplier applied to the base uniform scale.
   * A value of 1 leaves the artist-authored size unchanged.
   */
  scale: number
  /**
   * Horizontal-only multiplier on top of the uniform scale, widening or
   * narrowing temple reach without inflating lens height/depth. Optional —
   * defaults to 1 (no-op) when absent.
   */
  templeWidthBoost?: number
  /**
   * Lens tint and density, replacing the GLB's authored lens colour and
   * opacity — e.g. one GLB shipped in several lens colours. Optional.
   */
  lens?: TryOnLensCalibration
}

export interface TryOnCalibrationFile {
  schemaVersion: string
  /** Reference model used to normalize the baseline. */
  reference: string
  /** Calibration entries keyed by model identifier. */
  models: Record<string, TryOnModelCalibration>
}

/**
 * Parsed calibration for the currently selected frame.
 */
export interface TryOnFrameCalibration {
  model: string
  translation: TryOnModelCalibration['translation']
  rotation: TryOnModelCalibration['rotation']
  scale: number
  templeWidthBoost: number
  lens: TryOnLens
}
