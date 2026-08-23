import { ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useRafFn } from '@vueuse/core'
import { Euler, Quaternion } from 'three'
import {
  oneEuroFilter,
  oneEuroAlpha,
  predictOneEuro,
  ONE_EURO_MAX_PREDICTION_SECONDS,
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
//
// beta on position/rotation is deliberately aggressive: it only raises the
// cutoff *in proportion to measured signal speed*, so a still head keeps the
// heavy minCutoff smoothing (no jitter) while any real motion — turning to
// show a friend, leaning in — is tracked with almost no lag. This is the
// "feels glued to the face" knob; too low and the frame swims behind the
// head during motion, which reads as fake.
const POSE_FILTER = { minCutoff: 1.2, beta: 2.4 }
const ROTATION_FILTER = { minCutoff: 1.0, beta: 2.0, dCutoff: 1 }
const SCALE_FILTER = { minCutoff: 0.9, beta: 1.8 }

export function useTryOnSmoothing(options: {
  targetAnchor: ComputedRef<NormalizedLandmark>
  targetEuler: ComputedRef<{ x: number; y: number; z: number }>
  targetScale: ComputedRef<number>
  isTracking: ComputedRef<boolean>
  /**
   * While true (e.g. mid-blink, when iris landmarks are unreliable), the
   * scale filter is not fed new measurements — the frame keeps its last
   * smoothed size instead of jumping with the garbage signal.
   */
  holdScale?: ComputedRef<boolean>
  /**
   * Measured camera→landmarks pipeline latency in milliseconds (EMA from
   * `useFaceLandmarker`). While tracking, the filtered pose is extrapolated
   * forward by this much along its own velocity estimates, so the rendered
   * frame matches where the head is *now* instead of where it was when the
   * camera frame was captured. Prediction is velocity-proportional — a still
   * head predicts ~zero, keeping the heavy at-rest smoothing — and is applied
   * display-only: the filter state is never advanced by it, so extrapolation
   * error cannot feed back into the filter. Omit/0 disables prediction.
   */
  latencyMs?: Ref<number> | ComputedRef<number>
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
  // Display-only rotation: filter state quaternion + latency prediction.
  // Kept separate so the prediction never feeds back into the slerp state.
  const displayQuat = new Quaternion()
  // Reused per-frame instead of allocating in the rAF loop (60-120Hz).
  const outEulerObj = new Euler()

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
      // Blinks corrupt the iris-driven scale signal for a few frames; hold
      // the last smoothed value rather than filtering the garbage in.
      if (!options.holdScale?.value) {
        scaleState = oneEuroFilter(
          scaleState,
          targetScale,
          dtSeconds,
          SCALE_FILTER
        )
      }

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

      // Latency compensation: the pose targets describe where the head was
      // when the camera frame was captured (~latencyMs ago). Extrapolate the
      // filtered signals forward along their own velocity estimates so the
      // rendered frame matches where the head is *now*. Applied to the
      // outputs only — filter state is never advanced by the prediction.
      const predSeconds = options.isTracking.value
        ? Math.min(
            Math.max((options.latencyMs?.value ?? 0) / 1000, 0),
            ONE_EURO_MAX_PREDICTION_SECONDS
          )
        : 0

      smoothedAnchor.value = {
        x: predictOneEuro(anchorXState, targetAnchor.x, predSeconds),
        y: predictOneEuro(anchorYState, targetAnchor.y, predSeconds)
      }

      // Rotation prediction: continue past the filtered quaternion along the
      // measured angular velocity, overshooting the latest measured rotation
      // by at most a fifth of the remaining angle (t ≤ 1.2) — the same clamp
      // as `predictOneEuro`, so a decelerating head turn can't swing the
      // frame visibly past the face.
      displayQuat.copy(smoothedQuaternion)
      if (predSeconds > 0) {
        const remaining = displayQuat.angleTo(targetQuat)
        if (remaining > 1e-4) {
          const extra = Math.min(angularSpeedState * predSeconds, remaining * 0.2)
          displayQuat.slerp(targetQuat, 1 + extra / remaining)
        }
      }
      const outEuler = outEulerObj.setFromQuaternion(displayQuat)
      smoothedEuler.value = { x: outEuler.x, y: outEuler.y, z: outEuler.z }
      // scaleState stays null until the first non-held frame — keep the
      // initial value in that window instead of crashing on the read.
      if (scaleState) {
        smoothedScale.value = predictOneEuro(
          scaleState,
          targetScale,
          predSeconds
        )
      }
    },
    { immediate: true }
  )

  return { smoothedAnchor, smoothedEuler, smoothedScale }
}
