#!/usr/bin/env -S npx tsx
// Writes the `calibration.json` the component loads (`calibration-url`):
// measures every GLB in --input and normalises it against --reference (see
// scripts/lib/calibration.ts for the maths). Run it on the final, compressed
// models: Draco compression shifts bounding boxes by float rounding.
//
//   npm run generate-calibration -- --input <dir> --output <dir>/calibration.json
//
// When --output already exists, its hand-tuned fields (rotation,
// templeWidthBoost, lens) are kept.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import {
  buildCalibration,
  parseCalibrationFile,
  type MeasuredModel
} from './lib/calibration'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i === -1 ? undefined : args[i + 1]
  }

  const input = get('--input')
  const output = get('--output')
  if (!input || !output) {
    console.error(
      'Usage: generate-calibration --input <dir> --output <file> [--reference <model>]\n' +
        'Measures every .glb in --input and writes the calibration manifest to --output.'
    )
    process.exit(1)
  }
  return { input, output, reference: get('--reference') ?? 'iris-bronze' }
}

async function main() {
  const { input, output, reference } = parseArgs()

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })

  const files = readdirSync(input)
    .filter((file) => extname(file).toLowerCase() === '.glb')
    .sort()
  if (files.length === 0) {
    console.error(`No .glb files found in ${input}`)
    process.exit(1)
  }

  const models: MeasuredModel[] = []
  for (const file of files) {
    const document = await io.read(join(input, file))
    const root = document.getRoot()
    const scene = root.getDefaultScene() ?? root.listScenes()[0]
    if (!scene) throw new Error(`${file}: no scene`)
    const { min, max } = getBounds(scene)
    models.push({
      name: file.replace(/\.glb$/i, ''),
      bounds: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] }
      }
    })
  }

  const previous = existsSync(output)
    ? parseCalibrationFile(JSON.parse(readFileSync(output, 'utf8')) as unknown)
    : null
  const calibration = buildCalibration(models, reference, previous)
  writeFileSync(output, `${JSON.stringify(calibration, null, 2)}\n`)

  console.log(`Calibration written to ${output} (reference ${reference})`)
  for (const entry of Object.values(calibration.models)) {
    const t = entry.translation
    console.log(`- ${entry.model}: scale ${entry.scale}, translation (${t.x}, ${t.y}, ${t.z})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
