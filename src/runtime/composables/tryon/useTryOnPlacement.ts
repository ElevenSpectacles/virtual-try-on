import { computed, shallowRef, watch, type Ref } from 'vue'
import { Euler, Vector3 } from 'three'
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
import { faceEulerToThree, type FacePose } from '../../utils/tryon-pose'
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

/** Face-mesh occluder tuning (see `buildFaceMeshOccluderPositions`); omitted fields keep the shipped defaults. */
export interface OccluderMeshTuning {
  skinSetbackMeters?: number
  inflate?: number
  collarDepthMeters?: number
}

export interface UseTryOnPlacementOptions {
  /** Raw tracker output, from `useFaceLandmarker`. */
  landmarks: Ref<NormalizedLandmark[]>
  anchor: Ref<NormalizedLandmark | null>
  pose: Ref<FacePose | null>
  blinkScore: Ref<number | null>
  latencyMs: Ref<number>
  /** A face is in the latest result. */
  hasFace: Ref<boolean>
  /** Face tracking drives the frame (off before the camera starts). */
  faceTracking: () => boolean
  /** Stage aspect (width / height). */
  aspect: Ref<number>
  /** Visible `object-fit: cover` window of the camera frame. */
  coverWindow: Ref<ObjectCoverWindow>
  /** Camera frame aspect, for the eyelid blink fallback; 0 while unknown. */
  mediaAspect: Ref<number>
  /** Calibration of the selected frame. */
  calibration: Ref<TryOnFrameCalibration>
  /** Multiplier on the computed scale (`frameScale`, tuning). Default 1. */
  scaleMultiplier?: () => number
  /**
   * Scale from the tracked face. Off uses `referenceFaceWidth` for the scale
   * and the occluder size, as before a face is tracked. Default on.
   */
  autoScale?: () => boolean
  /** Normalized face width assumed while no face is measured. Default 0.32. */
  referenceFaceWidth?: () => number
  /** Anchor target while no face is tracked. Default the stage's upper middle. */
  fallbackAnchor?: () => NormalizedLandmark
  /** Rotation target while no face is tracked. Default the calibration rotation. */
  fallbackRotation?: () => Rotation
  /** Extra world-space offsets of the frame (tuning). Default 0. */
  offsetY?: () => number
  offsetZ?: () => number
  /** Ellipsoid occluder size, as ratios of the face half-width. */
  occluderRatios?: () => { widthRatio: number; heightRatio: number; depthRatio: number }
  /** Face-mesh occluder tuning. Default: the shipped values. */
  occluderMesh?: () => OccluderMeshTuning
  /**
   * Size the frame from the shopper's measured PD (iris ruler, see
   * utils/tryon-measure) instead of population averages. Default on.
   */
  trueToSize?: () => boolean
  /**
   * A card-calibrated PD (utils/tryon-card), which replaces the iris
   * measurement while set: `nearPdMm` as measured at the screen (the ruler),
   * `pdMm` the distance PD. Needs `trueToSize`.
   */
  calibratedPd?: () => { nearPdMm: number; pdMm: number } | null
}

/**
 * How long the face must stay lost before the PD measurement starts over:
 * a short loss (a turn past the tracker's range) is still the same person,
 * a longer one may not be.
 */
export const PD_RESET_AFTER_LOSS_MS = 2000

// Anchor target while no face is tracked (the frame is hidden then, so this
// only keeps the smoothing filters fed with a sane value).
const RESTING_ANCHOR: NormalizedLandmark = { x: 0.5, y: 0.45 }

// Calibration anchors each frame at its front face, so the ellipsoid's front
// surface must sit behind that plane — at the eye/cheek plane a real face
// recesses behind the nose-ridge anchor (same convention as the head-shell
// cap: just past the frame's endpiece wrap, ~15mm). Pushing it back by a
// frame half-depth on top (the pre-shell convention) leaves a gap where the
// frame's front half renders on top of the head.
const EYE_PLANE_SETBACK_METERS = 0.015

// Head turn and nod beyond which the nose profile is not sampled: its widths
// foreshorten with yaw (same gate as the PD measurement).
const SEAT_MAX_YAW_RAD = (12 * Math.PI) / 180
const SEAT_MAX_PITCH_RAD = (15 * Math.PI) / 180

// The camera preview is mirrored once, on the `<video>` (see landmarkToNdc).
const MIRROR_LANDMARKS = true

