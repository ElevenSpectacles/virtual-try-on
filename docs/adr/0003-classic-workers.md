# 0003. Run MediaPipe in import-free classic workers, on the device

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

MediaPipe's WASM loader needs synchronous `importScripts`, detection blocks, and camera frames must not leave the browser.

## Decision

Tracking and hair segmentation each run in a classic worker with no static import or export. Frames are transferred, and only derived results or small samples come back.

## Consequences

Worker message types are duplicated. The WASM version must equal the pinned package version.

## Known problems in these files

- [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152): Refactor: enforce values duplicated with "keep in sync" comments

## Detailed records

### `src/runtime/composables/tryon/useFaceLandmarker.ts`

#### `instance`

Classic (non-module) worker: MediaPipe's own WASM/script loader
relies on synchronous `importScripts`, which module workers don't
support — it falls back to a broken `self.import` shim there and
throws "e is not a function" before any CDN fetch happens.

### `src/runtime/types/face-landmarker-worker.ts`

#### File overview

Message types shared between the main thread and
`workers/face-landmarker.worker.ts`, kept out of the worker because it
is built as a classic (non-module) worker: any top-level `export` in the
worker's own source — even a type-only one that's erased at runtime —
makes the compiler emit a trailing `export {}` marker in the bundled
output, which is a syntax error outside a module worker.

#### `card`

Also send back a grey crop of this region of the frame (a `card`
message after the result), for card calibration. Normalized `[0, 1]`.

#### `blink`

max(eyeBlinkLeft, eyeBlinkRight) blendshape score, 0 open … 1
closed; null when the model emits no blendshapes.

#### `pixels`

RGBA bytes, `width * height * 4`.

#### `gray`

Grey bytes (luma), `width * height`, row-major from the top.

### `src/runtime/types/hair-segmenter-worker.ts`

#### File overview

Message types shared between the main thread and
`workers/hair-segmenter.worker.ts`. Kept out of the worker for the same
reason as `face-landmarker-worker.ts`: the worker is a classic worker
and must not contain any `export`. Keep the inline copy in the worker in
sync.

> Known problem: [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152). This records why the code is as it is; it does not endorse it.

#### `confidence`

Hair confidence 0…1 per pixel, row-major from the top (a copy).

### `src/runtime/workers/face-landmarker.worker.ts`

#### File overview

Dedicated worker running MediaPipe FaceLandmarker's synchronous
`detectForVideo` calls off the main thread. The main thread grabs each
video frame as a transferable `ImageBitmap` and posts it here; only the
small landmark/matrix result comes back, so the worker never touches the
DOM. On request it also sends back a 16×16 RGBA downsample of the frame
for the room-lighting estimate: reading pixels back from a GPU-backed
bitmap costs about a millisecond, which belongs here, not on the render
thread.

#### `FaceLandmarkerWorkerRequest`

Classic (non-module) worker: this file must contain zero static
`import`/`export` syntax. esbuild treats any top-level import/export as an
ES module and appends a trailing `export {}` marker to the bundle — a hard
SyntaxError outside a module worker — even for a type-only `import type`.
The request/response types are therefore duplicated here (source of truth
lives in `../types/face-landmarker-worker`, consumed via normal import by
the main-thread composable) instead of imported.

#### `faceLandmarker`

The landmarker is created in VIDEO mode and never leaves it — the camera
is the only input source.

#### `SAMPLE_SIZE`

Side of the lighting downsample. 16×16 is 256 pixels: enough for a mean
luma and colour cast (see utils/tryon-lighting).

#### `sampleContext`

undefined until first use; null when OffscreenCanvas 2D is unavailable.
A sample or card crop that can't be taken (no context, a throwing
readback) posts `observer_failed` instead of being dropped: detection
carries on, and the main thread reports each observer once
(`TRY_ON_ERROR`, source `room_lighting` or `card_calibration`).

#### `destroy`

A throwing `close()` on destroy is not reported: the main thread terminates
the worker right after posting `destroy`, so a reply could never arrive,
and terminating frees the WASM heap either way.

#### `postSample`

Draw the frame into a 16×16 canvas and read it back. The readback waits
on the GPU (the bitmap is GPU-backed and MediaPipe has just queued work),
about 1.2 ms on a laptop; it runs here, after the result is posted, and the
main thread asks for one sample every LIGHTING_SAMPLE_EVERY detections.
(A GPU-side `createImageBitmap` resize first was slower: 2.5 ms.)

#### `DEFAULT_WASM_BASE_PATH`

Defaults used when the host doesn't pass a self-hosted path — kept as the
fallback rather than a hard requirement, since FilesetResolver.forVisionTasks
accepts any basePath (see docs on the class) and modelAssetPath is just a
URL/path string.
The WASM must match the bundled JS exactly: keep this version equal to the
pinned `@mediapipe/tasks-vision` dependency (enforced by a unit test).

#### `outputFaceBlendshapes`

Only eyeBlinkLeft/Right are read (see `blinkScore`): calibrated
blink scores that stay valid while the eyelid hides the iris.

#### `cpu`

GPU delegate needs OffscreenCanvas/WebGL2 in-worker support; fall back to CPU when that is unavailable.

#### `blinkScore`

Stronger of the two eye-blink blendshapes (0 open … 1 closed), or null
when the model emitted no blendshapes (e.g. a self-hosted model without
the blendshape head) — callers fall back to the landmark heuristic.

#### `if (sample) postSample(id, bitmap)`

After the result, so the downsample never delays the landmarks.

### `src/runtime/workers/hair-segmenter.worker.ts`

#### File overview

Dedicated worker running MediaPipe's hair segmenter for the hair occluder
(issue #9; see utils/tryon-hair.ts). Separate from the face-landmarker
worker so segmentation never delays tracking, and so a failure here only
switches hair occlusion off.

Same constraints as face-landmarker.worker.ts: a classic worker with zero
static `import`/`export` (MediaPipe's loader needs `importScripts`), message
types duplicated from `../types/hair-segmenter-worker` (keep in sync).

#### `DEFAULT_WASM_BASE_PATH`

Must match the face-landmarker worker's (and the pinned
`@mediapipe/tasks-vision`; enforced by tests/unit/mediapipe-version.test.ts).

#### `DEFAULT_MODEL_ASSET_PATH`

The hair-only model (782 KB, 512² input, labels background/hair), not the
16 MB multiclass selfie model: this is a download on every phone that
turns the feature on.

#### `instance`

GPU only. A CPU segmenter is too slow to be worth the frames it would
cost; failing here just switches hair occlusion off.

#### `segmenter.segmentForVideo(bitmap, timestamp, (result) => {`

Callback form: the masks belong to the task and are freed when the
callback returns, so the confidence is copied out inside it (it may
be a view on Wasm memory, which must never be transferred).
