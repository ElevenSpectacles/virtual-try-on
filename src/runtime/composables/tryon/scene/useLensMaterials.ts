import { onUnmounted, watch, type ShallowRef } from 'vue'
import {
  BufferAttribute,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterial,
  type Object3D
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  LENS_HEIGHT_ATTRIBUTE,
  patchLensGradientShader,
  type TryOnLens
} from '../../../utils/tryon-lens'

// A lens mesh's own height, 0 at its bottom … 1 at its top in the GLB's
// frame (up is +y there), as a vertex attribute for the gradient tint. Baked
// once per geometry: the node transforms are fixed.
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

/**
 * Gradient tint (`lens.gradient`): the lens's base opacity follows its
 * height, dark to light top to bottom with a smooth middle
 * (`gradientDensityAt`). Composes with the Fresnel patch, which reads the
 * opacity after this.
 */
function applyLensGradient(material: Material, gradient: { top: number; bottom: number }) {
  const previous = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    shader.uniforms.uLensGradient = { value: [gradient.bottom, gradient.top] }
    patchLensGradientShader(shader)
  }
  material.customProgramCacheKey = () => `${previousKey()}|tryon-lens-gradient`
}

// The catalog's lens materials are authored as metalness ≈ 0.7 with
// alpha-blend transparency — physically wrong for a dielectric: metalness
// tints and darkens instead of transmitting, and the metallic Fresnel kills
// the see-through read against the face. Lenses are rebuilt as a true
// dielectric (metalness 0) that does not write depth, so frame geometry
// behind the lens is not clipped by the lens surface. Name-scoped — every
// catalog GLB names its lens material "glass".
//
// Further touches sell "real sunglass glass" in the composite:
// - roughness ≈ 0: lenses are polished; any roughness blurs the reflections
//   into a plastic-looking haze.
// - envMapIntensity above 1: a real lens is a curved mirror — it catches
//   bright, sharp speculars from the room. Boosting the IBL contribution on
//   lenses only (frame acetate keeps its authored response) gives that glint
//   that reads as glass over a video feed.
// - physicalLens (mid tier and up, see utils/tryon-lens.ts): opacity rises
//   with the Fresnel term toward grazing angles, so the lens rim reads as
//   glass instead of a flat tinted cut-out; reflections are added on top of
//   what the lens transmits instead of being scaled down by its opacity (a
//   light lens still mirrors the room); a clearcoat and a thin-film
//   iridescence give the faint green/violet sheen of an AR coating.
export const LENS_MATERIAL_NAME = /glass|lens/i

/**
 * Opacity follows the normalized Schlick term, `lensOpacityAt` in
 * utils/tryon-lens.ts. Output is premultiplied by hand: only the body
 * colour is scaled by coverage, reflections add on top.
 */
function applyLensFresnel(material: MeshPhysicalMaterial) {
  material.premultipliedAlpha = true
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <opaque_fragment>',
        `float lensGrazing = pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 5.0 );
        diffuseColor.a = diffuseColor.a + ( 1.0 - diffuseColor.a ) * lensGrazing;
        vec3 lensReflected = max( outgoingLight - totalDiffuse, vec3( 0.0 ) );
        gl_FragColor = vec4( totalDiffuse * diffuseColor.a + lensReflected, diffuseColor.a );`
      )
      .replace('#include <premultiplied_alpha_fragment>', '')
  }
  material.customProgramCacheKey = () => 'tryon-lens-fresnel'
}

function buildLens(
  authored: MeshStandardMaterial,
  physical: boolean,
  lens: TryOnLens
): Material {
  const base = {
    name: authored.name,
    map: authored.map,
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
  if (lens.tint) material.color.setRGB(...lens.tint)
  if (lens.density !== null) material.opacity = lens.density
  if (material instanceof MeshPhysicalMaterial) applyLensFresnel(material)
  // After the Fresnel patch, so it wraps it: the gradient sets the base
  // opacity the Fresnel term then raises toward grazing angles.
  if (lens.gradient) applyLensGradient(material, lens.gradient)
  return material
}

/**
 * Rebuilds the GLB's lens materials (tint, density, gradient, physical
 * lens) when the model, tier or override changes.
 */
export function useLensMaterials(
  model: ShallowRef<GLTF | null>,
  props: { physicalLens: boolean; lens: TryOnLens }
) {
  // Lens materials we built, so a rebuild (model, tier or override change)
  // can free the previous ones. The GLB's authored materials are kept on each
  // mesh so every rebuild starts from them.
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
