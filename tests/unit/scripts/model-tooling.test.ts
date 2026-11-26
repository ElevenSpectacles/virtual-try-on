import { describe, expect, it } from 'vitest'
import { Document, type Primitive } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import {
  compressOnce,
  markPrepared,
  preparedSteps,
  trimTempleTips,
  TEMPLE_NODE_NAME
} from '../../../scripts/lib/model-prep'
import { lintModel } from '../../../scripts/lib/model-lint'

function tube(xs: number[], half = 0.002) {
  const ring: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half]
  ]
  const positions: number[] = []
  for (const x of xs) for (const [y, z] of ring) positions.push(x, 0.07 + y, z)
  const indices: number[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k
      const b = i * 4 + ((k + 1) % 4)
      indices.push(a, b, b + 4, a, b + 4, a + 4)
    }
  }
  const last = (xs.length - 1) * 4
  indices.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3)
  return { positions, indices }
}

function triangles(prim: Primitive): number[][][] {
  const position = prim.getAttribute('POSITION')!
  const index = Array.from(prim.getIndices()!.getArray()!)
  const at = (i: number) => position.getElement(i, [0, 0, 0])
  const out: number[][][] = []
  for (let t = 0; t < index.length; t += 3) out.push([at(index[t]!), at(index[t + 1]!), at(index[t + 2]!)])
  return out
}

function signedVolume(tris: number[][][]): number {
  let volume = 0
  for (const [a, b, c] of tris) {
    volume +=
      (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) -
        a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) +
        a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) /
      6
  }
  return volume
}

