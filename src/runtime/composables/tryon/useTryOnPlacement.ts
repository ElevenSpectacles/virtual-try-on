import { computed, shallowRef, watch, type Ref } from 'vue'
import { Vector3 } from 'three'
import {
  ASSUMED_EAR_WIDTH_METERS,
  ASSUMED_FACE_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  FRAME_BRIDGE_STANDOFF_METERS,
  FRAME_FIT_SCALE_BOOST,
  compensateMeasureForPose,
  computeHeadOccluderGeometry,
  computeMetricBaseScale,
  computeMetricScaleFromMeasure,
  getEarWidth,
  getFaceWidth,
  getInterPupillaryDistance,
  headForwardOffset,
  landmarkToWorld,
  mapLandmarkToObjectCover,
  shouldHoldScaleForBlink,
  worldPlaneWidth,
  type NormalizedLandmark,
  type ObjectCoverWindow
} from '../../utils/tryon'
import {
  composeHeadRotation,
  faceEulerToThree,
  headEuler,
  type FacePose
} from '../../utils/tryon-pose'
import { buildFaceMeshOccluderPositions } from '../../utils/tryon-occluder'
import {
  SEAT_MIN_SAMPLES,
  headUpOffset,
  noseProfile,
  seatOffsetMm,
  updateNoseProfile,
  type NoseProfileEstimate
} from '../../utils/tryon-seat'
import {
  ASSUMED_CAMERA_HFOV_DEG,
  IRIS_DIAMETER_MM,
  PD_STABLE_SAMPLES,
  acceptPdSample,
  blendedMeters,
  earLevelWidth,
  irisDiameter,
  pdFromIris,
  pupillaryWidth,
  rulerPdMm,
  updatePdEstimate,
  viewingDistanceMm,
  type PdEstimate
} from '../../utils/tryon-measure'
import type { TryOnFrameCalibration } from '../../types/tryon-calibration'
import { useTryOnSmoothing } from './useTryOnSmoothing'

type Rotation = { x: number; y: number; z: number }

export interface OccluderMeshTuning {
  skinSetbackMeters?: number
  inflate?: number
  collarDepthMeters?: number
}

export interface UseTryOnPlacementOptions {
  landmarks: Ref<NormalizedLandmark[]>
  anchor: Ref<NormalizedLandmark | null>
  pose: Ref<FacePose | null>
  blinkScore: Ref<number | null>
  latencyMs: Ref<number>
  hasFace: Ref<boolean>
  faceTracking: () => boolean
  aspect: Ref<number>
  coverWindow: Ref<ObjectCoverWindow>
  mediaAspect: Ref<number>
  calibration: Ref<TryOnFrameCalibration>
  scaleMultiplier?: () => number
  autoScale?: () => boolean
  referenceFaceWidth?: () => number
  fallbackAnchor?: () => NormalizedLandmark
  fallbackRotation?: () => Rotation
  offsetY?: () => number
  offsetZ?: () => number
  occluderRatios?: () => { widthRatio: number; heightRatio: number; depthRatio: number }
  occluderMesh?: () => OccluderMeshTuning
  trueToSize?: () => boolean
  calibratedPd?: () => { nearPdMm: number; pdMm: number } | null
}

export const PD_RESET_AFTER_LOSS_MS = 2000

const RESTING_ANCHOR: NormalizedLandmark = { x: 0.5, y: 0.45 }

const EYE_PLANE_SETBACK_METERS = 0.015

const SEAT_MAX_YAW_RAD = (12 * Math.PI) / 180
const SEAT_MAX_PITCH_RAD = (15 * Math.PI) / 180

const MIRROR_LANDMARKS = true

