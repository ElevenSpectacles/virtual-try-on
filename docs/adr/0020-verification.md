# 0020. Verify locally on fixed fixtures, with real and software GL

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

MediaPipe needs a real GPU, pixel goldens need a stable renderer, and some footage cannot be redistributed.

## Decision

Tracking uses the real GPU and fake-camera clips. Frozen-pose goldens use SwiftShader. Licensed footage and the host catalog remain local.

## Consequences

These checks are not in CI. Intended visual changes require reviewing re-recorded images.

## Known problems in these files

- [#152](https://github.com/ElevenSpectacles/virtual-try-on/issues/152): Refactor: enforce values duplicated with "keep in sync" comments
- [#155](https://github.com/ElevenSpectacles/virtual-try-on/issues/155): Testing: UPNA pose spec cannot catch mirrored axes or scale errors

## Detailed records

### `.agents/skills/fit-check/scripts/grid-crop.mjs`

#### File overview

Zoomed crop with a labelled pixel grid, for reading frame edges by eye.

`node grid-crop.mjs <image> <out.png> <left> <top> <width> <height> [zoom=3]`

Grid lines every 10 source px, red + labelled every 50. Coordinates on the
grid are the INPUT image's pixels, so readings from two crops of the same
image compare directly.

### `.agents/skills/fit-check/scripts/proto-shot.mjs`

#### File overview

Screenshot the playground PROTOTYPE (occluder on, debug panel) on a face
fixture through Chromium's fake camera, real GPU.

`node proto-shot.mjs <face> <out.png> [--occluder-off] [--occluder-debug]`

Needs the playground served on :3298 (see SKILL.md) and the fixture clip
rendered once by `npm run verify:e2e` (os.tmpdir()/virtual-try-on-face-clips).

#### `await page.getByRole('button', { name: 'Allow camera access' }).click()`

The prototype turns tracking on by itself once the camera is live —
clicking "Track my face" would turn it OFF.

### `.agents/skills/release-smoke/scripts/release-smoke.mjs`

#### File overview

Install the packed module into a throwaway bare Nuxt host and prove it
builds and server-renders the component.

`node release-smoke.mjs [--with-tres]`

--with-tres also lists '@tresjs/nuxt' in the host's modules (hosts that
still register it themselves must keep working).

Every path is absolute and the host dir must be a fresh child of
os.tmpdir() — nothing here may write into the repo or $HOME.

### `.gitignore`

#### `tests/fixtures/tryon-pose/upna-*.json`

UPNA-derived fixtures are non-commercial: keep them local.

#### `playground/.claude/`

nuxt-skill-hub writes its wrapper next to the playground; the root skill
folders link straight to the generated tree in playground/.nuxt instead.

### `playground/app.vue`

#### `tierParam`

`?tier=low|mid|high` pins the capability tier (disables the step-down) so
the experience can be checked at a given tier.

#### `showFit`

`?fit=true` shows the fit verdict from the slot (off by default so the
experience goldens stay unchanged).

### `playground/components/TryOnFixtureScene.vue`

#### File overview

One frozen try-on frame: `TryOnScene` fed from a recorded snapshot
(tests/fixtures/tryon-pose, written by record-tryon-pose.spec.ts) instead of
a live tracker. No camera and no detection, so two renders differ only by
the props that change: this is what makes the shadow on/off comparison exact.

`?view=scene&shadow=on|off` picks the contact shadow. The background is flat
grey, not a portrait: the shadow is painted on the occluder mesh, so it
lands on the same skin whatever is behind it.

#### `HAIR_MASK_SIZE`

Hair-occlusion check (#9): a vertical hair band in the stage's screen space
(`hairBand`, stage x fractions) over the near temple arm: the arm behind the
temple roots is not drawn under the band, so the backdrop shows, while the
frame front stays. The mask is in mirrored camera space, like the live one.

#### `const { getCalibration } = useFrameCalibration('/models/virtual-try-on/calibrati`

The frame's lens override from calibration.json, as the shipped component
applies it, so lens tint/darkness/gradient show in goldens and colour QA.
Placement comes from the recorded pose, not from here.

### `playground/components/VirtualTryOnPrototype.vue`

#### `occluderMeshEnabled`

Landmark-shell occluder (the production path) with its tuning knobs; the
width/height/depth ratios above only steer the ellipsoid fallback.

#### `if (import.meta.client && route.query.harness === 'true') {`

Face-fixture harness (tests/e2e/tracking.spec.ts): `?harness=true` exposes
the raw tracking stream on `window.__tryOnHarness` so Playwright can assert
detection rate and landmark jitter. Records every detector result, with
landmarks in stage pixels, plus rAF frame intervals.

#### `watch(`

The detector sets landmarks before the pose in the same update, so the
pose watcher runs after the landmark watcher has pushed this result.

#### `snapshot`

Everything TryOnScene needs for one frame, in world units. The shadow
spec replays it (tests/e2e/tryon-pose-scene.spec.ts) so a render can be
compared without a live tracker.

#### `const {`

Placement is shared with the production experience (useTryOnPlacement):
scale from the tracked face, One Euro / slerp smoothing, frame position and
the occluders. The knobs below are the playground's tuning inputs; at their
defaults the result is exactly what VirtualTryOnExperience renders.

#### `<div`

Stage: mirrored &lt;video> under a transparent TresJS canvas. Sized to
dominate the layout like the Blackfin/Fittingbox reference — roughly
square, capped by viewport height so it never scrolls away.

#### `<video`

Layer 1: the camera feed, mirrored ONCE here. Always mounted so the
webcam stream has an element to attach to; hidden until active.

#### `<div`

Corner brackets (borders, not SVG strokes, so thickness stays
uniform under the stage's non-uniform aspect).

### `playground/nuxt.config.ts`

#### `modelsDir`

Standalone dev playground for the virtual try-on module. It exists ONLY for
local tuning and loads the module from source (`src/module.ts`), like a
sibling checkout of the Eleven Spectacles host would (`../..` = the Eleven
workspace root).

GLB frames + calibration.json are served straight from the host checkout so
both apps always render the same assets. Override with TRYON_MODELS_DIR if
your layout differs.

#### `imports`

No auto-imports, like a strict host: the module must import everything
explicitly (AGENTS.md), and `npm run typecheck` fails when it doesn't.

#### `skillHub`

Agent skill generated on `nuxt prepare` from the installed Nuxt stack,
with the module-authoring guide since this repo ships a module.

### `playwright.config.ts`

#### `PORT`

Face-fixture harness (`npm run verify:e2e`): builds the playground, serves
it in production mode and drives it with Chromium's fake camera. Local-only
like verify:playground — it needs the host's GLBs — so it skips cleanly
(no build, no server) when a prerequisite is missing.

#### `workers`

One worker: every test spins up MediaPipe + a SwiftShader WebGL context,
and parallel runs starve each other into timeouts.

### `scripts/fetch-footage.mjs`

#### File overview

Real-footage clips for the opt-in e2e specs (`video-clip.spec.ts`,
`metrics.spec.ts`): downloads a few stock portrait videos and converts them
to the 480×640 Y4M Chromium's fake camera reads.

`npm run fetch-footage`

`TRYON_VIDEO_CLIP=<printed path> npx playwright test tests/e2e/video-clip.spec.ts`

The clips come from Mixkit (https://mixkit.co, Mixkit Stock Video Free
License: free to use, not to redistribute). They are downloaded at run time
into the OS temp dir and never committed: footage stays out of git (see
AGENTS.md). Downloads land in their own directory and are only read by
ffmpeg.

Measured 2026-10-12 (real GPU): detection 99.3–100%, still jitter
0.78–1.02 px, latency 18–22 ms.

#### `CLIPS`

Frontal portraits that keep the whole face in a 3:4 centre crop.

### `scripts/verify-playground.mjs`

#### File overview

Playground smoke test: builds the playground, boots the production server,
and asserts the page, calibration manifest, and GLB assets actually serve.

Run via `npm run verify:playground` or directly:

`node scripts/verify-playground.mjs`

Requires the host models checkout (or TRYON_MODELS_DIR) — see
playground/nuxt.config.ts. That checkout isn't available in CI (this repo
is consumed by a separate host app), so this script is excluded
from `verify:unit` / CI and is local-only. If the models directory isn't
found, it exits 0 with a notice rather than failing the run.

### `tests/e2e/camera-test.ts`

#### `test`

`test` with a `cameraPage` whose fake camera plays the `clip` option.
Chromium takes the capture file as a launch flag, and Playwright only
allows launch options per worker, so each test launches its own browser.

### `tests/e2e/capture.spec.ts`

#### `skipReason`

`capture()` (issue #93) on the shipped component: the snapshot has the
stage's aspect and shows the same composite as the screen (mirrored feed,
frame on the face). Its own golden sits next to `render.spec.ts`'s stage
golden, so a reviewer can compare the two; both are SwiftShader renders of
the same still clip.

### `tests/e2e/colour.spec.ts`

#### `Swatch`

Colour QA (issue #85): each catalog frame rendered on a frozen pose under
neutral (greyscale) light, where Khronos PBR Neutral keeps hue exact, and
its frame and lens swatches compared with the product photo in CIEDE2000.
Swatches and sample boxes come from tests/fixtures/colour-swatches.json;
ΔE above its threshold fails unless the model is listed under `known`.
Local-only and SwiftShader (the `gl` option of camera-test's page), so
pixels match across machines.

### `tests/e2e/fixtures.ts`

#### `FACE_FIXTURES`

Face fixtures for the fake-camera harness. Each committed portrait under
`tests/fixtures/faces/<model>.jpg` shows a person wearing that catalog
frame, so its file name doubles as the model to render on it.

Chromium's fake capture device only reads Y4M, which is ~0.5 MB per frame
at 480×640 — far too big to commit — so the clips are rendered from the
JPEGs with ffmpeg into the OS temp dir and reused while the source is
unchanged:
- `still`  — the portrait held for 4 s: tracker noise floor (jitter).
- `motion` — slow pan, lean in/out and ±4.5° roll for 6 s: detection rate
  under movement. Yaw/pitch can't be synthesised from one photo.
- `dim` / `bright` — the portrait held for 6 s with the exposure pulled
  down or up: the room-lighting estimate (#5) must follow it.
- `dark` — much darker than `dim` (a lamp-lit room at night): the guide's
  `tooDark` hint must fire (#99).
- `backlit` — midtones pulled down and the edges blown out, as in front of
  a window (#99).
- `occluded` — a skin-toned block over the lower half of one side of the
  face from 2 s to 4 s, a hand passing (#99).
- `dropout` — 200 ms of black frames at 3 s: the tracker loses the face
  for less than the hold, and the frame must not vanish or pop (#99).
A yaw sweep can't be made from one photo; it runs on real footage
(`TRYON_VIDEO_CLIP`, see `npm run fetch-footage`).

#### `dark`

Room luma 0.012–0.096 on the three fixtures in Chromium (dim:
0.24–0.40), under the guide's 0.12 tooDark threshold. -0.55 left the
bright iris-moss portrait at 0.153.

#### `faceClip`

Absolute path of the rendered Y4M clip, rendering it if stale. The name
carries a hash of the filter and duration, so editing a clip kind renders
a new clip instead of reusing the old one.

#### `execFileSync('ffmpeg', [`

Fixed rate and pixel format keep the clip byte-identical across runs.

#### `fakeCameraArgs`

Chromium flags that feed `clip` as the camera. `swiftshader` pins WebGL to
software rendering — identical pixels on every machine, so goldens are
stable — but MediaPipe's GPU delegate takes seconds per frame on it, so
tracking tests run on the real GPU (`hardware`).

### `tests/e2e/freeze.spec.ts`

#### `skipReason`

`freeze()` / `unfreeze()` (issue #97) on the shipped component: freeze a
fixture's pose, switch to another catalog frame, and the new frame renders
where the old one sat, on the held camera frame. Golden: the switched
frame on the frozen pose (SwiftShader, like the other goldens).

### `tests/e2e/hair-scene.spec.ts`

#### `skipReason`

Hair occlusion (#9), positive case on frozen frames: the playground's
`?view=scene&hair=band` paints a hair band over the near temple arm
(`hairBand`, stage-width fractions). The arm behind the temple roots must
vanish inside the band, and nothing else may change: the frame front,
hinges and the far side stay. The live face fixtures have no hair over an
arm (see hair.spec.ts), so this is where the hiding itself is proven.

#### `expect(diff.minX).toBeGreaterThanOrEqual(band[0] * STAGE_WIDTH - 3)`

Only inside the band, give or take the bilinear mask edge and the
antialiased arm pixel at it (3 px).

### `tests/e2e/hair.spec.ts`

#### `FACE`

Hair occlusion (#9).

Live, on the shipped component (real GPU, face-fixture clip, tier pinned
to `high`, the feature's minimum):
- the segmenter, started on the first tracked face, finds the hair in a
  portrait at its cadence and inside its time budget;
- tracking keeps its latency and the render loop its frame rate with the
  segmenter running (metrics event, hair on vs off).

The positive case (a hair band hiding the arm) is checked on frozen frames
in hair-scene.spec.ts: the face fixtures have no hair over an arm.

### `tests/e2e/lighting.spec.ts`

#### `FACE`

Room lighting from the live frame (#5), end to end on the shipped component:
the playground's `?view=experience&lighting=true` shows the estimate read
from the component ref as data attributes.

- The light gain follows a dim vs a bright version of the same portrait.
- On a still clip the smoothed gain holds steady (no flicker).
- The estimate costs under 1 ms per detection. The 16×16 downsample runs in
  the worker (nothing on the render thread), one every
  LIGHTING_SAMPLE_EVERY detections, so its per-detection cost is the
  sample time divided by that.

### `tests/e2e/metrics.spec.ts`

#### `clipSkip`

The `metrics` event end to end: the playground's experience view with
`?metrics=true` logs each report as `[metrics] {json}`. Starts the camera
on a real clip, lets it track, stops it, and checks the final report.

Runs on the clip named by `TRYON_VIDEO_CLIP`, like video-clip.spec.ts.

#### `for (const key of ['landmarks', 'pose', 'frame']) {`

The payload is numbers and labels only: no frames, no landmarks.

### `tests/e2e/pose-metrics.ts`

#### `compareAxis`

Best alignment of `tracker` onto `truth`, chosen by the largest |r|.

The lag runs over a full loop of the truth. The fake camera replays the
clip, so the tracker can start anywhere in it, and the truth index wraps
around. Frames where the tracker has no sample are skipped. Returns null
when fewer than `minPairs` frames overlap at every lag.

#### `parseGroundTruth`

Parse a UPNA 3D ground-truth file: rows of `Tx Ty Tz Roll Yaw Pitch`.

### `tests/e2e/readiness.ts`

#### File overview

Readiness signals instead of fixed sleeps (issue #154). A spec waits for
what it needs, so it is as fast as the machine allows and never shoots too
early on a slow one:

- Scene view (`?view=scene`): `[data-scene][data-ready="true"]` once the
  GLB, the environment map and the calibration manifest have loaded.
- Experience view: `[data-experience]` carries `data-has-face` and
  `data-model-loaded` (the component's read-only `modelLoaded`).
- Then `waitForStill`: screenshots 500 ms apart until they stop changing,
  so the smoothed pose, the occluder and SwiftShader's slow frames have
  settled. Scene view: two in a row within 0.1 % of the pixels (channel
  tolerance 2). Live view (`waitForLiveStill`): three in a row within
  0.3 %, channel tolerance 12.

Fixed waits that remain are measurement windows, not readiness: the
tracking sample (`SAMPLE_MS`), the lighting sampler, the dropout window in
robustness, and the metrics and hair session lengths.

#### `LIVE_STILL_MAX_CHANGED_RATIO`

A live still clip never renders two identical frames: the camera-match
grain is reseeded every frame (up to 0.04, about 10 of 255 levels, hence
tolerance 12), and landmark jitter keeps moving frame edges by fractions of
a pixel, about 0.16–0.2 % of the stage per 500 ms once settled (measured
2026-11-25, SwiftShader). Hence 0.3 %, still under the goldens' 0.5 %.

### `tests/e2e/record-tryon-pose.spec.ts`

#### `FACE`

Records one settled frame of the prototype's scene inputs for the fixed-pose
render (tests/e2e/tryon-pose-scene.spec.ts). Writes
tests/fixtures/tryon-pose/&lt;face>.json. Does nothing unless
RECORD_TRYON_POSE=1, so it never runs in a normal verify. It records once
the harness snapshot stops moving (`waitForSettledPose` in
tracking-harness.ts: three reads in a row within 1e-3 rad and 0.1 % of
scale and face width).

Re-record after changing the tracker, the occluder or the frame layout:
the fixture is a snapshot of how those produce one frame.

#### `test.use({`

RECORD_GL=hardware is needed for longer clips: SwiftShader is too slow for
MediaPipe to find the first face in a 10 s UPNA clip. The saved values are
tracker output, so the GL backend does not change the fixture.

### `tests/e2e/render.spec.ts`

#### `skipReason`

Golden screenshots of the shipped component (`?view=experience`) fitting
each fixture's own frame onto a still portrait: real MediaPipe landmarks,
SwiftShader rendering. Catches fit, occlusion and material regressions
that unit tests can't see. Update after an intended visual change with
`npm run verify:e2e -- --update-snapshots` and review the new PNGs.

### `tests/e2e/rendering-goldens.spec.ts`

#### `skipReason`

Rendering goldens on frozen frames (umbrella #4, issue #14). Each case is one
recorded pose (tests/fixtures/tryon-pose) rendered through the playground's
`?view=scene` with one flag changed, so every flag gets its own golden and a
regression shows up as a changed image, not a changed number.

Goldens are re-recorded after an intended visual change:

`npx playwright test tests/e2e/rendering-goldens.spec.ts --update-snapshots`

then review the PNGs in tests/e2e/__screenshots__/rendering-goldens.spec.ts/.

#### `STRICT`

Strict per-pixel colour threshold: the default (0.2) ignores faint changes like a shadow or dim light.

#### `{ name: 'iris-moss-lens-standard', face: 'iris-moss', query: { lens: 'standard'`

Lens material (#10): the physical lens is the default; standard is the
low-tier fallback. kairos-crystal is the lightest catalog lens, iris-moss
a dark gradient; the dark backdrop shows reflections adding on top.

#### `{ name: 'synthetic-profile-base', face: 'synthetic-profile', query: {} },`

Synthetic profile (about -76 yaw): the recorded iris-moss frame rotated about
the head axis. Geometry only, not a real face; see synthetic-profile.json.

#### `{ name: 'upna-frontal-base', face: 'upna-frontal', query: {} }`

Frontal (yaw 0). The fixture is derived from a UPNA clip (non-commercial
licence), so it stays local and is not committed; the case skips without it.

#### `runnable`

A case whose pose fixture is absent is skipped, not failed: some fixtures are
local-only (footage-derived, not committed).

### `tests/e2e/robustness.spec.ts`

#### `skipReason`

Tracking robustness on the shipped component (issue #99):
- `dropout`: 200 ms of black frames. The tracker loses the face, but the
  hold keeps the frame on its last pose, so the canvas layer is never
  hidden (`vto-frame--hidden`) while the clip loops through the dropout.
- `dark`: a very dark room. The guide hint reads `tooDark`.

### `tests/e2e/tracking-harness.ts`

#### `MIN_DETECTION_RATE_BY_KIND`

Per-kind detection-rate floors (issue #99). Measured with MediaPipe's CPU
delegate on the fixture frames (2026-10-17): 100 % on still, dim, dark,
backlit and occluded, 96.7 % on dropout (its 200 ms of black frames).

#### `MAX_POP_PX`

Largest frame-to-frame move of the mean landmark allowed on a still
subject: a "pop" is a discontinuity well above the jitter floor. Measured
in camera pixels (480×640); the harness reports stage pixels, so recheck
the margin if the prototype's stage is much larger than the camera frame.
Measured: still 0.5–2.9, backlit 1.0–1.6, occluded 1.2–6.3 (the box
edge), dropout 1.8–6.8 (re-acquiring after the black frames).

#### `MAX_STILL_JITTER_PX`

Median frame-to-frame landmark movement on a perfectly still input: the
tracker's own noise floor. Above this the frame visibly shimmers.

#### `await page.getByRole('button', { name: 'Allow camera access' }).click()`

The prototype switches tracking on by itself once the camera is live.

#### `await page.waitForFunction(`

Measure from the first detection: MediaPipe's Wasm + model download is
load time, not tracking quality.

### `tests/e2e/tracking.spec.ts`

#### `testInfo.annotations.push({`

Logged, not asserted: headless GPU timing varies by machine.

### `tests/e2e/tryon-pose-faces.spec.ts`

#### `FACES`

Contact shadow on each recorded face (tests/fixtures/tryon-pose). For every
face the frozen frame is rendered with and without the shadow, and the
darkening is measured: how much there is, and where it lands relative to
the centre of the stage. The shadow sits under the frame, so its weight should
split either side of the nose rather than piling up on one cheek.

### `tests/e2e/tryon-pose-scene.spec.ts`

#### `CHANGE_TOLERANCE`

Contact shadow on vs off on one frozen frame (#6 acceptance). The playground's
`?view=scene` renders TryOnScene from a recorded pose (tests/fixtures/tryon-pose),
with no camera and no tracker, so renders are deterministic: two shadow-on
shots must match exactly, and the shadow-off shot must differ only where the
shadow is painted.

#### `await page.goto('/?view=scene&shadow=on')`

Goldens: the same frozen frame with and without the shadow. Both are
deterministic, so any drift is a real change in the render. The default
colour threshold (0.2) hides a translucent shadow, so it is tightened.

### `tests/e2e/upna-pose.spec.ts`

#### `GT_PATH`

Head-pose accuracy on a UPNA clip (University of Navarra head-pose
database). Runs the tracker over the clip and compares its yaw, pitch and
roll with the database's 3D ground truth.

Needs two local files (not committed; UPNA is non-commercial, CC BY-NC-SA):
- `TRYON_VIDEO_CLIP`: the clip as Y4M (e.g. user01_v05_yaw.y4m)
- `TRYON_UPNA_GT`: its `_groundtruth3D.txt` (Tx Ty Tz Roll Yaw Pitch rows)

#### `MAX_SHAPE_RMS_DEG`

Shape error after the best linear fit, in degrees. Observed ~0.3–0.4° on
the yaw and pitch clips; 3° leaves room for other clips and machines.

### `tests/e2e/video-clip.spec.ts`

#### `MODEL`

Tracking on a real video clip (`TRYON_VIDEO_CLIP`; `npm run fetch-footage`
prepares some), through the same fake camera path as the portrait
fixtures. The model is only the one rendered in the prototype: the
assertions are on detection, not on the frame's fit. A second test renders
the shipped component on the clip and attaches a screenshot to the report,
for reviewing how the frame looks on real footage (no golden: the clip is
not committed).

### `tests/mocks/nuxt-imports.ts`

#### File overview

Nuxt's `#imports` virtual module doesn't exist outside a Nuxt build; the
unit tests only exercise pure helpers, so a minimal stub is enough.

### `tests/unit/mediapipe-version.test.ts`

#### `describe('MediaPipe version', () => {`

The worker bundles @mediapipe/tasks-vision's JS but loads its WASM from a
CDN by default. Mixing versions is unsupported, so the pinned dependency
and the default WASM URL must move together.

### `tests/unit/scripts/colour.test.ts`

#### `pairs`

Test pairs from Sharma, Wu & Dalal (2005), Table 1.

### `tests/unit/support/landmark-stream.ts`

#### File overview

Synthetic tracker output for the smoothing tests: a scripted head motion
(ground truth) plus seeded Gaussian measurement noise, sampled at a fixed
frame rate. The smoothing composable only consumes the anchor, the Euler
rotation, the scale and the tracking/blink flags, so those are what is
generated, not the full 468-point mesh.

Deterministic: the same seed always gives the same stream, so thresholds
on the smoothing output are stable across runs.

### `tests/unit/utils/pose-metrics.test.ts`

#### `truth`

300 frames of a sweep in degrees. Two sinusoids with incommensurate periods,
so no shifted or negated copy lines up with it: a pure sine aliases every
half period, and the lag search would pick the alias.

### `tests/unit/utils/tryon-occluder.test.ts`

#### `landmarks`

The nose tip (landmark 4) is the foremost point of a real face — in
MediaPipe coordinates that is a NEGATIVE z. It must land closer to the
camera than a neutral-depth vertex or the whole occluder is inside-out
and depth-hides the frame front.
