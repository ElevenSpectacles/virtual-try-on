import { computed, onBeforeUnmount, shallowRef, type Ref } from 'vue'
import {
  CARD_TIMEOUT_MS,
  IDLE_CARD_CALIBRATION,
  cardRegion,
  cardWidthInFrame,
  expireCardCalibration,
  findCardEdges,
  nearPdFromCard,
  startCardCalibration,
  updateCardCalibration,
  type CardCalibrationState,
  type CardRegion,
  type TryOnCardCalibrationStatus
} from '../../utils/tryon-card'
import {
  ASSUMED_CAMERA_HFOV_DEG,
  PD_MAX_PITCH_RAD,
  PD_MAX_YAW_RAD,
  irisDiameter,
  pupillaryWidth,
  viewingDistanceMm
} from '../../utils/tryon-measure'
import type { NormalizedLandmark } from '../../utils/tryon'
import type { FacePose } from '../../utils/tryon-pose'

export interface UseTryOnCardCalibrationOptions {
  /** Raw landmarks (normalized to the camera frame). */
  landmarks: Ref<NormalizedLandmark[]>
  pose: Ref<FacePose | null>
  /** Camera frame aspect (width / height); 0 while unknown. */
  mediaAspect: Ref<number>
}

/** Card-calibration state for the host's UI (slot / ref `calibration`). */
export interface TryOnCardCalibration {
  status: TryOnCardCalibrationStatus
  /** 0 … 1 while detecting. */
  progress: number
  /** The calibrated distance PD, mm, once `done`. */
  pdMm: number | null
}

/**
 * Card calibration glue (issue #96). While detecting, every detection asks
 * the worker for a grey crop of the forehead band (`wantCardRegion`, at
 * full camera resolution) and each crop is measured (`onCardCrop`); see
 * utils/tryon-card for the maths. Only frontal frames count. Fails after
 * CARD_TIMEOUT_MS without a stable reading, also when no face (so no crop)
 * arrives at all. Nothing runs, and nothing is cropped, while idle.
 */
export function useTryOnCardCalibration(options: UseTryOnCardCalibrationOptions) {
  const state = shallowRef<CardCalibrationState>(IDLE_CARD_CALIBRATION)
  let timeout: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timeout !== null) clearTimeout(timeout)
    timeout = null
  }

  function start() {
    clearTimer()
    state.value = startCardCalibration(performance.now())
    timeout = setTimeout(() => {
      timeout = null
      state.value = expireCardCalibration(state.value, performance.now())
    }, CARD_TIMEOUT_MS)
  }

  function cancel() {
    clearTimer()
    state.value = IDLE_CARD_CALIBRATION
  }

  function frontal(): boolean {
    const pose = options.pose.value
    return (
      !!pose &&
      Math.abs(pose.euler.yaw) <= PD_MAX_YAW_RAD &&
      Math.abs(pose.euler.pitch) <= PD_MAX_PITCH_RAD
    )
  }

  /** The region to crop with the next detection, or null (not calibrating). */
  function wantCardRegion(): CardRegion | null {
    if (state.value.status !== 'detecting' || !frontal()) return null
    return cardRegion(options.landmarks.value, options.mediaAspect.value || 1)
  }

  /** One grey crop from the worker; the landmarks are its detection's. */
  function onCardCrop(gray: Uint8ClampedArray, width: number, height: number, region: CardRegion) {
    if (state.value.status !== 'detecting') return
    const landmarks = options.landmarks.value
    const aspect = options.mediaAspect.value || 1
    const edges = frontal() ? findCardEdges(gray, width, height) : null
    const iris = irisDiameter(landmarks, aspect)
    const distance = viewingDistanceMm(iris, ASSUMED_CAMERA_HFOV_DEG)
    const nearPd = edges
      ? nearPdFromCard(cardWidthInFrame(edges, region, width), pupillaryWidth(landmarks, aspect), distance)
      : 0
    state.value = updateCardCalibration(state.value, nearPd, distance, performance.now())
    if (state.value.status !== 'detecting') clearTimer()
  }

  onBeforeUnmount(clearTimer)

  const calibration = computed<TryOnCardCalibration>(() => ({
    status: state.value.status,
    progress: state.value.progress,
    pdMm: state.value.pdMm
  }))

  /** The calibrated near PD (mm) once done: the on-screen ruler. */
  const calibratedNearPdMm = computed(() =>
    state.value.status === 'done' ? state.value.nearPdMm : null
  )

  return { calibration, calibratedNearPdMm, start, cancel, wantCardRegion, onCardCrop, state }
}
