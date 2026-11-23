import type { Document, Primitive } from '@gltf-transform/core'
import { compactPrimitive, draco, prune, transformPrimitive } from '@gltf-transform/functions'
import { Matrix4 } from 'three'

export const TEMPLE_NODE_NAME = 'pt2'

export type PrepStep = 'trimmed' | 'compressed'

export const PREP_EXTRAS_KEY = 'tryOnPrepared'

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
  const theta = (tiltDegrees * Math.PI) / 180
  const tilt = new Matrix4()
    .makeTranslation(pivotX, 0, pivotZ)
    .multiply(new Matrix4().makeRotationY(-theta))
    .multiply(new Matrix4().makeTranslation(-pivotX, 0, -pivotZ))
  transformPrimitive(prim, tilt.elements)
}

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
  prim.setIndices(index.clone().setArray(Uint32Array.from(kept)))
  compactPrimitive(prim)
  return { before, after: kept.length / 3 }
}

export interface TrimResult {
  skipped: 'already-trimmed' | 'no-temple-node' | null
  before: number
  after: number
}

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

export async function compressOnce(document: Document): Promise<boolean> {
  if (preparedSteps(document).includes('compressed')) return false
  await document.transform(draco({ method: 'edgebreaker' }))
  markPrepared(document, 'compressed')
  return true
}
