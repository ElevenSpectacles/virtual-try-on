# Virtual try-on: improvement research

Research only — no code changes. Findings are cited against primary sources (spec text,
official docs, or the actual `.d.ts`/source shipped in `node_modules`), not blog posts.

Current implementation snapshot referenced throughout: `workers/face-landmarker.worker.ts`,
`utils/tryon-occluder.ts`, `utils/face-mesh-triangles.ts` (`FACE_MESH_VERTEX_COUNT = 468`),
`composables/tryon/useTryOnSmoothing.ts`, `utils/tryon.ts`, `components/TryOnScene.vue`.
Deps: `three@^0.185.1`, `@tresjs/nuxt@^5.6.3`, `@tresjs/cientos@^5.8.1`,
`@mediapipe/tasks-vision@^1.0.0`/installed `1.0.1`, `@gltf-transform/core@^4.4.2` (devDep).

---

## 1. GLB/asset size reduction

### Findings

**Draco (`KHR_draco_mesh_compression`)** and **Meshopt (`EXT_meshopt_compression`)** are both
ratified Khronos glTF extensions for compressing mesh geometry — Draco via a general-purpose
geometry codec, Meshopt via a lighter, faster-to-decode quantization+entropy-coding scheme.
Sources:
- Khronos extension registry, `KHR_draco_mesh_compression`: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_draco_mesh_compression — "defines a schema to use Draco geometry compression libraries in glTF format... allows glTF to support streaming compressed geometry data instead of the raw data."
- Khronos extension registry, `EXT_meshopt_compression`: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md
- Khronos press release confirming ratification: https://www.khronos.org/news/press/khronos-announces-gltf-geometry-compression-extension-google-draco

**`@gltf-transform/core` (the currently installed devDependency) does *not* contain the
compression transforms.** Its `dist/index.d.ts` only exports the low-level document/property
API (`Document`, `NodeIO`, `WebIO`, `Accessor`, `Mesh`, etc. — confirmed by inspecting
`node_modules/@gltf-transform/core/dist/index.d.ts` directly, no `draco`/`meshopt`/
`textureCompress`/`quantize`/`dedup`/`weld` exports present). The transform functions live in
the separate **`@gltf-transform/functions`** package, and the Draco/KTX2 *extension property
support* lives in **`@gltf-transform/extensions`** — neither is currently a dependency of this
repo. Source: `@gltf-transform/core`'s own bundled JSDoc references this split directly (`import { dedup } from '@gltf-transform/functions'` appears as an example inside `core`'s `Document` class docs).
- `draco()` transform docs: https://gltf-transform.dev/modules/functions/functions/draco — thin wrapper around `KHRDracoMeshCompression`; requires registering `KHRDracoMeshCompression` (from `@gltf-transform/extensions`) and a `draco3d.encoder` dependency on the `NodeIO`/`WebIO` instance, and takes a `method: 'edgebreaker' | 'sequential'` option (edgebreaker compresses further).
- `meshopt()` transform: https://gltf-transform.dev/modules/functions/functions/meshopt — wraps `reorder` + `quantize` + `EXTMeshoptCompression`; for full control (e.g. quantization bit depth) the docs recommend calling the underlying functions directly rather than `meshopt()`.
- `textureCompress()` transform: https://gltf-transform.dev/modules/functions/functions/textureCompress — converts textures to JPEG/PNG/**WebP**/**AVIF** (not KTX2 — see below) and can resize (`resize: [w, h]`). Best results require passing Node's `sharp` module as `encoder`; without it, "most quality- and compression-related options are ignored."

**KTX2/Basis Universal** (`KHR_texture_basisu`) is the GPU-texture-compression path — textures
stay compressed in GPU memory (not just on disk) — and is handled as a *separate* extension
property, not through `textureCompress()`. Three.js's `GLTFLoader` needs a paired
`KTX2Loader.setTranscoderPath(...)` + `loader.setKTX2Loader(ktx2Loader)` to decode it at load
time (https://threejs.org/docs/pages/GLTFLoader.html — the loader page documents
`.setDRACOLoader()`, `.setKTX2Loader()`, and `.setMeshoptDecoder()` as the three optional
loader-injection points, each requiring the corresponding decoder/transcoder to be configured
separately, e.g. `dracoLoader.setDecoderPath('/examples/jsm/libs/draco/')`).

