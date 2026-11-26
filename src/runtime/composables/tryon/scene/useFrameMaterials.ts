import { onUnmounted, readonly, shallowRef, watch, type ShallowRef } from 'vue'
import {
  BufferAttribute,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterial,
  type Object3D
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  LENS_HEIGHT_ATTRIBUTE,
  LENS_MATERIAL_NAME,
  lensGradientLogTransmittance,
  patchLensFresnelShader,
  patchLensGradientShader,
  type TryOnLens
} from '../../../utils/tryon-lens'
import { patchCameraMatchShader, type CameraMatchUniforms } from '../../../utils/tryon-camera-match'
import { EAR_BEND_RAMP_METERS, patchEarBendShader } from '../../../utils/tryon-temples'

function bakeLensHeight(mesh: Mesh, root: Object3D) {
  const geometry = mesh.geometry as BufferGeometry
  if (geometry.getAttribute(LENS_HEIGHT_ATTRIBUTE)) return
  const position = geometry.getAttribute('position')
  if (!position) return
  root.updateMatrixWorld(true)
  const toFrame = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
  const point = new Vector3()
  const heights = new Float32Array(position.count)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < position.count; i++) {
    const y = point.fromBufferAttribute(position, i).applyMatrix4(toFrame).y
    heights[i] = y
    min = Math.min(min, y)
    max = Math.max(max, y)
  }
  const span = max - min || 1
  for (let i = 0; i < heights.length; i++) heights[i] = (heights[i]! - min) / span
  geometry.setAttribute(LENS_HEIGHT_ATTRIBUTE, new BufferAttribute(heights, 1))
}

function applyLensGradient(material: Material, gradient: { top: number; bottom: number }) {
  const previous = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    shader.uniforms.uLensGradient = { value: lensGradientLogTransmittance(gradient) }
    patchLensGradientShader(shader)
  }
  material.customProgramCacheKey = () => `${previousKey()}|tryon-lens-gradient`
}


function applyLensFresnel(material: MeshPhysicalMaterial) {
  material.premultipliedAlpha = true
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchLensFresnelShader(shader.fragmentShader)
  }
  material.customProgramCacheKey = () => 'tryon-lens-fresnel'
}

export function buildLens(
  authored: MeshStandardMaterial,
  physical: boolean,
  lens: TryOnLens
): Material {
  const base = {
    name: authored.name,
    map: lens.tint ? null : authored.map,
    alphaMap: authored.alphaMap,
    color: authored.color.clone(),
    opacity: authored.opacity,
    side: authored.side,
    transparent: true,
    depthWrite: false,
    metalness: 0,
    roughness: physical ? 0.02 : 0.05,
    envMapIntensity: 1.6
  }
  const material = physical
    ? new MeshPhysicalMaterial({
        ...base,
        ior: 1.5,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        iridescence: 0.35,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [260, 420]
      })
    : Object.assign(authored.clone(), base)
  if (lens.tint) material.color.setRGB(...lens.tint, SRGBColorSpace)
  if (lens.density !== null) material.opacity = lens.density
  if (material instanceof MeshPhysicalMaterial) applyLensFresnel(material)
  if (lens.gradient) applyLensGradient(material, lens.gradient)
  return material
}

export interface MaterialPatch {
  key: string
  apply: (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) => void
}

export function withPatches(material: Material, patches: MaterialPatch[]): Material {
  if (!patches.length) return material
  const previous = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    for (const patch of patches) patch.apply(shader)
  }
  material.customProgramCacheKey = () => [previousKey(), ...patches.map((p) => p.key)].join('|')
  material.needsUpdate = true
  return material
}

export function cameraMatchPatch(uniforms: CameraMatchUniforms): MaterialPatch {
  return {
    key: 'tryon-camera-match',
    apply: (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = patchCameraMatchShader(shader.fragmentShader)
    }
  }
}

export function earBendPatch(uniform: { value: Vector4 }): MaterialPatch {
  return {
    key: 'tryon-ear-bend',
    apply: (shader) => {
      shader.uniforms.uEarBend = uniform
      shader.vertexShader = patchEarBendShader(shader.vertexShader)
    }
  }
}

export interface FrameMaterialFeatures {
  physicalLens: boolean
  lens: TryOnLens
  cameraMatch: CameraMatchUniforms | null
  earBend: { value: Vector4 } | null
}

