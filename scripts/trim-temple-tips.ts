#!/usr/bin/env -S npx tsx
import { readdirSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { TEMPLE_NODE_NAME, trimTempleTips } from './lib/model-prep'

function readArgs() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      threshold: { type: 'string', default: '0.105' },
      'tilt-degrees': { type: 'string', default: '6' }
    }
  })
  const { input, output } = values
  if (!input || !output) {
    console.error(
      'Usage: trim-temple-tips --input <dir> --output <dir> [--threshold <localX>] [--tilt-degrees <deg>]\n' +
        'Reads every .glb in --input, writes copies with temple tips trimmed (and the\n' +
        'remaining shaft tilted upward around the hinge) to --output.'
    )
    process.exit(1)
  }
  return {
    input,
    output,
    threshold: Number(values.threshold),
    tiltDegrees: Number(values['tilt-degrees'])
  }
}

async function main() {
  const { input, output, threshold, tiltDegrees } = readArgs()

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
    const result = await trimTempleTips(document, { threshold, tiltDegrees })
    await io.write(join(output, file), document)
    if (result.skipped === 'already-trimmed') {
      console.log(`${file}: already trimmed, left as is`)
    } else if (result.skipped === 'no-temple-node') {
      console.warn(`${file}: no "${TEMPLE_NODE_NAME}" mesh found, skipping trim`)
    } else {
      const { before, after, capped, open } = result
      console.log(
        `${file}: ${TEMPLE_NODE_NAME} triangles ${before} -> ${after} (${(((before - after) / before) * 100).toFixed(1)}% trimmed), ${capped} cut(s) capped${open ? `, ${open} left open` : ''}, tilted ${tiltDegrees}deg`
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
