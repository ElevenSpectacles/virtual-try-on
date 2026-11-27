# 0015. Match lighting, reflections and grain to the camera

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Studio-lit, noise-free renders look pasted over a webcam feed.

## Decision

A smoothed 16×16 room sample drives light, reflections and direction. Grain, slight blur and light wrap match the sensor.

## Consequences

All effects must degrade to neutral studio lighting without a sample.

## Detailed records

### `src/runtime/components/TryOnScene.vue`

#### `envPreset`

'city' reads as neutral architectural reflections rather than a
photo-studio product shot — at low intensity it lifts color/specular
accuracy without visibly compositing a studio backdrop over the feed.

#### `KEY_LIGHT_POSITION`

Dimmer fill light opposite the key light — without it, colored
acetate/metal reads duller/darker on the unlit side of the frame.

#### `<TresPerspectiveCamera`

Camera must match TRYON_CAMERA so the DOM overlay and WebGL scene agree
on how normalized landmarks map to world space.

### `src/runtime/components/VirtualTryOnExperience.vue`

#### `<TresCanvas`

Neutral tone mapping (Khronos PBR Neutral), not ACES: the
camera feed behind the canvas is untone-mapped sRGB, and
ACES' filmic curve would desaturate frame colors against it.
Neutral is near-identity in the SDR range — exactly what
e-commerce frame colors need.

#### `.vto-layer--camera-match {`

A webcam is a touch soft; only the rendered frame layer is blurred.

### `src/runtime/composables/tryon/experience/useTryOnFeatures.ts`

#### `hairOcclusionAllowed`

Hair occlusion (opt-in, high tier). The segmenter starts on the first
tracked face so it never delays the first try-on, and pauses while no face
is tracked.

### `src/runtime/composables/tryon/scene/useCameraMatch.ts`

#### `cameraMatchUniforms`

One shared uniform set, returned to `useFrameMaterials`, which patches it
into every standard/physical frame and lens material it builds. Toggling
camera match rebuilds those materials (one recompile); the amounts follow
room luma and tint through the uniforms.

#### `useLoop().onBeforeRender(() => {`

Re-seed the grain every rendered frame, like sensor noise; a fixed seed
keeps goldens stable.

### `src/runtime/composables/tryon/scene/useSceneEnvironment.ts`

#### File overview

three's own loaders instead of @tresjs/cientos: cientos ships as one
non-tree-shakeable file, so `useGLTF` + `Environment` pulled the whole
library (plus three-stdlib and camera-controls) into the host bundle. The
GLTF/Draco loaders live in the model cache.

#### `CAMERA_ENV_INTERVAL_MS`

