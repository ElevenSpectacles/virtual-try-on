#!/usr/bin/env -S npx tsx
// Pantoscopic tilt audit (issue #87): fits each GLB's lens plane and reports
// its effective tilt (lens plane + calibration rotation.x) against the
// 7–12° fitting range, with the rotation.x that gives 9°.
//
//   npx tsx scripts/audit-tilt.ts --input <dir> --calibration <dir>/calibration.json
//
// Exits non-zero when a model is out of range, so it can gate a catalog PR.
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { parseCalibrationFile } from './lib/calibration'
import { PANTOSCOPIC_RANGE_DEG, auditTilt } from './lib/tilt'

const LENS_MATERIAL_NAME = /glass|lens/i

async function main() {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, calibration: { type: 'string' } }
  })
  if (!values.input) {
    console.error('Usage: audit-tilt --input <dir> [--calibration <file>]')
    process.exit(1)
  }
  const calibration = values.calibration
    ? parseCalibrationFile(JSON.parse(readFileSync(values.calibration, 'utf8')) as unknown)
    : null
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })

  let failed = 0
  for (const file of readdirSync(values.input).filter((f) => extname(f).toLowerCase() === '.glb').sort()) {
    const name = file.replace(/\.glb$/i, '')
    const document = await io.read(join(values.input, file))
    const points: number[] = []
    for (const node of document.getRoot().listNodes()) {
      const mesh = node.getMesh()
      if (!mesh) continue
      const world = node.getWorldMatrix()
      for (const primitive of mesh.listPrimitives()) {
        if (!LENS_MATERIAL_NAME.test(primitive.getMaterial()?.getName() ?? '')) continue
        const position = primitive.getAttribute('POSITION')
        if (!position) continue
        const v = [0, 0, 0]
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v)
          // Column-major 4×4 world matrix.
          points.push(
            world[0]! * v[0]! + world[4]! * v[1]! + world[8]! * v[2]! + world[12]!,
            world[1]! * v[0]! + world[5]! * v[1]! + world[9]! * v[2]! + world[13]!,
            world[2]! * v[0]! + world[6]! * v[1]! + world[10]! * v[2]! + world[14]!
          )
        }
      }
    }
    const audit = auditTilt(name, points, calibration?.models[name]?.rotation.x ?? 0)
    if (!audit) {
      console.log(`- ${name}: no lens geometry`)
      continue
    }
    if (!audit.ok) failed++
    console.log(
      `- ${name}: lens ${audit.authoredDeg.toFixed(1)}°, effective ${audit.effectiveDeg.toFixed(1)}° ` +
        `${audit.ok ? 'ok' : `OUT OF ${PANTOSCOPIC_RANGE_DEG.min}–${PANTOSCOPIC_RANGE_DEG.max}°`}` +
        ` · rotation.x for 9°: ${audit.suggestedRotationX.toFixed(4)}`
    )
  }
  if (failed) {
    console.error(`${failed} model(s) out of range`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
