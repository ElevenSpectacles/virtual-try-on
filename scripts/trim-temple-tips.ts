#!/usr/bin/env -S npx tsx
// Shortens the temple arms in the catalog GLBs by dropping the curled
// ear-hook geometry past a local-space X threshold. Every catalog frame
// shares the same authored structure: a node named `pt2` holds both temple
// arms as one mirrored mesh (split by the sign of local Y), running local-X
// from the hinge (~0.018) to the tip (~0.151). Tracing the arm's centerline
// along X shows it runs a straight shaft out to ~0.10, then curves down and
// back (the ear-hook) for the remaining ~0.05 — the default threshold cuts
// right where that curve starts, dropping the whole hook, not just its
// rounded end cap. Dropping triangles with any vertex past the threshold
// removes it cleanly — the cut end is never capped, but it's also never
// seen: it sits behind the ear/hair at every angle the frame is worn at.
import { readdirSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { NodeIO, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'

const TEMPLE_NODE_NAME = 'pt2'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i === -1 ? undefined : args[i + 1]
  }

  const input = get('--input')
  const output = get('--output')
  const threshold = Number(get('--threshold') ?? '0.105')
  if (!input || !output) {
    console.error(
      'Usage: trim-temple-tips --input <dir> --output <dir> [--threshold <localX>]\n' +
        'Reads every .glb in --input, writes copies with temple tips trimmed to --output.'
    )
    process.exit(1)
  }
  return { input, output, threshold }
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
  // Compact every attribute down to just the vertices the kept triangles
  // reference, remapping indices to the new, smaller vertex range.
  const remap = new Map<number, number>()
  for (const idx of kept) {
    if (!remap.has(idx)) remap.set(idx, remap.size)
  }

  const semantics = prim.listSemantics()
  for (const semantic of semantics) {
    const attribute = prim.getAttribute(semantic)!
    const itemSize = attribute.getElementSize()
    const oldArray = attribute.getArray()!
    const newArray = new (oldArray.constructor as new (n: number) => typeof oldArray)(
      remap.size * itemSize
    )
    const elem = new Array(itemSize).fill(0)
    for (const [oldIdx, newIdx] of remap) {
      attribute.getElement(oldIdx, elem)
      newArray.set(elem, newIdx * itemSize)
    }
    // Clone rather than mutate in place — an accessor could in principle be
    // shared with another primitive; a fresh accessor for the compacted data
    // keeps this trim scoped to pt2 no matter what.
    const compacted = attribute.clone().setArray(newArray)
    prim.setAttribute(semantic, compacted)
  }

  const remappedIndices = kept.map((idx) => remap.get(idx)!)
  const newIndex = index
    .clone()
    .setArray(
      remap.size <= 65535
        ? Uint16Array.from(remappedIndices)
        : Uint32Array.from(remappedIndices)
    )
  prim.setIndices(newIndex)
  index.dispose()

  return { before, after: kept.length / 3 }
}

async function main() {
  const { input, output, threshold } = parseArgs()

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

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
    }

    await document.transform(prune())
    await io.write(join(output, file), document)
    console.log(
      `${file}: ${TEMPLE_NODE_NAME} triangles ${before} -> ${after} (${(((before - after) / before) * 100).toFixed(1)}% trimmed)`
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
