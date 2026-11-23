import { watch, type ShallowRef } from 'vue'
import { Mesh, type Material, type MeshStandardMaterial } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useLoop } from '@tresjs/core'
import {
  grainAmount,
  LIGHT_WRAP_STRENGTH,
  lightWrapColor,
  patchCameraMatchShader,
  type CameraMatchUniforms
} from '../../../utils/tryon-camera-match'
import type { TryOnLens } from '../../../utils/tryon-lens'

export function useCameraMatch(
  model: ShallowRef<GLTF | null>,
  props: {
    physicalLens: boolean
    lens: TryOnLens
    cameraMatch: boolean
    roomLuma: number | null
    lightTint: [number, number, number]
    grainSeed?: number | undefined
  }
) {
  const cameraMatchUniforms: CameraMatchUniforms = {
    uCameraGrain: { value: 0 },
    uCameraGrainSeed: { value: 0 },
    uCameraWrap: { value: 0 },
    uCameraWrapColor: { value: { r: 0.5, g: 0.5, b: 0.5 } }
  }

  function patchCameraMatch(material: Material) {
    if (!(material as MeshStandardMaterial).isMeshStandardMaterial) return
    if (material.userData.tryOnCameraMatch) return
    material.userData.tryOnCameraMatch = true
    const previous = material.onBeforeCompile.bind(material)
    const previousKey = material.customProgramCacheKey.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer)
      Object.assign(shader.uniforms, cameraMatchUniforms)
      shader.fragmentShader = patchCameraMatchShader(shader.fragmentShader)
    }
    material.customProgramCacheKey = () => `${previousKey()}|tryon-camera-match`
    material.needsUpdate = true
  }

  watch(
    [model, () => props.physicalLens, () => props.lens, () => props.cameraMatch],
    ([gltf, , , enabled]) => {
      if (!enabled || !gltf) return
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          patchCameraMatch(material)
        }
      })
    },
    { immediate: true }
  )

  watch(
    [() => props.cameraMatch, () => props.roomLuma, () => props.lightTint],
    ([enabled, luma, tint]) => {
      cameraMatchUniforms.uCameraGrain.value = enabled ? grainAmount(luma) : 0
      cameraMatchUniforms.uCameraWrap.value = enabled ? LIGHT_WRAP_STRENGTH : 0
      cameraMatchUniforms.uCameraWrapColor.value = lightWrapColor(tint, luma)
    },
    { immediate: true }
  )

  useLoop().onBeforeRender(() => {
    cameraMatchUniforms.uCameraGrainSeed.value =
      props.grainSeed ?? (cameraMatchUniforms.uCameraGrainSeed.value + 1.618) % 1000
  })
}
