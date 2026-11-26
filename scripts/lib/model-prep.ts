import type { Document, Primitive } from '@gltf-transform/core'
import { compactPrimitive, draco, prune, transformPrimitive } from '@gltf-transform/functions'
import { Matrix4 } from 'three'

export const TEMPLE_NODE_NAME = 'pt2'

export type PrepStep = 'trimmed' | 'compressed'

export const PREP_EXTRAS_KEY = 'tryOnPrepared'

export const DRACO_EXTENSION = 'KHR_draco_mesh_compression'

export const TRIM_DETECT_MARGIN = 0.001

export function preparedSteps(document: Document): PrepStep[] {
  const extras = document.getRoot().getExtras() as Record<string, unknown>
  const steps = extras[PREP_EXTRAS_KEY]
  return Array.isArray(steps) ? (steps.filter((s) => typeof s === 'string') as PrepStep[]) : []
}

export function templeReach(document: Document): number | null {
  const mesh = templeMesh(document)
  if (!mesh) return null
  let reach = -Infinity
  const v = [0, 0, 0]
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION')
    if (!position) continue
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, v)
      reach = Math.max(reach, v[0]!)
    }
  }
  return Number.isFinite(reach) ? reach : null
}

export function isDracoCompressed(document: Document): boolean {
  return document
    .getRoot()
    .listExtensionsUsed()
    .some((extension) => extension.extensionName === DRACO_EXTENSION)
}

function templeMesh(document: Document) {
  return document
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === TEMPLE_NODE_NAME)
    ?.getMesh()
}

export function backfillPrepared(
  document: Document,
  { threshold = 0.105 }: { threshold?: number } = {}
): PrepStep[] {
  const done = preparedSteps(document)
  const found: PrepStep[] = []
  const reach = templeReach(document)
  if (!done.includes('trimmed') && reach !== null && reach <= threshold + TRIM_DETECT_MARGIN) {
    found.push('trimmed')
  }
  if (!done.includes('compressed') && isDracoCompressed(document)) found.push('compressed')
  for (const step of found) markPrepared(document, step)
  return found
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

export interface TrimCounts {
  before: number
  after: number
  capped: number
  open: number
}

export function trimPrimitive(prim: Primitive, threshold: number): TrimCounts {
  const position = prim.getAttribute('POSITION')
  const index = prim.getIndices()
  if (!position || !index) return { before: 0, after: 0, capped: 0, open: 0 }
  const src = index.getArray()!
  const before = src.length / 3
  const kept: number[] = []
  const dropped: number[] = []
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
    ;(clipped ? dropped : kept).push(a, b, c)
  }
  const cap = capCut(position, kept, dropped)
  const after = kept.length / 3
  prim.setIndices(index.clone().setArray(Uint32Array.from([...kept, ...cap.indices])))
  compactPrimitive(prim)
  return { before, after, capped: cap.loops, open: cap.open }
}

function capCut(
  position: NonNullable<ReturnType<Primitive['getAttribute']>>,
  kept: number[],
  dropped: number[]
): { indices: number[]; loops: number; open: number } {
  const v = [0, 0, 0]
  const keyOf = new Map<number, string>()
  const vertexOf = new Map<string, number>()
  const key = (i: number) => {
    let k = keyOf.get(i)
    if (k === undefined) {
      position.getElement(i, v)
      k = v.map((c) => Math.round(c * 1e6)).join(',')
      keyOf.set(i, k)
      if (!vertexOf.has(k)) vertexOf.set(k, i)
    }
    return k
  }
  const edges = (list: number[], visit: (a: string, b: string) => void) => {
    for (let t = 0; t < list.length; t += 3) {
      const tri = [key(list[t]!), key(list[t + 1]!), key(list[t + 2]!)]
      for (let e = 0; e < 3; e++) visit(tri[e]!, tri[(e + 1) % 3]!)
    }
  }
  const droppedEdges = new Set<string>()
  edges(dropped, (a, b) => droppedEdges.add(`${a}|${b}`))
  const next = new Map<string, string>()
  edges(kept, (a, b) => {
    if (droppedEdges.has(`${b}|${a}`)) next.set(b, a)
  })
  const indices: number[] = []
  let loops = 0
  let open = 0
  const seen = new Set<string>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: string[] = []
    let at: string | undefined = start
    while (at !== undefined && !seen.has(at)) {
      seen.add(at)
      loop.push(at)
      at = next.get(at)
    }
    if (at !== start || loop.length < 3) {
      open++
      continue
    }
    const first = vertexOf.get(loop[0]!)!
    for (let i = 1; i < loop.length - 1; i++) {
      indices.push(first, vertexOf.get(loop[i]!)!, vertexOf.get(loop[i + 1]!)!)
    }
    loops++
  }
  return { indices, loops, open }
}

export interface TrimResult extends TrimCounts {
  skipped: 'already-trimmed' | 'no-temple-node' | null
}

export async function trimTempleTips(
  document: Document,
  { threshold = 0.105, tiltDegrees = 6 }: { threshold?: number; tiltDegrees?: number } = {}
): Promise<TrimResult> {
  const none = { before: 0, after: 0, capped: 0, open: 0 }
  backfillPrepared(document, { threshold })
  if (preparedSteps(document).includes('trimmed')) return { skipped: 'already-trimmed', ...none }
  const mesh = templeMesh(document)
  if (!mesh) return { skipped: 'no-temple-node', ...none }
  const total = { ...none }
  for (const prim of mesh.listPrimitives()) {
    const counts = trimPrimitive(prim, threshold)
    total.before += counts.before
    total.after += counts.after
    total.capped += counts.capped
    total.open += counts.open
    tiltPrimitive(prim, tiltDegrees)
  }
  await document.transform(prune())
  markPrepared(document, 'trimmed')
  return { skipped: null, ...total }
}

export async function compressOnce(document: Document): Promise<boolean> {
  backfillPrepared(document)
  if (preparedSteps(document).includes('compressed')) return false
  await document.transform(draco({ method: 'edgebreaker' }))
  markPrepared(document, 'compressed')
  return true
}
