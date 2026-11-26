import type { TryOnGuideHint } from '../types/tryon-experience'

export const TRACKING_HOLD_MS = 300

export const GUIDE_TURN_BACK_YAW_RAD = (55 * Math.PI) / 180

export const GUIDE_DARK_LUMA = 0.12
export const GUIDE_DARK_HYSTERESIS = 0.03

export interface GuideInputs {
  tracking: boolean
  hasFace: boolean
  anchored: boolean
  yaw: number | null
  lastYaw: number | null
  luma: number | null
  previous: TryOnGuideHint | null
}

export function guideHintFor(inputs: GuideInputs): TryOnGuideHint | null {
  if (!inputs.tracking) return null
  const darkEdge =
    GUIDE_DARK_LUMA + (inputs.previous === 'tooDark' ? GUIDE_DARK_HYSTERESIS : 0)
  const dark = inputs.luma !== null && inputs.luma < darkEdge
  if (!inputs.hasFace || !inputs.anchored) {
    if (inputs.lastYaw !== null && Math.abs(inputs.lastYaw) >= GUIDE_TURN_BACK_YAW_RAD) {
      return 'turnBack'
    }
    return dark ? 'tooDark' : 'noFace'
  }
  if (inputs.yaw !== null && Math.abs(inputs.yaw) >= GUIDE_TURN_BACK_YAW_RAD) return 'turnBack'
  return dark ? 'tooDark' : 'aligned'
}

export function isHeld(lastSeenAt: number | null, now: number, holdMs = TRACKING_HOLD_MS): boolean {
  return lastSeenAt !== null && now - lastSeenAt < holdMs
}

export const FRAME_FADE_MS = 150
