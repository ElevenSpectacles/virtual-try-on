#!/usr/bin/env -S npx tsx
// One command from a raw catalog GLB to a try-on-ready GLB and its
// calibration entry (issue #103). Steps, in order, each at most once (they
// record themselves in the GLB's extras, so a second run changes nothing):
//
//   1. trim the curled temple tips and tilt the shafts (never twice)
//   2. Draco-compress
//   3. lint (scripts/lib/model-lint)
//   4. regenerate calibration.json for the output directory, keeping the
//      hand-tuned fields (calibration is measured on the compressed GLBs)
//
//   npx tsx scripts/prepare-model.ts --input <glb or dir> --output <catalog dir> \
//     [--calibration <catalog dir>/calibration.json] [--reference iris-bronze]
//
// The output directory is the catalog: it must hold the reference model for
// the calibration step.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { buildCalibration, parseCalibrationFile, type MeasuredModel } from './lib/calibration'
import { compressOnce, preparedSteps, trimTempleTips } from './lib/model-prep'
import { lintModel } from './lib/model-lint'

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      calibration: { type: 'string' },
      reference: { type: 'string', default: 'iris-bronze' },
      threshold: { type: 'string', default: '0.105' },
      'tilt-degrees': { type: 'string', default: '6' }
    }
  })
  const { input, output, calibration, reference } = values
  if (!input || !output) {
    console.error(
      'Usage: prepare-model --input <glb or dir> --output <catalog dir> [--calibration <file>] [--reference <model>]'
    )
    process.exit(1)
  }
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule()
    })
  mkdirSync(output, { recursive: true })

  const inputs = statSync(input).isDirectory()
    ? readdirSync(input)
        .filter((f) => extname(f).toLowerCase() === '.glb')
        .map((f) => join(input, f))
    : [input]

  let lintErrors = 0
  for (const source of inputs) {
    const target = join(output, basename(source))
    const document = await io.read(source)
    const done = preparedSteps(document)
    if (done.includes('trimmed') && done.includes('compressed')) {
      // Already prepared: keep the bytes as they are.
      if (resolve(source) !== resolve(target)) copyFileSync(source, target)
      console.log(`${basename(source)}: already prepared`)
    } else {
      const trim = await trimTempleTips(document, {
        threshold: Number(values.threshold),
        tiltDegrees: Number(values['tilt-degrees'])
      })
      const compressed = await compressOnce(document)
      await io.write(target, document)
      console.log(
        `${basename(source)}: ${
          trim.skipped ? `trim ${trim.skipped}` : `trimmed ${trim.before} -> ${trim.after} triangles`
        }, ${compressed ? 'compressed' : 'already compressed'}`
      )
    }
    const findings = lintModel(await io.read(target), { fileSize: statSync(target).size })
    for (const f of findings) console.log(`  ${f.severity === 'error' ? '✗' : '!'} [${f.rule}] ${f.message}`)
    lintErrors += findings.filter((f) => f.severity === 'error').length
  }

  if (calibration) {
    const models: MeasuredModel[] = []
    for (const file of readdirSync(output).filter((f) => extname(f).toLowerCase() === '.glb').sort()) {
      const document = await io.read(join(output, file))
      const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
      if (!scene) continue
      const { min, max } = getBounds(scene)
      models.push({
        name: file.replace(/\.glb$/i, ''),
        bounds: {
          min: { x: min[0], y: min[1], z: min[2] },
          max: { x: max[0], y: max[1], z: max[2] }
        }
      })
    }
    const previous = existsSync(calibration)
      ? parseCalibrationFile(JSON.parse(readFileSync(calibration, 'utf8')) as unknown)
      : null
    const next = `${JSON.stringify(buildCalibration(models, reference!, previous), null, 2)}\n`
    const unchanged = existsSync(calibration) && readFileSync(calibration, 'utf8') === next
    if (!unchanged) writeFileSync(calibration, next)
    console.log(`calibration ${unchanged ? 'unchanged' : `written to ${calibration}`}`)
  }

  if (lintErrors) {
    console.error(`${lintErrors} lint error(s)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
