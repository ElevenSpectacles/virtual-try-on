#!/usr/bin/env -S npx tsx
// Compresses a directory of GLBs with Draco mesh compression via
// @gltf-transform/functions' `draco()` transform. Run against the host's
// model directory before shipping — the module's own GLTFLoader/useGLTF
// wiring (see components/TryOnScene.vue) already expects to decode Draco
// meshes when present, and is a no-op passthrough for meshes that aren't.
import { readdirSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'

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
      'Usage: compress-models --input <dir> --output <dir>\n' +
        'Reads every .glb in --input, writes Draco-compressed copies to --output.'
    )
    process.exit(1)
  }
  return { input, output }
}

async function main() {
  const { input, output } = parseArgs()

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule()
    })

  mkdirSync(output, { recursive: true })

  const files = readdirSync(input).filter(
    (file) => extname(file).toLowerCase() === '.glb'
  )
  if (files.length === 0) {
    console.warn(`No .glb files found in ${input}`)
    return
  }

  for (const file of files) {
    const document = await io.read(join(input, file))
    await document.transform(draco({ method: 'edgebreaker' }))
    await io.write(join(output, file), document)
    console.log(`compressed ${file}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
