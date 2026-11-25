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
  landmarks: Ref<NormalizedLandmark[]>
  pose: Ref<FacePose | null>
  mediaAspect: Ref<number>
}

export interface TryOnCardCalibration {
  status: TryOnCardCalibrationStatus
  progress: number
  pdMm: number | null
}

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

  function fail() {
    if (state.value.status !== 'detecting') return
    clearTimer()
    state.value = { ...state.value, status: 'failed' }
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

  function wantCardRegion(): CardRegion | null {
    if (state.value.status !== 'detecting' || !frontal()) return null
    return cardRegion(options.landmarks.value, options.mediaAspect.value || 1)
  }

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

  const calibratedNearPdMm = computed(() =>
    state.value.status === 'done' ? state.value.nearPdMm : null
  )

  return { calibration, calibratedNearPdMm, start, cancel, fail, wantCardRegion, onCardCrop, state }
}
