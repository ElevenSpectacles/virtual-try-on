import { ref } from 'vue'
import type { ComputedRef } from 'vue'
import { useRafFn } from '@vueuse/core'
import { Euler, Quaternion } from 'three'
import {
  oneEuroFilter,
  oneEuroAlpha,
  type NormalizedLandmark,
  type OneEuroState
} from '../../utils/tryon'

// MediaPipe's per-frame landmarks jitter by a pixel or two even on a still
// face, and the video's own frame rate is not the render frame rate. Both
// alone are enough to make a rigidly-parented 3D model visibly tremble in a
// way raw video never does. `oneEuroFilter` adapts its cutoff to the signal's
// own speed, so it smooths hard while the user holds still and loosens
// automatically during real motion instead of lagging behind it.
//
// `beta` is tuned higher for scale than for position/rotation: distance
// changes (the user visibly walking toward or away from the camera) should
// read as immediate, while position/rotation jitter at rest is the more
// distracting artifact to suppress.
const POSE_FILTER = { minCutoff: 0.8, beta: 0.7 }
const ROTATION_FILTER = { minCutoff: 0.6, beta: 0.6, dCutoff: 1 }
const SCALE_FILTER = { minCutoff: 0.6, beta: 1.2 }

export function useTryOnSmoothing(options: {
  targetAnchor: ComputedRef<NormalizedLandmark>
  targetEuler: ComputedRef<{ x: number; y: number; z: number }>
  targetScale: ComputedRef<number>
  isTracking: ComputedRef<boolean>
}) {
  const smoothedAnchor = ref<NormalizedLandmark>({
    ...options.targetAnchor.value
  })
  const smoothedEuler = ref({ x: 0, y: 0, z: 0 })
  const smoothedScale = ref(options.targetScale.value)

  let anchorXState: OneEuroState | null = null
  let anchorYState: OneEuroState | null = null
  let scaleState: OneEuroState | null = null
  let wasTracking = options.isTracking.value

  // Rotation is smoothed as a single quaternion slerp rather than three
  // independent per-axis low-pass filters. Filtering yaw/pitch/roll
  // separately can produce non-physical intermediate rotations ("wobble")
  // during combined multi-axis motion (e.g. a quick head tilt while turning)
  // — slerping the whole rotation as one rigid unit avoids that. The slerp
  // factor itself is adapted with the same One Euro Filter formula used for
  // the scalar signals below.
  let smoothedQuaternion: Quaternion | null = null
  let angularSpeedState = 0
  const targetEulerObj = new Euler()
  const targetQuat = new Quaternion()

  useRafFn(
    ({ delta }) => {
      const targetAnchor = options.targetAnchor.value
      const targetEuler = options.targetEuler.value
      const targetScale = options.targetScale.value
      const dtSeconds = delta / 1000

      // Reset (snap) whenever the face is (re)acquired — filtering a jump
      // from "idle drift" or "no face" to a freshly-detected position would
      // drag the frame across the screen instead of appearing where the face
      // is.
      if (options.isTracking.value && !wasTracking) {
        anchorXState = null
        anchorYState = null
        scaleState = null
        smoothedQuaternion = null
        angularSpeedState = 0
      }
      wasTracking = options.isTracking.value

      anchorXState = oneEuroFilter(
        anchorXState,
        targetAnchor.x,
        dtSeconds,
        POSE_FILTER
      )
      anchorYState = oneEuroFilter(
        anchorYState,
        targetAnchor.y,
        dtSeconds,
        POSE_FILTER
      )
      scaleState = oneEuroFilter(
        scaleState,
        targetScale,
        dtSeconds,
        SCALE_FILTER
      )

      targetEulerObj.set(targetEuler.x, targetEuler.y, targetEuler.z)
      targetQuat.setFromEuler(targetEulerObj)

      if (!smoothedQuaternion) {
        smoothedQuaternion = targetQuat.clone()
        angularSpeedState = 0
      } else if (dtSeconds > 0) {
        const rawAngle = smoothedQuaternion.angleTo(targetQuat)
        const rawSpeed = rawAngle / dtSeconds
        const dAlpha = oneEuroAlpha(ROTATION_FILTER.dCutoff, dtSeconds)
        angularSpeedState = dAlpha * rawSpeed + (1 - dAlpha) * angularSpeedState
        const cutoff =
          ROTATION_FILTER.minCutoff + ROTATION_FILTER.beta * angularSpeedState
        const alpha = oneEuroAlpha(cutoff, dtSeconds)
        smoothedQuaternion.slerp(targetQuat, alpha)
      }

      smoothedAnchor.value = { x: anchorXState.value, y: anchorYState.value }
      const outEuler = new Euler().setFromQuaternion(smoothedQuaternion)
      smoothedEuler.value = { x: outEuler.x, y: outEuler.y, z: outEuler.z }
      smoothedScale.value = scaleState.value
    },
    { immediate: true }
  )

  return { smoothedAnchor, smoothedEuler, smoothedScale }
}
