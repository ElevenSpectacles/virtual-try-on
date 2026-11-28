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

export interface RoomSample {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

export function useTryOnLighting(options: {
  enabled: () => boolean
  sample?: () => boolean
  room?: () => boolean
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
    if (!roomAccumulator || roomAccumulator.length !== rgba.length) {
      roomAccumulator = Float32Array.from(rgba)
    } else {
      for (let i = 0; i < rgba.length; i++) {
        roomAccumulator[i]! += LIGHTING_SMOOTHING * (rgba[i]! - roomAccumulator[i]!)
      }
    }
    const pixels = Uint8ClampedArray.from(roomAccumulator)
    roomSample.value = { pixels, width, height }
    const direction = estimateLightDirection(pixels, width, height, options.faceRegion?.() ?? undefined)
    if (direction) {
      lightDirection.value = smoothLightDirection(lightDirection.value, direction, LIGHTING_SMOOTHING)
    }
  }

  const lightGain = computed(() =>
    options.enabled() && frameLighting.value ? lightingGain(frameLighting.value.luma) : 1
  )
  const lightTint = computed<[number, number, number]>(() =>
    options.enabled() && frameLighting.value ? frameLighting.value.tint : [1, 1, 1]
  )

  const lighting = computed(() => ({
    luma: options.enabled() ? (frameLighting.value?.luma ?? null) : null,
    gain: lightGain.value,
    sampleMs: lastSampleMs.value,
    direction: room() ? lightDirection.value : null
  }))

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
