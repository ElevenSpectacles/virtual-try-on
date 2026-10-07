import { describe, it, expect } from 'vitest'
import { getCalibrationFromManifest } from '../../../../src/runtime/composables/tryon/useFrameCalibration'
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
      scale: 1.0183
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
      templeWidthBoost: 1
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
})
