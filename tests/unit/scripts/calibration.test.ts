import { describe, expect, it } from 'vitest'
import {
  buildCalibration,
  modelCalibration,
  parseCalibrationFile,
  type MeasuredModel
} from '../../../scripts/lib/calibration'
import type { TryOnCalibrationFile } from '../../../src/runtime/types/tryon-calibration'

// Box from (cx ± w/2, cy ± h/2) and a lens plane at frontZ, temples behind it.
function model(name: string, w: number, h: number, cx = 0, cy = 0, frontZ = 0.004): MeasuredModel {
  return {
    name,
    bounds: {
      min: { x: cx - w / 2, y: cy - h / 2, z: frontZ - 0.1 },
      max: { x: cx + w / 2, y: cy + h / 2, z: frontZ }
    }
  }
}

const reference = model('iris-bronze', 0.1397, 0.0493, 0, 0.023, 0.004383)

describe('modelCalibration', () => {
  it('centres the box in X and Y and puts the lens plane on the anchor', () => {
    const entry = modelCalibration(model('a', 0.14, 0.05, 0.001, 0.02, 0.005), reference)
    expect(entry.translation.x).toBeCloseTo(-0.001)
    expect(entry.translation.y).toBeCloseTo(-0.02)
    expect(entry.translation.z).toBeCloseTo(-0.005)
  })

  it('scales to the reference from the mean of the width and height ratios', () => {
    // Same width, 2% shorter: scale = (1 + 1/0.98) / 2.
    const entry = modelCalibration(model('a', 0.1397, 0.0493 * 0.98), reference)
    expect(entry.scale).toBeCloseTo((1 + 1 / 0.98) / 2, 4)
  })

  it('writes the rendered frame width in millimetres', () => {
    const entry = modelCalibration(model('a', 0.1397, 0.0493 * 0.98), reference)
    expect(entry.frameWidthMm).toBeCloseTo(0.1397 * entry.scale * 1000, 1)
    expect(modelCalibration(reference, reference).frameWidthMm).toBe(139.7)
  })

  it('ignores depth for the scale', () => {
    const deep = model('a', 0.1397, 0.0493)
    deep.bounds.min.z -= 0.05
    expect(modelCalibration(deep, reference).scale).toBe(1)
  })

  it('writes 0, not -0, for a centred axis', () => {
    const entry = modelCalibration(model('a', 0.14, 0.05, 0, 0), reference)
    expect(Object.is(entry.translation.x, -0)).toBe(false)
    expect(JSON.stringify(entry.translation)).toContain('"x":0')
  })

  it('keeps the hand-tuned fields of the previous entry', () => {
    const entry = modelCalibration(model('a', 0.14, 0.05), reference, {
      model: 'a',
      translation: { x: 9, y: 9, z: 9 },
      rotation: { x: 0.1, y: 0, z: 0 },
      scale: 9,
      templeWidthBoost: 1.05,
      lens: { tint: '#3a4a5c', density: 0.6 }
    })
    expect(entry.rotation).toEqual({ x: 0.1, y: 0, z: 0 })
    expect(entry.templeWidthBoost).toBe(1.05)
    expect(entry.lens).toEqual({ tint: '#3a4a5c', density: 0.6 })
    // Measured fields are recomputed, not carried over.
    expect(entry.scale).not.toBe(9)
    expect(entry.translation.x).not.toBe(9)
  })

  it('rejects an empty bounding box', () => {
    expect(() => modelCalibration(model('a', 0, 0.05), reference)).toThrow(/empty/)
  })
})