Camera reflections (issue #84): the room sample becomes a 128×64 equirect
(utils/tryon-room `cameraEnvironment`, blended with the studio map),
PMREM-filtered at most every CAMERA_ENV_INTERVAL_MS (the sample is
smoothed anyway; ~0.3 ms per update on a laptop GPU). Without a sample
the studio map stays.

#### `const { scene, renderer } = useTres()`

Image-based lighting from an equirect HDR, set as scene.environment —
the renderer PMREM-filters equirect environments itself. If the HDR
fails to load only reflections are lost; the ambient/directional lights
still light the frame.

#### `webglRenderer`

The renderer as a WebGLRenderer, or null: PMREM filtering needs WebGL, and
Tres can also run three's WebGPU `Renderer` (the one with `isRenderer`).

#### `roomEnvironment`

Procedural room: three's RoomEnvironment PMREM-filtered once on the GPU.
No download, a few ms of GPU time; neutral soft-box reflections.

#### `radiance`

Half float: linear filtering of full floats is an extension
(OES_texture_float_linear) some GPUs lack; half floats always filter.

#### `if (!cameraEnvTarget) scene.value.environment = envTexture`

Like the HDR branch: an active camera environment stays.

### `src/runtime/composables/tryon/useTryOnLighting.ts`

#### `useTryOnLighting`

Room lighting from the camera (issue #5): while `enabled`, every
LIGHTING_SAMPLE_EVERY-th detection asks the face-landmarker worker for a
16×16 downsample of the frame (`wantFrameSample` / `onFrameSample`, wire
them into `useFaceLandmarker`), which is averaged and smoothed here into a
light gain and tint for the scene. With no sample (lighting off, or
OffscreenCanvas unavailable in the worker) the estimate stays null, which
keeps the neutral studio lighting.

#### `sample`

Sample the room even while the lighting itself is off, for `roomLuma`
(the guide's `tooDark` hint). Default: only while enabled.

#### `if (!roomAccumulator || roomAccumulator.length !== rgba.length) {`

Per-pixel EMA, at the lighting's own rate, so reflections and the light
direction don't flicker with sensor noise or a passing hand.

### `src/runtime/utils/tryon-camera-match.ts`

#### File overview

Match the webcam (issue #86): grain, a slight blur and light wrap on the
rendered frame, so it reads as filmed with the face instead of pasted on.
Pure parameters and the shader patch; no three.js objects.

A webcam frame is noisy and a little soft, worst in dim rooms; the render
is clean and sharp. Three cheap cues close the gap:
- **Grain**: per-pixel noise on the frame's materials, stronger as the
  room's luma drops (the camera's gain rises), re-seeded per video frame
  like sensor noise. Low amplitude, so a still frame doesn't shimmer.
- **Blur**: a sub-pixel CSS blur of the canvas layer, which holds only the
  frame and its shadow (the video is its own element).
- **Light wrap**: at the frame's silhouette (grazing view angles) its
  colour leans toward the room's, the way bright background light bleeds
  over an edge in a real photo.

Sources: ARKit's `cameraGrainTexture`; US11308652B2 (rendering objects to
match camera noise); Fischer et al., camera image effects for AR
compositing (TU Wien).

#### `GRAIN_RANGE`

Grain bounds: a bright room still has a little, a dark one not too much.

#### `grainAmount`

Grain amplitude for a room luma: webcam noise grows as the gain rises in
a dim room, roughly with 1/√luma (shot noise). Null luma (unsampled) keeps
the neutral amount.

#### `CAMERA_BLUR_PX`

CSS blur of the canvas layer, in CSS pixels: a webcam is a touch soft.

#### `lightWrapAt`

Light wrap weight at a view angle (`cosTheta` between the view direction
and the normal): zero face-on, `LIGHT_WRAP_STRENGTH` at the silhouette.
Its GLSL twin is `tryOnLightWrapRim` in `CAMERA_MATCH_GLSL`, which the
shader scales by the strength; `tests/glsl/shader-parity.spec.ts` checks they agree. The grain hash has no value
twin: `fract(sin(x) · 43758)` amplifies float32 `sin` error past 0.04 on
any GPU, so the spec checks only that the GPU's hash is uniform noise in
[0, 1) that changes with the seed.

#### `patchCameraMatchShader`

Patch a standard/physical material fragment shader: light wrap toward
`uCameraWrapColor` at grazing angles, then grain, scaled by the pixel's
alpha (so a semi-transparent lens gets proportionally less). Inserted
before `#include <dithering_fragment>`, after tone mapping and the
colour-space encode, so the amounts are in display terms.

#### `lightWrapColor`

The room's average colour in display terms, for the light wrap: its hue
(`tint`, brightest channel 1) at its brightness (`luma`, lifted a little
since a wrap comes from the brighter background). Neutral grey without a
sample.

### `src/runtime/utils/tryon-lighting.ts`

#### `NEUTRAL_LUMA`

Mean BT.709 luma of a neutral room; a frame at this level keeps the scene's own lighting.

#### `LIGHT_GAIN_RANGE`

Lower and upper bound on the light gain: a dark room never goes black, a bright one never blows out.

#### `LIGHTING_SAMPLE_EVERY`

One room sample every this many detections. The room light changes slowly,
and each sample costs a GPU readback (~1.2 ms in the worker), so ~7 Hz is
plenty: about 0.3 ms per detection.

#### `LIGHTING_SMOOTHING`

EMA weight of each new estimate. Low, so a passing hand or a screen flash
doesn't flicker the lighting: 0.1 per detection, compounded over the
LIGHTING_SAMPLE_EVERY detections each sample stands for, so the response
time doesn't depend on the sampling rate.

#### `tint`

Colour cast of the room, each channel 0…1 with the brightest channel at 1.

#### `peak`

Normalise by the brightest channel so the tint describes the hue of the
light, not its brightness (brightness is `luma`).

### `src/runtime/utils/tryon-room.ts`

#### File overview

The room in the lenses (issue #84): reflections built from the camera
feed, and the direction the light comes from. Pure functions, no three.js.

In the one user study on eyeglass try-on realism we know of (Zhang et al.,
IEEE CG&A 2017), reflections were the strongest realism cue. Studio HDRs
never mirror the shopper's own room; the 16×16 room sample the
face-landmarker worker already returns (utils/tryon-lighting) does. It
becomes a tiny equirect environment, the mirrored frame as the front
hemisphere and its mean as the back (as Snap's camera reflections do),
blended with the studio map so highlights keep their sparkle.

The same sample, over the face only, gives the dominant light direction
(an order-1 fit, after Knorr & Kurz, ISMAR 2014): the brighter half of the
face is toward the light. It aims the key light and the contact shadow,
so a window on the left throws the frame's shadow to the right.

Everything stays on-device: the sample is 16×16 pixels, used in memory.

#### `FrameRegion`

A region of the raw camera frame, normalized `[0, 1]` (x from the raw left).

#### `LightDirection`

Light direction in scene space (x right in the mirrored preview, y up, z toward the camera).

#### `LIGHT_DIRECTION_GAIN`

How far a fully lopsided face tips the light from frontal: luma gradient
1 (one half twice as bright as the face mean) → 60°.

#### `LIGHT_DIRECTION_DEADBAND`

Under this gradient the light reads as frontal (noise, skin tone).

#### `estimateLightDirection`

Light direction from an RGBA sample over `region` (the face): the luma
difference between its halves, left/right and top/bottom, over its mean.
Mirrored once, like the preview. Null when the region has no pixels.

#### `gx`

Raw left is the preview's right (mirror once).

#### `aimLight`

Where a light that defaults to `fallback` (unnormalized) should shine from,
leaning toward the estimated direction by its strength. Returns a unit
vector. Flat light keeps the fallback.

#### `CAMERA_ENV_WIDTH`

Size of the camera environment map (equirect). Small: it is PMREM-blurred
anyway, but not smaller, since PMREMGenerator sizes its cube at width / 4
and needs at least 16 (2^LOD_MIN) texels a face; below that the
reflections come out black.

#### `equirectDirection`

Direction of an equirect texel in three.js's convention (`equirectUv`):
u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5, rows from the bottom.

#### `cameraEnvironment`

Linear RGBA (Float32, `width × height × 4`, rows from the bottom) of an
equirect environment made from a room sample. The front hemisphere (+z,
toward the camera, what the lenses face) shows the mirrored frame as an
orthographic projection; the back is the frame's mean; they blend over
the horizon. With `studio` (same layout, linear), the result is
`studio·(1 − weight) + camera·weight`.

#### `sx`

Front: preview x (mirrored raw) ↔ +x, y up ↔ image top.

#### `y0`

At least one source texel, so a source smaller than the grid still fills it.
