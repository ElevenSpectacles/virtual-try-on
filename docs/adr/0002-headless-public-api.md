# 0002. Keep the component headless and report through slot state and track events

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Hosts own consent, copy, analytics and design, and need a stable surface to build them on.

## Decision

The component renders only the video and the tracked frame. State and actions are exposed through the slot and ref, failures and events through `track`. The module never logs.

## Consequences

Public props and types are contracts. Their documentation lives here and in the package README, not in declarations.

## Known problems in these files

- [#151](https://github.com/ElevenSpectacles/virtual-try-on/issues/151): Refactor: remove implicit setup, watcher and light ordering
- [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152): Refactor: enforce values duplicated with "keep in sync" comments
- [#159](https://github.com/ElevenSpectacles/virtual-try-on/issues/159): Performance: default HDR loads from a mutable GitHub main branch

## Detailed records

### `src/runtime/components/TryOnScene.vue`

#### `emit`

Load failures go to the parent, which reports them through `track` —
the module itself never logs.

#### `loaded`

The loaded GLB's width (bounding-box x extent), in GLB metres.

#### `snapshot`

Once at setup: renders the scene now and returns the canvas, for
`capture()`. Read the canvas in the same task (before the browser
composites), so no `preserveDrawingBuffer` is needed.

#### `const { model, temples } = useSceneModel(props, {`

The scene's parts live in composables/tryon/scene/ (not auto-imported),
called in the order their watchers, hooks and render callback must
register: the camera-match patch and the contact shadow read the lens
materials the lens watcher has just rebuilt, and the temple fit reads the
rig the model load sets.

> Known problem: [#151](https://github.com/ElevenSpectacles/virtual-try-on/issues/151). This records why the code is as it is; it does not endorse it.

#### `cameraPosition`

Tres catch-all components type vector props as raw three.js instances, so we
hand them Vector3 / Euler objects (fresh instances keep them reactive).

#### `<primitive :object="shadowLight" />`

Shadow-only light, framed on the frame each update; its target must
be in the scene graph.

#### `<TresMesh`

Contact shadow receiver: the same tracked skin, drawing only the
shadow the frame casts on it. Transparent and depth-tested without
depth writes, so the frame in front (drawn opaque) covers it.

#### `roots (see the notes in the script), drawn before the frame. -->`

Inner group: recentring offset in GLB-local metres, so it inherits
the outer group's rotation and scale (pivots with the head).

### `src/runtime/components/VirtualTryOnExperience.vue`

#### File overview

Headless virtual try-on view: renders only the mirrored camera feed and the
tracked 3D frame, sized to fill its container. It ships no UI copy, icons
or utility classes — consent, error states, positioning guidance and any
tuning controls are the host's job, built from the state and actions the
default slot (and the component ref) exposes. Slot content is rendered on
top of the feed inside the stage.

The stateful glue lives in `composables/tryon/experience/` (internal, not
auto-imported). Watchers and lifecycle hooks run in the order they register:
keep the calls below in order.

> Known problem: [#151](https://github.com/ElevenSpectacles/virtual-try-on/issues/151). This records why the code is as it is; it does not endorse it.

#### `occluder`

Explicit undefined, not Vue's absent-boolean `false`, so an omitted
prop falls through to the module option.

#### `FROZEN_GRAIN_SEED`

While frozen the camera image is a still photo: hold the grain still too,
instead of re-seeding it every render (which would shimmer over the photo).

#### `capability.resetWarmup()`

A new GLB compiles its shaders on the next frames: warm up again.

#### `frameFit.reset()`

The new frame has its own width: no verdict until its GLB has loaded.

#### `<video`

Always mounted so the webcam stream has an element to attach to;
hidden until the stream is active. Mirrored here and only here
(see landmarkToNdc).

#### `<style scoped>`

Structural styles only (stacking, mirroring, fill) — no visual design.
The host sizes the component; the stage fills it.

### `src/runtime/composables/tryon/experience/useTryOnTrackEvents.ts`

#### `if (change.previousTier === null) return`

The initial classification is reported with TRY_ON_FACE_DETECTED,
which fires after consent. Only step-downs need an event of their own.

#### `hasReportedFaceDetected`

Reset by `start()` for each consented session.

#### `reportedCalibration`

A bad calibration entry is reported once per model (the frame still
renders, with the invalid fields at their defaults).

### `src/runtime/composables/tryon/experience/useTryOnTracking.ts`

#### `if (cardCalibration.calibration.value.status === 'detecting') cardCalibration.ca`

A calibration needs live frames; drop it rather than let it time out.

### `src/runtime/types/tryon-experience-props.ts`

#### `autoStart`

Start the camera as soon as the component mounts. Use when the host
already collected consent (e.g. its own privacy step); otherwise call
the exposed `start()` from the host's consent UI.

#### `mediapipeBasePath`

Directory the MediaPipe Wasm fileset is served from. Omit to use the
built-in jsDelivr CDN default; pass a same-origin path (e.g.
`/mediapipe/wasm`) to self-host and drop the CDN dependency.

#### `dracoDecoderPath`

Draco decoder path override — omit to use the gstatic CDN default.

#### `occluder`

Hide frame parts behind the head (the far temple) with the face-mesh
occluder. Omit to use the module option `virtualTryOn.occluder`
(default `true`).

#### `adaptiveLighting`

Light the frame from the room the camera sees (estimated luma and
colour cast). Off keeps the fixed studio lighting. Also needs the
`mid` tier or higher.

#### `contactShadow`

Soft shadow of the frame on the tracked skin under the bridge and
lenses. Needs the face-mesh occluder and the `mid` tier or higher.

#### `fitTolerance`

Half-width of the "good fit" band of the fit verdict, as a fraction of
the ideal frame width for the tracked face (default 0.06). Until the
PD is measured the face estimate assumes an average IPD (about ±5%),
so tighter bands mostly add noise.

#### `trueToSize`

Show the frame at its real size: measure the shopper's PD against the
iris (on-device, over the first seconds of frontal tracking) and size
the frame and the fit verdict from it instead of population averages.
Off keeps the average-face sizing.

#### `physicalLens`

Physically-based lenses: Fresnel opacity, reflections that add on top
of the tint, an AR-coating sheen. Off keeps the cheaper standard lens.
Also needs the `mid` tier or higher.

#### `hairOcclusion`

Hide the temple arms behind hair that hangs over them: a hair
segmenter (its own worker, ~0.8 MB model, loaded on the first tracked
face) masks the arms where the camera sees hair, so the real hair
shows in front. Opt-in, because a 2D mask can't tell hair over an arm
from hair under it, and arms usually rest on top of hair. Needs the
occluder and the `high` tier, and switches itself off for the session
if segmentation is too slow.

#### `mediapipeHairModelAssetPath`

URL/path of `hair_segmenter.tflite`, to self-host it.

#### `tintedLensShadow`

Add the lenses' shadow, in their colour: a brown lens throws a warm
shadow, a green one a green shadow. Without it lenses cast no shadow (a
colourless one reads as a grey patch on the cheek). Costs a second shadow map and a
camera-texture upload per frame, so it is opt-in and needs the `high`
tier and `contactShadow`.

#### `templeEarBend`

Bend the temple tips down behind the ears, as an optician fits a
frame. Visible when the shopper turns to see the temples. Off keeps
the straight authored tips.

#### `environmentUrl`

URL of the equirect `.hdr` environment map, to self-host it. Omit for
the built-in preset (GitHub raw CDN). The `low` tier uses a procedural
environment instead and downloads nothing.

#### `roomReflections`

Reflect the shopper's own room in the lenses (the camera's view,
blended with the studio environment) and aim the key light and the
contact shadow at where the room's light comes from. Needs
`adaptiveLighting` (and so the `mid` tier). On-device: it uses the
16×16 room sample the lighting already takes.

#### `cameraMatch`

Make the frame look filmed with the face: grain that grows in dim
rooms, a sub-pixel blur, and light wrap at its edges. Needs the `mid`
tier or higher.

### `src/runtime/types/tryon-experience.ts`

#### `TryOnMeasurements`

On-device face measurements for frame-advisor UIs (issue #98). Everything
stays in the browser; only coarse classes are reported on `track`.

#### `pdMm`

Distance PD, mm (iris-measured, see `trueToSize`); null until measured.

#### `faceWidthMm`

Ear-level face width, mm (the fit verdict's measure); null until stable.

#### `confidence`

0 … 1: how far the PD measurement has come (1 once it froze).

#### `faceShape`

Coarse face shape, a styling hint (never a filter); null until about
1.5 s of frontal tracking.

#### `faceShapeConfidence`

0 … 1: margin of `faceShape` over the next-closest class.

#### `fit`

Whether the selected frame suits the tracked face's width, with the
two widths in mm. Null until about a second of tracking has given a
stable estimate, and while no face is tracked.

#### `measurements`

On-device face measurements: PD, face width, face shape. Null until
something is measured.

#### `calibration`

Card calibration: `{ status, progress, pdMm }` ('idle' until started).

#### `capture`

Snapshot of the composited try-on as an image Blob (on-device).

### `src/runtime/types/tryon-scene-props.ts`

#### File overview

Props of `<TryOnScene>`, the TresJS scene inside `<VirtualTryOnExperience>`
(and the playground's prototype). The defaults stay inline in the
component's `withDefaults`, so its runtime props declaration is unchanged.

#### `position`

World-space position of the frame on the camera plane.

#### `scale`

Uniform scale (GLBs are modelled in metres).

#### `rotationY`

Yaw (radians) so the lenses can be faced at the camera.

#### `rotation`

Full Euler rotation (radians). Overrides rotationY when provided.

#### `environmentUrl`

URL of an equirect `.hdr` to use instead of the `envPreset` file, to
self-host it. Ignored with `proceduralEnvironment`.

#### `proceduralEnvironment`

Use three's procedural `RoomEnvironment` (generated on the GPU, no
download) instead of an HDR file. For low-tier devices, where the
1.6 MB preset costs more first-load time than its reflections are worth.

#### `occluderPositions`

Per-frame world-space vertices of the landmark-built face mesh (see
`buildFaceMeshOccluderPositions`). When present this replaces the
ellipsoid proxy — the mesh hugs the tracked face surface, so temple
arms are occluded exactly where the real head would occlude them.

#### `templeFit`

Open the temple arms at the hinge to meet the side of the tracked head
(utils/tryon-temples). Needs `occluderPositions`; off keeps them as
authored.

#### `templeEarBend`

Bend the temple tips down behind the ear, as an optician fits them
(utils/tryon-temples, `earBendPoint`). Shows on profile views. Needs
`templeFit`; off keeps the straight authored tips.

#### `lightGain`

Multiplier on the key, fill and ambient lights, from the room's
estimated luma. 1 keeps the fixed studio lighting.

#### `lightTint`

Colour cast of the room, each channel 0…1. White keeps the lights neutral.

#### `roomSample`

Smoothed 16×16 room sample (utils/tryon-room): reflections from the
camera, blended with the studio environment. Null keeps the studio map.

#### `cameraMatch`

Grain and light wrap on the frame (utils/tryon-camera-match), so it
reads as filmed with the face. The CSS blur is the host canvas's.

#### `grainSeed`

Fixed grain seed (goldens); omit to re-seed every frame like sensor noise.

#### `contactShadow`

Soft shadow of the frame on the tracked face mesh (shadow map from the
key light, see utils/tryon-contact-shadow). Needs `occluderPositions`;
the host canvas must have shadows enabled.

#### `tintedLensShadow`

Add the lenses' shadow, in their colour (utils/tryon-lens-shadow); off,
lenses cast none. Lenses cast into their own shadow map, and the receiver samples the
camera (`videoElement`) for the colour. Needs `contactShadow`.

#### `modelOffset`

Calibration recentring offset in the GLB's own (pre-scale) metre
space. Applied INSIDE the rotated group so it pivots with the head.

#### `visible`

Hide the frame (and occluder) without unmounting — used when face
tracking momentarily loses the face so the glasses don't freeze mid-air.

#### `draco`

Whether the loader wires up Draco decompression support. Harmless to
leave on for uncompressed GLBs — GLTFLoader only invokes the decoder
when a mesh actually carries the `KHR_draco_mesh_compression`
extension.

#### `modelCache`

Parsed-GLB cache shared with the parent (instant switching, prefetch).
Omit for a cache of this scene's own (`draco` and `dracoDecoderPath`
apply to it; a passed cache brings its own).

#### `hairMask`

Hair confidence of the camera frame (see `useHairSegmenter`): temple
arm parts behind the temple roots are not drawn where it says hair,
so the camera's hair shows in front of them. Null turns it off.
