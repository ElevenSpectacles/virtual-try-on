import type {
  TryOnCalibrationFile,
  TryOnModelCalibration
} from '../../src/runtime/types/tryon-calibration'
import type { TryOnLensCategory } from '../../src/runtime/utils/tryon-lens'

export interface Bounds {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export interface MeasuredModel {
  name: string
  bounds: Bounds
}

export const CALIBRATION_SCHEMA_VERSION = '1.0.0'

function round(value: number, digits: number): number {
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
  entry.frameWidthMm = round(width * entry.scale * 1000, 1)
  if (previous?.lens !== undefined) entry.lens = previous.lens
  if (previous?.pads !== undefined) entry.pads = previous.pads
  return entry
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVector(value: unknown): value is { x: number; y: number; z: number } {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number'
  )
}

export function parseCalibrationFile(value: unknown): TryOnCalibrationFile {
  if (!isRecord(value) || !isRecord(value.models)) {
    throw new Error('not a calibration manifest (no "models" object)')
  }
  const models: TryOnCalibrationFile['models'] = {}
  for (const [name, entry] of Object.entries(value.models)) {
    if (!isRecord(entry)) throw new Error(`${name}: entry is not an object`)
    if (entry.rotation !== undefined && !isVector(entry.rotation)) {
      throw new Error(`${name}: rotation must be { x, y, z } numbers`)
    }
    const lens = entry.lens
    const gradient = isRecord(lens) ? lens.gradient : undefined
    if (
      lens !== undefined &&
      (!isRecord(lens) ||
        (lens.tint !== undefined && typeof lens.tint !== 'string') ||
        (lens.density !== undefined && typeof lens.density !== 'number') ||
        (lens.transmittance !== undefined && typeof lens.transmittance !== 'number') ||
        (lens.category !== undefined && ![0, 1, 2, 3, 4].includes(lens.category as number)) ||
        (gradient !== undefined &&
          (!isRecord(gradient) ||
            typeof gradient.top !== 'number' ||
            typeof gradient.bottom !== 'number')))
    ) {
      throw new Error(
        `${name}: lens must be { tint?: string, density?: number, transmittance?: number, category?: 0-4, gradient?: { top: number, bottom: number } }`
      )
    }
    const pads = entry.pads
    if (pads !== undefined && (!isRecord(pads) || typeof pads.spacingMm !== 'number')) {
      throw new Error(`${name}: pads must be { spacingMm: number }`)
    }
    models[name] = {
      model: typeof entry.model === 'string' ? entry.model : name,
      translation: isVector(entry.translation) ? entry.translation : { x: 0, y: 0, z: 0 },
      rotation: isVector(entry.rotation) ? entry.rotation : { x: 0, y: 0, z: 0 },
      scale: typeof entry.scale === 'number' ? entry.scale : 1,
      ...(isRecord(pads) ? { pads: { spacingMm: pads.spacingMm as number } } : {}),
      ...(isRecord(lens)
        ? {
            lens: {
              ...(typeof lens.tint === 'string' ? { tint: lens.tint } : {}),
              ...(typeof lens.density === 'number' ? { density: lens.density } : {}),
              ...(typeof lens.transmittance === 'number'
                ? { transmittance: lens.transmittance }
                : {}),
              ...(typeof lens.category === 'number'
                ? { category: lens.category as TryOnLensCategory }
                : {}),
              ...(isRecord(gradient)
                ? { gradient: { top: gradient.top as number, bottom: gradient.bottom as number } }
                : {})
            }
          }
        : {})
    }
  }
  return {
    schemaVersion: typeof value.schemaVersion === 'string' ? value.schemaVersion : CALIBRATION_SCHEMA_VERSION,
    reference: typeof value.reference === 'string' ? value.reference : '',
    models
  }
}
