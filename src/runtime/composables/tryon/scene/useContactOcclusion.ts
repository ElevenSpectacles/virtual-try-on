import { onUnmounted, watch, type ComputedRef, type ShallowRef } from 'vue'
import {
  DoubleSide,
  LinearFilter,
  NoColorSpace,
  ShadowMaterial,
  Vector3,
  VideoTexture,
  type Color
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  CONTACT_OCCLUSION_GAIN,
  OCCLUSION_RANGE_METERS,
  patchContactReceiverShader
} from '../../../utils/tryon-contact-occlusion'
import { earBendPoint } from '../../../utils/tryon-temples'
import type { ContactReceiverUniforms, MeshOccluderSphere } from './useContactShadow'
import type { EarBendMaterials } from './useFrameMaterials'

export function useContactOcclusion(
  model: ShallowRef<GLTF | null>,
  props: {
    contactShadowStrength: number
    videoElement: HTMLVideoElement | null
    mediaWindow: { xMin: number; xMax: number; yMin: number; yMax: number }
  },
  shadow: {
    shadowColor: Color
    receiverUniforms: ContactReceiverUniforms
    tinted: ComputedRef<boolean>
    occluderSpheres: () => MeshOccluderSphere[]
  },
  earBendMaterials: EarBendMaterials
) {
  const { shadowColor: SHADOW_COLOR, receiverUniforms, tinted } = shadow

  const shadowReceiverMaterial = new ShadowMaterial({
    color: SHADOW_COLOR,
    transparent: true,
    depthWrite: false,
    side: DoubleSide
  })
  shadowReceiverMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, receiverUniforms)
    patchContactReceiverShader(shader)
  }

  watch(
    tinted,
    (tint) => {
      if (tint) shadowReceiverMaterial.defines = { TINTED_LENS_SHADOW: '' }
      else delete shadowReceiverMaterial.defines?.TINTED_LENS_SHADOW
      shadowReceiverMaterial.needsUpdate = true
    },
    { immediate: true }
  )

  watch(
    [tinted, () => props.videoElement],
    ([tint, video]) => {
      receiverUniforms.uVideo.value?.dispose()
      receiverUniforms.uVideo.value = null
      if (!tint || !video) return
      const texture = new VideoTexture(video)
      texture.colorSpace = NoColorSpace
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      receiverUniforms.uVideo.value = texture
    },
    { immediate: true }
  )
  watch(
    () => props.mediaWindow,
    (window) => receiverUniforms.uWindow.value.set(window.xMin, window.xMax, window.yMin, window.yMax),
    { immediate: true }
  )

  const sphereCentre = new Vector3()
  shadowReceiverMaterial.onBeforeRender = () => {
    const root = model.value?.scene
      const spheres = root ? shadow.occluderSpheres() : []
    const scale = root ? root.matrixWorld.getMaxScaleOnAxis() : 0
    spheres.forEach((sphere, i) => {
      const bend = earBendMaterials.get(sphere.mesh)?.uniform.value
      const local = bend
        ? earBendPoint(sphere, { start: bend.x, z: bend.y, angle: bend.z }, bend.w)
        : sphere
      sphereCentre.set(local.x, local.y, local.z).applyMatrix4(sphere.mesh.matrixWorld)
      receiverUniforms.uSpheres.value[i]!.set(
        sphereCentre.x,
        sphereCentre.y,
        sphereCentre.z,
        sphere.r * sphere.mesh.matrixWorld.getMaxScaleOnAxis()
      )
    })
    receiverUniforms.uSphereCount.value = spheres.length
    receiverUniforms.uOcclusionRange.value = OCCLUSION_RANGE_METERS * scale
  }

  watch(
    () => props.contactShadowStrength,
    (strength) => {
      shadowReceiverMaterial.opacity = strength
      receiverUniforms.uOcclusionStrength.value = Math.min(
        strength * CONTACT_OCCLUSION_GAIN,
        1
      )
    },
    { immediate: true }
  )

  onUnmounted(() => {
    receiverUniforms.uVideo.value?.dispose()
    shadowReceiverMaterial.dispose()
  })

  return shadowReceiverMaterial
}
