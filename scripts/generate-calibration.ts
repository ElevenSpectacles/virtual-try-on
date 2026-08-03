import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { resolve } from 'node:path'
import type { Document } from '@gltf-transform/core'
import { NodeIO, getBounds } from '@gltf-transform/core'
import type { TryOnCalibrationFile } from '../types/tryon-calibration'

interface Bounds {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

function parseArgs() {
  let input: string | null = null
  let output: string | null = null
  let reference: string | null = null

  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--input' || arg === '-i') {
      input = args[++i] ?? null
    } else if (arg === '--output' || arg === '-o') {
      output = args[++i] ?? null
    } else if (arg === '--reference' || arg === '-r') {
      reference = args[++i] ?? null
    }
  }

  return {
    input: input ?? 'public/models',
    output: output ?? 'public/models/calibration.json',
    reference: reference ?? 'iris-bronze'
  }
}

function findGlbFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  return entries
    .filter((name) => name.toLowerCase().endsWith('.glb'))
    .map((name) => resolve(dir, name))
}

function getModelName(path: string): string {
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.glb$/i, '')
}

const io = new NodeIO()

function computeBounds(doc: Document): Bounds {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (!scene) throw new Error('GLB has no scene')

  const { min, max } = getBounds(scene)
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] }
  }
}

async function analyzeModel(
  path: string
): Promise<{ name: string; bounds: Bounds }> {
  const buffer = readFileSync(path)
  const doc = await io.readBinary(new Uint8Array(buffer))
  const bounds = computeBounds(doc)

  return {
    name: getModelName(path),
    bounds
  }
}

function center(bounds: Bounds) {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2
  }
}

function dimensions(bounds: Bounds) {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
  }
}

async function main() {
  const { input, output, reference } = parseArgs()

  const inputPath = resolve(process.cwd(), input)
  const outputPath = resolve(process.cwd(), output)

  const stat = statSync(inputPath)
  if (!stat.isDirectory()) {
    throw new Error(`Input path is not a directory: ${inputPath}`)
  }

  const modelFiles = findGlbFiles(inputPath)
  if (modelFiles.length === 0) {
    throw new Error(`No .glb files found in ${inputPath}`)
  }

  const models = await Promise.all(modelFiles.map(analyzeModel))
  const referenceModel = models.find((m) => m.name === reference)

  if (!referenceModel) {
    throw new Error(
      `Reference model ${reference} not found among ${models.map((m) => m.name).join(', ')}`
    )
  }

  const refDims = dimensions(referenceModel.bounds)

  const calibration: TryOnCalibrationFile = {
    schemaVersion: '1.0.0',
    reference,
    models: {}
  }

  for (const model of models) {
    const modelCenter = center(model.bounds)
    const modelDims = dimensions(model.bounds)

    // Normalize to reference dimensions using the average of X and Y ratios.
    // Z is less visible in a front-facing try-on, so it is not used for the
    // uniform scale multiplier.
    const scaleX = refDims.x / modelDims.x
    const scaleY = refDims.y / modelDims.y
    const scale = Number(((scaleX + scaleY) / 2).toFixed(4))

    // Self-centering offset: brings the model's own bounding box to the
    // origin, since GLB local origins are not authored at the bridge. X/Y
    // center the box on the tracked anchor; Z instead anchors the FRONT of
    // the frame (the lens plane, `max.z`) — centering Z would put the
    // mid-temple at the anchor and push the lenses ~half a temple-length
    // toward the camera.
    const translation = {
      x: Number((-modelCenter.x).toFixed(6)),
      y: Number((-modelCenter.y).toFixed(6)),
      z: Number((-model.bounds.max.z).toFixed(6))
    }

    calibration.models[model.name] = {
      model: model.name,
      translation,
      rotation: { x: 0, y: 0, z: 0 },
      scale
    }
  }

  writeFileSync(outputPath, JSON.stringify(calibration, null, 2))

  console.log(`Calibration written to ${outputPath}`)
  console.log(`Reference model: ${reference}`)
  for (const [name, entry] of Object.entries(calibration.models)) {
    console.log(
      `- ${name}: scale=${entry.scale}, translation=(${entry.translation.x}, ${entry.translation.y}, ${entry.translation.z})`
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
