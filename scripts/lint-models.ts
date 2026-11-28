#!/usr/bin/env -S npx tsx
import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { countErrors, formatFinding, lintModel } from './lib/model-lint'

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
    errors += countErrors(findings)
    console.log(`${file}: ${findings.length ? '' : 'ok'}`)
    for (const f of findings) console.log(formatFinding(f))
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
