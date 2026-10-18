import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useTryOnCardCalibration } from '../../../../src/runtime/composables/tryon/useTryOnCardCalibration'
import {
  CARD_CROP_HEIGHT,
  CARD_CROP_WIDTH,
  CARD_SAMPLES,
  CARD_TIMEOUT_MS,
  CARD_WIDTH_MM
} from '../../../../src/runtime/utils/tryon-card'
import { IRIS_RING_LEFT, IRIS_RING_RIGHT } from '../../../../src/runtime/utils/tryon-measure'
import type { NormalizedLandmark } from '../../../../src/runtime/utils/tryon'
import type { FacePose } from '../../../../src/runtime/utils/tryon-pose'

const POSE: FacePose = {
  position: { x: 0, y: 0, z: -40 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  euler: { yaw: 0, pitch: 0, roll: 0 },
  scale: 1
}

// A frontal face 0.3 wide, iris centres 0.12 apart, irises 0.0223 wide.
function face(): NormalizedLandmark[] {
  const p: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  p[234] = { x: 0.35, y: 0.45 }
  p[454] = { x: 0.65, y: 0.45 }
  p[151] = { x: 0.5, y: 0.3 }
  p[9] = { x: 0.5, y: 0.36 }
  for (const [c, ring, x] of [
    [468, IRIS_RING_RIGHT, 0.44],
    [473, IRIS_RING_LEFT, 0.56]
  ] as const) {
    p[c] = { x, y: 0.44 }
    ring.forEach((i, k) => {
      const a = (k * Math.PI) / 2
      p[i] = { x: x + 0.01115 * Math.cos(a), y: 0.44 + 0.01115 * Math.sin(a) }
    })
  }
  return p
}

/** A crop of `region` with a card `cardWidth` (frame fraction) wide, centred. */
function cardCrop(regionWidth: number, cardWidth: number) {
  const span = (cardWidth / regionWidth) * CARD_CROP_WIDTH
  const left = (CARD_CROP_WIDTH - span) / 2
  const gray = new Uint8ClampedArray(CARD_CROP_WIDTH * CARD_CROP_HEIGHT)
  for (let y = 0; y < CARD_CROP_HEIGHT; y++) {
    for (let x = 0; x < CARD_CROP_WIDTH; x++) {
      const cover = Math.max(0, Math.min(x + 1, left + span) - Math.max(x, left))
      gray[y * CARD_CROP_WIDTH + x] = 160 + 70 * cover
    }
  }
  return gray
}

function setup() {
  const landmarks = ref(face())
  const pose = ref<FacePose | null>(POSE)
  const scope = effectScope()
  const cal = scope.run(() => useTryOnCardCalibration({ landmarks, pose, mediaAspect: ref(1) }))!
  return { cal, landmarks, pose }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useTryOnCardCalibration', () => {
  it('crops nothing while idle', () => {
    expect(setup().cal.wantCardRegion()).toBeNull()
  })

  it('measures the PD from the card and finishes', () => {
    const { cal } = setup()
    cal.start()
    // A card 0.18 of the frame wide: 85.6 mm over 0.18, times the 0.12 IPD.
    for (let i = 0; i < CARD_SAMPLES; i++) {
      const region = cal.wantCardRegion()!
      cal.onCardCrop(cardCrop(region.width, 0.18), CARD_CROP_WIDTH, CARD_CROP_HEIGHT, region)
    }
    const state = cal.state.value
    expect(cal.calibration.value.status).toBe('done')
    // Near PD: card ruler plus the 12 mm card-to-eye correction (a few %).
    const flat = (CARD_WIDTH_MM / 0.18) * 0.12
    expect(state.nearPdMm! / flat).toBeGreaterThan(1.01)
    expect(state.nearPdMm! / flat).toBeLessThan(1.05)
    expect(cal.calibration.value.pdMm).toBeGreaterThan(state.nearPdMm!)
    expect(cal.calibratedNearPdMm.value).toBe(state.nearPdMm)
  })

  it('ignores frames on a turned head', () => {
    const { cal, pose } = setup()
    cal.start()
    pose.value = { ...POSE, euler: { yaw: 0.6, pitch: 0, roll: 0 } }
    expect(cal.wantCardRegion()).toBeNull()
  })

  it('fails when no card shows up in time, even with no frames', () => {
    const { cal } = setup()
    cal.start()
    vi.advanceTimersByTime(CARD_TIMEOUT_MS)
    expect(cal.calibration.value.status).toBe('failed')
  })

  it('cancels back to idle', () => {
    const { cal } = setup()
    cal.start()
    cal.cancel()
    expect(cal.calibration.value).toEqual({ status: 'idle', progress: 0, pdMm: null })
    vi.advanceTimersByTime(CARD_TIMEOUT_MS)
    expect(cal.calibration.value.status).toBe('idle')
  })
})