Given the eyewear GLBs here are almost entirely **geometry + PBR material params**, not
texture-heavy (no photo-textured surfaces implied by the existing lens/frame material setup),
Draco/Meshopt mesh compression is the higher-leverage lever than KTX2 texture work for this
specific asset type — but this should be confirmed by inspecting one exported GLB's byte
breakdown (mesh buffers vs image buffers) before committing to a specific pipeline.

### Recommendation

- Add `@gltf-transform/functions` and `@gltf-transform/extensions` as devDependencies
  alongside the existing `@gltf-transform/core`, plus a Draco encoder (`draco3dgltf` for the
  Node-side encoder used by the `scripts/generate-calibration.ts`-style build pipeline).
- Extend `scripts/generate-calibration.ts` (which already loads and rewrites GLBs with
  `@gltf-transform/core`) into a build step that also runs `document.transform(draco({method:
  'edgebreaker'}))` (or `meshopt()` if faster decode matters more than smallest bytes — Meshopt
  decodes faster in WASM, per its own README positioning as a lighter alternative to Draco) before writing the final GLB.
- On the runtime side, wire `GLTFLoader.setDRACOLoader()` (TresJS's `useGLTF` composable
  exposes Draco support — see §4) with a **self-hosted** decoder path (bundle `three/examples/jsm/libs/draco/` rather than pointing at Google's CDN, consistent with removing the CDN dependency called out in §3).
- Treat KTX2/texture compression as a follow-up only if a byte-size audit of an actual exported
  GLB shows textures are a meaningful fraction of the 5.8MB — `textureCompress()` (needs `sharp`
  in the Node build script) for disk/transfer size, or full KTX2 (needs `KHR_texture_basisu` +
  runtime `KTX2Loader`) for GPU-memory savings too.

---

## 2. MediaPipe FaceLandmarker capabilities not yet used

Findings below are checked against the **shipped type definitions**
(`node_modules/@mediapipe/tasks-vision/vision.d.ts`, package version `1.0.1`, which is
authoritative for what the currently-pinned `^1.0.0` range actually exposes) and cross-checked
against Google's own docs page (https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js — note: `ai.google.dev/edge/...` 301-redirects here as of writing).

### Already in use (confirmed from `workers/face-landmarker.worker.ts`)
`runningMode: 'VIDEO'`, `numFaces: 1`, `outputFacialTransformationMatrixes: true`,
`minFacePresenceConfidence: 0.3`, `minTrackingConfidence: 0.3`, GPU delegate with CPU
fallback (`landmarkerOptions('GPU')` → catch → `('CPU')`).

### Not currently used

- **`outputFaceBlendshapes`** (`vision.d.ts:701`) — currently hardcoded `false`. Per the type
  doc comment: "Face blendshapes are used for rendering the 3D face model." This is 52
  ARKit-style expression coefficients (mouth open, brow raise, etc.) computed by the same
  inference pass essentially for free. Not obviously needed for eyewear compositing today, but
  would enable future features (e.g. suppressing/adjusting the occluder or triggering
  re-calibration when the user's expression invalidates the neutral-face assumption baked into
  `skinSetbackMeters`/`inflate` in `utils/tryon-occluder.ts`).
- **Iris landmarks are already included in the 468→478-point output, but this codebase only
  consumes 468.** `utils/face-mesh-triangles.ts` hardcodes `FACE_MESH_VERTEX_COUNT = 468`.
  Unlike the legacy MediaPipe FaceMesh solution (which needed an explicit
  `refineLandmarks`/iris flag), the Tasks-Vision `FaceLandmarker` model outputs landmarks
  0–467 for the face surface plus indices 468–477 for the two irises as a fixed part of its
  478-point topology — confirmed by `FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS` /
  `FACE_LANDMARKS_RIGHT_IRIS` static connection tables existing unconditionally on the class
  (`vision.d.ts:598, 617`), with no corresponding options-interface flag to turn them on/off.
  Since the occluder mesh only indexes `FACE_MESH_TRIANGLE_INDEX` over the first 468, the iris
  points are silently present in every `faceLandmarks[0]` array today and simply discarded.
  These could improve **pupillary-distance-based metric scale** (a documented true metric —
  average iris diameter ≈ 11.7mm — versus the current ear-width/face-width/IPD heuristic
  chain) and eye-level frame vertical alignment.
- **`delegate` is already exercised (GPU→CPU fallback)**, confirmed as a `BaseOptions` field
  (`vision.d.ts:29`, `delegate?: "CPU" | "GPU"`) — no further action, just noting it's
  correctly used already, contrary to what Google's own web_js docs page shows in its options
  table (that page's example omits `delegate` from the narrative options table even though it's
  present in the type and in a separate code sample on the same page using
  `delegate: "GPU"`).
- **Confidence/threshold tuning headroom**: `minFaceDetectionConfidence` (default 0.5, not
  overridden here — worker only overrides `minFacePresenceConfidence`/`minTrackingConfidence`
  to 0.3) is left at default. Given `numFaces: 1` is fixed and detection-vs-tracking confidence
  serve different purposes (initial face acquisition vs. frame-to-frame persistence), leaving
  detection confidence at the stricter default while loosening tracking confidence to 0.3 is a
  reasonable asymmetric choice already made — flagging only that it's an unexplained gap in the
  current inline comments, not a defect.

### Performance/latency guidance found in Google's own docs

- "Calls to the Face Landmarker `detect()` and `detectForVideo()` methods run synchronously and
  block the user interface thread... use web workers to run the `detect()` and
  `detectForVideo()` methods on another thread" — this repo already does this correctly via the
  classic Web Worker in `workers/face-landmarker.worker.ts`.
- "Smoothing is only applied when `num_faces` is set to 1" — per the same docs page's
  `numFaces` row. This repo already pins `numFaces: 1`, so it benefits from MediaPipe's own
  built-in landmark smoothing *in addition to* the custom One-Euro filter in
  `composables/tryon/useTryOnSmoothing.ts` — worth knowing when tuning the One-Euro
  `minCutoff`/`beta` parameters, since some jitter reduction is already happening upstream in
  the model's own temporal filter, not solely from the custom filter.

Source: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

### Recommendation

- Set `outputFacialTransformationMatrixes: true` stays as-is (already correct).
- Bump `FACE_MESH_VERTEX_COUNT` handling to optionally read indices 468–477 (irises) — cheap
  since they're already being returned in every result — and use iris diameter as an additional
  metric-scale signal in the ear-width → face-width → IPD fallback chain (probably inserted as
  the most-preferred rung, since iris diameter varies far less across adults than ear or face
  width).
- Leave `outputFaceBlendshapes: false` unless a concrete feature (expression-gated
  recalibration, "smile to capture" UX, etc.) is scoped — no free win here without a consumer.

---

## 3. Web Worker + WASM loading best practices (self-hosting)

### Findings

`FilesetResolver.forVisionTasks(basePath?, useModule?)` (`vision.d.ts:792`) accepts an
arbitrary `basePath` — "An optional base path to specify the directory the Wasm files should be
loaded from. If not specified, the Wasm files are loaded from the host's root directory." There
is **no CDN requirement in the API itself**; the current code's
`'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm'` is a caller choice, not a
constraint of `FilesetResolver`. Class-level doc comment on `FilesetResolver`
(`vision.d.ts:725-730`): "The returned filesets require that the Wasm files are published
without renaming. If this is not possible, you can invoke the MediaPipe Tasks APIs using a
manually created `WasmFileset`" — i.e. self-hosting is explicitly supported, either by pointing
`basePath` at a same-origin directory with the files under their default names, or by building a
`WasmFileset` object by hand if renaming is required.

Confirmed empirically: the installed `@mediapipe/tasks-vision@1.0.1` package **already ships the
WASM binaries locally** at `node_modules/@mediapipe/tasks-vision/wasm/` —
`vision_wasm_internal.{js,wasm}` (11.2MB), `vision_wasm_module_internal.{js,wasm}` (SIMD variant,
11.2MB), and `vision_wasm_nosimd_internal.{js,wasm}` (10.5MB, non-SIMD fallback). `static
isSimdSupported(useModule?)` (`vision.d.ts:744`) exists precisely so a self-hosting caller can
pick which of these three ~11MB pairs to serve, rather than shipping all three.

The **model asset** (`face_landmarker.task`, currently loaded from
`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`)
is a separate concern from the WASM runtime — `modelAssetPath` in `BaseOptions`
(`vision.d.ts:22`) is just a URL/path string, so self-hosting it is a plain static-asset move
(download once, serve from the module's own public assets or a first-party CDN), not an API
change.

Source: `node_modules/@mediapipe/tasks-vision/vision.d.ts` (shipped types, package
`1.0.1`, matches installed `^1.0.0` range) — `FilesetResolver` class doc and
`forVisionTasks`/`isSimdSupported` signatures.

### Recommendation

- Self-host both the WASM fileset and the `.task` model file as static assets served by the
  Nuxt app (e.g. under `public/mediapipe/`), copying them at build time from
  `node_modules/@mediapipe/tasks-vision/wasm/` — this directly addresses the module's own
  stated gap ("No self-hosting of MediaPipe assets, no CDN fallback") and removes the runtime
  dependency on `cdn.jsdelivr.net`/`storage.googleapis.com` availability.
  Trade-off: the WASM+model payload is itself large (~11MB WASM + the `.task` file, size not
  directly inspected here but MediaPipe's float16 face_landmarker task is documented elsewhere
  in Google's model card as a few MB) — this is a genuine bandwidth cost either way; self-hosting
  changes *where* that cost is paid from (Google's CDN → this app's own hosting/CDN) and gives
  control over caching headers, not a size reduction.
  Only serve the SIMD or non-SIMD pair (via `isSimdSupported()`), never both, to avoid doubling
  that payload.
- Keep the CDN path as an optional fallback/override rather than removing the flexibility
  entirely, since `basePath` is just a string — trivial to make configurable.

---

## 4. Three.js/TresJS rendering performance for AR-style compositing

### Findings

- **Three.js `GLTFLoader` loader-injection API** confirmed directly from
  https://threejs.org/docs/pages/GLTFLoader.html: `.setDRACOLoader(dracoLoader)`,
  `.setKTX2Loader(ktx2Loader)`, `.setMeshoptDecoder(meshoptDecoder)` — each optional, each
  required only if the loaded GLB actually uses the corresponding compression extension (ties
  directly to §1: compressing the GLBs at build time requires wiring the matching decoder here
  at runtime, e.g. `dracoLoader.setDecoderPath('/examples/jsm/libs/draco/')` before
  `loader.setDRACOLoader(dracoLoader)`).
- **TresJS's `useGLTF` composable supports a `draco` option out of the box** — per search-result
  content surfaced from TresJS/Cientos docs (the specific `docs.tresjs.org`/`cientos.tresjs.org`
  pages returned HTTP 404 on direct fetch during this research, likely due to a docs-site
  restructuring since the last search-index crawl; the `draco` prop's existence is corroborated
  by both the search snippet and TresJS's own `@tresjs/cientos` changelog entries referencing
  Draco support in `useGLTF`, but the exact current API surface should be re-verified against
  `node_modules/@tresjs/cientos`'s shipped types before implementation, since this could not be
  confirmed against a live docs page in this pass).
- **TresJS performance guidance** (via search snippet of `docs.tresjs.org/advanced/performance`,
  full page not retrievable at time of research — cite with that caveat): recommends rendering
  the scene only when necessary (manual/on-demand render loop rather than continuous
  `requestAnimationFrame`) to reduce battery/GPU load, and using `shallowRef` instead of `ref`
  for Three.js object references to avoid Vue's deep-reactivity proxying overhead on Three.js's
  internal object graphs. Both are directly relevant here: this module renders continuously
  (video passthrough + tracked overlay, so on-demand rendering doesn't apply the same way a
  static/idle 3D viewer would — flagging as *not* directly applicable, since the whole point is
  live tracking every frame), but the `shallowRef` guidance is directly actionable for any
  TresJS-side Vue refs wrapping Three.js objects (camera, scene graph nodes, materials) in
  `components/TryOnScene.vue`.
- Three.js's own manual site was searched for a dedicated "Optimize your scenes"/performance
  page; none was found as a standalone official manual page as of this research pass (only
  forum threads, which are excluded as non-primary per the task brief) — no citable Three.js-side
  manual claim beyond the `GLTFLoader` API page above and general docs (`How to update things`,
  `How to run things locally` — neither is performance-specific enough to cite here).

### Recommendation

- Wire `DRACOLoader`/`MeshoptDecoder` into whatever loader TresJS's `useGLTF` uses internally
  (or use its documented `draco` prop if confirmed) once the build pipeline in §1 starts
  emitting compressed GLBs — otherwise compressed models will fail to load at runtime.
  **Action item: re-verify the current `useGLTF`/`draco` option directly against
  `node_modules/@tresjs/cientos`'s type definitions before implementing**, since the docs pages
  couldn't be fetched live in this research pass.
  \- confirmed 404 pages: `https://tresjs.org/guide/performance.html`,
  `https://cientos.tresjs.org/guide/loaders/use-gltf.html` (search-indexed URLs no longer
  resolve).
  \- URL to retry: `https://docs.tresjs.org/advanced/performance` (returned 404 to the
  WebFetch tool in this session but appears in Google's own index, so may be a
  bot-blocking/redirect issue rather than a moved/removed page).
- Audit `components/TryOnScene.vue` for any `ref()`-wrapped Three.js objects (camera, meshes,
  materials) that could be `shallowRef()` instead, per the TresJS performance guidance above.

---

## 5. WebRTC `getUserMedia` video constraints

### Findings

Per MDN (https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), which
documents the W3C Media Capture and Streams spec's constraint model:

- Numeric constraints (`width`, `height`, `frameRate`) accept `min`/`max`/`exact` (hard
  constraints — `getUserMedia()` rejects with `OverconstrainedError` *before* prompting the
  user if unsatisfiable) or `ideal`/a bare value (soft constraint — browser picks the closest
  achievable setting by "fitness distance," never fails on it).
- Explicit performance note from MDN: "Lower frame-rates may be desirable in some cases, like
  WebRTC transmissions with bandwidth restrictions" — example given:
  `{ frameRate: { ideal: 10, max: 15 } }`. MDN does not make an explicit end-to-end
  resolution→latency causal claim, but the mechanism is direct: a smaller captured frame means
  less work in the module's own downscale-to-480px preprocessing step before the frame is
  transferred to the worker, and requesting a lower native `frameRate` reduces the input rate to
  the `requestVideoFrameCallback`-driven detect loop, directly bounding the maximum detection
  attempt rate.
- `resizeMode: "crop-and-scale" | "none"` — controls whether the browser is allowed to
  crop/downscale a higher-native-resolution camera stream to hit the requested
  width/height, versus rejecting/adjusting instead.
- `facingMode: "user"` (soft) or `{ exact: "environment" }` (hard) — relevant for confirming the
  front-camera request is a soft preference (so it degrades gracefully on devices without a
  labeled front camera) rather than a hard requirement that could throw `OverconstrainedError`
  on unusual hardware.

Source: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia (MDN's video
constraints section, syntax and quotes above pulled directly from the page).

### Recommendation

- Since frames are downscaled to 480px in software before transfer to the worker anyway (per
  the existing pipeline), requesting a capture resolution far above 480px-equivalent wastes
  camera pipeline and downscale-step work for no tracking-quality benefit — request
  `width`/`height` as `ideal` values in the ~640–960px range (enough headroom for the 480px
  downscale plus any future higher-res use, without capturing at full sensor resolution) rather
  than leaving constraints unset (which typically defaults to the camera's max/preferred
  resolution on many browsers).
- Consider capping `frameRate` with `ideal`/`max` (e.g. `{ ideal: 30, max: 30 }`) if the
  detect loop is already throttled to one-in-flight via `pendingRequestId` — capturing at a
  higher native frame rate than the detector can consume just burns camera-pipeline CPU/power
  for frames that get dropped anyway.
- Keep `facingMode: "user"` as a soft (`ideal`) constraint, not `exact`, to avoid hard failures
  on devices with atypical camera labeling.

---

## Prioritized summary (impact vs. effort)

| # | Recommendation | Area | Impact | Effort | Notes |
|---|---|---|---|---|---|
| 1 | Add `@gltf-transform/functions` + `@gltf-transform/extensions`, run `draco()` (or `meshopt()`) in the existing calibration/build script | GLB size | High — directly attacks the self-documented "untenable" 5.8MB blocker | Medium — new deps, build-script change, needs matching runtime `DRACOLoader`/`MeshoptDecoder` wiring | §1 |
| 2 | Wire `DRACOLoader`/`MeshoptDecoder` into the TresJS/GLTFLoader runtime path to match #1 | Rendering | High — required for #1 to not break loading | Low–Medium | §4 — re-verify `useGLTF` draco API against `@tresjs/cientos` types first |
| 3 | Self-host MediaPipe WASM fileset + `.task` model as static assets, drop CDN dependency | Reliability | Medium-High — removes production blocker (no CDN fallback / offline risk) | Low — files already present in `node_modules`, just needs copy-to-`public/` + `basePath`/`modelAssetPath` change | §3 |
| 4 | Constrain `getUserMedia` `width`/`height`/`frameRate` to match the 480px downscale + detector throttle | Tracking latency, battery | Medium — reduces wasted capture/downscale work | Low — constraint object change only | §5 |
| 5 | Use already-returned iris landmarks (468–477) as a metric-scale signal | Tracking accuracy (metric scale) | Medium — potentially more stable than ear/face-width heuristics | Low-Medium — data already present in every frame, needs consumption + calibration validation | §2 |
| 6 | Audit `TryOnScene.vue` for `ref()`→`shallowRef()` on Three.js objects | Rendering perf | Low-Medium (unquantified without profiling) | Low | §4 — re-verify against live TresJS docs, page 404'd during this research |
| 7 | Texture compression (`textureCompress()`/KTX2) | GLB size | Low unless audit shows textures are a meaningful share of the 5.8MB | Medium (KTX2 needs extra runtime loader + transcoder assets) | §1 — do the byte-breakdown audit before investing here |
| 8 | `outputFaceBlendshapes` | Tracking features | Low today (no consumer) | Low to enable, but pointless without a scoped feature | §2 |

### Open items flagged during research (not resolved, need follow-up before acting on them)

- `docs.tresjs.org/advanced/performance`, `tresjs.org/guide/performance.html`, and
  `cientos.tresjs.org/guide/loaders/use-gltf.html` all returned HTTP 404 to direct fetch in this
  session despite appearing in search results — re-check these against the live TresJS site (or
  its GitHub source) before relying on the `draco` prop / `shallowRef` claims for implementation.
- No official standalone Three.js manual "performance" page was found; only the `GLTFLoader` API
  reference page was confirmed as a primary source for loader configuration.
- The actual byte breakdown of an existing GLB (mesh buffer vs. image/texture bytes) was not
  inspected in this pass — needed to correctly prioritize Draco/Meshopt vs. KTX2 work (item 7).
