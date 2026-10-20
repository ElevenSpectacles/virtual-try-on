import type { Ref } from 'vue'
import { useFaceLandmarker } from '../useFaceLandmarker'
import { useTryOnLighting } from '../useTryOnLighting'
import { useTryOnTrackingHold } from '../useTryOnTrackingHold'
import { useTryOnCardCalibration } from '../useTryOnCardCalibration'
import { useTryOnFreeze } from '../useTryOnFreeze'
import { faceRegion } from '../../../utils/tryon-room'
import type { TryOnTrack } from './useTryOnTrackEvents'

export interface UseTryOnTrackingOptions {
  props: {
    mediapipeBasePath?: string | undefined
    mediapipeModelAssetPath?: string | undefined
    roomReflections: boolean
  }
  /** Camera stream is on. */
  isActive: Ref<boolean>
  /** Camera frame aspect (width / height), for the card crops; 0 while unknown. */
  mediaAspect: Ref<number>
  /** Room lighting runs: host opt-in and tier (see useTryOnFeatures). */
  lightingEnabled: () => boolean
  /** Each raw camera-to-result latency sample, ms (session metrics). */
  onLatency: (ms: number) => void
  track: TryOnTrack
}

/**
 * The face tracker (`useFaceLandmarker`, in its worker) and what that worker
 * feeds: the room lighting samples, the tracking hold every consumer reads
 * the face from, the card-calibration crops, and freeze / unfreeze (which
 * detects the held frame once). Returns the lighting, the raw tracker's
 * state (`faceError`, `trackerHasFace`, `confidence`, `latencyMs`,
 * `faceReady`, `initFaceLandmarker`), the held face (`landmarks`, `pose`,
 * `blinkScore`, `anchor`, `hasFace`, `lastYaw`), `cardCalibration` and the
 * freeze controls.
 */
export function useTryOnTracking(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseTryOnTrackingOptions
) {
  const { props, isActive, track } = options

  // The room is sampled on every tier while the camera is on, for the guide's
  // `tooDark` hint (one 16×16 readback in the worker every few detections);
  // the lighting itself still needs the mid tier.
  const light = useTryOnLighting({
    enabled: options.lightingEnabled,
    sample: () => isActive.value,
    room: () => props.roomReflections,
    // The face's box in the raw frame, for the light direction. Read when a
    // sample arrives, after its detection.
    faceRegion: () => faceRegion(held.landmarks.value)
  })

  const tracker = useFaceLandmarker(videoRef, {
    ...(props.mediapipeBasePath !== undefined
      ? { mediapipeBasePath: props.mediapipeBasePath }
      : {}),
    ...(props.mediapipeModelAssetPath !== undefined
      ? { mediapipeModelAssetPath: props.mediapipeModelAssetPath }
      : {}),
    onLatency: options.onLatency,
    wantFrameSample: light.wantFrameSample,
    onFrameSample: light.onFrameSample,
    wantCardRegion: () => cardCalibration.wantCardRegion(),
    onCardCrop: (gray, width, height, region) =>
      cardCalibration.onCardCrop(gray, width, height, region)
  })

  // Tracking hold: a dropout shorter than TRACKING_HOLD_MS keeps the last
  // pose, so the frame doesn't vanish and pop back. Everything downstream
  // reads the held face; only the session metrics see the raw tracker.
  const held = useTryOnTrackingHold({
    landmarks: tracker.landmarks,
    pose: tracker.pose,
    blinkScore: tracker.blinkScore,
    anchor: tracker.anchor
  })

  // Card calibration (optional, ±1 mm PD): the host shows its own "hold a
  // card to your forehead" UI and calls `startCalibration()`; the result
  // replaces the iris PD for the session (memory only).
  // Raw tracker, not the held face: each card crop must be measured against
  // the landmarks of its own detection.
  const cardCalibration = useTryOnCardCalibration({
    landmarks: tracker.landmarks,
    pose: tracker.pose,
    mediaAspect: options.mediaAspect
  })

  // Freeze / unfreeze (compare frames on a held pose): the video and the
  // tracked pose are held; tracking idles until unfreeze.
  const {
    frozen,
    freeze: freezeTryOn,
    unfreeze: unfreezeTryOn
  } = useTryOnFreeze(videoRef, { active: isActive, detectHeld: tracker.detectHeld })

  /** Hold the current camera frame and pose; switching `model` re-renders on it. */
  async function freeze() {
    // A calibration needs live frames; drop it rather than let it time out.
    if (cardCalibration.calibration.value.status === 'detecting') cardCalibration.cancel()
    const wasFrozen = frozen.value
    await freezeTryOn()
    if (frozen.value && !wasFrozen) track('TRY_ON_FREEZE', { frozen: true })
  }

  /** Back to the live camera; tracking resumes on the next frame. */
  async function unfreeze() {
    const wasFrozen = frozen.value
    await unfreezeTryOn()
    if (wasFrozen) track('TRY_ON_FREEZE', { frozen: false })
  }

  return {
    lightGain: light.lightGain,
    lightTint: light.lightTint,
    lighting: light.lighting,
    roomLuma: light.roomLuma,
    roomSample: light.roomSample,
    lightDirection: light.lightDirection,
    faceError: tracker.error,
    faceErrorDetail: tracker.errorDetail,
    trackerHasFace: tracker.hasFace,
    confidence: tracker.confidence,
    latencyMs: tracker.latencyMs,
    faceReady: tracker.isReady,
    initFaceLandmarker: tracker.init,
    landmarks: held.landmarks,
    pose: held.pose,
    blinkScore: held.blinkScore,
    anchor: held.anchor,
    hasFace: held.hasFace,
    lastYaw: held.lastYaw,
    cardCalibration,
    frozen,
    freeze,
    unfreeze
  }
}