export function useTryOnPlacement(options: UseTryOnPlacementOptions) {
  const scaleMultiplier = options.scaleMultiplier ?? (() => 1)
  const autoScale = options.autoScale ?? (() => true)
  const referenceFaceWidth = options.referenceFaceWidth ?? (() => 0.32)
  const fallbackAnchor = options.fallbackAnchor ?? (() => RESTING_ANCHOR)
  const offsetY = options.offsetY ?? (() => 0)
  const offsetZ = options.offsetZ ?? (() => 0)
  const occluderRatios =
    options.occluderRatios ?? (() => ({ widthRatio: 1.3, heightRatio: 1.3, depthRatio: 1.4 }))
  const trueToSize = options.trueToSize ?? (() => true)

  const correctedLandmarks = computed(() =>
    options.landmarks.value.map((lm) => mapLandmarkToObjectCover(lm, options.coverWindow.value))
  )
  const correctedAnchor = computed(() =>
    options.anchor.value
      ? mapLandmarkToObjectCover(options.anchor.value, options.coverWindow.value)
      : null
  )
  const faceWidth = computed(() => getFaceWidth(correctedLandmarks.value, options.aspect.value))
  const ipd = computed(() =>
    getInterPupillaryDistance(correctedLandmarks.value, options.aspect.value)
  )
  const earWidth = computed(() => getEarWidth(correctedLandmarks.value, options.aspect.value))

  function poseCompensated(measure: number): number {
    const pose = options.pose.value
    if (!pose) return measure
    return compensateMeasureForPose(measure, pose.euler.yaw, pose.euler.pitch, pose.euler.roll)
  }

  const pdEstimate = shallowRef<PdEstimate | null>(null)
  let lostAt: number | null = null
  watch(options.landmarks, (list) => {
    if (!list.length) {
      lostAt ??= performance.now()
      if (performance.now() - lostAt >= PD_RESET_AFTER_LOSS_MS) pdEstimate.value = null
      return
    }
    if (lostAt !== null && performance.now() - lostAt >= PD_RESET_AFTER_LOSS_MS) {
      pdEstimate.value = null
    }
    lostAt = null
    const pose = options.pose.value
    if (!trueToSize() || !pose || pdEstimate.value?.stable) return
    const aspect = options.mediaAspect.value || 1
    const blinking = shouldHoldScaleForBlink(options.blinkScore.value, list, aspect)
    if (!acceptPdSample({ yaw: pose.euler.yaw, pitch: pose.euler.pitch, blinking })) return
    const iris = irisDiameter(list, aspect)
    const ear = earLevelWidth(list, aspect)
    pdEstimate.value = updatePdEstimate(pdEstimate.value, {
      nearPdMm: pdFromIris(pupillaryWidth(list, aspect), iris),
      distanceMm: viewingDistanceMm(iris, ASSUMED_CAMERA_HFOV_DEG),
      earWidthMm: iris > 0 && ear > 0 ? (ear / iris) * IRIS_DIAMETER_MM : 0
    })
  })
  const measurement = computed<PdEstimate | null>(() => {
    if (!trueToSize()) return null
    const iris = pdEstimate.value
    const card = options.calibratedPd?.()
    if (!card) return iris
    const ipdNow = poseCompensated(ipd.value)
    const earRatio =
      iris && iris.nearPdMm > 0 && iris.earWidthMm > 0
        ? iris.earWidthMm / iris.nearPdMm
        : ipdNow > 0
          ? poseCompensated(earWidth.value) / ipdNow
          : 0
    return {
      samples: iris?.samples ?? [],
      distances: iris?.distances ?? [],
      earWidths: iris?.earWidths ?? [],
      accepted: Math.max(iris?.accepted ?? 0, PD_STABLE_SAMPLES),
      nearPdMm: card.nearPdMm,
      pdMm: card.pdMm,
      earWidthMm: earRatio * card.nearPdMm,
      spread: 0,
      stable: true
    }
  })
  const rulerPd = computed(() => rulerPdMm(measurement.value))

  function measuredEarWidthMm(): number {
    return measurement.value?.earWidthMm ?? 0
  }

  const noseEstimate = shallowRef<NoseProfileEstimate | null>(null)
  watch(options.landmarks, (list) => {
    const pose = options.pose.value
    if (!list.length || !pose || options.calibration.value.padSpacingMm === null) return
    if (Math.abs(pose.euler.yaw) > SEAT_MAX_YAW_RAD || Math.abs(pose.euler.pitch) > SEAT_MAX_PITCH_RAD) {
      return
    }
    const aspect = options.mediaAspect.value || 1
    const right = list[234]
    const left = list[454]
    if (!right || !left) return
    const ear = Math.hypot(right.x - left.x, (right.y - left.y) / aspect)
    if (ear <= 0) return
    noseEstimate.value = updateNoseProfile(
      noseEstimate.value,
      noseProfile(list, aspect, (measuredEarWidthMm() || ASSUMED_EAR_WIDTH_METERS * 1000) / ear)
    )
  })
  const seatOffset = computed(() => {
    const spacing = options.calibration.value.padSpacingMm
    const estimate = noseEstimate.value
    if (spacing === null || !estimate) return 0
    return seatOffsetMm(estimate.mean, spacing) * Math.min(estimate.samples / SEAT_MIN_SAMPLES, 1)
  })

  const scaleSource = computed<'ear' | 'width' | 'ipd' | 'manual'>(() => {
    if (!autoScale() || !options.hasFace.value) return 'manual'
    if (earWidth.value > 0) return 'ear'
    return faceWidth.value > 0 ? 'width' : 'ipd'
  })

  const autoMetricScale = computed(() => {
    if (scaleSource.value === 'manual') {
      return computeMetricBaseScale(options.aspect.value, referenceFaceWidth())
    }
    const measured = measurement.value
    const measure =
      scaleSource.value === 'ear'
        ? ([
            earWidth.value,
            blendedMeters(
              measured,
              measured?.earWidthMm ?? 0,
              ASSUMED_EAR_WIDTH_METERS / FRAME_FIT_SCALE_BOOST
            )
          ] as const)
        : scaleSource.value === 'width'
          ? ([faceWidth.value, ASSUMED_FACE_WIDTH_METERS / FRAME_FIT_SCALE_BOOST] as const)
          : ([
              ipd.value,
              blendedMeters(
                measured,
                measured?.nearPdMm ?? 0,
                ASSUMED_IPD_METERS / FRAME_FIT_SCALE_BOOST
              )
            ] as const)
    return computeMetricScaleFromMeasure(options.aspect.value, poseCompensated(measure[0]), measure[1])
  })

  const calibratedScale = computed(
    () => autoMetricScale.value * options.calibration.value.scale * scaleMultiplier()
  )

  const faceWorldHalfWidth = computed(() => {
    const width =
      autoScale() && faceWidth.value ? poseCompensated(faceWidth.value) : referenceFaceWidth()
    return (worldPlaneWidth(options.aspect.value) * width) / 2
  })

  const occluderGeometry = computed(() =>
    computeHeadOccluderGeometry(faceWorldHalfWidth.value, occluderRatios())
  )

  const faceRotation = computed<Rotation | null>(() => {
    if (!options.faceTracking() || !options.pose.value) return null
    return composeHeadRotation(
      faceEulerToThree(options.pose.value.euler),
      options.calibration.value.rotation
    )
  })

  const fallbackRotation =
    options.fallbackRotation ??
    (() => {
      const rotation = options.calibration.value.rotation
      return { x: rotation.x, y: rotation.y, z: rotation.z }
    })

  const tracking = computed(() => options.faceTracking() && options.hasFace.value)

  const targetAnchor = computed<NormalizedLandmark>(() => {
    if (tracking.value && correctedAnchor.value) return correctedAnchor.value
    return fallbackAnchor()
  })

  const { smoothedAnchor, smoothedEuler, smoothedScale } = useTryOnSmoothing({
    targetAnchor,
    targetEuler: computed(() => faceRotation.value ?? fallbackRotation()),
    targetScale: calibratedScale,
    isTracking: tracking,
    latencyMs: options.latencyMs,
    holdScale: computed(() =>
      shouldHoldScaleForBlink(
        options.blinkScore.value,
        options.landmarks.value,
        options.mediaAspect.value || 1
      )
    )
  })

  const framePosition = computed(() => {
    const position = landmarkToWorld(smoothedAnchor.value, options.aspect.value, {
      mirror: MIRROR_LANDMARKS
    })
    const standoff = headForwardOffset(
      smoothedEuler.value,
      FRAME_BRIDGE_STANDOFF_METERS * smoothedScale.value
    )
    const seat = headUpOffset(smoothedEuler.value, (-seatOffset.value / 1000) * smoothedScale.value)
    return {
      x: position.x + standoff.x + seat.x,
      y: position.y + standoff.y + seat.y + offsetY(),
      z: standoff.z + seat.z + offsetZ()
    }
  })

  const occluderPosition = computed(() => {
    const position = landmarkToWorld(smoothedAnchor.value, options.aspect.value, {
      mirror: MIRROR_LANDMARKS
    })
    const setback = EYE_PLANE_SETBACK_METERS * smoothedScale.value
    const back = new Vector3(0, 0, -(occluderGeometry.value.radiusZ + setback)).applyEuler(
      headEuler(smoothedEuler.value)
    )
    return {
      x: position.x + back.x,
      y: position.y + back.y,
      z: offsetZ() + back.z
    }
  })

  const occluderPositions = computed(() => {
    if (
      !options.faceTracking() ||
      !options.hasFace.value ||
      !options.pose.value ||
      !faceRotation.value ||
      !correctedAnchor.value
    ) {
      return null
    }
    return buildFaceMeshOccluderPositions({
      landmarks: correctedLandmarks.value,
      aspect: options.aspect.value,
      mirror: MIRROR_LANDMARKS,
      rawAnchor: correctedAnchor.value,
      rawEuler: faceRotation.value,
      smoothedAnchor: smoothedAnchor.value,
      smoothedEuler: smoothedEuler.value,
      scale: smoothedScale.value,
      ...options.occluderMesh?.()
    })
  })

  return {
    correctedLandmarks,
    correctedAnchor,
    faceWidth,
    earWidth,
    ipd,
    poseCompensated,
    seatOffset,
    measurement,
    rulerPd,
    scaleSource,
    autoMetricScale,
    calibratedScale,
    faceRotation,
    smoothedAnchor,
    smoothedEuler,
    smoothedScale,
    framePosition,
    faceWorldHalfWidth,
    occluderGeometry,
    occluderPosition,
    occluderPositions
  }
}
