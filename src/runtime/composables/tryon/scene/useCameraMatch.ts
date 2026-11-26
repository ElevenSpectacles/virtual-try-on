import { watch } from 'vue'
import { useLoop } from '@tresjs/core'
import {
  grainAmount,
  LIGHT_WRAP_STRENGTH,
  lightWrapColor,
  type CameraMatchUniforms
} from '../../../utils/tryon-camera-match'

export function useCameraMatch(
  props: {
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

  return cameraMatchUniforms
}
