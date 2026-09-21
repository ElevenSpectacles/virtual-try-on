# AGENTS.md

## Project overview

`@elevenspectacles/virtual-try-on` — a **Nuxt-only module** implementing the
Eleven Spectacles virtual try-on experience. It composites 3D eyewear GLB
models over a live front-camera feed using MediaPipe
`FaceLandmarker` for face tracking and TresJS (Three.js) for rendering.

Key facts:

- Distributed as a **git submodule** consumed by the Eleven Spectacles Nuxt
  host project. It is intentionally **not published to npm** and is not
  designed for reuse outside that host.
- The module itself has no app entry point at the repo root. **Import
  everything explicitly** — `ref`/`computed`/`onBeforeUnmount` from `vue`,
  `useI18n` from `vue-i18n`, VueUse from `@vueuse/core`, Nuxt composables from
  `#imports`, sibling components/composables by relative path. The host
  (Eleven Spectacles) disables auto-imports project-wide, so nothing here may
  rely on a bare global. The host-provided `useLogger()` is the one symbol
  addressed through the embedding app: `~/composables/useLogger` — `~` resolves
  to the host's `app/`, and to `playground/composables/` in the playground.
  `playground/` is a self-contained dev-only Nuxt app for local visual tuning
  (see below).
- `"type": "module"`; all source is TypeScript / Vue 3 `<script setup lang="ts">` SFCs.
- Runtime dependencies are declared as `peerDependencies` and provided by the
  host: `nuxt` ^4, `vue` ^3, `@nuxt/ui`, `@nuxtjs/i18n`, `@tresjs/nuxt` +
  `@tresjs/cientos`, `three`, `@vueuse/core`, `@mediapipe/tasks-vision`.

## Repository layout

- `module.ts` — Nuxt module entry (`defineNuxtModule` via `@nuxt/kit`, no
  build step). Registers `components/`, `composables/` + `utils/`
  auto-imports, Tailwind v4 source scanning (vite transform appending
  `@source` to Tailwind CSS entries), i18n messages via the
  `i18n:registerModule` hook, and vite dev-server `fs.allow`. Hosts add this
  repo's local path to their `modules` array; nothing else.
- `components/` — Vue SFCs. `VirtualTryOnExperience.vue` is the main entry
  component (props: `models: TryOnModel[]`, `calibration-url`; emits `track`).
  `VirtualTryOnModal.vue`, `VirtualTryOnSuggestions.vue` are supporting UI;
  `TryOnScene.vue` is the TresJS scene (GLB loading, occluder, environment);
  `VirtualTryOnPrototype.vue` is a tuning/demo playground.
- `composables/tryon/` — stateful logic:
  - `useFaceLandmarker.ts` — worker-backed MediaPipe integration, rAF detect
    loop, pose/confidence exposure.
  - `useWebcamStream.ts` — webcam lifecycle (`getUserMedia`).
  - `useTryOnSmoothing.ts` — One-Euro filtering of landmarks/pose.
  - `useFrameCalibration.ts` — loads `calibration.json` and resolves
    per-model calibration.
  - `useTryOnModels.ts` — model list types/helpers.
- `workers/face-landmarker.worker.ts` — MediaPipe `FaceLandmarker` running in
  a dedicated **classic** Web Worker (see constraints below).
  `face-landmarker.worker.types.ts` holds the request/response types consumed
  by the main thread.
- `utils/` — pure, unit-testable math: `tryon.ts` (landmark→NDC/world
  remapping, metric/IPD scaling, occluder geometry, One-Euro filter,
  `TRYON_CAMERA` constants), `tryon-occluder.ts` (per-frame landmark-built
  face-mesh occluder: the tracked 468-point face surface rendered depth-only,
  so frame parts behind the skin — temple arms, far lens at profile — are
  hidden exactly where the real head hides them),
  `face-mesh-triangles.ts` (generated canonical-model triangulation), and
  `tryon-pose.ts` (transformation matrix → face-pose decomposition).
- `types/tryon-calibration.ts` — calibration manifest types
  (`TryOnCalibrationFile`, `TryOnModelCalibration`, `TryOnFrameCalibration`).
