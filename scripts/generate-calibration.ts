#!/usr/bin/env -S npx tsx
import { readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { buildCalibration, type MeasuredModel } from './lib/calibration'
import { measureModel, readCalibration } from './lib/gltf-io'

function readArgs() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      reference: { type: 'string', default: 'iris-bronze' }
    }
  })
  const { input, output, reference } = values
  if (!input || !output) {
    console.error(
      'Usage: generate-calibration --input <dir> --output <file> [--reference <model>]\n' +
        'Measures every .glb in --input and writes the calibration manifest to --output.'
    )
    process.exit(1)
  }
  return { input, output, reference }
}

async function main() {
  const { input, output, reference } = readArgs()

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
    const model = measureModel(await io.read(join(input, file)), file)
    if (!model) throw new Error(`${file}: no scene`)
    models.push(model)
  }

  const calibration = buildCalibration(models, reference, readCalibration(output))
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