export function deriveMaterial(authored: Material, features: FrameMaterialFeatures): Material {
  const isLens = LENS_MATERIAL_NAME.test(authored.name)
  const cameraMatch =
    features.cameraMatch && (authored as MeshStandardMaterial).isMeshStandardMaterial
      ? cameraMatchPatch(features.cameraMatch)
      : null
  const patches = [cameraMatch, features.earBend ? earBendPatch(features.earBend) : null].filter(
    (p): p is MaterialPatch => p !== null
  )
  if (!isLens && !patches.length) return authored
  const base = isLens
    ? buildLens(authored as MeshStandardMaterial, features.physicalLens, features.lens)
    : authored.clone()
  return withPatches(base, patches)
}

export type EarBendMaterials = Map<Mesh, { material: Material; uniform: { value: Vector4 } }>

export function useFrameMaterials(
  model: ShallowRef<GLTF | null>,
  props: { physicalLens: boolean; lens: TryOnLens; cameraMatch: boolean },
  cameraMatchUniforms: CameraMatchUniforms
) {
  const derived = new Set<Material>()
  const earBendMaterials: EarBendMaterials = new Map()
  const bendUniforms = new Map<Mesh, { value: Vector4 }>()
  let meshes: Mesh[] = []
  let shared = new Map<Material, Material>()
  const dressed = shallowRef(0)

  function authoredOf(mesh: Mesh): Material | Material[] {
    const authored: Material | Material[] = mesh.userData.tryOnAuthoredMaterial ?? mesh.material
    mesh.userData.tryOnAuthoredMaterial = authored
    return authored
  }

  function dress(mesh: Mesh) {
    const root = model.value?.scene ?? null
    const authored = authoredOf(mesh)
    const bend = bendUniforms.get(mesh) ?? null
    const features: FrameMaterialFeatures = {
      physicalLens: props.physicalLens,
      lens: props.lens,
      cameraMatch: props.cameraMatch ? cameraMatchUniforms : null,
      earBend: bend
    }
    const one = (material: Material) => {
      if (LENS_MATERIAL_NAME.test(material.name) && props.lens.gradient && root) bakeLensHeight(mesh, root)
      const cached = bend ? undefined : shared.get(material)
      if (cached) return cached
      const next = deriveMaterial(material, features)
      if (next !== material) derived.add(next)
      if (!bend) shared.set(material, next)
      return next
    }
    mesh.material = Array.isArray(authored) ? authored.map(one) : one(authored)
    if (bend) earBendMaterials.set(mesh, { material: mesh.material as Material, uniform: bend })
    else earBendMaterials.delete(mesh)
  }

  function dressAll() {
    const previous = [...derived]
    derived.clear()
    shared = new Map()
    meshes = []
    model.value?.scene.traverse((obj) => {
      if (obj instanceof Mesh) meshes.push(obj)
    })
    for (const mesh of meshes) dress(mesh)
    for (const material of previous) if (!derived.has(material)) material.dispose()
    dressed.value++
  }

  function restore() {
    for (const mesh of meshes) {
      const authored = mesh.userData.tryOnAuthoredMaterial
      if (authored) mesh.material = authored
    }
    for (const material of derived) material.dispose()
    derived.clear()
    shared = new Map()
    earBendMaterials.clear()
  }

  function earBend(mesh: Mesh): { value: Vector4 } {
    const existing = bendUniforms.get(mesh)
    if (existing) return existing
    const uniform = { value: new Vector4(0, 0, 0, EAR_BEND_RAMP_METERS) }
    bendUniforms.set(mesh, uniform)
    dress(mesh)
    return uniform
  }

  function clearEarBend() {
    const bent = [...earBendMaterials]
    bendUniforms.clear()
    for (const [mesh, { material }] of bent) {
      dress(mesh)
      derived.delete(material)
      material.dispose()
    }
  }

  watch(
    model,
    (next, previous) => {
      if (previous && next !== previous) {
        restore()
        bendUniforms.clear()
      }
    },
    { flush: 'sync' }
  )

  watch([model, () => props.physicalLens, () => props.lens, () => props.cameraMatch], dressAll, {
    immediate: true
  })

  onUnmounted(restore)

  return { earBend, clearEarBend, earBendMaterials, dressed: readonly(dressed) }
}
