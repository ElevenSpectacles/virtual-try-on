import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import {
  MAX_TEMPLE_OPENING_RADIANS,
  MIN_TEMPLE_REACH_METERS,
  TEMPLE_CLEARANCE_METERS,
  TEMPLE_NODE_NAME,
  rigTemples,
  templeAngles,
  templeInnerHalfWidth,
  templeOpeningAngle,
  templeProfile,
  EAR_BEND_RADIANS,
  EAR_REST_OFFSET_METERS,
  earBendFor,
  earBendPoint,
  patchEarBendShader
} from '../../../src/runtime/utils/tryon-temples'

/**
 * A straight temple arm on one side, like the catalog's `pt2` halves: a thin
 * plate from the hinge (x = 0.018) back to x = 0.105, inner face at
 * |y| = 0.068, outer at 0.070, 4 mm tall.
 */
function armPoints(side: 1 | -1): number[] {
  const points: number[] = []
  for (let x = 0.018; x <= 0.105 + 1e-9; x += 0.005) {
    for (const y of [0.068, 0.07]) {
      for (const z of [0.002, 0.006]) points.push(x, side * y, z)
    }
  }
  return points
}

/** Both arms as one indexed mesh: one quad strip per side. */
function templeMesh(): Mesh {
  const positions: number[] = []
  const index: number[] = []
  for (const side of [1, -1]) {
    const start = positions.length / 3
    let rows = 0
    for (let x = 0.018; x <= 0.105 + 1e-9; x += 0.005) {
      positions.push(x, side * 0.068, 0.004, x, side * 0.07, 0.004)
      rows++
    }
    for (let r = 0; r + 1 < rows; r++) {
      const a = start + r * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(index)
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = TEMPLE_NODE_NAME
  mesh.position.set(0, 0, -0.02)
  return mesh
}

describe('templeProfile', () => {
  it('puts the pivot on the outer face at the hinge', () => {
    const profile = templeProfile(armPoints(1), 1)!
    expect(profile.pivot.x).toBeCloseTo(0.018)
    expect(profile.pivot.y).toBeCloseTo(0.07)
    expect(profile.pivot.z).toBeCloseTo(0.004)
  })

  it('mirrors on the other side', () => {
    const profile = templeProfile(armPoints(-1), -1)!
    expect(profile.pivot.y).toBeCloseTo(-0.07)
  })

  it('reads the inner face along the arm', () => {
    const profile = templeProfile(armPoints(1), 1)!
    expect(templeInnerHalfWidth(profile, 0.06)).toBeCloseTo(0.068)
    // Held past the ends.
    expect(templeInnerHalfWidth(profile, 0.5)).toBeCloseTo(0.068)
  })

  it('is null without points', () => {
    expect(templeProfile([], 1)).toBeNull()
  })
})

describe('templeOpeningAngle', () => {
  const plus = templeProfile(armPoints(1), 1)!
  const minus = templeProfile(armPoints(-1), -1)!
  // A head point where the arm already clears it by exactly the clearance.
  const fitted = 0.068 - TEMPLE_CLEARANCE_METERS

  it('is zero where the arm already meets the head', () => {
    expect(templeOpeningAngle(plus, { x: 0.06, y: fitted })).toBeCloseTo(0)
  })

  it('opens outward for a wider head', () => {
    const angle = templeOpeningAngle(plus, { x: 0.06, y: fitted + 0.002 })
    expect(angle).toBeCloseTo(Math.atan2(0.002, 0.06 - 0.018))
  })

  it('closes in for a narrower head', () => {
    expect(templeOpeningAngle(plus, { x: 0.06, y: fitted - 0.002 })).toBeLessThan(0)
  })

  it('is symmetric: the −Y arm opens with the opposite rotation', () => {
    const a = templeOpeningAngle(plus, { x: 0.06, y: fitted + 0.002 })
    const b = templeOpeningAngle(minus, { x: 0.06, y: -(fitted + 0.002) })
    expect(b).toBeCloseTo(-a)
  })

  it('is clamped', () => {
    expect(templeOpeningAngle(plus, { x: 0.06, y: 0.2 })).toBeCloseTo(MAX_TEMPLE_OPENING_RADIANS)
    expect(templeOpeningAngle(plus, { x: 0.06, y: 0.001 })).toBeCloseTo(-MAX_TEMPLE_OPENING_RADIANS)
  })

  it('ignores points close to the hinge or on the other side', () => {
    expect(templeOpeningAngle(plus, { x: 0.018 + MIN_TEMPLE_REACH_METERS / 2, y: 0.08 })).toBe(0)
    expect(templeOpeningAngle(plus, { x: 0.06, y: -0.08 })).toBe(0)
  })
})

describe('rigTemples', () => {
  it('splits the temple node into two arms on hinge pivots', () => {
    const root = new Group()
    const parent = new Group()
    root.add(parent)
    const node = templeMesh()
    parent.add(node)
    const triangles = node.geometry.getIndex()!.count / 3

    const rig = rigTemples(root)!
    expect(rig.temples).toHaveLength(2)
    expect(root.getObjectByName(TEMPLE_NODE_NAME)).not.toBe(node)
    const meshes: Mesh[] = []
    root.traverse((obj) => {
      if (obj instanceof Mesh) meshes.push(obj)
    })
    expect(meshes).toHaveLength(2)
    expect(meshes.reduce((n, mesh) => n + mesh.geometry.getIndex()!.count / 3, 0)).toBe(triangles)
    for (const mesh of meshes) {
      // Every triangle on one side only.
      const index = mesh.geometry.getIndex()!
      const position = mesh.geometry.getAttribute('position')
      const signs = new Set<number>()
      for (let i = 0; i < index.count; i++) signs.add(Math.sign(position.getY(index.getX(i))))
      expect(signs.size).toBe(1)
    }
  })

  it('keeps the arms where they were at rest', () => {
    const root = new Group()
    root.add(templeMesh())
    root.updateMatrixWorld(true)
    const before = new Vector3(0.105, 0.07, 0.004).applyMatrix4(
      root.getObjectByName(TEMPLE_NODE_NAME)!.matrixWorld
    )
    rigTemples(root)
    let after: Vector3 | null = null
    root.traverse((obj) => {
      if (obj instanceof Mesh && obj.name.endsWith('_plus_y')) {
        after = new Vector3(0.105, 0.07, 0.004).applyMatrix4(obj.matrixWorld)
      }
    })
    expect(after!.distanceTo(before)).toBeLessThan(1e-9)
  })

  it('swings an arm about its hinge', () => {
    const root = new Group()
    root.add(templeMesh())
    const rig = rigTemples(root)!
    const plus = rig.temples.find((t) => t.profile.side === 1)!
    plus.pivot.rotation.z = 0.1
    root.updateMatrixWorld(true)
    let tip: Vector3 | null = null
    root.traverse((obj) => {
      if (obj instanceof Mesh && obj.name.endsWith('_plus_y')) {
        tip = new Vector3(0.105, 0.07, 0.004).applyMatrix4(obj.matrixWorld)
      }
    })
    // The +Y arm's tip swings outward (+y) by reach · sin(angle).
    expect(tip!.y).toBeCloseTo(0.07 + (0.105 - 0.018) * Math.sin(0.1), 4)
  })

  it('leaves a GLB without a temple node alone', () => {
    const root = new Group()
    root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()))
    expect(rigTemples(root)).toBeNull()
  })

  it('leaves a one-sided temple node alone', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0.02, 0.07, 0, 0.1, 0.07, 0, 0.1, 0.068, 0]), 3)
    )
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.name = TEMPLE_NODE_NAME
    const root = new Group()
    root.add(mesh)
    expect(rigTemples(root)).toBeNull()
    expect(root.getObjectByName(TEMPLE_NODE_NAME)).toBe(mesh)
  })
})