- `i18n/` — default translations (`bg`, `de`, `en`, `es`, `fr`, `it`, `nl`) under
  the `virtualTryOn.*` key; registered into the host's i18n config by
  `module.ts` (no manual merging needed).
- `playground/` — standalone dev-only Nuxt app (`npm run playground`, port
  4000) that mounts `VirtualTryOnPrototype` with the full frame catalog for
  local visual tuning. It consumes this repo through `module.ts` itself
  (dogfooding the exact host integration), provides a console-backed
  `useLogger` stand-in (playground-only — the module source still assumes
  the host's logger), and serves GLBs + `calibration.json` from the host
  checkout via nitro `publicAssets` (override with `TRYON_MODELS_DIR`). Not
  part of the shipped module.
- `scripts/generate-calibration.ts` — CLI that scans a directory of GLBs and
  emits `calibration.json` (bounding-box recentring + scale normalization
  against a reference model).
- `scripts/compress-models.ts` — CLI that Draco-compresses a directory of
  GLBs via `@gltf-transform/functions`' `draco()` transform. Run before
  `generate-calibration` on the compressed output, since compression can
  shift bounding boxes by float rounding.
- `scripts/trim-temple-tips.ts` — CLI that shortens the catalog GLBs' curled
  ear-hook temple tips (dropping geometry past a local-X threshold on the
  `pt2` node) and tilts the remaining straight shaft upward around the hinge,
  so it reads as resting over the ear rather than poking past it. Re-run
  against `public/models/virtual-try-on` whenever that catalog is
  regenerated from source GLBs with the full ear-hook geometry — the
  checked-in catalog already has this applied. **Do not** run it against
  `public/models/original` or `public/models/compressed` (see below) — those
  feed the product page's `<model-viewer>`, which should show the
  untrimmed, true-to-source frame.
- `tests/unit/` — Vitest unit tests (run from this repo).
- `tests/nuxt/` — Nuxt-environment tests (run from the host project).

## Build and test commands

There is no build step; the module is consumed as source. Useful commands:

```bash
npm install                     # only needed when working standalone
npx vitest                      # run unit tests (tests/unit only, per vitest.config.ts)
npx vitest run                  # single run (CI-style)
npm run playground              # standalone dev playground on :4000 (visual tuning)
npm run typecheck               # vue-tsc against the playground's generated tsconfig
npm run verify                  # vitest + playground build + booted-server smoke test
npx tsx scripts/generate-calibration.ts \
  --input public/models/virtual-try-on \
  --output public/models/virtual-try-on/calibration.json \
  --reference iris-bronze       # regenerate the calibration manifest
npm run compress-models -- \
  --input public/models/virtual-try-on \
  --output public/models/virtual-try-on   # Draco-compress a GLB directory in place
npx tsx scripts/trim-temple-tips.ts \
  --input public/models/virtual-try-on \
  --output public/models/virtual-try-on   # trim + upward-tilt temple tips in place
                                           # (--threshold, --tilt-degrees to override)
```

Testing strategy:

- `vitest.config.ts` includes only `tests/unit/**/*.test.ts`. Unit tests
  target the pure functions in `utils/` and worker-independent composable
  logic (e.g. `useFrameCalibration`) — no camera, GPU, or real MediaPipe.
- `tests/nuxt/**/*.nuxt.test.ts` (e.g. `useFaceLandmarker.nuxt.test.ts`)
  needs the Nuxt test environment and is **run from the host project**, which
  includes this directory in its own Vitest config. It fakes the worker with
  a `FakeWorker` class that records `postMessage` and drives responses back
  through `onmessage`.
- New pure logic should go in `utils/` and get a unit test; worker-dependent
  composables get a `FakeWorker`-style nuxt test.

## Host integration contract

When changing public surfaces, keep the host contract in mind (documented in
`README.md`):

- Host adds this repo's local path to their `modules` array; `module.ts`
  self-registers components, composables/utils, Tailwind source scanning,
  i18n messages, and worker `fs.allow`.
- Host provides `@nuxt/ui` components (`UButton`, `UModal`, `USlider`, …),
  `@nuxtjs/i18n`, `@tresjs/nuxt`, and a host-defined `useLogger()` composable —
  do not add local stubs for them. `U*` and `<NuxtLinkLocale>` stay globally
  registered by their modules; `useI18n` (from `vue-i18n`) and `useLogger`
  (from `~/composables/useLogger`) must be imported explicitly.
- Host supplies GLB assets and a generated `calibration.json` at a
  host-controlled URL, passes `models` + `calibration-url` props, and consumes
  the `track` event (all analytics stay in the host).

## Code style and conventions

- English is the project language for code, comments, and docs.
- Vue 3 Composition API with `<script setup lang="ts">`, typed props via
  `defineProps<{…}>` + `withDefaults`, typed composable options/return types.
- Composables return plain refs/computed; SSR-safe guards via
  `import.meta.client` around browser-only work.
- Heavy doc comments are the norm: coordinate conventions, MediaPipe
  quirks, and the reasoning behind non-obvious decisions are documented
  inline at the top of files/functions. Keep these comments accurate when
  changing behavior.
- Pure math lives in `utils/` (no Vue/Nuxt imports) so it stays unit-testable
  without a camera/GPU; composables and components hold the stateful glue.

## Critical constraints (do not break)

- **Classic worker, zero imports**: `workers/face-landmarker.worker.ts` must
  contain no static `import`/`export` syntax — esbuild would emit a module
  marker that is a SyntaxError in a classic worker, and MediaPipe's WASM
  loader relies on synchronous `importScripts`, which module workers don't
  support. Worker message types are therefore duplicated inline; the source
  of truth for the main thread is `face-landmarker.worker.types.ts` — keep
  both in sync.
- **Mirror-once convention**: the front-camera preview is mirrored via
  `scaleX(-1)` on the `<video>` only; landmark `x` is flipped in
  `landmarkToNdc` to match. Never mirror the canvas/scene too — that makes
  the frame track the head backwards.
- **One in-flight detection**: `useFaceLandmarker` allows a single
  outstanding detect request (`pendingRequestId`); stale responses are
  discarded by request id. Preserve this throttling behavior.
- **VIDEO mode only**: the `FaceLandmarker` instance is created in VIDEO
  running mode and never switches — the live camera is the only input
  source (the photo-upload path was removed).
- MediaPipe WASM and the face model are loaded from CDNs (jsdelivr /
  Google storage) at runtime by default — network access is required at
  first load unless the host overrides `mediapipeBasePath` /
  `mediapipeModelAssetPath` (see below) to self-hosted paths.

## Security and privacy considerations

- Camera frames are processed **entirely on-device**;
  face tracking runs locally in the worker and no video leaves the
  browser. The i18n copy makes this promise to users (`virtualTryOn.consent`)
  — do not introduce network transmission of imagery.
- All analytics flow through the `track` event to the host; the module itself
  sends nothing.
- Secrets/config (`.env`, `*.local`) are git-ignored; the module holds no
  credentials.

## Known production gaps

The module now supports compression and self-hosting overrides, but actually
using them (compressing the catalog, hosting the assets) is host-repo work:

- **GLB asset size**: catalog models are ~5.8MB each — fine for local
  tuning, too large to download per try-on session. Run
  `scripts/compress-models.ts` against the host's model directory before
  shipping; `TryOnScene`'s loader already decodes Draco meshes (`draco` prop,
  default `true`). Re-run `generate-calibration` against the compressed
  output afterward.
- **MediaPipe / Draco CDN dependency**: by default
  `workers/face-landmarker.worker.ts` loads WASM and model weights from
  `cdn.jsdelivr.net` / `storage.googleapis.com`, and `TryOnScene`'s Draco
  decoder from TresJS's gstatic CDN default. A CDN outage or breaking
  upstream release takes down try-on entirely beyond the existing
  "unsupported" error state. Pass `mediapipeBasePath` /
  `mediapipeModelAssetPath` / `dracoDecoderPath` to `VirtualTryOnExperience`
  with self-hosted paths to remove the dependency — hosting the actual files
  (copied from `@mediapipe/tasks-vision`'s `wasm/` dir, the model-zoo `.task`
  file, and `three`'s `examples/jsm/libs/draco/`) is host-repo work.
