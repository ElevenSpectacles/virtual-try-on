import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTryOnFit } from '../../../../src/runtime/composables/tryon/useTryOnFit'
import { useTryOnLighting } from '../../../../src/runtime/composables/tryon/useTryOnLighting'
import { FIT_MIN_SAMPLES } from '../../../../src/runtime/utils/tryon-fit'
import { LIGHTING_SAMPLE_EVERY } from '../../../../src/runtime/utils/tryon-lighting'
import type { NormalizedLandmark } from '../../../../src/runtime/utils/tryon'

function solid(value: number, size = 16): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = value
    rgba[i + 1] = value
    rgba[i + 2] = value
    rgba[i + 3] = 255
  }
  return rgba
}

describe('useTryOnLighting', () => {
  it(`asks the worker for one sample every ${LIGHTING_SAMPLE_EVERY} detections, only while enabled`, () => {
    const enabled = ref(true)
    const lighting = useTryOnLighting({ enabled: () => enabled.value })
    const asks = Array.from({ length: LIGHTING_SAMPLE_EVERY * 3 }, () => lighting.wantFrameSample())
    expect(asks.filter(Boolean)).toHaveLength(3)
    enabled.value = false
    expect(Array.from({ length: 10 }, () => lighting.wantFrameSample()).some(Boolean)).toBe(false)
  })

  it('turns a bright room into a gain above 1 and reports the sample', () => {
    const lighting = useTryOnLighting({ enabled: () => true })
    expect(lighting.lightGain.value).toBe(1)
    lighting.onFrameSample(solid(240), 16, 16, 1.2)
    expect(lighting.lightGain.value).toBeGreaterThan(1)
    expect(lighting.lighting.value.luma).toBeGreaterThan(0.9)
    expect(lighting.lighting.value.sampleMs).toBe(1.2)
  })

  it('stays neutral while disabled', () => {
    const enabled = ref(false)
    const lighting = useTryOnLighting({ enabled: () => enabled.value })
    lighting.onFrameSample(solid(240), 16, 16, 1)
    expect(lighting.lightGain.value).toBe(1)
    expect(lighting.lightTint.value).toEqual([1, 1, 1])
    expect(lighting.lighting.value.luma).toBeNull()
  })
})

describe('useTryOnFit', () => {
  // The fit composable only reads the widths through its getters; the
  // landmarks ref is the per-detection trigger.
  function setup(frameWidthMm = 140) {
    const landmarks = ref<NormalizedLandmark[]>([])
    const hasFace = ref(true)
    const frameWidth = ref(frameWidthMm)
    const scope = effectScope()
    const fit = scope.run(() =>
      useTryOnFit({
        landmarks,
        hasFace,
        // Face 140 mm at ear level: ear width / IPD × 63 mm.
        earWidth: () => (0.1 * 140) / 63,
        ipd: () => 0.1,
        frameWidthMm: () => frameWidth.value,
        tolerance: () => 0.06
      })
    )!
    const detect = async (count: number) => {
      for (let i = 0; i < count; i++) {
        landmarks.value = [{ x: i, y: 0 }]
        await nextTick()
      }
    }
    return { fit, detect, hasFace, frameWidth, landmarks, scope }
  }

  it(`gives a verdict after ${FIT_MIN_SAMPLES} detections`, async () => {
    const { fit, detect } = setup()
    await detect(FIT_MIN_SAMPLES - 1)
    expect(fit.fit.value).toBeNull()
    await detect(1)
    expect(fit.fit.value?.verdict).toBe('good')
    expect(fit.fit.value?.faceWidthMm).toBeCloseTo(140)
  })

  it('starts over when the face is lost', async () => {
    const { fit, detect, hasFace } = setup()
    await detect(FIT_MIN_SAMPLES)
    hasFace.value = false
    await detect(1)
    expect(fit.fit.value).toBeNull()
    hasFace.value = true
    await detect(FIT_MIN_SAMPLES - 1)
    expect(fit.fit.value).toBeNull()
  })

  it('clears the verdict on reset and recomputes on the next detection', async () => {
    const { fit, detect, frameWidth } = setup()
    await detect(FIT_MIN_SAMPLES)
    expect(fit.verdict.value).toBe('good')
    fit.reset()
    frameWidth.value = 170
    expect(fit.verdict.value).toBeNull()
    await detect(1)
    expect(fit.verdict.value).toBe('wide')
  })
})
