# 0008. Smooth adaptively and predict only for display

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Landmarks jitter at rest, and the detection pipeline trails real motion.

## Decision

One-Euro filters and quaternion slerp smooth the pose. Prediction is bounded, has a deadband and never feeds back into filter state.

## Consequences

Tuning must be checked for jitter, lag and overshoot together.

## Known problems in these files

- [#143](https://github.com/ElevenSpectacles/virtual-try-on/issues/143): Bug: face-width compensation is wrong for pitch and roll (up to 24% scale error)
- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST

## Detailed records

### `src/runtime/composables/tryon/useTryOnSmoothing.ts`

#### `POSE_FILTER`

MediaPipe's per-frame landmarks jitter by a pixel or two even on a still
face, and the video's own frame rate is not the render frame rate. Both
alone are enough to make a rigidly-parented 3D model visibly tremble in a
way raw video never does. `oneEuroFilter` adapts its cutoff to the signal's
own speed, so it smooths hard while the user holds still and loosens
automatically during real motion instead of lagging behind it.

`beta` is tuned higher for scale than for position/rotation: distance
changes (the user visibly walking toward or away from the camera) should
read as immediate, while position/rotation jitter at rest is the more
distracting artifact to suppress.

beta on position/rotation is deliberately aggressive: it only raises the
cutoff *in proportion to measured signal speed*, so a still head keeps the
heavy minCutoff smoothing (no jitter) while any real motion — turning to
show a friend, leaning in — is tracked with almost no lag. This is the
"feels glued to the face" knob; too low and the frame swims behind the
head during motion, which reads as fake.

#### `ANCHOR_PREDICTION_DEADBAND`

Prediction deadbands (see `predictOneEuro`): below these speeds the
velocity estimate is mostly landmark noise, so a still head predicts
nothing. Anchor in normalized frame widths per second, scale as a fraction
of the current scale per second, rotation in radians per second.

#### `holdScale`

While true (e.g. mid-blink, when iris landmarks are unreliable), the
scale filter is not fed new measurements — the frame keeps its last
smoothed size instead of jumping with the garbage signal.

#### `latencyMs`

Measured camera→landmarks pipeline latency in milliseconds (EMA from
`useFaceLandmarker`). While tracking, the filtered pose is extrapolated
forward by this much along its own velocity estimates, so the rendered
frame matches where the head is *now* instead of where it was when the
camera frame was captured. Prediction is velocity-proportional — a still
head predicts ~zero, keeping the heavy at-rest smoothing — and is applied
display-only: the filter state is never advanced by it, so extrapolation
error cannot feed back into the filter. Omit/0 disables prediction.

#### `smoothedQuaternion`

Rotation is smoothed as a single quaternion slerp rather than three
independent per-axis low-pass filters. Filtering yaw/pitch/roll
separately can produce non-physical intermediate rotations ("wobble")
during combined multi-axis motion (e.g. a quick head tilt while turning)
— slerping the whole rotation as one rigid unit avoids that. The slerp
factor itself is adapted with the same One Euro Filter formula used for
the scalar signals below.

#### `smoothedSpeedState`

Speed of the smoothed rotation itself (rad/s), for latency prediction.
`angularSpeedState` measures the residual to the raw target, which on a
still head is pure landmark noise; the smoothed rotation barely moves at
rest, so extrapolating along its speed adds no jitter.

#### `displayQuat`

Display-only rotation: filter state quaternion + latency prediction.
Kept separate so the prediction never feeds back into the slerp state.

#### `outEulerObj`

Reused per-frame instead of allocating in the rAF loop (60-120Hz). In and
out in `HEAD_EULER_ORDER` (`YXZ`), so the smoothed rotation is the tracked
one (ADR 0005).

#### `if (options.isTracking.value && !wasTracking) {`

Reset (snap) whenever the face is (re)acquired — filtering a jump
from "no face" to a freshly-detected position would drag the frame
across the screen instead of appearing where the face is.

#### `if (!options.holdScale?.value) {`

Blinks corrupt the iris-driven scale signal for a few frames; hold
the last smoothed value rather than filtering the garbage in.

#### `predSeconds`

Latency compensation: the pose targets describe where the head was
when the camera frame was captured (~latencyMs ago). Extrapolate the
filtered signals forward along their own velocity estimates so the
rendered frame matches where the head is *now*. Applied to the
outputs only — filter state is never advanced by the prediction.

#### `displayQuat.copy(smoothedQuaternion)`

Rotation prediction: advance from the filtered quaternion toward the
latest measurement by the angle the smoothed rotation covers in
`predSeconds` at its own speed (less a deadband), overshooting the
measurement by at most a fifth of the remaining angle (t ≤ 1.2) — the
same clamp as `predictOneEuro`, so a decelerating head turn can't
swing the frame visibly past the face. Zero speed leaves the filtered
rotation untouched (t = 0), so a still head keeps its smoothing.

#### `if (scaleState) {`

scaleState stays null until the first non-held frame — keep the
initial value in that window instead of crashing on the read.

### `src/runtime/utils/tryon.ts`

#### `oneEuroFilter`

One Euro Filter (Casiez, Roussel & Vogel, 2012) — a low-pass filter whose
cutoff frequency adapts to the signal's own speed. A fixed-time-constant
smoother has to pick one point on the jitter-vs-lag tradeoff; this instead
smooths hard when the signal is nearly still (killing per-frame tracker
jitter) and loosens automatically during fast motion (so a quick head turn
or a step toward the camera doesn't visibly lag behind the real face).

`state: null` primes the filter — the first sample passes through
unfiltered rather than smoothing from an arbitrary starting value. Callers
also pass `null` to reset the filter on discontinuities (e.g. the face
being re-acquired after tracking was lost), so it snaps instead of gliding
across the screen from the last known position.

#### `predictOneEuro`

Latency compensation on top of `oneEuroFilter`: extrapolate the filtered
value along the filter's own velocity estimate by `dtSeconds` (typically
the measured camera→result pipeline latency), so the rendered pose matches
where the head is *now* rather than where it was when the frame was
captured.

Two guards keep extrapolation from becoming a new artifact:

- The lookahead is capped at `ONE_EURO_MAX_PREDICTION_SECONDS` so a latency
  spike (GC pause, background tab) cannot fling the value far away.
- The prediction may overshoot the latest raw measurement by at most
  `(maxOvershoot - 1)` times the remaining gap between filtered value and
  measurement — beyond that the filter, not the velocity estimate, is the
  better information source (e.g. the head just decelerated and the stale
velocity would overshoot badly). Keep this tight: past-the-measurement
overshoot is what makes the frame visibly swing past the face when a
head turn stops.

A third guard keeps a still head still: `minSpeed` is a soft deadband on
the velocity estimate. On a still face the derivative is pure measurement
noise, and extrapolating along it multiplies at-rest jitter (about 3x at
100 ms latency, see useTryOnSmoothing.test.ts). Speeds below `minSpeed`
predict nothing; above it the excess is used, so prediction fades in with
no step.

#### `ObjectCoverWindow`

The visible window (in raw-media-normalized `[0, 1]` coordinates) left
after `object-fit: cover` scales a media element to fill a container of a
different aspect ratio. `object-cover` crops symmetrically, so the window
is always centred.
