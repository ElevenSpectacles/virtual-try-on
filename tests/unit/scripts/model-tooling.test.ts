import { describe, expect, it } from 'vitest'
import { Document } from '@gltf-transform/core'
import {
  compressOnce,
  markPrepared,
  preparedSteps,
  trimTempleTips
} from '../../../scripts/lib/model-prep'
import { lintModel } from '../../../scripts/lib/model-lint'

/**
 * A synthetic frame: a 140 × 45 mm front with a lens material, and a `pt2`
 * temple mesh whose triangles run along local X from the hinge (0.02) to
 * past the trim threshold (0.15).
 */
function frame({ lensColour = [0.3, 0.3, 0.3], width = 0.14, temple = true } = {}) {
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
    const xs = [0.02, 0.05, 0.08, 0.1, 0.12, 0.15]
    const positions: number[] = []
    for (const x of xs) positions.push(x, 0.07, 0, x, 0.07, 0.004)
    const indices: number[] = []
    for (let i = 0; i < xs.length - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const arm = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
      .setIndices(accessor('SCALAR', new Uint32Array(indices)))
    // Like the catalog: pt2's local X (reach) runs to world -Z.
    scene.addChild(
      doc
        .createNode('pt2')
        .setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2])
        .setMesh(doc.createMesh().addPrimitive(arm))
    )
  }
  doc.getRoot().setDefaultScene(scene)
  return doc
}

const templeX = (doc: Document) => {
  const prim = doc.getRoot().listNodes().find((n) => n.getName() === 'pt2')!.getMesh()!.listPrimitives()[0]!
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
    // A second run would tilt the shaft again: it must not touch it.
    expect(templeX(doc)).toEqual(afterFirst)
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
})