/**
 * Where the frame goes: tracked landmarks → scale, rotation, smoothed pose,
 * world position and the occluders, for `TryOnScene`. Shared by
 * `VirtualTryOnExperience` and the playground prototype, so tuning in the
 * playground transfers 1:1; the prototype's knobs are the optional inputs.
 *
 * Call after `useFaceLandmarker`: the smoothing reads its targets at setup.
 */
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

  // MediaPipe runs on the raw media frame, but the video is displayed with
  // object-fit: cover inside the fixed-aspect stage. Remap landmarks into the
  // visible cropped window so positioning matches what the user sees.
  const correctedLandmarks = computed(() =>
    options.landmarks.value.map((lm) => mapLandmarkToObjectCover(lm, options.coverWindow.value))
  )
  const correctedAnchor = computed(() =>
    options.anchor.value
      ? mapLandmarkToObjectCover(options.anchor.value, options.coverWindow.value)
      : null
  )
  const faceWidth = computed(() => getFaceWidth(correctedLandmarks.value))
  // Normalized inter-pupillary distance from the iris landmarks — varies far
  // less between people than cheek-to-cheek width, so it stays the fallback
  // when face width isn't trackable.
  const ipd = computed(() => getInterPupillaryDistance(correctedLandmarks.value))
  // Normalized ear-to-ear width (face-oval points at temple height) — the
  // measure a real frame is sized from: the temple arms must span it. Drives
  // the metric scale when trackable.
  const earWidth = computed(() => getEarWidth(correctedLandmarks.value))

  // Undo the cos(yaw)·cos(pitch) foreshortening of an on-screen measure so the
  // frame does not shrink when the head turns.
  function poseCompensated(measure: number): number {
    const pose = options.pose.value
    if (!pose) return measure
    return compensateMeasureForPose(measure, pose.euler.yaw, pose.euler.pitch)
  }

  // True-to-size (issue #92): the PD and ear-level width in millimetres,
  // measured against the iris on frontal, open-eyed detections (raw
  // landmarks: the ratios don't depend on the cover crop). Kept through a
  // short tracking loss; started over after PD_RESET_AFTER_LOSS_MS, since it
  // may be someone else.
  const pdEstimate = shallowRef<PdEstimate | null>(null)
  let lostAt: number | null = null
  watch(options.landmarks, (list) => {
    if (!list.length) {
      lostAt ??= performance.now()
      if (performance.now() - lostAt >= PD_RESET_AFTER_LOSS_MS) pdEstimate.value = null
      return
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
  // A card calibration wins over the iris: it is the more accurate ruler.
  // The ear width keeps its measured ratio to the PD (iris samples, else
  // this detection's).
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
  // The near PD the on-screen IPD is measured against, mm: the assumed IPD
  // until measured, then eased toward the measurement.
  const rulerPd = computed(() => rulerPdMm(measurement.value))

  function measuredEarWidthMm(): number {
    return measurement.value?.earWidthMm ?? 0
  }

  // Pad-contact seat (issue #87): for a model with pad spacing in its
  // calibration, the shopper's nose profile (frontal detections, averaged)
  // decides how much lower or higher than on the reference nose the frame
  // sits. Millimetres from the ear-level width (measured, else assumed).
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
      // Millimetres per unit of ear width: measured when true-to-size has
      // an estimate, else the assumed ear width.
      noseProfile(list, aspect, (measuredEarWidthMm() || ASSUMED_EAR_WIDTH_METERS * 1000) / ear)
    )
  })
  // Eased in over the first SEAT_MIN_SAMPLES detections, so it never jumps.
  const seatOffset = computed(() => {
    const spacing = options.calibration.value.padSpacingMm
    const estimate = noseEstimate.value
    if (spacing === null || !estimate) return 0
    return seatOffsetMm(estimate.mean, spacing) * Math.min(estimate.samples / SEAT_MIN_SAMPLES, 1)
  })

  // GLBs are authored in metres — derive scale metrically from the tracked
  // ear-to-ear width (what a frame's temple arms actually span), falling back
  // to cheek width, to IPD, and to the static reference width while no face
  // is tracked.
  const scaleSource = computed<'ear' | 'width' | 'ipd' | 'manual'>(() => {
    if (!autoScale() || !options.hasFace.value) return 'manual'
    if (earWidth.value > 0) return 'ear'
    return faceWidth.value > 0 ? 'width' : 'ipd'
  })

  const autoMetricScale = computed(() => {
    if (scaleSource.value === 'manual') {
      return computeMetricBaseScale(options.aspect.value, referenceFaceWidth())
    }
    // Each measure's real length: the population average, eased toward the
    // shopper's own once measured (cheek width has no measurement).
    const measured = measurement.value
    const measure =
      scaleSource.value === 'ear'
        ? ([
            earWidth.value,
            blendedMeters(measured, measured?.earWidthMm ?? 0, ASSUMED_EAR_WIDTH_METERS)
          ] as const)
        : scaleSource.value === 'width'
          ? ([faceWidth.value, ASSUMED_FACE_WIDTH_METERS] as const)
          : ([ipd.value, blendedMeters(measured, measured?.nearPdMm ?? 0, ASSUMED_IPD_METERS)] as const)
    // Tracked sources get the fit boost on top — a real frame is worn
    // slightly wider than the skull (see FRAME_FIT_SCALE_BOOST).
    return (
      computeMetricScaleFromMeasure(options.aspect.value, poseCompensated(measure[0]), measure[1]) *
      FRAME_FIT_SCALE_BOOST
    )
  })

  const calibratedScale = computed(
    () => autoMetricScale.value * options.calibration.value.scale * scaleMultiplier()
  )

  // The occluder must stay skull-sized when the head turns: the cheek-to-cheek
  // measure foreshortens by cos(yaw)·cos(pitch), so compensate it the same way
  // the scale path does — otherwise the ellipsoid shrinks at yaw and the far
  // temple arm escapes it, rendering on top of the face.
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
    const euler = faceEulerToThree(options.pose.value.euler)
    const offset = options.calibration.value.rotation
    return { x: euler.x + offset.x, y: euler.y + offset.y, z: euler.z + offset.z }
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
    // Iris landmarks drift while the eyelid covers the iris — freeze scale
    // for the blink instead of letting the frame visibly change size.
    holdScale: computed(() =>
      shouldHoldScaleForBlink(
        options.blinkScore.value,
        options.landmarks.value,
        options.mediaAspect.value || 1
      )
    )
  })

  // The calibration recentring translation is NOT applied here — the scene
  // applies it inside the rotated group (`model-offset`), so it pivots with
  // the head. Adding it to this world-space position kept the recentring
  // un-rotated and drifted the frame sideways at yaw.
  const framePosition = computed(() => {
    const position = landmarkToWorld(smoothedAnchor.value, options.aspect.value, {
      mirror: MIRROR_LANDMARKS
    })
    // The frame front stands off the face along the head's forward axis
    // (see FRAME_BRIDGE_STANDOFF_METERS).
    const standoff = headForwardOffset(
      smoothedEuler.value,
      FRAME_BRIDGE_STANDOFF_METERS * smoothedScale.value
    )
    // Pad seat: down the head's own up axis by the seat offset (GLB metres).
    const seat = headUpOffset(smoothedEuler.value, (-seatOffset.value / 1000) * smoothedScale.value)
    return {
      x: position.x + standoff.x + seat.x,
      y: position.y + standoff.y + seat.y + offsetY(),
      z: standoff.z + seat.z + offsetZ()
    }
  })

  // Push-back is applied along the head's own backward axis, not the
  // camera's: at yaw the skull sits diagonally behind the nose bridge, and
  // pushing straight back along camera Z drifts the ellipsoid off the head,
  // exposing the far temple arm it exists to hide.
  const occluderPosition = computed(() => {
    const position = landmarkToWorld(smoothedAnchor.value, options.aspect.value, {
      mirror: MIRROR_LANDMARKS
    })
    const setback = EYE_PLANE_SETBACK_METERS * smoothedScale.value
    const rot = smoothedEuler.value
    const back = new Vector3(0, 0, -(occluderGeometry.value.radiusZ + setback)).applyEuler(
      new Euler(rot.x, rot.y, rot.z)
    )
    return {
      x: position.x + back.x,
      y: position.y + back.y,
      z: offsetZ() + back.z
    }
  })

  // Face-mesh occluder vertices, rebuilt per detection. Shape comes from the
  // RAW landmarks/pose (so the mesh hugs the real face surface); placement
  // comes from the SMOOTHED anchor/euler/scale the glasses render with — the
  // mesh and frame move as one rigid body and occluder edges never shimmer
  // against the glasses. Null when no face is tracked → the scene falls back
  // to the ellipsoid proxy.
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
