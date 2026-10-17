import { computed, ref, shallowRef } from 'vue'
import {
  LIGHTING_SAMPLE_EVERY,
  LIGHTING_SMOOTHING,
  estimateFrameLighting,
  lightingGain,
  smoothFrameLighting,
  type FrameLighting
} from '../../utils/tryon-lighting'
import {
  estimateLightDirection,
  smoothLightDirection,
  type FrameRegion,
  type LightDirection
} from '../../utils/tryon-room'

/** A smoothed room sample: RGBA bytes, for the camera environment (issue #84). */
export interface RoomSample {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Room lighting from the camera (issue #5): while `enabled`, every
 * LIGHTING_SAMPLE_EVERY-th detection asks the face-landmarker worker for a
 * 16×16 downsample of the frame (`wantFrameSample` / `onFrameSample`, wire
 * them into `useFaceLandmarker`), which is averaged and smoothed here into a
 * light gain and tint for the scene. With no sample (lighting off, or
 * OffscreenCanvas unavailable in the worker) the estimate stays null, which
 * keeps the neutral studio lighting.
 */
export function useTryOnLighting(options: {
  enabled: () => boolean
  /**
   * Sample the room even while the lighting itself is off, for `roomLuma`
   * (the guide's `tooDark` hint). Default: only while enabled.
   */
  sample?: () => boolean
  /**
   * Also keep a smoothed copy of the room sample and the light direction
   * over `faceRegion` (camera reflections, issue #84). Default off.
   */
  room?: () => boolean
  /** The face's region of the raw frame, for the light direction. */
  faceRegion?: () => FrameRegion | null
}) {
  const sampling = () => options.enabled() || (options.sample?.() ?? false)
  const room = () => options.enabled() && (options.room?.() ?? false)
  const roomSample = shallowRef<RoomSample | null>(null)
  const lightDirection = shallowRef<LightDirection | null>(null)
  let roomAccumulator: Float32Array | null = null
  const frameLighting = ref<FrameLighting | null>(null)
  const lastSampleMs = ref<number | null>(null)
  let detectionsSinceSample = 0

  function wantFrameSample(): boolean {
    if (!sampling()) return false
    detectionsSinceSample = (detectionsSinceSample + 1) % LIGHTING_SAMPLE_EVERY
    return detectionsSinceSample === 0
  }

  function onFrameSample(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    sampleMs: number
  ) {
    if (!sampling()) return
    frameLighting.value = smoothFrameLighting(
      frameLighting.value,
      estimateFrameLighting(rgba, width, height)
    )
    lastSampleMs.value = sampleMs
    if (!room()) {
      roomSample.value = null
      lightDirection.value = null
      roomAccumulator = null
      return
    }
    // Per-pixel EMA, at the lighting's own rate, so reflections and the light
    // direction don't flicker with sensor noise or a passing hand.
    if (!roomAccumulator || roomAccumulator.length !== rgba.length) {
      roomAccumulator = Float32Array.from(rgba)
    } else {
      for (let i = 0; i < rgba.length; i++) {
        roomAccumulator[i]! += LIGHTING_SMOOTHING * (rgba[i]! - roomAccumulator[i]!)
      }
    }
    const pixels = Uint8ClampedArray.from(roomAccumulator)
    roomSample.value = { pixels, width, height }
    const region = options.faceRegion?.() ?? undefined
    const direction = estimateLightDirection(pixels, width, height, region ?? undefined)
    if (direction) {
      lightDirection.value = smoothLightDirection(lightDirection.value, direction, LIGHTING_SMOOTHING)
    }
  }

  // Light gain and tint from the smoothed room estimate; neutral (gain 1,
  // white) whenever lighting is disabled or no estimate is available.
  const lightGain = computed(() =>
    options.enabled() && frameLighting.value ? lightingGain(frameLighting.value.luma) : 1
  )
  const lightTint = computed<[number, number, number]>(() =>
    options.enabled() && frameLighting.value ? frameLighting.value.tint : [1, 1, 1]
  )

  // Read-only state for the component ref: the smoothed room luma (null
  // while lighting is off or unsampled), the light multiplier it drives, and
  // the worker's time for the last downsample.
  const lighting = computed(() => ({
    luma: options.enabled() ? (frameLighting.value?.luma ?? null) : null,
    gain: lightGain.value,
    sampleMs: lastSampleMs.value,
    /** Where the room's light comes from (with room reflections on), or null. */
    direction: room() ? lightDirection.value : null
  }))

  // The smoothed room luma whenever the room is sampled, lighting on or off.
  const roomLuma = computed(() => (sampling() ? (frameLighting.value?.luma ?? null) : null))

  return {
    wantFrameSample,
    onFrameSample,
    lightGain,
    lightTint,
    lighting,
    roomLuma,
    roomSample: computed(() => (room() ? roomSample.value : null)),
    lightDirection: computed(() => (room() ? lightDirection.value : null))
  }
}
