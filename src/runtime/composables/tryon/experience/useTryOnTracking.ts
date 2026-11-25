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
  isActive: Ref<boolean>
  onPlayError: (err: unknown) => void
  mediaAspect: Ref<number>
  lightingEnabled: () => boolean
  onLatency: (ms: number) => void
  track: TryOnTrack
}

export function useTryOnTracking(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseTryOnTrackingOptions
) {
  const { props, isActive, track } = options

  const light = useTryOnLighting({
    enabled: options.lightingEnabled,
    sample: () => isActive.value,
    room: () => props.roomReflections,
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

  const held = useTryOnTrackingHold({
    landmarks: tracker.landmarks,
    pose: tracker.pose,
    blinkScore: tracker.blinkScore,
    anchor: tracker.anchor
  })

  const cardCalibration = useTryOnCardCalibration({
    landmarks: tracker.landmarks,
    pose: tracker.pose,
    mediaAspect: options.mediaAspect
  })

  const {
    frozen,
    freeze: freezeTryOn,
    unfreeze: unfreezeTryOn
  } = useTryOnFreeze(videoRef, {
    active: isActive,
    detectHeld: tracker.detectHeld,
    onPlayError: options.onPlayError
  })

  async function freeze() {
    if (cardCalibration.calibration.value.status === 'detecting') cardCalibration.cancel()
    const wasFrozen = frozen.value
    await freezeTryOn()
    if (frozen.value && !wasFrozen) track('TRY_ON_FREEZE', { frozen: true })
  }

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
