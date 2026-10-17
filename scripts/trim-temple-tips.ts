#!/usr/bin/env -S npx tsx
// Shortens the temple arms in the catalog GLBs by dropping the curled
// ear-hook geometry past a local-space X threshold, then tilts the
// remaining straight shaft upward around the hinge. Every catalog frame
// shares the same authored structure: a node named `pt2` holds both temple
// arms as one mirrored mesh (split by the sign of local Y), running local-X
// from the hinge (~0.018) to the tip (~0.151). Tracing the arm's centerline
// along X shows it runs a straight shaft out to ~0.10, then curves down and
// back (the ear-hook) for the remaining ~0.05 — the default threshold cuts
// right where that curve starts, dropping the whole hook, not just its
// rounded end cap. Dropping triangles with any vertex past the threshold
// removes it cleanly — the cut end is never capped, but that's normally
// fine, it sits low against the ear.
//
// Without the hook, though, the leftover shaft is dead flat (local Z is
// near-constant along its whole length) — it runs level into the ear rather
// than arcing over the top of it the way a real temple does, so it reads as
// poking past the ear instead of resting on it. `pt2`'s node transform (see
// its parent `glasses` node's rotation) maps local X -> world -Z (reach),
// local Y -> world X (left/right side-select), local Z -> world +Y (up) —
// so tilting the tip toward the top of the ear means rotating the kept
// vertices around the hinge in the local X/Z plane (a pitch around the
// left/right axis), not touching Y.
//
// Run it once per new model. GLBs it trimmed are marked in their extras
// (`tryOnPrepared`) and skipped on a second run, since every run would tilt
// the shaft another --tilt-degrees; GLBs trimmed before the marker existed
// are not recognised, so don't feed them back in. `scripts/prepare-model.ts`
// runs this and the other steps in order.
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

  // The catalog GLBs are Draco-compressed (compress-models): decode them to
  // edit the geometry, and re-encode on write.
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
      const { before, after } = result
      console.log(
        `${file}: ${TEMPLE_NODE_NAME} triangles ${before} -> ${after} (${(((before - after) / before) * 100).toFixed(1)}% trimmed), tilted ${tiltDegrees}deg`
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
