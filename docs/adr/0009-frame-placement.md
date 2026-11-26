# 0009. Anchor the frame to the skull and pivot it with the head

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Gaze, expression and differing GLB origins otherwise move a frame that should be rigid on the face.

## Decision

A rigid landmark centroid is the anchor. Standoff, pad seat and recentring are applied in head space.

## Consequences

Anchor or offset changes require the fit checks on the face fixtures.

## Known problems in these files

- [#143](https://github.com/ElevenSpectacles/virtual-try-on/issues/143): Bug: face-width compensation is wrong for pitch and roll (up to 24% scale error)
- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST
- [#146](https://github.com/ElevenSpectacles/virtual-try-on/issues/146): Sizing: REFERENCE_NOSE_PROFILE rests on two photos at 25° yaw
- [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152): Refactor: enforce values duplicated with "keep in sync" comments

## Detailed records

### `src/runtime/composables/tryon/useTryOnPlacement.ts`

#### `landmarks`

Raw tracker output, from `useFaceLandmarker`.

#### `autoScale`

Scale from the tracked face. Off uses `referenceFaceWidth` for the scale
and the occluder size, as before a face is tracked. Default on.

#### `RESTING_ANCHOR`

Anchor target while no face is tracked (the frame is hidden then, so this
only keeps the smoothing filters fed with a sane value).

#### `EYE_PLANE_SETBACK_METERS`

Calibration anchors each frame at its front face, so the ellipsoid's front
surface must sit behind that plane — at the eye/cheek plane a real face
recesses behind the nose-ridge anchor (same convention as the head-shell
cap: just past the frame's endpiece wrap, ~15mm). Pushing it back by a
frame half-depth on top (the pre-shell convention) leaves a gap where the
frame's front half renders on top of the head.

#### `SEAT_MAX_YAW_RAD`

Head turn and nod beyond which the nose profile is not sampled: its widths
foreshorten with yaw (same gate as the PD measurement).

#### `useTryOnPlacement`

Where the frame goes: tracked landmarks → scale, rotation, smoothed pose,
world position and the occluders, for `TryOnScene`. Shared by
`VirtualTryOnExperience` and the playground prototype, so tuning in the
playground transfers 1:1; the prototype's knobs are the optional inputs.

Call after `useFaceLandmarker`: the smoothing reads its targets at setup.

#### `noseProfile(list, aspect, (measuredEarWidthMm() || ASSUMED_EAR_WIDTH_METERS * 10`

Millimetres per unit of ear width: measured when true-to-size has
an estimate, else the assumed ear width.

#### `seatOffset`

Eased in over the first SEAT_MIN_SAMPLES detections, so it never jumps.

#### `holdScale`

Iris landmarks drift while the eyelid covers the iris — freeze scale
for the blink instead of letting the frame visibly change size.

#### `framePosition`

The calibration recentring translation is NOT applied here — the scene
applies it inside the rotated group (`model-offset`), so it pivots with
the head. Adding it to this world-space position kept the recentring
un-rotated and drifted the frame sideways at yaw.

#### `standoff`

The frame front stands off the face along the head's forward axis
(see FRAME_BRIDGE_STANDOFF_METERS).

#### `seat`

Pad seat: down the head's own up axis by the seat offset (GLB metres).

### `src/runtime/utils/tryon-seat.ts`

#### File overview

Pad-contact nose seat (issue #87). Pure math, no Vue.

A frame's pads rest where the nose is as wide as the pads are apart:
high on a wide bridge, lower on a narrow one. The placement anchors every
frame at the same point of the nose ridge (tuned on average noses), so a
narrow-bridged shopper sees a frame that floats a little high. With a
model's pad spacing in its calibration (`pads.spacingMm`), this finds how
far down the shopper's nose the pads would land, compares it with where
they land on the reference nose the placement was tuned for, and moves
the frame by the difference (clamped).

Nose width comes from the face mesh's nose side wall, where it meets the
cheek: five landmark pairs down the nose (188/412 … 131/360). On real
MediaPipe landmarks (the face fixtures) they widen monotonically down the
nose, 20 → 34 mm over 25 mm. Only frontal detections count (the widths
foreshorten with yaw), averaged, like the PD.

#### `NOSE_SIDE_PAIRS`

Nose side-wall landmark pairs, top (near the inner eye corners) to bottom.

#### `NoseProfilePoint`

A nose profile: width at each depth below the top pair, millimetres.

#### `REFERENCE_NOSE_PROFILE`

The reference nose: the mean profile of the face fixtures the placement
was tuned on (iris-moss, pteron-azure; MediaPipe landmarks, ear width
148 mm, drops corrected for their 25° yaw), 2026-10-17.

> Known problem: [#146](https://github.com/ElevenSpectacles/virtual-try-on/issues/146). This records why the code is as it is; it does not endorse it.

#### `noseProfile`

The nose profile of one detection, in millimetres: `mmPerUnit` converts
width units (fractions of the frame width, see `widthUnitDistance`), e.g.
the ear-level width's millimetres over its width units. Null when a
landmark is missing.

#### `seatDropMm`

How far below the top of the profile pads `spacingMm` apart come to rest:
the first depth where the nose is that wide, interpolated. At the top when
the nose is wider already; at the bottom when it never gets that wide.

#### `SEAT_MIN_SAMPLES`

Frontal detections averaged before the seat moves the frame (~1 s).

### `src/runtime/utils/tryon.ts`

#### `TRYON_ANCHOR_INDICES`

Landmark indices averaged into the frame anchor — the frame's seat. The
nose-bridge ridge (168 between eyebrows, 6 glabella, 197/5 down the ridge)
pins the anchor where the frame's bridge actually rests, and the inner eye
corners (133/362) pin it to the lens line. Every point is fixed to the
skull, so the seat follows the head and nothing else: the iris centres
this used before move with gaze and drift during blinks, which moved the
frame when the customer looked down at their phone. A real frame doesn't.
The eye corners also sit a little lower than the pupils, which brought the
rendered bridge 1.6–3 px (stage) down onto the real one on the face
fixtures (issue #11). Averaging six points also smooths single-landmark
jitter. Brow/mouth/chin landmarks are deliberately excluded — they move
with expression and would make the frame drift when the user talks or
raises their eyebrows.

#### `computeAnchorCentroid`

Average the given landmark indices into a single anchor point. Missing
indices (e.g. iris centres on a 468-point model) are skipped; returns
null when none of the indices are present so callers can fall back.

#### `FRAME_BRIDGE_STANDOFF_METERS`

How far in front of the tracked anchor (≈ landmark 168, on the skin
between the brows) a worn frame's front sits: the bridge rests on nose
pads, standing off the face. Applied along the head's own forward axis —
frontal it only moves the frame toward the camera, but at yaw it shifts
the frame toward the nose, where the real one is. Without it the frame
pivots about the skin and drifts toward the ear on turned heads.
Fitted on the face fixtures (see tests/e2e/render.spec.ts).
