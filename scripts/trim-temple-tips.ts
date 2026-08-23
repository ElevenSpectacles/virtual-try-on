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
  const tiltDegrees = Number(get('--tilt-degrees') ?? '6')
  if (!input || !output) {
    console.error(
      'Usage: trim-temple-tips --input <dir> --output <dir> [--threshold <localX>] [--tilt-degrees <deg>]\n' +
        'Reads every .glb in --input, writes copies with temple tips trimmed (and the\n' +
        'remaining shaft tilted upward around the hinge) to --output.'
    )
    process.exit(1)
  }
  return { input, output, threshold, tiltDegrees }
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
  const normal = prim.getAttribute('NORMAL')
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
  // toward local +Z, which is world +Y (up) — see file header axis mapping.
  const theta = (tiltDegrees * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  for (let i = 0; i < count; i++) {
    position.getElement(i, v)
    const dx = v[0]! - pivotX
    const dz = v[2]! - pivotZ
    v[0] = pivotX + dx * cos - dz * sin
    v[2] = pivotZ + dx * sin + dz * cos
    position.setElement(i, v)
  }

  if (normal) {
    const n = [0, 0, 0]
    for (let i = 0; i < normal.getCount(); i++) {
      normal.getElement(i, n)
      const nx = n[0]!
      const nz = n[2]!
      n[0] = nx * cos - nz * sin
      n[2] = nx * sin + nz * cos
      normal.setElement(i, n)
    }
  }
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
  const { input, output, threshold, tiltDegrees } = parseArgs()

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