function openEdges(tris: number[][][]): number {
  const count = new Map<string, number>()
  const key = (p: number[]) => p.map((c) => Math.round(c * 1e6)).join(',')
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const [a, b] = [key(tri[e]!), key(tri[(e + 1) % 3]!)]
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`
      count.set(edge, (count.get(edge) ?? 0) + 1)
    }
  }
  return [...count.values()].filter((n) => n !== 2).length
}

function frame({
  lensColour = [0.3, 0.3, 0.3],
  width = 0.14,
  temple = true,
  reach = 0.15,
  closed = false
} = {}) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const accessor = (type: 'VEC3' | 'SCALAR', array: Float32Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const front = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      accessor('VEC3', new Float32Array([-width / 2, 0, 0, width / 2, 0, 0, 0, 0.045, 0]))
    )
    .setIndices(accessor('SCALAR', new Uint32Array([0, 1, 2])))
    .setMaterial(doc.createMaterial('glass').setBaseColorFactor([...lensColour, 0.6] as [number, number, number, number]).setAlphaMode('BLEND'))
  const scene = doc.createScene()
  scene.addChild(doc.createNode('front').setMesh(doc.createMesh().addPrimitive(front)))
  if (temple) {
    const xs = [0.02, 0.05, 0.08, 0.1, 0.12, 0.15].filter((x) => x <= reach)
    const { positions, indices } = closed ? tube(xs) : strip(xs)
    const arm = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
      .setIndices(accessor('SCALAR', new Uint32Array(indices)))
    scene.addChild(
      doc
        .createNode(TEMPLE_NODE_NAME)
        .setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2])
        .setMesh(doc.createMesh().addPrimitive(arm))
    )
  }
  doc.getRoot().setDefaultScene(scene)
  return doc
}

function strip(xs: number[]) {
  const positions: number[] = []
  for (const x of xs) positions.push(x, 0.07, 0, x, 0.07, 0.004)
  const indices: number[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  return { positions, indices }
}

const templePrim = (doc: Document) =>
  doc.getRoot().listNodes().find((n) => n.getName() === TEMPLE_NODE_NAME)!.getMesh()!.listPrimitives()[0]!

const templeX = (doc: Document) => {
  const prim = doc.getRoot().listNodes().find((n) => n.getName() === TEMPLE_NODE_NAME)!.getMesh()!.listPrimitives()[0]!
  return Array.from(prim.getAttribute('POSITION')!.getArray()!)
}

describe('model preparation', () => {
  it('records the steps it ran in the extras', () => {
    const doc = frame()
    expect(preparedSteps(doc)).toEqual([])
    markPrepared(doc, 'trimmed')
    markPrepared(doc, 'trimmed')
    expect(preparedSteps(doc)).toEqual(['trimmed'])
  })

  it('trims the temple tips once and never again', async () => {
    const doc = frame()
    const first = await trimTempleTips(doc)
    expect(first.skipped).toBeNull()
    expect(first.after).toBeLessThan(first.before)
    const afterFirst = templeX(doc)
    const second = await trimTempleTips(doc)
    expect(second.skipped).toBe('already-trimmed')
    expect(templeX(doc)).toEqual(afterFirst)
  })

  it('recognises a temple trimmed before the marker existed and never tilts it again', async () => {
    const doc = frame({ reach: 0.1 })
    const before = templeX(doc)
    const result = await trimTempleTips(doc)
    expect(result.skipped).toBe('already-trimmed')
    expect(templeX(doc)).toEqual(before)
    expect(preparedSteps(doc)).toContain('trimmed')
  })

  it('caps the cut so a closed temple stays closed and outward-facing', async () => {
    const doc = frame({ closed: true })
    const original = triangles(templePrim(doc))
    expect(openEdges(original)).toBe(0)
    expect(signedVolume(original)).toBeGreaterThan(0)
    const result = await trimTempleTips(doc, { tiltDegrees: 0 })
    expect(result).toMatchObject({ skipped: null, capped: 1, open: 0 })
    const trimmed = triangles(templePrim(doc))
    expect(openEdges(trimmed)).toBe(0)
    expect(signedVolume(trimmed)).toBeGreaterThan(0)
    expect(Math.max(...trimmed.flat().map((p) => p[0]!))).toBeLessThanOrEqual(0.105)
  })

  it('reports an open strip it cannot cap', async () => {
    const result = await trimTempleTips(frame())
    expect(result).toMatchObject({ capped: 0, open: 1 })
  })

  it('treats a Draco-compressed GLB without the marker as compressed', async () => {
    const doc = frame()
    doc.createExtension(KHRDracoMeshCompression).setRequired(true)
    expect(await compressOnce(doc)).toBe(false)
    expect(preparedSteps(doc)).toContain('compressed')
  })

  it('skips a GLB without a temple node', async () => {
    expect((await trimTempleTips(frame({ temple: false }))).skipped).toBe('no-temple-node')
  })

  it('compresses once', async () => {
    const doc = frame()
    expect(await compressOnce(doc)).toBe(true)
    expect(await compressOnce(doc)).toBe(false)
    expect(preparedSteps(doc)).toContain('compressed')
  })
})

describe('model lint', () => {
  const rules = (doc: Document, fileSize = 500_000) => lintModel(doc, { fileSize }).map((f) => `${f.severity}:${f.rule}`)

  it('passes a prepared, plausible frame', () => {
    const doc = frame()
    markPrepared(doc, 'compressed')
    expect(rules(doc)).toEqual([])
  })

  it('flags the placeholder lens colour', () => {
    expect(rules(frame({ lensColour: [1, 0.78, 0.82] }))).toContain('warning:lens-colour')
  })

  it('fails a model without a lens material', () => {
    const doc = frame()
    doc.getRoot().listMaterials()[0]!.setName('acetate')
    expect(rules(doc)).toContain('error:lens-material')
  })

  it('fails a frame in the wrong units', () => {
    expect(rules(frame({ width: 140 }))).toContain('error:bounds')
  })

  it('warns about a missing temple node, size and compression', () => {
    const found = rules(frame({ temple: false }), 2e6)
    expect(found).toContain('warning:temple-node')
    expect(found).toContain('warning:size')
    expect(found).toContain('warning:compressed')
    expect(rules(frame(), 6e6)).toContain('error:size')
  })

  it('accepts a Draco-compressed frame prepared before the marker existed', () => {
    const doc = frame()
    doc.createExtension(KHRDracoMeshCompression).setRequired(true)
    expect(rules(doc)).not.toContain('warning:compressed')
  })
})
