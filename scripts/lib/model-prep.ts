/**
 * Model preparation steps for `scripts/prepare-model.ts` (issue #103), kept
 * free of file I/O so they are unit-tested on synthetic documents. The
 * order matters and the trim must never run twice (each run tilts the
 * temples again), so every step records itself in the GLB's root
 * `extras.tryOnPrepared` and is skipped when already there.
 *
 *   trim temple tips → Draco-compress → (measure for calibration)
 *
 * Calibration is measured on the compressed output, since compression
 * shifts bounding boxes by float rounding.
 */
import type { Document, Primitive } from '@gltf-transform/core'
import { compactPrimitive, draco, prune, transformPrimitive } from '@gltf-transform/functions'
import { Matrix4 } from 'three'

/** Node holding both temple arms in every catalog GLB. */
export const TEMPLE_NODE_NAME = 'pt2'

/** Steps recorded in `extras.tryOnPrepared`. */
export type PrepStep = 'trimmed' | 'compressed'

export const PREP_EXTRAS_KEY = 'tryOnPrepared'

/** Steps already applied to a document. */
export function preparedSteps(document: Document): PrepStep[] {
  const extras = document.getRoot().getExtras() as Record<string, unknown>
  const steps = extras[PREP_EXTRAS_KEY]
  return Array.isArray(steps) ? (steps.filter((s) => typeof s === 'string') as PrepStep[]) : []
}

export function markPrepared(document: Document, step: PrepStep) {
  const root = document.getRoot()
  const extras = { ...(root.getExtras() as Record<string, unknown>) }
  extras[PREP_EXTRAS_KEY] = [...new Set([...preparedSteps(document), step])]
  root.setExtras(extras)
}

/**
 * Rotates the kept temple-shaft vertices upward around the hinge, pitching
 * in the local X/Z plane (world reach/up). The pivot comes from the data
 * (the lowest local-X vertices near the hinge), not a hardcoded value.
 */
export function tiltPrimitive(prim: Primitive, tiltDegrees: number): void {
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
  // Positive angle raises local +X (the shaft) toward local +Z (world up):
  // a rotation by -angle about local Y, around the hinge.
  const theta = (tiltDegrees * Math.PI) / 180
  const tilt = new Matrix4()
    .makeTranslation(pivotX, 0, pivotZ)
    .multiply(new Matrix4().makeRotationY(-theta))
    .multiply(new Matrix4().makeTranslation(-pivotX, 0, -pivotZ))
  transformPrimitive(prim, tilt.elements)
}

/** Drops triangles with any vertex past local X `threshold` (the ear hook). */
export function trimPrimitive(prim: Primitive, threshold: number): { before: number; after: number } {
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
  // Move the primitive onto fresh accessors holding only the referenced
  // vertices, so the trim stays scoped to pt2 even with shared accessors.
  prim.setIndices(index.clone().setArray(Uint32Array.from(kept)))
  compactPrimitive(prim)
  return { before, after: kept.length / 3 }
}

export interface TrimResult {
  /** Why nothing was done, or null when trimmed. */
  skipped: 'already-trimmed' | 'no-temple-node' | null
  before: number
  after: number
}

/**
 * Trim the temple tips and tilt the shafts, once: a document already
 * marked `trimmed` is left alone.
 */
export async function trimTempleTips(
  document: Document,
  { threshold = 0.105, tiltDegrees = 6 }: { threshold?: number; tiltDegrees?: number } = {}
): Promise<TrimResult> {
  if (preparedSteps(document).includes('trimmed')) {
    return { skipped: 'already-trimmed', before: 0, after: 0 }
  }
  const node = document
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === TEMPLE_NODE_NAME)
  const mesh = node?.getMesh()
  if (!mesh) return { skipped: 'no-temple-node', before: 0, after: 0 }
  let before = 0
  let after = 0
  for (const prim of mesh.listPrimitives()) {
    const counts = trimPrimitive(prim, threshold)
    before += counts.before
    after += counts.after
    tiltPrimitive(prim, tiltDegrees)
  }
  await document.transform(prune())
  markPrepared(document, 'trimmed')
  return { skipped: null, before, after }
}

/** Draco-compress, once. The IO writing the document needs the encoder. */
export async function compressOnce(document: Document): Promise<boolean> {
  if (preparedSteps(document).includes('compressed')) return false
  await document.transform(draco({ method: 'edgebreaker' }))
  markPrepared(document, 'compressed')
  return true
}
