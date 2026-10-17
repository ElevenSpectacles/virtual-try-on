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
   * Lens tint and density, replacing the GLB's authored lens colour and
   * opacity — e.g. one GLB shipped in several lens colours. Optional.
   */
  lens?: TryOnLensCalibration
  /**
   * Nose pads: the distance between their contact points, mm. With it the
   * frame seats lower on a narrow nose and higher on a wide one
   * (utils/tryon-seat). Optional; without it every nose seats the frame at
   * the same point.
   */
  pads?: { spacingMm: number }
  /**
   * Total frame width in millimetres (bounding-box width × `scale`), written
   * by `generate-calibration`. Lets a host rank its catalog by fit without
   * loading every GLB. Optional; `TryOnModel.frameWidthMm` wins when set.
   */
  frameWidthMm?: number
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
  lens: TryOnLens
  /** Pad contact spacing, mm; null when the manifest has none. */
  padSpacingMm: number | null
  /** Frame width from the manifest, mm; 0 when it has none. */
  frameWidthMm: number
}
