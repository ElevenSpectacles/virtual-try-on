import type { TryOnLens, TryOnLensCalibration } from '../utils/tryon-lens'

export interface TryOnModelCalibration {
  model: string
  translation: {
    x: number
    y: number
    z: number
  }
  rotation: {
    x: number
    y: number
    z: number
  }
  scale: number
  lens?: TryOnLensCalibration
  pads?: { spacingMm: number }
  frameWidthMm?: number
}

export interface TryOnCalibrationFile {
  schemaVersion: string
  reference: string
  models: Record<string, TryOnModelCalibration>
}

export interface TryOnFrameCalibration {
  model: string
  translation: TryOnModelCalibration['translation']
  rotation: TryOnModelCalibration['rotation']
  scale: number
  lens: TryOnLens
  padSpacingMm: number | null
  frameWidthMm: number
}
