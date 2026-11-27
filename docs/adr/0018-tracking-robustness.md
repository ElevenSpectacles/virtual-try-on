# 0018. Hold brief losses and coach longer ones

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Short occlusions and fast turns cause dropouts that make the frame flash.

## Decision

The last face is held briefly. Pose and luma produce guide hints with hysteresis. The host supplies the wording.

## Consequences

Consumers read the held face. Session metrics read the raw tracker.

## Detailed records

### `src/runtime/composables/tryon/experience/useTryOnFrame.ts`

#### `frameVisible`

The frame renders only on a tracked face: never before the camera starts
(the host owns that screen — consent, previews), and not while tracking
has momentarily lost the face (head turned past the tracker's yaw range,
face out of frame), where it would freeze mid-air over the live video.

#### `guideHint`

Coaching for the host's guide UI (no copy here): no face, turned too far,
too dark, or aligned. Keeps its previous value for the hysteresis.

### `src/runtime/composables/tryon/experience/useTryOnTracking.ts`

#### `light`

The room is sampled on every tier while the camera is on, for the guide's
`tooDark` hint (one 16×16 readback in the worker every few detections);
the lighting itself still needs the mid tier.

#### `held`

Tracking hold: a dropout shorter than TRACKING_HOLD_MS keeps the last
pose, so the frame doesn't vanish and pop back. Everything downstream
reads the held face; only the session metrics see the raw tracker.

### `src/runtime/composables/tryon/useTryOnTrackingHold.ts`

#### `useTryOnTrackingHold`

Tracking hold (issue #99): the tracker's output, except that a lost face
keeps its last landmarks, pose and anchor for `holdMs`. A dropout shorter
than that (a hand passing, motion blur in a fast turn) never reaches the
placement: the frame stays on the last pose and the smoothing glides to
the new one when the face comes back, instead of hiding the frame and
snapping it back. A longer loss releases everything, as before.

`lastYaw` keeps the yaw of the last tracked pose after release, so the
guide can tell "turned away" from "gone".

#### `scheduleRelease`

Release the held face after `holdMs`, unless the tracker finds it again
first. One timer per loss: further empty detections don't restart it.

#### `onScopeDispose(cancelRelease)`

A pending release must not fire after the component (or scope) is gone.

### `src/runtime/types/tryon-experience.ts`

#### `TryOnGuideHint`

Positioning hint for the host's guide UI: `noFace` while tracking runs
without a usable face, `aligned` once the anchor is found, `turnBack`
when the head is turned too far to fit well (or was, when the face was
lost), `tooDark` when the room is too dark for stable tracking. `null`
when the camera is off.

### `src/runtime/utils/tryon-guide.ts`

#### File overview

Guide hints and the tracking hold (issue #99). Pure, no Vue.

Real shoppers try frames on in dim rooms, turn to see the temples, and
pass a hand through the frame. Two things make that read well:

- **Hold**: when the tracker drops the face for a moment (a blink-length
  occlusion, motion blur in a fast turn), the frame stays on the last pose
  for `TRACKING_HOLD_MS` instead of vanishing and popping back. Only a
  longer loss hides it (with a short fade, see the component).
- **Coaching**: `guideHint` tells the host *why* there is no good track:
  `turnBack` when the head is turned past what the tracker and the
  occluder handle well (or was, when the face was lost), `tooDark` when the
  room's luma is too low for stable landmarks. The module ships no copy;
the host words it.

#### `GUIDE_TURN_BACK_YAW_RAD`

Head turn past which the shopper is asked to turn back. MediaPipe tracks
to ~±60–70°, but near its limit the far side of the face (and its
occluder) is mostly guessed and the far temple pops in and out. Not lower:
the kairos-amber fixture sits at 44° and tracks and fits well there
(MediaPipe on the fixture frames, 2026-10-17), and turning to see the
temples is the point of a try-on.

#### `GUIDE_DARK_LUMA`

Room luma (0…1, see utils/tryon-lighting) under which the room is too
dark: webcam sensor noise, and with it landmark noise, grows fast below
it. On the fixtures in Chromium, the `dim` clip reads 0.24–0.40 and
the `dark` clip 0.012–0.096. Leaving the hint takes
`GUIDE_DARK_HYSTERESIS` more, so it doesn't flicker.

#### `yaw`

Current head yaw (radians), or null without a pose.

#### `if (inputs.lastYaw !== null && Math.abs(inputs.lastYaw) >= GUIDE_TURN_BACK_YAW_R`

Lost while turned away: the face is still there, just out of range.
