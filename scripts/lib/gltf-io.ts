import { existsSync, readFileSync } from 'node:fs'
import { getBounds, type Document } from '@gltf-transform/core'
import type { TryOnCalibrationFile } from '../../src/runtime/types/tryon-calibration'
import { parseCalibrationFile, type MeasuredModel } from './calibration'

export function measureModel(document: Document, file: string): MeasuredModel | null {
  const root = document.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (!scene) return null
  const { min, max } = getBounds(scene)
  return {
    name: file.replace(/\.glb$/i, ''),
    bounds: {
      min: { x: min[0], y: min[1], z: min[2] },
      max: { x: max[0], y: max[1], z: max[2] }
    }
  }
}

export function readCalibration(path: string): TryOnCalibrationFile | null {
  return existsSync(path) ? parseCalibrationFile(JSON.parse(readFileSync(path, 'utf8')) as unknown) : null
}
