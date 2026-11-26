import { onUnmounted, watch, type ShallowRef } from 'vue'
import {
  BufferAttribute,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector3,
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

export function useLensMaterials(
  model: ShallowRef<GLTF | null>,
  props: { physicalLens: boolean; lens: TryOnLens }
) {
  let builtLenses: Material[] = []

  watch(
    [model, () => props.physicalLens, () => props.lens],
    ([gltf, physical, lens]) => {
      const previous = builtLenses
      builtLenses = []
      const built = new Map<Material, Material>()
      gltf?.scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        const authored: Material | Material[] =
          obj.userData.tryOnAuthoredMaterial ?? obj.material
        obj.userData.tryOnAuthoredMaterial = authored
        const swap = (material: Material) => {
          if (!LENS_MATERIAL_NAME.test(material.name)) return material
          if (lens.gradient && gltf) bakeLensHeight(obj, gltf.scene)
          let lensMaterial = built.get(material)
          if (!lensMaterial) {
            lensMaterial = buildLens(material as MeshStandardMaterial, physical, lens)
            built.set(material, lensMaterial)
            builtLenses.push(lensMaterial)
          }
          return lensMaterial
        }
        obj.material = Array.isArray(authored) ? authored.map(swap) : swap(authored)
      })
      for (const material of previous) material.dispose()
    },
    { immediate: true }
  )

  onUnmounted(() => {
    for (const material of builtLenses) material.dispose()
  })
}