describe('buildCalibration', () => {
  const models = [model('pteron-azure', 0.1397, 0.0482), reference, model('kairos-amber', 0.135, 0.0484)]

  it('normalises against the reference, which gets scale 1', () => {
    const file = buildCalibration(models, 'iris-bronze')
    expect(file.schemaVersion).toBe('1.0.0')
    expect(file.reference).toBe('iris-bronze')
    expect(file.models['iris-bronze']!.scale).toBe(1)
    expect(file.models['kairos-amber']!.scale).toBeGreaterThan(1)
  })

  it('lists the models in name order', () => {
    expect(Object.keys(buildCalibration(models, 'iris-bronze').models)).toEqual([
      'iris-bronze',
      'kairos-amber',
      'pteron-azure'
    ])
  })

  it('carries hand-tuned fields over from the previous manifest', () => {
    const previous: TryOnCalibrationFile = {
      schemaVersion: '1.0.0',
      reference: 'iris-bronze',
      models: {
        'kairos-amber': {
          model: 'kairos-amber',
          translation: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: 1,
          lens: { tint: '#202020' }
        }
      }
    }
    const file = buildCalibration(models, 'iris-bronze', previous)
    expect(file.models['kairos-amber']!.lens).toEqual({ tint: '#202020' })
    expect(file.models['pteron-azure']!.lens).toBeUndefined()
  })

  it('fails without the reference model', () => {
    expect(() => buildCalibration(models, 'nous-navy')).toThrow(/nous-navy not found/)
  })
})

describe('parseCalibrationFile', () => {
  it('reads a manifest and keeps the hand-tuned fields', () => {
    const file = parseCalibrationFile({
      schemaVersion: '1.0.0',
      reference: 'iris-bronze',
      models: {
        a: {
          model: 'a',
          translation: { x: 0, y: -0.02, z: -0.004 },
          rotation: { x: 0.1, y: 0, z: 0 },
          scale: 1.01,
          templeWidthBoost: 1.05,
          lens: { tint: '#202020', density: 0.6 }
        }
      }
    })
    expect(file.models.a).toEqual({
      model: 'a',
      translation: { x: 0, y: -0.02, z: -0.004 },
      rotation: { x: 0.1, y: 0, z: 0 },
      scale: 1.01,
      templeWidthBoost: 1.05,
      lens: { tint: '#202020', density: 0.6 }
    })
  })

  it('rejects anything that is not a manifest', () => {
    expect(() => parseCalibrationFile([])).toThrow(/not a calibration manifest/)
    expect(() => parseCalibrationFile({ models: { a: 1 } })).toThrow(/a: entry/)
  })

  it('rejects a mistyped hand-tuned field instead of carrying it over', () => {
    expect(() => parseCalibrationFile({ models: { a: { rotation: { x: '0' } } } })).toThrow(/rotation/)
    expect(() => parseCalibrationFile({ models: { a: { templeWidthBoost: '1' } } })).toThrow(/templeWidthBoost/)
    expect(() => parseCalibrationFile({ models: { a: { lens: { density: 'dark' } } } })).toThrow(/lens/)
  })
})

describe('pads', () => {
  it('carries the pad spacing over and rejects a malformed one', () => {
    expect(parseCalibrationFile({ models: { a: { pads: { spacingMm: 18 } } } }).models.a!.pads).toEqual({ spacingMm: 18 })
    expect(() => parseCalibrationFile({ models: { a: { pads: { spacingMm: 'x' } } } })).toThrow(/pads/)
  })
})

describe('physical lens fields', () => {
  it('carries the category, transmittance and gradient over', () => {
    const file = parseCalibrationFile({
      models: {
        a: { lens: { tint: '#5a4632', category: 3, transmittance: 0.12, gradient: { top: 0.9, bottom: 0.3 } } }
      }
    })
    expect(file.models.a!.lens).toEqual({
      tint: '#5a4632',
      category: 3,
      transmittance: 0.12,
      gradient: { top: 0.9, bottom: 0.3 }
    })
  })

  it('rejects a category outside 0-4 and a half gradient', () => {
    expect(() => parseCalibrationFile({ models: { a: { lens: { category: 5 } } } })).toThrow(/lens/)
    expect(() => parseCalibrationFile({ models: { a: { lens: { gradient: { top: 1 } } } } })).toThrow(/lens/)
  })
})
