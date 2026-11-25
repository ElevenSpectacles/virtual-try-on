# 0016. Degrade by capability and keep first load off the critical path

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Device signals are incomplete, effects vary in cost, and model and WASM downloads dominate first load.

## Decision

Unknown devices start at mid and only step down. The tracker loads beside the camera prompt. Origins are preconnected, parsed GLBs are cached and neighbours are prefetched when idle.

## Consequences

New expensive features need a minimum tier. Metrics stay aggregate and opt-in.

## Known problems in these files

- [#147](https://github.com/ElevenSpectacles/virtual-try-on/issues/147): Performance: FRAME_BUDGET_MS is still a placeholder
- [#151](https://github.com/ElevenSpectacles/virtual-try-on/issues/151): Refactor: remove implicit setup, watcher and light ordering
- [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152): Refactor: enforce values duplicated with "keep in sync" comments

## Detailed records

### `src/runtime/components/VirtualTryOnExperience.vue`

#### `capability`

Frames count toward the step-down only while a face is tracked, so idle
camera time never looks like a slow device.

### `src/runtime/composables/tryon/experience/useTryOnFeatures.ts`

#### `useTryOnFeatures`

Which optional features run. Each runs only when the host opted in AND the
device tier allows it (`useCapabilityTier`); the occluder's opt-in comes
from the prop, then the module option, then `true`. Room reflections
(`roomReflections`) ride on the lighting: useTryOnLighting keeps the room
sample only while the lighting runs. Also owns the hair segmenter (opt-in,
high tier) with its read-only state (`hair`), the contact shadow's
strength, and the `features` block of the `metrics` report (`snapshot`).

### `src/runtime/composables/tryon/experience/useTryOnModelSwitch.ts`

#### `preloadPerSide`

Parsed-GLB cache (issue #94): switching back to a frame, or to a
prefetched neighbour, mounts it at once. Prefetch runs only while a face is
tracked, so it never competes with the first frame or loads anything
before the camera starts; the low tier keeps two GLBs and never prefetches.

#### `modelLoaded`

True once the shown frame's GLB is mounted; false from a switch until the
new one is. Read-only on the component ref, for a host's loading state and
for the e2e readiness waits.

#### `preloadModel`

Fetch and parse a frame ahead of a likely switch (e.g. hover on a swatch),
in idle time. Unknown files are ignored.

### `src/runtime/composables/tryon/experience/useTryOnSession.ts`

#### `trackerRequestedAt`

Time to first frame (issue #95). The tracker (MediaPipe Wasm + face
model, the largest first-load cost) starts loading with `start()` or
`prefetch()`, in parallel with the camera permission prompt and stream
start, instead of after the stream is up.

#### `prefetch`

Warm up before the shopper taps "Try on" (e.g. on hover of the button):
loads the face tracker. Does not touch the camera, so it needs no consent;
it does download the MediaPipe Wasm and model.

#### `useHead({`

Open connections to the default CDNs early (skipped for self-hosted
assets), while the shopper reads the consent screen.

#### `grantedAt`

Camera granted → first rendered frame on a face, once per camera session.

#### `requestAnimationFrame(() => metrics.onFirstFrame(performance.now() - since))`

The frame is on screen once the next frame has been drawn.

#### `initTracker()`

Already loading since `start()`; this covers a retry after a failure.

### `src/runtime/composables/tryon/experience/useTryOnSessionMetrics.ts`

#### `tracking`

The raw tracker has a face (not the held one): a dropout counts as lost.

#### `useTryOnSessionMetrics`

Session metrics for the `metrics` event (opt-in): every 30 s of camera
time, and once more when the camera stops. With reportMetrics off there is
no accumulator and no extra frame loop, so there is no cost to hosts that
don't use it. Returns the accumulator (null when off) for the component's
other hooks (latency, tier, asset timings, model switches), and
`watchSessionEnd`, which registers the final report.

### `src/runtime/composables/tryon/scene/useBoundingBoxHelper.ts`

#### `watch(boundingBoxHelper, (_helper, previous) => previous?.dispose())`

`<primitive>` objects are never disposed by Tres, so free the previous
helper's geometry/material whenever it is rebuilt or toggled off.

### `src/runtime/composables/tryon/scene/useSceneModel.ts`

#### `localBounds`

The GLB's local-space bounding box: the debug helper
(`useBoundingBoxHelper`), and the frame width the fit verdict compares
with the face. Calibration y-centers the bbox on the tracked anchor and
places the frame's FRONT face on it in z (the frame extends backward
toward the temples), so this box shows exactly what the calibration
anchors against. The box is accumulated relative to the GLB scene root
(not via `setFromObject`, which measures in world space and would
double-apply the group transform once the scene is mounted).

#### `model`

Non-blocking loader: `model` is null until the first GLB resolves, so a
heavy frame download never stalls the whole scene graph. On a model switch
the previous frame stays up until the next one arrives; responses for a
superseded `src` are dropped.

#### `for (const temple of rig?.temples ?? []) temple.pivot.rotation.z = 0`

A cached frame keeps its last opening: start from the GLB's own.

### `src/runtime/composables/tryon/useCapabilityTier.ts`

#### `forcedTier`

Pin the tier while it returns a value: no step-down, and the device
classification is ignored. Read reactively, so setting or clearing it
after mount takes effect. Clearing returns to the device's own tier.
For tests and goldens.

#### `sampling`

Whether frames count right now: camera active and a face tracked. Frames
are sampled only while this is true, so idle time never counts as slow.

#### `gl.getExtension('WEBGL_lose_context')?.loseContext()`

Release the probe context now; browsers cap live WebGL contexts.

#### `useCapabilityTier`

The device capability tier and the features it allows, with a step-down
when the frame p95 stays over budget. Call from component setup: it
registers a frame loop, a watcher and an `onMounted` probe.

The tier starts at `mid` on the server and before mount, then is set from
the device probe in `onMounted`. It only steps down during a session.

#### `deviceTier`

The device's own classification, kept so clearing a forced tier can return to it.

#### `watch(forcedTier, (value) => {`

A forced tier pins the sampler; clearing it resumes from the device tier.
No onChange here: a forced tier is the host's own choice, not a measured step.

#### `sampling`

A hidden tab resumes with one huge delta and throws frames away, so
it is not sampled.

#### `resetWarmup`

Restart warm-up. Call when the model changes, before the new GLB compiles.

#### `allows`

Whether `feature` runs at the current tier. Opt-in is checked by the caller.

### `src/runtime/composables/tryon/useTryOnElementSize.ts`

#### `useTryOnElementSize`

Reactive content-box size of an element, tracked with a ResizeObserver.
Stays `0 × 0` until the element mounts, and where ResizeObserver doesn't
exist (SSR).

The module's own replacement for VueUse's `useElementSize` (see
`useTryOnFrameLoop`).

### `src/runtime/composables/tryon/useTryOnFrameLoop.ts`

#### `useTryOnFrameLoop`

Run `callback` once per animation frame with the milliseconds elapsed since
the previous frame (0 on the first), until the calling scope is disposed.
A no-op where `requestAnimationFrame` doesn't exist (SSR).

The module's own replacement for VueUse's `useRafFn`, so hosts don't have
to provide a matching VueUse major. Prefixed to stay clear of host
auto-imports.

### `src/runtime/composables/tryon/useTryOnModelCache.ts`

#### `DEFAULT_DRACO_DECODER_PATH`

Same decoder build cientos defaulted to, so self-hosting paths carry over.

#### `draco`

Wire up Draco decompression (harmless for uncompressed GLBs). Default on.

#### `disposeModel`

Free a GLB's GPU resources: geometries, the authored materials (built lens
materials are freed by the scene that built them) and their textures.

#### `id`

Safari before 18 has no requestIdleCallback.

#### `useTryOnModelCache`

Parsed-GLB cache (issue #94): every frame is fetched, parsed and rigged
once, kept in an LRU (disposed on eviction), and shared by concurrent
loads. `prefetch()` warms it in idle time, one GLB at a time, so it never
competes with the frame on screen. The frame on screen (`setActive`) is
never evicted.

Client-only: the loaders are created on the first load.

#### `pending.catch(() => {`

A failed load is not cached: the next request retries.

#### `})`

A failed prefetch is retried on demand; nothing to report.

#### `prefetch`

Fetch and parse `srcs` in idle time, in order. Replaces any queued
prefetch that has not started.

### `src/runtime/types/tryon-experience-props.ts`

#### `tier`

Pin the device capability tier (`low` | `mid` | `high`). Omit to
classify the device and step down under sustained frame-time load.
Forcing a tier disables the step-down, so tests and goldens stay
deterministic.

#### `reportMetrics`

Emit `metrics` events (aggregated session numbers, no image data): every
30 s while the camera is on, and once more when it stops. Read once at
setup. Off by default, so nothing is measured or emitted.

#### `preload`

Frames to prefetch on each side of the active one in `models` (its
neighbouring colourways), in idle time once a face is tracked, so
switching to them is instant. `false` or 0 turns it off. The low tier
never prefetches.

### `src/runtime/utils/tryon-capability.ts`

#### File overview

Device capability tiering: one policy that decides which expensive
rendering features run on this device, and when a running session steps
down to a cheaper tier.

Pure functions only (no Vue, no DOM) so the tier mapping and the step-down
logic are unit-testable. Browser signals are read in
`composables/tryon/useCapabilityTier.ts`.

Tiers are ordered `low < mid < high`. A feature is allowed when the device
tier is at or above its minimum tier in `FEATURE_MIN_TIER`.

#### `FEATURE_MIN_TIER`

Lowest tier that runs each feature — the single place that decides what a
feature costs.

#### `physicalLens`

Fresnel opacity, clearcoat and thin-film sheen on the lens pixels only.

#### `tintedLensShadow`

A second shadow map for the lenses and a camera-texture upload per
frame (the cost the iOS Safari segment can't spare).

#### `cameraMatch`

Grain and light wrap in the frame's shaders, a CSS blur of the canvas.

#### `FRAME_BUDGET_MS`

Frame budget: 33 ms is 30 fps, the target on the mid tier. Placeholder
until the baseline measurement in umbrella #4 fills in agreed thresholds.

> Known problem: [#147](https://github.com/ElevenSpectacles/virtual-try-on/issues/147). This records why the code is as it is; it does not endorse it.

#### `FRAME_WINDOW_SIZE`

Rolling window of frame deltas the p95 is taken over (~4 s at 30 fps).

#### `WARMUP_MS`

Sampled time after start or a model switch during which frames are
ignored: shader compile, GLB load and first-detection setup all look like
slow frames.

#### `MAX_FRAME_GAP_MS`

A frame delta above this is a stall (hidden tab, debugger pause, GC
hitch), not a slow frame. It is dropped and clears the over-budget timer.

#### `webgl2`

WebGL2 available. three has no WebGL1 renderer, so false means no try-on.

#### `deviceMemoryGb`

`navigator.deviceMemory` in GB. Chromium only: undefined on Safari and
Firefox, which must not be read as a low-memory device.

#### `classifyTier`

Classify the device from its static signals. Each known signal votes for
a tier and the lowest vote wins, so one weak signal caps the device.

Missing signals are ignored, and with no usable signal the result is
`mid`, not `low`: a browser that hides its memory and texture limits (every
iPhone for `deviceMemory`) must not be pinned to the floor.

`hardwareConcurrency` is deliberately not a vote. Browsers clamp it
(Safari), so it can't tell a slow device from a masked fast one.

#### `TierSampler`

Mutable step-down state, advanced one frame at a time by
`advanceTierSampler`. Mutated in place: it runs once per animation frame,
so copying the window each time would be wasted work.

#### `resetTierSampler`

Restart warm-up and drop the window, keeping the current tier. Call on a
model switch, since loading and compiling the new model is not a frame cost.

#### `advanceTierSampler`

Feed one frame delta. Returns the step when the tier drops, else null.

- `frameMs` null means "not sampling" (camera off, no face, hidden tab);
  it clears the over-budget timer, so a gap never counts toward a step-down.
- The first frame reports 0 and is skipped without touching the timer.
- The tier only steps down, one tier at a time, and never below `low`.
  There is no step back up, so the tier cannot oscillate mid-session.
- After a step the window is cleared, so the new tier is judged on its own
  frames, not the ones that caused the step.

### `src/runtime/utils/tryon-metrics.ts`

#### `TryOnAsset`

Session metrics for the host's analytics: aggregated numbers only, with no
frames, landmarks or other image-derived data.

Pure functions only (no Vue, no DOM). The component feeds it frame deltas,
detection latencies and events; it returns a snapshot the host can forward.

#### `activeMs`

Camera-on time in milliseconds. Stalls longer than MAX_FRAME_GAP_MS are excluded.

#### `timeToFirstTrackMs`

Active time until the first tracked face, or null if none was tracked.

#### `timeToFirstFrameMs`

Camera granted → first rendered frame on a face (wall clock), or null
until then. The headline first-load number (issue #95).

#### `assetTimings`

How long each first-load asset took, ms, null until it loaded: the
tracker (MediaPipe Wasm + face model, from `start()`), the first frame
GLB, and the environment map.

#### `modelSwitchMeanMs`

Mean time from a frame switch to the new frame on screen (a cached or
prefetched GLB shows at once), or null before any switch.

#### `endedWithoutTrack`

The session never tracked a face and the user never switched frames: the
"looked broken" proxy.

#### `onFirstFrame(ms: number): void`

Camera granted → first frame on a face, ms. Only the first call counts.

#### `onAssetTiming(asset: TryOnAsset, ms: number): void`

Load time of a first-load asset, ms. Only the first call per asset counts.

#### `if (deltaMs <= 0 || deltaMs > MAX_FRAME_GAP_MS) return false`

Frames the browser stalled (hidden tab, debugger) are not frames the
user saw, so they count toward neither the time nor the frame rate.

#### `nextReportAtMs = METRICS_INTERVAL_MS`

`tier` is kept: it describes the device, not the session.

#### `timeToFirstFrameMs = null`

First-load timings stay: they describe how this page loaded, and a
restart of the camera reuses the loaded assets. The next session's
time to first frame is measured again.

#### `final`

True on the report sent when the camera stops or the component unmounts.

### `src/runtime/utils/tryon-model-cache.ts`

#### File overview

Instant frame switching (issue #94): an LRU of parsed GLBs and the order in
which to prefetch a model's neighbours. Pure (no three.js, no Vue), so the
eviction and the neighbour order are unit-tested.

#### `createLruCache`

Least-recently-used cache with a capacity in entries. `dispose` runs on
every value that leaves (evicted, replaced, deleted, cleared). `pinned`
keys are never evicted (the frame on screen): the cache may then run over
capacity until they are unpinned.

#### `neighbourFiles`

Files to prefetch around `active` in catalog order: the next and previous
models first (usually the neighbouring colourways), then one further out
each side, up to `perSide` each way. No wrap-around.

#### `modelCacheCapacity`

Cache capacity per tier: low-tier devices keep the current frame and one more.

#### `return Math.min(Math.max(2 + 2 * preload, 4), 6)`

The frame on screen, its neighbours, and room for the one just left.

### `src/runtime/utils/tryon-preconnect.ts`

#### File overview

Time to first frame (issue #95): which third-party origins the try-on will
fetch from, so the component can open their connections early with
`<link rel="preconnect">`. Pure, no Nuxt.

First load pulls the MediaPipe Wasm (jsDelivr), the face model (Google
Storage), the Draco decoder (gstatic) and the environment HDR (jsDelivr,
pinned to a Tresjs/assets commit so the bytes never change under a release).
A cold TLS handshake to each costs one to three round trips; preconnecting
while the shopper reads the consent screen takes that off the critical
path. An origin a host self-hosts (its path option is set) is left out.

The defaults live in the workers, the model cache and the scene; a unit
test keeps these origins in step with them.
