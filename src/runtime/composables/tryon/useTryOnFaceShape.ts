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
  /** Raw landmarks (normalized to the camera frame). */
  landmarks: Ref<NormalizedLandmark[]>
  pose: Ref<FacePose | null>
  /** Camera frame aspect (width / height); 0 while unknown. */
  mediaAspect: Ref<number>
  /** Measure at all. Default on. */
  enabled?: () => boolean
  /** Lost time after which the estimate starts over (another person). */
  resetAfterLossMs?: number
}

/**
 * Face-shape glue (issue #98): averages the face proportions over frontal
 * detections (same yaw/pitch gate as the PD measurement, since a turned head
 * foreshortens the widths) and classifies them with hysteresis. Null until
 * FACE_SHAPE_MIN_SAMPLES frames are in.
 */
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
