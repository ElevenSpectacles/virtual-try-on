import { computed, onBeforeUnmount, ref, watch, watchEffect, type Ref } from 'vue'
import { useTryOnPlacement } from '../useTryOnPlacement'
import { FRAME_FADE_MS, guideHintFor } from '../../../utils/tryon-guide'
import type { NormalizedLandmark, ObjectCoverWindow } from '../../../utils/tryon'
import type { CardCalibrationState } from '../../../utils/tryon-card'
import type { FacePose } from '../../../utils/tryon-pose'
import type { TryOnFrameCalibration } from '../../../types/tryon-calibration'
import type { TryOnGuideHint } from '../../../types/tryon-experience'

export interface UseTryOnFrameOptions {
  props: { frameScale: number; trueToSize: boolean }
  camera: { isActive: Ref<boolean> }
  faceTracking: Ref<boolean>
  tracking: {
    landmarks: Ref<NormalizedLandmark[]>
    anchor: Ref<NormalizedLandmark | null>
    pose: Ref<FacePose | null>
    blinkScore: Ref<number | null>
    latencyMs: Ref<number>
    hasFace: Ref<boolean>
    lastYaw: Ref<number | null>
    roomLuma: Ref<number | null>
    cardCalibration: { state: Ref<CardCalibrationState> }
  }
  stage: {
    aspect: Ref<number>
    coverWindow: Ref<ObjectCoverWindow>
    mediaAspect: Ref<number>
  }
  calibration: Ref<TryOnFrameCalibration>
}

export function useTryOnFrame(options: UseTryOnFrameOptions) {
  const { props, tracking, stage } = options
  const { isActive } = options.camera

  const frameVisible = computed(
    () => isActive.value && options.faceTracking.value && tracking.hasFace.value
  )

  const frameFading = ref(false)
  let fadeTimer: ReturnType<typeof setTimeout> | null = null
  watch(frameVisible, (visible, wasVisible) => {
    if (fadeTimer !== null) clearTimeout(fadeTimer)
    fadeTimer = null
    frameFading.value = !visible && wasVisible
    if (frameFading.value) {
      fadeTimer = setTimeout(() => {
        fadeTimer = null
        frameFading.value = false
      }, FRAME_FADE_MS)
    }
  })
  onBeforeUnmount(() => {
    if (fadeTimer !== null) clearTimeout(fadeTimer)
  })

  const placement = useTryOnPlacement({
    landmarks: tracking.landmarks,
    anchor: tracking.anchor,
    pose: tracking.pose,
    blinkScore: tracking.blinkScore,
    latencyMs: tracking.latencyMs,
    hasFace: tracking.hasFace,
    faceTracking: () => options.faceTracking.value,
    aspect: stage.aspect,
    coverWindow: stage.coverWindow,
    mediaAspect: stage.mediaAspect,
    calibration: options.calibration,
    scaleMultiplier: () => props.frameScale,
    trueToSize: () => props.trueToSize,
    calibratedPd: () => {
      const { state } = tracking.cardCalibration
      return state.value.status === 'done' && state.value.nearPdMm && state.value.pdMm
        ? { nearPdMm: state.value.nearPdMm, pdMm: state.value.pdMm }
        : null
    }
  })

  const guideHint = ref<TryOnGuideHint | null>(null)
  watchEffect(() => {
    guideHint.value = guideHintFor({
      tracking: isActive.value && options.faceTracking.value,
      hasFace: tracking.hasFace.value,
      anchored: !!placement.correctedAnchor.value,
      yaw: tracking.pose.value?.euler.yaw ?? null,
      lastYaw: tracking.lastYaw.value,
      luma: tracking.roomLuma.value,
      previous: guideHint.value
    })
  })

  return { ...placement, frameVisible, frameFading, guideHint }
}
