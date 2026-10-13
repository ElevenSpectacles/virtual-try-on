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
import { readdirSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { NodeIO, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { compactPrimitive, prune, transformPrimitive } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { Matrix4 } from 'three'

const TEMPLE_NODE_NAME = 'pt2'

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

/**
 * Rotates the kept temple-shaft vertices upward around the hinge, pitching
 * in the local X/Z plane (world reach/up — see file header). The pivot is
 * derived from the data itself (the lowest local-X vertices near the hinge)
 * rather than hardcoded, so it holds even if a model's hinge position
 * varies slightly from the ~0.018 seen in `iris-bronze`.
 */
function tiltPrimitive(prim: Primitive, tiltDegrees: number): void {
  if (tiltDegrees === 0) return
  const position = prim.getAttribute('POSITION')
  if (!position) return

  const count = position.getCount()
  const v = [0, 0, 0]

  let pivotX = Infinity
  for (let i = 0; i < count; i++) {
    position.getElement(i, v)
    if (v[0]! < pivotX) pivotX = v[0]!
  }

  let zSum = 0
  let zCount = 0
  const hingeBand = pivotX + 0.003
  for (let i = 0; i < count; i++) {
    position.getElement(i, v)
    if (v[0]! <= hingeBand) {
      zSum += v[2]!
      zCount++
    }
  }
  const pivotZ = zCount > 0 ? zSum / zCount : 0

  // Positive angle raises local +X (the shaft, reaching toward the tip)
  // toward local +Z, which is world +Y (up) — see file header axis mapping:
  // a rotation by -angle about local Y, around the hinge. transformPrimitive
  // turns the normals with it.
  const theta = (tiltDegrees * Math.PI) / 180
  const tilt = new Matrix4()
    .makeTranslation(pivotX, 0, pivotZ)
    .multiply(new Matrix4().makeRotationY(-theta))
    .multiply(new Matrix4().makeTranslation(-pivotX, 0, -pivotZ))
  transformPrimitive(prim, tilt.elements)
}

function trimPrimitive(prim: Primitive, threshold: number): { before: number; after: number } {
  const position = prim.getAttribute('POSITION')
  const index = prim.getIndices()
  if (!position || !index) return { before: 0, after: 0 }

  const src = index.getArray()!
  const before = src.length / 3
  const kept: number[] = []
  const v = [0, 0, 0]

  for (let t = 0; t < src.length; t += 3) {
    const a = src[t]!
    const b = src[t + 1]!
    const c = src[t + 2]!
    let clipped = false
    for (const idx of [a, b, c]) {
      position.getElement(idx, v)
      if (v[0]! > threshold) {
        clipped = true
        break
      }
    }
    if (!clipped) kept.push(a, b, c)
  }

  // Dropping triangles alone leaves the tip's vertices orphaned in the
  // attribute buffers (unreferenced, but still shipped over the wire).
  // compactPrimitive moves the primitive onto fresh accessors holding only
  // the vertices the kept triangles reference, so the trim stays scoped to
  // pt2 even if an accessor is shared with another primitive.
  prim.setIndices(index.clone().setArray(Uint32Array.from(kept)))
  compactPrimitive(prim)

  return { before, after: kept.length / 3 }
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
    const root = document.getRoot()
    const node = root.listNodes().find((n) => n.getName() === TEMPLE_NODE_NAME)
    if (!node) {
      console.warn(`${file}: no "${TEMPLE_NODE_NAME}" node found, skipping trim`)
      await io.write(join(output, file), document)
      continue
    }
    const mesh = node.getMesh()
    if (!mesh) {
      console.warn(`${file}: "${TEMPLE_NODE_NAME}" has no mesh, skipping trim`)
      await io.write(join(output, file), document)
      continue
    }

    let before = 0
    let after = 0
    for (const prim of mesh.listPrimitives()) {
      const counts = trimPrimitive(prim, threshold)
      before += counts.before
      after += counts.after
      tiltPrimitive(prim, tiltDegrees)
    }

    await document.transform(prune())
    await io.write(join(output, file), document)
    console.log(
      `${file}: ${TEMPLE_NODE_NAME} triangles ${before} -> ${after} (${(((before - after) / before) * 100).toFixed(1)}% trimmed), tilted ${tiltDegrees}deg`
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
