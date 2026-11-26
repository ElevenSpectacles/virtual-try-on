import { ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { Euler, Quaternion } from 'three'
import {
  oneEuroFilter,
  oneEuroAlpha,
  predictOneEuro,
  ONE_EURO_MAX_PREDICTION_SECONDS,
  type NormalizedLandmark,
  type OneEuroState
} from '../../utils/tryon'
import { HEAD_EULER_ORDER } from '../../utils/tryon-pose'
import { useTryOnFrameLoop } from './useTryOnFrameLoop'

const POSE_FILTER = { minCutoff: 1.2, beta: 2.4 }
const ROTATION_FILTER = { minCutoff: 1.0, beta: 2.0, dCutoff: 1 }
const SCALE_FILTER = { minCutoff: 0.9, beta: 1.8 }

const ANCHOR_PREDICTION_DEADBAND = 0.06
const SCALE_PREDICTION_DEADBAND = 0.3
const ROTATION_PREDICTION_DEADBAND = 0.25

export function useTryOnSmoothing(options: {
  targetAnchor: ComputedRef<NormalizedLandmark>
  targetEuler: ComputedRef<{ x: number; y: number; z: number }>
  targetScale: ComputedRef<number>
  isTracking: ComputedRef<boolean>
  holdScale?: ComputedRef<boolean>
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

  let smoothedQuaternion: Quaternion | null = null
  let angularSpeedState = 0
  let smoothedSpeedState = 0
  const previousQuat = new Quaternion()
  const targetEulerObj = new Euler(0, 0, 0, HEAD_EULER_ORDER)
  const targetQuat = new Quaternion()
  const displayQuat = new Quaternion()
  const outEulerObj = new Euler(0, 0, 0, HEAD_EULER_ORDER)

  useTryOnFrameLoop((delta) => {
    const targetAnchor = options.targetAnchor.value
    const targetEuler = options.targetEuler.value
    const targetScale = options.targetScale.value
    const dtSeconds = delta / 1000

    if (options.isTracking.value && !wasTracking) {
      anchorXState = null
      anchorYState = null
      scaleState = null
      smoothedQuaternion = null
      angularSpeedState = 0
      smoothedSpeedState = 0
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
    if (!options.holdScale?.value) {
      scaleState = oneEuroFilter(
        scaleState,
        targetScale,
        dtSeconds,
        SCALE_FILTER
      )
    }

    targetEulerObj.set(targetEuler.x, targetEuler.y, targetEuler.z, HEAD_EULER_ORDER)
    targetQuat.setFromEuler(targetEulerObj)

    if (!smoothedQuaternion) {
      smoothedQuaternion = targetQuat.clone()
      angularSpeedState = 0
      smoothedSpeedState = 0
    } else if (dtSeconds > 0) {
      previousQuat.copy(smoothedQuaternion)
      const rawAngle = smoothedQuaternion.angleTo(targetQuat)
      const rawSpeed = rawAngle / dtSeconds
      const dAlpha = oneEuroAlpha(ROTATION_FILTER.dCutoff, dtSeconds)
      angularSpeedState = dAlpha * rawSpeed + (1 - dAlpha) * angularSpeedState
      const cutoff =
        ROTATION_FILTER.minCutoff + ROTATION_FILTER.beta * angularSpeedState
      const alpha = oneEuroAlpha(cutoff, dtSeconds)
      smoothedQuaternion.slerp(targetQuat, alpha)
      const smoothedSpeed = previousQuat.angleTo(smoothedQuaternion) / dtSeconds
      smoothedSpeedState =
        dAlpha * smoothedSpeed + (1 - dAlpha) * smoothedSpeedState
    }

    const predSeconds = options.isTracking.value
      ? Math.min(
          Math.max((options.latencyMs?.value ?? 0) / 1000, 0),
          ONE_EURO_MAX_PREDICTION_SECONDS
        )
      : 0

    smoothedAnchor.value = {
      x: predictOneEuro(
        anchorXState,
        targetAnchor.x,
        predSeconds,
        undefined,
        ANCHOR_PREDICTION_DEADBAND
      ),
      y: predictOneEuro(
        anchorYState,
        targetAnchor.y,
        predSeconds,
        undefined,
        ANCHOR_PREDICTION_DEADBAND
      )
    }

    displayQuat.copy(smoothedQuaternion)
    if (predSeconds > 0) {
      const remaining = displayQuat.angleTo(targetQuat)
      if (remaining > 1e-4) {
        const speed = Math.max(
          smoothedSpeedState - ROTATION_PREDICTION_DEADBAND,
          0
        )
        const advance = Math.min(speed * predSeconds, remaining * 1.2)
        displayQuat.slerp(targetQuat, advance / remaining)
      }
    }
    const outEuler = outEulerObj.setFromQuaternion(displayQuat, HEAD_EULER_ORDER)
    smoothedEuler.value = { x: outEuler.x, y: outEuler.y, z: outEuler.z }
    if (scaleState) {
      smoothedScale.value = predictOneEuro(
        scaleState,
        targetScale,
        predSeconds,
        undefined,
        SCALE_PREDICTION_DEADBAND * Math.abs(scaleState.value)
      )
    }
  })

  return { smoothedAnchor, smoothedEuler, smoothedScale }
}
