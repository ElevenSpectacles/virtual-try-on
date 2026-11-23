import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import {
  FACE_SHAPE_MIN_SAMPLES,
  classifyFaceShape,
  faceProportions,
  updateFaceProportions,
  type FaceProportionsEstimate,
  type FaceShapeResult
} from '../../utils/tryon-face-shape'
import { PD_MAX_PITCH_RAD, PD_MAX_YAW_RAD } from '../../utils/tryon-measure'
import type { NormalizedLandmark } from '../../utils/tryon'
import type { FacePose } from '../../utils/tryon-pose'

export interface UseTryOnFaceShapeOptions {
  landmarks: Ref<NormalizedLandmark[]>
  pose: Ref<FacePose | null>
  mediaAspect: Ref<number>
  enabled?: () => boolean
  resetAfterLossMs?: number
}

export function useTryOnFaceShape(options: UseTryOnFaceShapeOptions) {
  const enabled = options.enabled ?? (() => true)
  const resetAfterLossMs = options.resetAfterLossMs ?? 2000
  const estimate = shallowRef<FaceProportionsEstimate | null>(null)
  const result = ref<FaceShapeResult | null>(null)
  let lostAt: number | null = null

  watch(options.landmarks, (list) => {
    if (!list.length) {
      lostAt ??= performance.now()
      if (performance.now() - lostAt >= resetAfterLossMs) {
        estimate.value = null
        result.value = null
      }
      return
    }
    if (lostAt !== null && performance.now() - lostAt >= resetAfterLossMs) {
      estimate.value = null
      result.value = null
    }
    lostAt = null
    const pose = options.pose.value
    if (!enabled() || !pose) return
    if (Math.abs(pose.euler.yaw) > PD_MAX_YAW_RAD || Math.abs(pose.euler.pitch) > PD_MAX_PITCH_RAD)
      return
    estimate.value = updateFaceProportions(
      estimate.value,
      faceProportions(list, options.mediaAspect.value || 1)
    )
    const current = estimate.value
    if (current && current.samples >= FACE_SHAPE_MIN_SAMPLES) {
      result.value = classifyFaceShape(current.mean, result.value?.shape ?? null)
    }
  })

  const faceShape = computed(() => (enabled() ? result.value : null))

  return { faceShape, proportions: estimate }
}
