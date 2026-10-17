#!/usr/bin/env -S npx tsx
// Model lint (issue #103): checks every GLB in --input for what the try-on
// needs (lens material, temple node, sane size) and what silently looks
// wrong (placeholder lens colour, big textures). Exits non-zero on errors.
//
//   npx tsx scripts/lint-models.ts --input <dir>
import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { lintModel } from './lib/model-lint'

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' } } })
  if (!values.input) {
    console.error('Usage: lint-models --input <dir>')
    process.exit(1)
  }
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })
  let errors = 0
  for (const file of readdirSync(values.input).filter((f) => extname(f).toLowerCase() === '.glb').sort()) {
    const path = join(values.input, file)
    const findings = lintModel(await io.read(path), { fileSize: statSync(path).size })
    errors += findings.filter((f) => f.severity === 'error').length
    console.log(`${file}: ${findings.length ? '' : 'ok'}`)
    for (const f of findings) console.log(`  ${f.severity === 'error' ? '✗' : '!'} [${f.rule}] ${f.message}`)
  }
  if (errors) {
    console.error(`${errors} error(s)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
