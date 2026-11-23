# 0005. Mirror once and work in visible-window coordinates

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

The tracker sees the raw camera frame. Shoppers see a mirrored, cropped preview under an unmirrored canvas.

## Decision

Only the video is mirrored. Landmark x is flipped once and remapped into the visible cover window. Capture repeats the same transform.

## Consequences

Every new spatial input must state its coordinate space and cross the mirror exactly once.

## Known problems in these files

- [#142](https://github.com/ElevenSpectacles/virtual-try-on/issues/142): Bug: frame rotation drops YXZ order (up to 11° off on a turned, tilted head)
- [#143](https://github.com/ElevenSpectacles/virtual-try-on/issues/143): Bug: face-width compensation is wrong for pitch and roll (up to 24% scale error)
- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST

## Detailed records

### `src/runtime/composables/tryon/experience/useTryOnCapture.ts`

#### `capture`

The try-on as the shopper sees it, as an image Blob: the visible
(`object-fit: cover`) window of the camera frame, mirrored like the
preview, with the frame rendered over it. Made on-device; the Blob stays in
the browser unless the host uploads or shares it. Rejects while the camera
is off.

#### `context.save()`

Mirrored once, like the preview's `scaleX(-1)`; the scene is not.

#### `scene`

Render and copy in the same task: the drawing buffer is still intact.
As on screen: no frame while it is hidden (it fades out), and the
camera-match blur scaled from stage pixels to output pixels.

### `src/runtime/composables/tryon/experience/useTryOnStage.ts`

#### `mediaAspect`

MediaPipe runs on the raw media frame, but the video is displayed
with object-fit: cover inside the fixed-aspect stage. Remap landmarks into
the visible cropped window so positioning matches what the user sees.

### `src/runtime/composables/tryon/scene/useSceneSnapshot.ts`

#### `onSnapshot(() => {`

Render on demand for `capture()`: the drawing buffer is cleared after the
browser composites a frame, so a capture renders the current pose itself
and the caller copies the canvas before returning to the event loop.

#### `renderer.render(scene.value, active)`

`useTres().renderer` is the renderer instance itself (WebGL or WebGPU);
both draw with render(scene, camera) into their domElement.

### `src/runtime/composables/tryon/useTryOnPlacement.ts`

#### `correctedLandmarks`

MediaPipe runs on the raw media frame, but the video is displayed with
object-fit: cover inside the fixed-aspect stage. Remap landmarks into the
visible cropped window so positioning matches what the user sees.

### `src/runtime/utils/tryon-capture.ts`

#### File overview

Snapshot of the composited try-on (issue #93): which part of the camera
frame the preview shows, and how big the picture is. Pure math, no DOM.

The stage shows the `<video>` with `object-fit: cover` (cropped to the
stage's aspect, centred) and mirrored once with CSS; the WebGL canvas
covers the whole stage unmirrored. A capture redraws exactly that: the
cover window of the raw frame, mirrored, then the canvas over it, both
scaled to the output size.

#### `quality`

Encoder quality for JPEG/WebP, 0 … 1. Default 0.92.

#### `maxWidth`

Maximum output width in pixels. Default: the camera's own resolution
across the visible window (no upscaling).

### `src/runtime/utils/tryon-pose.ts`

#### `position`

Metric translation from the camera origin (MediaPipe camera space).

#### `euler`

Rotation as Euler angles in radians (YXZ order → yaw/pitch/roll).

#### `yaw`

Left/right head turn (radians).

#### `pitch`

Up/down head nod (radians).

#### `roll`

Head tilt toward the shoulders (radians).

#### `euler`

YXZ order gives intuitive yaw/pitch/roll for a head looking at a camera.

### `src/runtime/utils/tryon.ts`

#### File overview

Virtual try-on compositing helpers.

These functions answer the "how do the tracked landmarks agree with a
mirrored front-camera preview?" half of the compositing question. They are
pure math so they can be unit-tested without a camera, a GPU, or MediaPipe.

**Coordinate conventions**

A face-tracking graph (MediaPipe FaceLandmarker) runs on the *raw* camera
frame and returns landmarks normalized to `[0, 1]`, with `x` measured from
the LEFT edge of that raw frame and `y` from the TOP.

The front-camera preview, by convention, is displayed mirrored
(`transform: scaleX(-1)` on the `<video>`) so it reads like a mirror. We
mirror the video ONCE, on the DOM element, and flip the landmark `x` to
match — never mirror the canvas as well. Mirroring both layers is the
classic way to get a frame that tracks the head backwards.

#### `NormalizedLandmark`

A normalized landmark as emitted by MediaPipe (raw-camera space).

#### `x`

`[0, 1]`, from the left edge of the raw (un-mirrored) camera frame.

#### `y`

`[0, 1]`, from the top edge of the frame.

#### `NdcPoint`

A point in Three.js normalized device coordinates (`[-1, 1]`, y-up).

#### `mirrorNormalizedX`

Mirror a normalized `x` so it lines up with a horizontally-mirrored
(`scaleX(-1)`) front-camera preview.

@example mirrorNormalizedX(0) === 1 // left edge of the raw frame is the
right edge of the mirrored preview.

#### `landmarkToNdc`

Convert a normalized landmark (raw-camera space, y-down) into Three.js
normalized device coordinates (`[-1, 1]`, y-up), applying the front-camera
mirror on `x` so the point sits under the same spot of the mirrored
`<video>` layer.

Pass `mirror: false` to see the "mirror the canvas too" bug: the frame ends
up on the opposite side of the head from where the user sees their face.

#### `TRYON_CAMERA`

Perspective camera used by the try-on scene (kept in one place so the
DOM overlay and the WebGL scene agree on the projection).

The vertical FOV matches the ~63° canonical camera MediaPipe's facial
transformation matrix assumes (and real phone front cameras approximate).

#### `landmarkDistance`

Euclidean distance between two normalized landmarks. Useful for estimating
face size / distance from the camera.

#### `getEarWidth`

Approximate ear-to-ear width in normalized image coordinates, using the
face-oval contour's outermost points (234/454). A better proxy for temple
reach than `getFaceWidth`'s cheek points, though still an approximation —
see `EAR_LEVEL_RIGHT`/`EAR_LEVEL_LEFT`.

#### `FRAME_FIT_SCALE_BOOST`

Frames are worn slightly wider than the skull they sit on — the temple
arms bow outward and the front overhangs the cheeks a touch — so sizing
exactly to the ear-to-ear measure reads as too tight. Tried 1.2
(2026-08-23) but that read too large and pushed the temple hinge far
enough past the tracked face to clip against the occlusion collar at
close range; brought back to 1.16, then down to 1.08 (2026-08-24) since
the frame still read larger than real-world size, then back up to 1.12
(2026-08-24) to split the difference. Applied on top of the metric
scale (all tracked sources, itself already derived from the tracked
face) so the frame sits like a real fit without being a flat,
face-independent size.

> Known problem: [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145). This records why the code is as it is; it does not endorse it.

#### `getInterPupillaryDistance`

Inter-pupillary distance in normalized image units, from the iris-center
landmarks. Returns 0 when the model did not emit iris landmarks (e.g. a
468-point result), letting callers fall back to the face-width path.

#### `EYE_RIGHT_TOP`

Eyelid landmarks for eye-aspect-ratio blink detection: top/bottom lid over
the pupil plus the inner/outer canthus of each eye. Chosen over the iris
landmarks precisely because they stay put when the eyelid closes.

#### `mapLandmarkToObjectCover`

Remap a landmark normalized to the RAW media frame into a landmark
normalized to the visible, `object-fit: cover`-cropped window shown on
screen. Face trackers run on the raw frame, but every downstream consumer
(debug overlay, world-space placement) reasons in on-screen coordinates —
without this remap, any mismatch between the media's native aspect ratio
and the container's aspect ratio throws position and scale off by however
much `cover` cropped away.
