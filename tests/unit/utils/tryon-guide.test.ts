import { describe, expect, it } from 'vitest'
import {
  GUIDE_DARK_HYSTERESIS,
  GUIDE_DARK_LUMA,
  GUIDE_TURN_BACK_YAW_RAD,
  TRACKING_HOLD_MS,
  guideHintFor,
  isHeld,
  type GuideInputs
} from '../../../src/runtime/utils/tryon-guide'

const base: GuideInputs = {
  tracking: true,
  hasFace: true,
  anchored: true,
  yaw: 0,
  lastYaw: 0,
  luma: 0.45,
  previous: null
}

describe('guideHintFor', () => {
  it('is null while not tracking', () => {
    expect(guideHintFor({ ...base, tracking: false })).toBeNull()
  })

  it('reads aligned on a frontal face in a lit room', () => {
    expect(guideHintFor(base)).toBe('aligned')
  })

  it('asks to turn back past the yaw limit, either way', () => {
    expect(guideHintFor({ ...base, yaw: GUIDE_TURN_BACK_YAW_RAD + 0.01 })).toBe('turnBack')
    expect(guideHintFor({ ...base, yaw: -GUIDE_TURN_BACK_YAW_RAD - 0.01 })).toBe('turnBack')
    expect(guideHintFor({ ...base, yaw: GUIDE_TURN_BACK_YAW_RAD - 0.05 })).toBe('aligned')
  })

  it('tells "turned away" from "gone" after the face is lost', () => {
    const lost = { ...base, hasFace: false, yaw: null }
    expect(guideHintFor({ ...lost, lastYaw: 1.0 })).toBe('turnBack')
    expect(guideHintFor({ ...lost, lastYaw: 0.1 })).toBe('noFace')
    expect(guideHintFor({ ...lost, lastYaw: null })).toBe('noFace')
  })

  it('flags a dark room, with or without a face', () => {
    expect(guideHintFor({ ...base, luma: GUIDE_DARK_LUMA - 0.01 })).toBe('tooDark')
    expect(guideHintFor({ ...base, hasFace: false, lastYaw: 0, luma: 0.05 })).toBe('tooDark')
  })

  it('needs a bit more light to leave tooDark (hysteresis)', () => {
    const between = GUIDE_DARK_LUMA + GUIDE_DARK_HYSTERESIS / 2
    expect(guideHintFor({ ...base, luma: between })).toBe('aligned')
    expect(guideHintFor({ ...base, luma: between, previous: 'tooDark' })).toBe('tooDark')
    expect(
      guideHintFor({ ...base, luma: GUIDE_DARK_LUMA + GUIDE_DARK_HYSTERESIS + 0.01, previous: 'tooDark' })
    ).toBe('aligned')
  })

  it('never says tooDark without a luma sample', () => {
    expect(guideHintFor({ ...base, luma: null })).toBe('aligned')
  })

  it('puts turnBack before tooDark', () => {
    expect(guideHintFor({ ...base, yaw: 1, luma: 0.01 })).toBe('turnBack')
  })
})

describe('isHeld', () => {
  it('holds for TRACKING_HOLD_MS after the face was last seen', () => {
    expect(isHeld(1000, 1000 + TRACKING_HOLD_MS - 1)).toBe(true)
    expect(isHeld(1000, 1000 + TRACKING_HOLD_MS)).toBe(false)
    expect(isHeld(null, 0)).toBe(false)
  })
})
