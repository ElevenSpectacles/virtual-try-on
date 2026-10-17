import { describe, it, expect } from 'vitest'
import {
  getCalibrationFromManifest,
  validateCalibration
} from '../../../../src/runtime/composables/tryon/useFrameCalibration'
import type { TryOnCalibrationFile } from '../../../../src/runtime/types/tryon-calibration'

const manifest: TryOnCalibrationFile = {
  schemaVersion: '1.0.0',
  reference: 'iris-bronze',
  models: {
    'iris-bronze': {
      model: 'iris-bronze',
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1
    },
    'kairos-amber': {
      model: 'kairos-amber',
      translation: { x: -0.000246, y: 0, z: 0.001998 },
      rotation: { x: 0, y: 0.1, z: 0 },
      scale: 1.0183,
      lens: { tint: '#3a4a5c', density: 0.7 },
      frameWidthMm: 139.2
    }
  }
}

describe('getCalibrationFromManifest', () => {
  it('returns default calibration when manifest is missing', () => {
    const result = getCalibrationFromManifest(null, 'iris-bronze')
    expect(result).toEqual({
      model: 'unknown',
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      templeWidthBoost: 1,
      lens: { tint: null, density: null, gradient: null },
      padSpacingMm: null,
      frameWidthMm: 0
    })
  })

  it('returns default calibration when model is not in manifest', () => {
    const result = getCalibrationFromManifest(manifest, 'unknown-model')
    expect(result.scale).toBe(1)
    expect(result.model).toBe('unknown')
  })

  it('returns the calibration entry for a known model', () => {
    const result = getCalibrationFromManifest(manifest, 'kairos-amber')
    expect(result.model).toBe('kairos-amber')
    expect(result.scale).toBe(1.0183)
    expect(result.translation).toEqual({ x: -0.000246, y: 0, z: 0.001998 })
    expect(result.rotation).toEqual({ x: 0, y: 0.1, z: 0 })
  })

  it('returns identity calibration for the reference model', () => {
    const result = getCalibrationFromManifest(manifest, 'iris-bronze')
    expect(result.model).toBe('iris-bronze')
    expect(result.scale).toBe(1)
    expect(result.translation).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.rotation).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('resolves a per-model lens tint and density', () => {
    expect(getCalibrationFromManifest(manifest, 'kairos-amber').lens).toEqual({
      tint: [0x3a / 255, 0x4a / 255, 0x5c / 255],
      density: 0.7,
      gradient: null
    })
  })

  it('keeps the authored lens when the entry has no lens override', () => {
    expect(getCalibrationFromManifest(manifest, 'iris-bronze').lens).toEqual({
      tint: null,
      density: null,
      gradient: null
    })
  })

  it('reads the frame width, 0 when the entry has none', () => {
    expect(getCalibrationFromManifest(manifest, 'kairos-amber').frameWidthMm).toBe(139.2)
    expect(getCalibrationFromManifest(manifest, 'iris-bronze').frameWidthMm).toBe(0)
  })
})

describe('validateCalibration', () => {
  const bad = {
    schemaVersion: '1.0.0',
    reference: 'a',
    models: {
      a: {
        model: 'a',
        translation: { x: 0.001, y: '-0.02', z: 0 },
        rotation: { x: 0.1, y: 0, z: 0 },
        scale: 0,
        lens: { tint: 'brown', density: 1.5 }
      }
    }
  } as unknown as TryOnCalibrationFile

  it('validates the fitting and physical-lens fields too', () => {
    const entry = (fields: Record<string, unknown>) =>
      ({
        schemaVersion: '1.0.0',
        reference: 'a',
        models: {
          a: {
            model: 'a',
            translation: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: 1,
            ...fields
          }
        }
      }) as unknown as TryOnCalibrationFile
    const good = validateCalibration(
      entry({ pads: { spacingMm: 18 }, frameWidthMm: 139.5, lens: { category: 3, gradient: { top: 0.9, bottom: 0.3 } } }),
      'a'
    )
    expect(good.problems).toEqual([])
    expect(good.calibration.padSpacingMm).toBe(18)
    expect(good.calibration.frameWidthMm).toBe(139.5)
    expect(good.calibration.lens.gradient).toEqual({ top: 0.9, bottom: 0.3 })
    const bad = validateCalibration(
      entry({
        pads: { spacingMm: '18' },
        frameWidthMm: -1,
        lens: { category: 5, transmittance: 1.2, gradient: { top: 0.9 } }
      }),
      'a'
    )
    expect(bad.calibration.padSpacingMm).toBeNull()
    expect(bad.calibration.frameWidthMm).toBe(0)
    expect(bad.problems).toEqual([
      'lens.transmittance must be between 0 and 1',
      'lens.category must be an ISO 12312-1 category 0-4',
      'lens.gradient must be { top, bottom } between 0 and 1',
      'pads.spacingMm must be a positive number of millimetres',
      'frameWidthMm must be a positive number of millimetres'
    ])
  })

  it('falls back field by field and lists what is wrong', () => {
    const { calibration, problems } = validateCalibration(bad, 'a')
    expect(calibration.translation).toEqual({ x: 0, y: 0, z: 0 })
    expect(calibration.rotation).toEqual({ x: 0.1, y: 0, z: 0 })
    expect(calibration.scale).toBe(1)
    expect(problems).toEqual([
      'translation must be { x, y, z } numbers within ±0.5',
      'scale must be a number between 0.2 and 5',
      'lens.tint must be #rrggbb',
      'lens.density must be between 0 and 1'
    ])
  })

  it('finds nothing wrong with a valid entry, or a missing one', () => {
    expect(validateCalibration(manifest, 'kairos-amber').problems).toEqual([])
    expect(validateCalibration(manifest, 'nope').problems).toEqual([])
  })

  it('catches a rotation in degrees', () => {
    const degrees = {
      ...manifest,
      models: { b: { ...manifest.models['iris-bronze']!, model: 'b', rotation: { x: 9, y: 0, z: 0 } } }
    }
    expect(validateCalibration(degrees, 'b').problems[0]).toMatch(/rotation/)
  })
})
