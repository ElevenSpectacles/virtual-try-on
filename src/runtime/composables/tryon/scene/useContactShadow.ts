import { onUnmounted, watch, type ShallowRef } from 'vue'
import {
  Color,
  DirectionalLight,
  Mesh,
  MeshDepthMaterial,
  SRGBColorSpace,
  type Material
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SHADOW_LIGHT_DIRECTION, contactShadowLight } from '../../../utils/tryon-contact-shadow'
import type { TryOnLens } from '../../../utils/tryon-lens'
import { aimLight, type LightDirection } from '../../../utils/tryon-room'
import { LENS_MATERIAL_NAME } from './useLensMaterials'

// Contact shadow (utils/tryon-contact-shadow): a shadow-only light (no
// intensity, so it changes no shading) renders a small
// shadow map of the frame, framed tightly on it, and a ShadowMaterial copy
// of the face mesh shows that shadow on the skin. The catalog is mostly
// rimless, so most of a real pair's shadow comes from its tinted lenses: a
// shadow map has no partial transparency, so lenses cast through an
// alpha-hashed depth material (a random share of texels, by lens density)
// that the blur turns into an even half-shadow. The host canvas uses VSM:
// its blur pass keeps the edge soft, as from a room light rather than a
// spotlight, without PCF's speckle at a wide radius.
//
// The shadow colour (`shadowColor`) is a warm dark brown, not black: light
// scattering under skin keeps real shadows on skin reddish, and black at low
// opacity reads as a grey smudge.
const SHADOW_MAP_SIZE = 512
const SHADOW_RADIUS = 8
/** Share of light a lens blocks in the shadow, per unit of lens opacity. */
const LENS_SHADOW_DENSITY = 0.6

/**
 * The shadow-only light framed on the frame (aimed by the room's light
 * direction when known), what casts into its map, and the colour the
 * receiver draws the shadow in.
 */
export function useContactShadow(
  model: ShallowRef<GLTF | null>,
  props: {
    contactShadow: boolean
    position: { x: number; y: number; z?: number }
    scale: number
    lightDirection: LightDirection | null
    lens: TryOnLens
  }
) {
  const shadowColor = new Color().setRGB(0.16, 0.05, 0.03, SRGBColorSpace)

  const shadowLight = new DirectionalLight(0xffffff, 0)
  shadowLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  shadowLight.shadow.radius = SHADOW_RADIUS
  shadowLight.shadow.blurSamples = 12
  shadowLight.shadow.bias = -0.0005

  watch(
    () => props.contactShadow,
    (enabled) => {
      shadowLight.castShadow = enabled
    },
    { immediate: true }
  )

  // Frame the shadow camera on the frame. The light is directional and has
  // no intensity, so moving it changes only what the shadow map covers.
  watch(
    [() => props.position, () => props.scale, () => props.lightDirection],
    ([position, scale, direction]) => {
      const light = contactShadowLight(position, scale, aimLight(SHADOW_LIGHT_DIRECTION, direction))
      shadowLight.position.set(light.position.x, light.position.y, light.position.z)
      shadowLight.target.position.set(light.target.x, light.target.y, light.target.z)
      shadowLight.target.updateMatrixWorld()
      const camera = shadowLight.shadow.camera
      camera.left = -light.halfExtent
      camera.right = light.halfExtent
      camera.top = light.halfExtent
      camera.bottom = -light.halfExtent
      camera.near = light.near
      camera.far = light.far
      camera.updateProjectionMatrix()
    },
    { immediate: true }
  )

  // Every frame mesh casts; lens meshes through a partial (alpha-hashed)
  // depth material. The receiver never casts.
  let lensDepthMaterials: MeshDepthMaterial[] = []

  watch(
    [model, () => props.contactShadow, () => props.lens],
    ([gltf, enabled]) => {
      for (const material of lensDepthMaterials) material.dispose()
      lensDepthMaterials = []
      gltf?.scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        obj.castShadow = enabled
        const current = Array.isArray(obj.material) ? obj.material : [obj.material]
        const lens = current.find((m: Material) => LENS_MATERIAL_NAME.test(m.name))
        if (!enabled || !lens) {
          obj.customDepthMaterial = undefined
          return
        }
        const depth = new MeshDepthMaterial({
          alphaHash: true,
          opacity: Math.min(lens.opacity * LENS_SHADOW_DENSITY, 1)
        })
        lensDepthMaterials.push(depth)
        obj.customDepthMaterial = depth
      })
    },
    { immediate: true }
  )

  onUnmounted(() => {
    shadowLight.dispose()
    for (const material of lensDepthMaterials) material.dispose()
  })

  return { shadowLight, shadowColor }
}
