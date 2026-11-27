# 0012. Make depth-only hair occlusion opt-in

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

The face mesh cannot hide temples under hair, and a 2D mask cannot tell hair over an arm from hair under it.

## Decision

A separate GPU segmenter drives a depth-only plane behind the frame front, only on capable devices, with a time budget.

## Consequences

The frame front is never hidden by hair. Slow or failed segmentation disables only this feature.

## Detailed records

### `src/runtime/composables/tryon/scene/useHairOccluder.ts`

#### `HAIR_VERTEX`

Hair occluder (utils/tryon-hair.ts): a depth-only plane in head space,
HAIR_PLANE_SETBACK_METERS behind the frame front, drawn before the frame
and kept only where the hair mask says hair. Arm parts behind the plane
fail the depth test there and are not drawn, so the live camera's own hair
shows through the empty canvas; lenses, rims and hinges are in front of the
plane and stay. Like the face-mesh occluder, no colour is written.

The shader maps each fragment back to the camera frame exactly as the
preview shows it: mirrored `<video>`, `object-fit: cover` window
(`screenToMedia`). The mask is bilinear-sampled and cut at half
confidence, which gives a smooth hair contour from a 96-px-wide mask.

(Redrawing the camera's pixels over the arm instead, for soft edges, was
tried: at antialiased arm edges the redraw is weighted by coverage twice
and leaves a dark outline, and it costs a camera-texture upload per frame.)

#### `uniform vec4 uWindow;`

xMin, xMax, yMin, yMax of the raw camera frame

#### `if (texture2D(uMask, media).r < 0.5) discard;`

Mask rows are uploaded top first (flipY off).

### `src/runtime/composables/tryon/useHairSegmenter.ts`

#### `HairMask`

Hair confidence of the camera frame, 0…255 per pixel, row-major from the top.

#### `enabled`

Whether to segment. Checked per camera frame; the worker and model load
the first time this is true (so they never delay the first try-on), and
segmentation pauses (mask cleared) while it is false.

#### `useHairSegmenter`

Hair segmentation of the live camera frame in its own worker, for the hair
occluder (see utils/tryon-hair.ts). At most one request in flight, at most
one every HAIR_SEGMENT_INTERVAL_MS, on a small copy of the frame; the mask
comes back as confidence, is shrunk to HAIR_MASK_WIDTH and smoothed over
time.

Switches itself off for the session (`overBudget`) when the worker's
segmentation time stays over HAIR_SEGMENT_BUDGET_MS. A load failure sets
`error` and leaves the mask null; the module never logs, the caller reports.

### `src/runtime/utils/tryon-hair.ts`

#### File overview

Hair occlusion of the temple arms (issue #9). Pure math, no Vue or three.

The face-mesh occluder hides the arms behind the face, but not behind hair
that hangs over them. A MediaPipe hair segmenter (its own worker, see
`useHairSegmenter`) gives a per-pixel hair confidence of the camera frame.
Where it says hair, the scene writes depth on a plane in head space
HAIR_PLANE_SETBACK_METERS behind the frame's front, so arm parts behind
that plane are not drawn and the live camera's hair shows in front of them.
Everything in front of the plane (lenses, rims, hinges and the start of
the arms) stays, so bangs never cover the frame front, which matches
reality: the frame sits in front of the fringe.

A 2D mask can't tell hair hanging over an arm from hair the arm rests on.
Glasses usually sit on top of hair at the temple, and a vanishing arm looks
broken, so the feature is opt-in (`hair-occlusion` prop).

#### `HAIR_PLANE_SETBACK_METERS`

Distance behind the frame's front plane (GLB metres) beyond which hair may cover the arms.

#### `HAIR_PLANE_SIZE_METERS`

Side of the square head-space plane the hair mask is drawn on (GLB metres). Covers both arms with margin.

#### `HAIR_SEGMENT_INTERVAL_MS`

Minimum time between two segmentations. Hair moves slowly; ~10 Hz is plenty.

#### `HAIR_INPUT_WIDTH`

Width of the segmenter's input frame (px). The hair model resizes to 512²
internally; the confidence it returns at this size is read back from the
GPU, and the mask is cut down to HAIR_MASK_WIDTH anyway.

#### `HAIR_MASK_WIDTH`

Size of the mask sent back to the main thread. Bilinear sampling smooths its edges.

#### `HAIR_MASK_SMOOTHING`

EMA weight of a new mask. Each mask is a whole new estimate, so a single
noisy frame shouldn't make hair strands flicker over the arm.

#### `HAIR_SEGMENT_BUDGET_MS`

Worker time per segmentation (EMA) above which hair occlusion switches
itself off for the session: under half of HAIR_SEGMENT_INTERVAL_MS, so the
segmenter keeps the GPU for less than half the time. The capability
step-down samples render-thread frames only, so it would never see a slow
segmenter in its own worker. Measured on a laptop: ~14 ms alone, ~24 ms
while the face tracker shares the GPU.

#### `HAIR_TIMING_WARMUP`

First segmentations left out of the timing: the first one compiles shaders
and uploads the model to the GPU (~170–260 ms against ~14 ms after, on a
laptop), which would keep the average over budget long after.

#### `MediaWindow`

Visible `object-fit: cover` window of the camera frame, raw-media normalized (see `objectCoverWindow`).

#### `screenToMedia`

Raw camera-frame coordinates (0…1, top-left origin, unmirrored) of a
screen point (0…1, top-left origin) on the mirrored, cover-cropped preview.
The leftmost screen column shows the rightmost visible camera column (the
`<video>` is mirrored), so x runs backwards. Its GLSL twin is
`SCREEN_TO_MEDIA_GLSL`, used by the hair layer and the tinted lens shadow;
`tests/glsl/shader-parity.spec.ts` checks they agree.

#### `downsampleConfidence`

Box-average a single-channel confidence mask (`width * height` floats,
0…1, row-major from the top) down to `outWidth * outHeight` bytes (0…255).