describe('templeAngles', () => {
  it('opens each arm to the head point on its side, in the scene frame', () => {
    const root = new Group()
    root.add(templeMesh())
    const rig = rigTemples(root)!
    // The node sits at z = −0.02 in the scene; head points 2 mm wider than fitted.
    const y = 0.068 - TEMPLE_CLEARANCE_METERS + 0.002
    const angles = templeAngles(rig, [
      { x: 0.06, y: -y, z: -0.02 },
      { x: 0.06, y, z: -0.02 }
    ])
    const expected = Math.atan2(0.002, 0.06 - 0.018)
    rig.temples.forEach((temple, i) => {
      expect(angles[i]).toBeCloseTo(temple.profile.side * expected)
    })
  })

  it('opens both arms as far as the wider side needs', () => {
    const root = new Group()
    root.add(templeMesh())
    const rig = rigTemples(root)!
    const fitted = 0.068 - TEMPLE_CLEARANCE_METERS
    const angles = templeAngles(rig, [
      { x: 0.06, y: -(fitted - 0.002), z: -0.02 },
      { x: 0.06, y: fitted + 0.003, z: -0.02 }
    ])
    const expected = Math.atan2(0.003, 0.06 - 0.018)
    rig.temples.forEach((temple, i) => {
      expect(angles[i]).toBeCloseTo(temple.profile.side * expected)
    })
  })

  it('keeps the arms shut without head points', () => {
    const root = new Group()
    root.add(templeMesh())
    expect(templeAngles(rigTemples(root)!, [])).toEqual([0, 0])
  })
})

describe('ear bend', () => {
  const bend = { start: 0.08, z: 0, angle: Math.PI / 6 }

  it('leaves the arm in front of the ear untouched', () => {
    expect(earBendPoint({ x: 0.05, y: 0.07, z: 0.001 }, bend)).toEqual({ x: 0.05, y: 0.07, z: 0.001 })
  })

  it('drops the tip by the full angle past the ramp, keeping its length', () => {
    const tip = earBendPoint({ x: 0.12, y: 0.07, z: 0 }, bend)
    const reach = 0.04
    expect(tip.x).toBeCloseTo(0.08 + reach * Math.cos(Math.PI / 6), 9)
    expect(tip.z).toBeCloseTo(-reach * Math.sin(Math.PI / 6), 9)
    expect(tip.y).toBe(0.07)
  })

  it('eases in, so the arm curves instead of kinking', () => {
    const just = earBendPoint({ x: 0.0805, y: 0, z: 0 }, bend)
    expect(just.z).toBeLessThan(0)
    expect(-just.z).toBeLessThan(0.0005 * Math.sin(Math.PI / 6) * 0.1)
  })

  it('starts the bend behind the ear point, on the arm', () => {
    const profile = templeProfile(new Float32Array([0.02, 0.07, 0.003, 0.12, 0.068, 0.003]), 1)!
    const result = earBendFor(profile, { x: 0.09 })
    expect(result.start).toBeCloseTo(0.09 + EAR_REST_OFFSET_METERS, 9)
    expect(result.z).toBeCloseTo(profile.pivot.z, 9)
    expect(result.angle).toBe(EAR_BEND_RADIANS)
  })

  it('patches the vertex shader around the position and normal chunks', () => {
    const patched = patchEarBendShader(
      'void main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}'
    )
    expect(patched).toContain('uniform vec4 uEarBend;')
    expect(patched).toMatch(/beginnormal_vertex>[\s\S]*objectNormal = vec3/)
    expect(patched).toMatch(/begin_vertex>[\s\S]*transformed = tryOnEarBend\(transformed/)
  })
})
