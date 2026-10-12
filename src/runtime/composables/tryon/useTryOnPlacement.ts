import { computed, type Ref } from 'vue'
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
}

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
    const measure =
      scaleSource.value === 'ear'
        ? ([earWidth.value, ASSUMED_EAR_WIDTH_METERS] as const)
        : scaleSource.value === 'width'
          ? ([faceWidth.value, ASSUMED_FACE_WIDTH_METERS] as const)
          : ([ipd.value, ASSUMED_IPD_METERS] as const)
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
    return {
      x: position.x + standoff.x,
      y: position.y + standoff.y + offsetY(),
      z: standoff.z + offsetZ()
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
