import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTryOnTrackingHold } from '../../../../src/runtime/composables/tryon/useTryOnTrackingHold'
import { TRACKING_HOLD_MS } from '../../../../src/runtime/utils/tryon-guide'
import type { NormalizedLandmark } from '../../../../src/runtime/utils/tryon'
import type { FacePose } from '../../../../src/runtime/utils/tryon-pose'

function pose(yaw: number): FacePose {
  return {
    position: { x: 0, y: 0, z: -40 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    euler: { yaw, pitch: 0, roll: 0 },
    scale: 1
  }
}
const FACE: NormalizedLandmark[] = [{ x: 0.5, y: 0.5, z: 0 }]

function setup() {
  const source = {
    landmarks: ref<NormalizedLandmark[]>([]),
    pose: ref<FacePose | null>(null),
    blinkScore: ref<number | null>(null),
    anchor: ref<NormalizedLandmark | null>(null)
  }
  const scope = effectScope()
  const held = scope.run(() => useTryOnTrackingHold(source))!
  async function detect(face: boolean, yaw = 0) {
    source.landmarks.value = face ? [...FACE] : []
    source.pose.value = face ? pose(yaw) : null
    source.anchor.value = face ? FACE[0]! : null
    source.blinkScore.value = face ? 0.1 : null
    await nextTick()
  }
  return { held, detect, scope }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useTryOnTrackingHold', () => {
  it('passes a tracked face through', async () => {
    const { held, detect } = setup()
    await detect(true, 0.2)
    expect(held.hasFace.value).toBe(true)
    expect(held.pose.value?.euler.yaw).toBe(0.2)
    expect(held.lastYaw.value).toBe(0.2)
  })

  it('keeps the last pose through a dropout shorter than the hold', async () => {
    const { held, detect } = setup()
    await detect(true, 0.1)
    await detect(false)
    expect(held.hasFace.value).toBe(true)
    expect(held.holding.value).toBe(true)
    expect(held.pose.value?.euler.yaw).toBe(0.1)
    vi.advanceTimersByTime(TRACKING_HOLD_MS - 50)
    await detect(true, 0.12)
    expect(held.holding.value).toBe(false)
    // The hold never released: no hide, no snap.
    vi.advanceTimersByTime(TRACKING_HOLD_MS)
    expect(held.hasFace.value).toBe(true)
    expect(held.pose.value?.euler.yaw).toBe(0.12)
  })

  it('releases the face after the hold', async () => {
    const { held, detect } = setup()
    await detect(true, 0.9)
    await detect(false)
    vi.advanceTimersByTime(TRACKING_HOLD_MS)
    expect(held.hasFace.value).toBe(false)
    expect(held.pose.value).toBeNull()
    expect(held.anchor.value).toBeNull()
    // The yaw it was lost at stays, for the turnBack hint.
    expect(held.lastYaw.value).toBe(0.9)
  })

  it('does not restart the hold on consecutive empty results', async () => {
    const { held, detect } = setup()
    await detect(true)
    await detect(false)
    vi.advanceTimersByTime(TRACKING_HOLD_MS / 2)
    await detect(false)
    vi.advanceTimersByTime(TRACKING_HOLD_MS / 2)
    expect(held.hasFace.value).toBe(false)
  })

  it('holds nothing before the first face', async () => {
    const { held, detect } = setup()
    await detect(false)
    expect(held.hasFace.value).toBe(false)
    expect(held.holding.value).toBe(false)
  })
})
