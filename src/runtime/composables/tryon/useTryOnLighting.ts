import { computed, ref } from 'vue'
import {
  LIGHTING_SAMPLE_EVERY,
  estimateFrameLighting,
  lightingGain,
  smoothFrameLighting,
  type FrameLighting
} from '../../utils/tryon-lighting'

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
}) {
  const sampling = () => options.enabled() || (options.sample?.() ?? false)
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
    sampleMs: lastSampleMs.value
  }))

  // The smoothed room luma whenever the room is sampled, lighting on or off.
  const roomLuma = computed(() => (sampling() ? (frameLighting.value?.luma ?? null) : null))

  return { wantFrameSample, onFrameSample, lightGain, lightTint, lighting, roomLuma }
}
