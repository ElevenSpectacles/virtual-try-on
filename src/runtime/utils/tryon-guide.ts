/**
 * Guide hints and the tracking hold (issue #99). Pure, no Vue.
 *
 * Real shoppers try frames on in dim rooms, turn to see the temples, and
 * pass a hand through the frame. Two things make that read well:
 *
 * - **Hold**: when the tracker drops the face for a moment (a blink-length
 *   occlusion, motion blur in a fast turn), the frame stays on the last pose
 *   for `TRACKING_HOLD_MS` instead of vanishing and popping back. Only a
 *   longer loss hides it (with a short fade, see the component).
 * - **Coaching**: `guideHint` tells the host *why* there is no good track:
 *   `turnBack` when the head is turned past what the tracker and the
 *   occluder handle well (or was, when the face was lost), `tooDark` when the
 *   room's luma is too low for stable landmarks. The module ships no copy;
 *   the host words it.
 */

import type { TryOnGuideHint } from '../types/tryon-experience'

/** How long the last pose is held after the tracker loses the face, ms. */
export const TRACKING_HOLD_MS = 300

/**
 * Head turn past which the shopper is asked to turn back. MediaPipe tracks
 * to ~±60–70°, but near its limit the far side of the face (and its
 * occluder) is mostly guessed and the far temple pops in and out. Not lower:
 * the kairos-amber fixture sits at 44° and tracks and fits well there
 * (MediaPipe on the fixture frames, 2026-10-17), and turning to see the
 * temples is the point of a try-on.
 */
export const GUIDE_TURN_BACK_YAW_RAD = (55 * Math.PI) / 180

/**
 * Room luma (0…1, see utils/tryon-lighting) under which the room is too
 * dark: webcam sensor noise, and with it landmark noise, grows fast below
 * it. On the fixtures in Chromium, the `dim` clip reads 0.24–0.40 and
 * the `dark` clip 0.012–0.096. Leaving the hint takes
 * `GUIDE_DARK_HYSTERESIS` more, so it doesn't flicker.
 */
export const GUIDE_DARK_LUMA = 0.12
export const GUIDE_DARK_HYSTERESIS = 0.03

export interface GuideInputs {
  /** Camera on and face tracking driving the frame. */
  tracking: boolean
  /** A (held) face is tracked. */
  hasFace: boolean
  /** The anchor was found on it. */
  anchored: boolean
  /** Current head yaw (radians), or null without a pose. */
  yaw: number | null
  /** Yaw of the last tracked pose, kept after the face was lost. */
  lastYaw: number | null
  /** Smoothed room luma, or null while unsampled. */
  luma: number | null
  /** The previous hint, for hysteresis. */
  previous: TryOnGuideHint | null
}

/** The hint for the host's guide UI; null while not tracking. */
export function guideHintFor(inputs: GuideInputs): TryOnGuideHint | null {
  if (!inputs.tracking) return null
  const darkEdge =
    GUIDE_DARK_LUMA + (inputs.previous === 'tooDark' ? GUIDE_DARK_HYSTERESIS : 0)
  const dark = inputs.luma !== null && inputs.luma < darkEdge
  if (!inputs.hasFace || !inputs.anchored) {
    // Lost while turned away: the face is still there, just out of range.
    if (inputs.lastYaw !== null && Math.abs(inputs.lastYaw) >= GUIDE_TURN_BACK_YAW_RAD) {
      return 'turnBack'
    }
    return dark ? 'tooDark' : 'noFace'
  }
  if (inputs.yaw !== null && Math.abs(inputs.yaw) >= GUIDE_TURN_BACK_YAW_RAD) return 'turnBack'
  return dark ? 'tooDark' : 'aligned'
}

/**
 * Whether a face last seen at `lastSeenAt` (ms, null: never) is still held
 * at `now`.
 */
export function isHeld(lastSeenAt: number | null, now: number, holdMs = TRACKING_HOLD_MS): boolean {
  return lastSeenAt !== null && now - lastSeenAt < holdMs
}
