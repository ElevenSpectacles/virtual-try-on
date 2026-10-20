import { computed, onBeforeUnmount, ref, watch, watchEffect, type Ref } from 'vue'
import { useTryOnPlacement } from '../useTryOnPlacement'
import { guideHintFor } from '../../../utils/tryon-guide'
import type { NormalizedLandmark, ObjectCoverWindow } from '../../../utils/tryon'
import type { CardCalibrationState } from '../../../utils/tryon-card'
import type { FacePose } from '../../../utils/tryon-pose'
import type { TryOnFrameCalibration } from '../../../types/tryon-calibration'
import type { TryOnGuideHint } from '../../../types/tryon-experience'

// The frame fades out (CSS, on the canvas layer) when the face is lost for
// longer than the hold; the scene keeps drawing it until the fade is done.
// Keep in step with the `.vto-frame` transition in VirtualTryOnExperience.
const FRAME_FADE_MS = 150

export interface UseTryOnFrameOptions {
  props: { frameScale: number; trueToSize: boolean }
  camera: { isActive: Ref<boolean> }
  /** Face tracking drives the frame (set when the camera comes up). */
  faceTracking: Ref<boolean>
  /** The held face, its room light and the card calibration (`useTryOnTracking`). */
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
  /** The stage and the video's visible crop (`useTryOnStage`). */
  stage: {
    aspect: Ref<number>
    coverWindow: Ref<ObjectCoverWindow>
    mediaAspect: Ref<number>
  }
  /** Calibration of the selected frame. */
  calibration: Ref<TryOnFrameCalibration>
}

/**
 * The frame on the tracked face: whether it shows (and its fade-out once the
 * face is lost), where it goes (`useTryOnPlacement`), and the guide hint that
 * coaches the shopper toward a pose it can follow. Returns the placement's
 * refs plus `frameVisible`, `frameFading` and `guideHint`.
 */
export function useTryOnFrame(options: UseTryOnFrameOptions) {
  const { props, tracking, stage } = options
  const { isActive } = options.camera

  // The frame renders only on a tracked face: never before the camera starts
  // (the host owns that screen — consent, previews), and not while tracking
  // has momentarily lost the face (head turned past the tracker's yaw range,
  // face out of frame), where it would freeze mid-air over the live video.
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

  // Where the frame goes (shared with the playground prototype): scale from
  // the tracked face, smoothed pose, world position and the occluders.
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

  // Coaching for the host's guide UI (no copy here): no face, turned too far,
  // too dark, or aligned. Keeps its previous value for the hysteresis.
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
