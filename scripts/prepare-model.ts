#!/usr/bin/env -S npx tsx
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { buildCalibration, type MeasuredModel } from './lib/calibration'
import { measureModel, readCalibration } from './lib/gltf-io'
import { backfillPrepared, compressOnce, preparedSteps, trimTempleTips } from './lib/model-prep'
import { countErrors, formatFinding, lintModel } from './lib/model-lint'

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
  const threshold = Number(values.threshold)
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
    const backfilled = backfillPrepared(document, { threshold })
    if (backfilled.length) console.log(`${basename(source)}: found already ${backfilled.join(' and ')}`)
    const done = preparedSteps(document)
    if (done.includes('trimmed') && done.includes('compressed')) {
      if (resolve(source) !== resolve(target)) copyFileSync(source, target)
      console.log(`${basename(source)}: already prepared`)
    } else {
      const trim = await trimTempleTips(document, {
        threshold,
        tiltDegrees: Number(values['tilt-degrees'])
      })
      const compressed = await compressOnce(document)
      await io.write(target, document)
      console.log(
        `${basename(source)}: ${
          trim.skipped
            ? `trim ${trim.skipped}`
            : `trimmed ${trim.before} -> ${trim.after} triangles, ${trim.capped} cut(s) capped${trim.open ? `, ${trim.open} left open` : ''}`
        }, ${compressed ? 'compressed' : 'already compressed'}`
      )
    }
    const findings = lintModel(await io.read(target), { fileSize: statSync(target).size })
    for (const f of findings) console.log(formatFinding(f))
    lintErrors += countErrors(findings)
  }

  if (calibration) {
    const models: MeasuredModel[] = []
    for (const file of readdirSync(output).filter((f) => extname(f).toLowerCase() === '.glb').sort()) {
      const model = measureModel(await io.read(join(output, file)), file)
      if (model) models.push(model)
    }
    const next = `${JSON.stringify(buildCalibration(models, reference!, readCalibration(calibration)), null, 2)}\n`
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
