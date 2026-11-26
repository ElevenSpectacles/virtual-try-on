import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  ShaderLib,
  Texture,
  type Material
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  buildLens,
  useFrameMaterials
} from '../../../../../src/runtime/composables/tryon/scene/useFrameMaterials'
import { NO_LENS_OVERRIDE, resolveLens } from '../../../../../src/runtime/utils/tryon-lens'

function authoredLens() {
  return new MeshStandardMaterial({ name: 'glass', map: new Texture(), color: 0xffc8d1, opacity: 0.62, transparent: true })
}

describe('buildLens', () => {
  it('keeps the authored colour and texture without an override', () => {
    const authored = authoredLens()
    for (const physical of [true, false]) {
      const lens = buildLens(authored, physical, NO_LENS_OVERRIDE) as MeshStandardMaterial
      expect(lens.map).toBe(authored.map)
      expect(lens.color.getHex()).toBe(authored.color.getHex())
      expect(lens.opacity).toBeCloseTo(0.62, 9)
    }
  })

  it('replaces the authored texture with a calibration tint, so the tint is the colour shown', () => {
    const lens = resolveLens({ tint: '#7dbcab', density: 0.4 })
    for (const physical of [true, false]) {
      const material = buildLens(authoredLens(), physical, lens) as MeshStandardMaterial
      expect(material.map).toBeNull()
      expect(material.color.getHexString(SRGBColorSpace)).toBe('7dbcab')
      expect(material.color.r).toBeCloseTo(new Color().setRGB(...lens.tint!, SRGBColorSpace).r, 9)
      expect(material.opacity).toBeCloseTo(0.4, 9)
    }
  })

  it('keeps the authored texture when only the darkness is overridden', () => {
    const authored = authoredLens()
    const material = buildLens(authored, true, resolveLens({ category: 3 })) as MeshPhysicalMaterial
    expect(material.map).toBe(authored.map)
  })
})

function scene() {
  const frame = new MeshStandardMaterial({ name: 'acetate' })
  const glass = authoredLens()
  const front = new Mesh(new BoxGeometry(), frame)
  const lens = new Mesh(new BoxGeometry(), glass)
  const arm = new Mesh(new BoxGeometry(), frame)
  const root = new Group()
  root.add(front, lens, arm)
  return { gltf: { scene: root } as unknown as GLTF, frame, glass, front, lens, arm }
}

function compiled(material: Material) {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader
  }
  material.onBeforeCompile(shader as never, {} as never)
  return shader
}

function setup() {
  const s = scene()
  const model = shallowRef<GLTF | null>(s.gltf)
  const props = reactive({ physicalLens: true, lens: NO_LENS_OVERRIDE, cameraMatch: false })
  const uniforms = {
    uCameraGrain: { value: 0 },
    uCameraGrainSeed: { value: 0 },
    uCameraWrap: { value: 0 },
    uCameraWrapColor: { value: { r: 0.5, g: 0.5, b: 0.5 } }
  }
  const scope = effectScope()
  const materials = scope.run(() => useFrameMaterials(model, props, uniforms))!
  return { ...s, model, props, materials, scope }
}

describe('useFrameMaterials', () => {
  it('never mutates the authored materials shared through the model cache', async () => {
    const { frame, props, materials, arm } = setup()
    const compile = frame.onBeforeCompile
    const key = frame.customProgramCacheKey
    props.cameraMatch = true
    await nextTick()
    materials.earBend(arm)
    expect(frame.onBeforeCompile).toBe(compile)
    expect(frame.customProgramCacheKey).toBe(key)
    expect(frame.userData).toEqual({})
  })

  it('reaches the same materials whichever feature is turned on first', async () => {
    const keys = async (order: 'bend-first' | 'match-first') => {
      const { props, materials, arm, front } = setup()
      if (order === 'bend-first') materials.earBend(arm)
      props.cameraMatch = true
      await nextTick()
      if (order === 'match-first') materials.earBend(arm)
      return [
        (arm.material as Material).customProgramCacheKey(),
        (front.material as Material).customProgramCacheKey()
      ]
    }
    const bendFirst = await keys('bend-first')
    expect(bendFirst).toEqual(await keys('match-first'))
    expect(bendFirst[0]).toContain('tryon-camera-match')
    expect(bendFirst[0]).toContain('tryon-ear-bend')
  })

  it('keeps camera match on the arms when ear bend turns off', async () => {
    const { props, materials, arm, front, frame } = setup()
    materials.earBend(arm)
    props.cameraMatch = true
    await nextTick()
    materials.clearEarBend()
    expect(arm.material).toBe(front.material)
    expect(arm.material).not.toBe(frame)
    const shader = compiled(arm.material as Material)
    expect(shader.fragmentShader).toContain('uCameraGrain')
    expect(shader.vertexShader).not.toContain('tryOnEarBend')
    expect(materials.earBendMaterials.size).toBe(0)
  })

  it('patches the bent arm for both the bend and camera match', async () => {
    const { props, materials, arm } = setup()
    props.cameraMatch = true
    await nextTick()
    const uniform = materials.earBend(arm)
    const shader = compiled(arm.material as Material)
    expect(shader.uniforms.uEarBend).toBe(uniform)
    expect(shader.vertexShader).toContain('tryOnEarBend(transformed')
    expect(shader.fragmentShader).toContain('uCameraGrain')
    expect(materials.earBendMaterials.get(arm)?.uniform).toBe(uniform)
  })

  it('shows the authored frame material with no feature on, and swaps only the lens', () => {
    const { front, frame, lens, glass } = setup()
    expect(front.material).toBe(frame)
    expect(lens.material).not.toBe(glass)
    expect((lens.material as Material).name).toBe('glass')
  })

  it('puts the authored materials back when the model changes', async () => {
    const { model, props, materials, front, frame, lens, glass, arm } = setup()
    props.cameraMatch = true
    await nextTick()
    materials.earBend(arm)
    model.value = scene().gltf
    await nextTick()
    expect(front.material).toBe(frame)
    expect(arm.material).toBe(frame)
    expect(lens.material).toBe(glass)
    expect(materials.earBendMaterials.size).toBe(0)
  })
})
