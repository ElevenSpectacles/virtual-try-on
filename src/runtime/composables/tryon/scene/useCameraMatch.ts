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

/**
 * Grain and light wrap on the frame (utils/tryon-camera-match), so it reads
 * as filmed with the face: the shader patch on the GLB's materials and the
 * per-frame grain seed. The CSS blur is the host canvas's.
 */
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
  // Camera match (issue #86): one shared uniform set, patched into every frame
  // and lens material (standard/physical only: the patch reads their normal
  // and view vectors) after the lens materials are built. Off sets the
  // amounts to 0; patched materials stay patched until the GLB is evicted.
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

  // Watches the lens inputs too: a lens rebuild (`useLensMaterials`, whose
  // watcher runs first) leaves fresh, unpatched lens materials.
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

  // Re-seed the grain every rendered frame, like sensor noise; a fixed seed
  // keeps goldens stable.
  useLoop().onBeforeRender(() => {
    cameraMatchUniforms.uCameraGrainSeed.value =
      props.grainSeed ?? (cameraMatchUniforms.uCameraGrainSeed.value + 1.618) % 1000
  })
}
