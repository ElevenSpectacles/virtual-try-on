# 0004. Detect once per camera frame, with one request in flight

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Display refresh outpaces the camera, and queued detections add visible latency.

## Decision

Detection follows `requestVideoFrameCallback`, sends downscaled bitmaps, allows one outstanding request and discards stale results. Freeze detects the held frame once.

## Consequences

A slow device lowers the detection rate instead of growing a queue. Smoothing has to bridge detections.

## Known problems in these files

- [#148](https://github.com/ElevenSpectacles/virtual-try-on/issues/148): Bug: a rejected video.play() leaves the camera active with no recovery
- [#149](https://github.com/ElevenSpectacles/virtual-try-on/issues/149): Bug: worker, observer and calibration-load failures are silent

## Detailed records

### `src/runtime/composables/tryon/useFaceLandmarker.ts`

#### `onFrameSample`

Receives each requested downsample, made in the worker after the
landmarks so it costs the render thread nothing. `sampleMs` is the time
the worker spent on it.

#### `wantCardRegion`

Region of the frame (normalized) to crop for card calibration with the
next detection, or null. While it returns a region, frames go to the
worker at full camera resolution, so the card's edges are sharp.

#### `supportsMediaPipe`

Capability check: can this browser run detection off the main thread?

WebAssembly is the hard requirement for MediaPipe itself; `Worker` +
`createImageBitmap` are required to hand video frames to it without
touching the DOM from the worker.

#### `useFaceLandmarker`

MediaPipe Face Landmarker integration for the virtual try-on. Detection
runs in a dedicated Worker (`face-landmarker.worker.ts`) so the heavy
synchronous `detectForVideo()` call never blocks the main thread's render
loop; each frame is handed over as a transferable `ImageBitmap` and only
the small landmark/matrix result comes back.

#### `CONFIDENCE_HISTORY_SIZE`

MediaPipe FaceLandmarker does not reliably populate per-landmark
visibility in video mode, so confidence is derived from detection
stability over a short rolling window instead.

#### `anchor`

The anchor point used to position the frame — a centroid of the
configured indices (nose-bridge ridge + inner eye corners by default),
falling back to the first landmark if none of them are present.
/

#### `nextRequestId`

In-flight request bookkeeping: one outstanding detect call at a time,
keyed by id so a stale response can never clobber a newer one.

#### `LATENCY_EMA_ALPHA`

Measured camera→result round-trip latency (EMA), exposed so the smoothing
layer can extrapolate the pose forward by roughly this much and cancel the
pipeline delay instead of rendering where the head *was*. EMA alpha is
deliberately low — a single GC pause or background-tab hiccup shouldn't
swing the prediction horizon.

#### `case 'sample':`

Downsamples arrive after their result and are not part of the
one-in-flight handshake: a late one is still a valid room sample.

#### `DETECT_MAX_WIDTH`

Detection input is downscaled before it crosses to the worker: the face
landmarker resizes every frame to its internal ~192px input anyway, so
shipping a full 1280×720 bitmap per detection only buys transfer and
preprocessing overhead. Landmarks come back normalized, so precision is
unaffected. The visible preview stays full-resolution. 480px and
'low'-quality (box) resize keep the capture+detect cycle short enough to
sustain the camera's 30fps cadence — a slower cycle is felt directly as
tracking delay.

#### `detect`

Send the current video frame for detection. Returns the request id, or
null when nothing was sent. `held` also detects a paused video (the
frame `freeze()` holds); the loop never does.

#### `if (pendingRequestId !== null) return null`

One outstanding detect at a time — a slow frame naturally throttles
the request rate instead of queueing stale work behind it.

#### `if (!worker.value || pendingRequestId !== id) {`

The face-landmarker may have been torn down while the bitmap was
being created (e.g. component unmount mid-frame).

#### `detectHeld`

Detect the frame the video shows now, even when paused, and resolve
once its landmarks are applied (immediately when the tracker isn't
running). Used by `freeze()`, so the held pose is the held frame's, not
the previous frame's. Waits for an in-flight request first.

#### `loopActive`

Detect-loop scheduling: prefer requestVideoFrameCallback so detection
runs once per *produced video frame* (30–60fps depending on the camera)
instead of once per rAF (60–120Hz). Halving or quartering the detect rate
costs nothing — MediaPipe + smoothing interpolate fine at 30fps — while
freeing the render thread. The callback timestamp is deliberately NOT
used as the MediaPipe timestamp: a camera stop/start resets mediaTime,
and MediaPipe throws on non-monotonic timestamps, so detect() always
stamps frames with performance.now().

The rVFC-with-rAF-fallback choice lives in utils/tryon-frame-schedule.ts.

### `src/runtime/composables/tryon/useTryOnFreeze.ts`

#### `useTryOnFreeze`

Freeze / unfreeze (issue #97): hold the camera frame and the pose, so
frames can be compared on the same face.

Freezing pauses the `<video>`: the preview keeps showing that frame, and
the detect loop (and the hair segmenter) stop on their own, since both
schedule on delivered video frames and skip a paused video — the worker
sits idle. Before the freeze takes effect, the held frame itself is
detected once, so the pose the frame renders with belongs to the frame
on screen, not to the one before it. While frozen the landmarks don't
change, so a model switch renders the new frame exactly where the old one
sat (the occluder and shadow keep the held face too). Unfreezing plays the
video; detection resumes on its next frame.

#### `if (id === generation && video.paused) frozen.value = true`

An unfreeze (or camera stop) while the held frame was detected wins.

### `src/runtime/composables/tryon/useWebcamStream.ts`

#### `useWebcamStream`

Front-camera stream lifecycle for the virtual try-on.

Requests `facingMode: 'user'` (the front camera — the UX is judged on a
phone in portrait, not a desktop webcam) and hands back a `videoRef` to bind
to the mirrored `<video>` element. Cleans the stream up on unmount so the
camera light is never left on.

Mirroring is a *display* concern handled in CSS on the video element; this
composable deals only with acquiring the raw stream.

#### `frameRate`

Tracking latency is bounded below by the camera frame interval —
at the default 30fps every pose update is up to 33ms stale before
detection even starts. `ideal` (not `exact`) so devices without a
60fps front-camera mode silently keep their native rate.

### `src/runtime/utils/tryon-frame-schedule.ts`

#### File overview

Camera-paced scheduling for detection: run a callback once per camera frame
the video element presents, instead of once per display refresh.

`HTMLVideoElement.requestVideoFrameCallback` fires once per delivered video
frame. rAF is display-paced (60–120 Hz), so on a fast screen it would
re-detect the same camera frame several times. Where rVFC is missing (older
Safari) the callback falls back to rAF.

rVFC isn't in every TS lib.dom yet, so the element is typed structurally.
The frame-request functions are injectable so this stays unit-testable.
