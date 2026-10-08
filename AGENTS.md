# AGENTS.md

## Project overview

`@eleven.spectacles/virtual-try-on` — a **Nuxt-only module** implementing the
Eleven Spectacles virtual try-on experience. It composites 3D eyewear GLB
models over a live front-camera feed using MediaPipe `FaceLandmarker` for face
tracking and TresJS (Three.js) for rendering.

Key facts:

- Published to npm as `@eleven.spectacles/virtual-try-on`, built with
  `@nuxt/module-builder` (`dist/`). Local checkouts (the playground, a
  sibling host checkout) consume the source entry `src/module.ts` directly,
  no build needed.
- No app entry point at the repo root. **Import everything explicitly** —
  `ref`/`computed`/`onBeforeUnmount` from `vue`, VueUse from `@vueuse/core`, Nuxt composables from `#imports`, sibling
  components/composables by relative path. The host disables auto-imports
  project-wide. Never import host paths like `~/composables/*`.
- **The module never logs.** Failures surface as slot state and a
  `TRY_ON_ERROR` `track` event carrying `source` and `message`; the host
  does all logging from its `track` handler. Do not add `console.*` calls or
  a logger injection point.
- `"type": "module"`; all source is TypeScript / Vue 3
  `<script setup lang="ts">` SFCs.
- `peerDependencies` are only what the host already owns: `nuxt` ^4,
  `vue` ^3, `@vueuse/core`. `dependencies` are `@nuxt/kit` (module entry),
  `@tresjs/nuxt` + `@tresjs/core` + `three` (the module installs
  `@tresjs/nuxt` through `moduleDependencies`, so hosts never list or
  install them; `resolve.dedupe` keeps one copy if a host also imports
  three), and `@mediapipe/tasks-vision`,
  pinned to an exact version: only the worker uses it, and its JS must match
  the WASM version in the worker's `DEFAULT_WASM_BASE_PATH`
  (`tests/unit/mediapipe-version.test.ts` enforces it). Bump both together.

## Repository layout

- `src/module.ts` — Nuxt module entry (`defineNuxtModule` via `@nuxt/kit`).
  Installs `@tresjs/nuxt` (`moduleDependencies`), registers `components/`, `composables/` + `utils/` auto-imports,
  `resolve.dedupe` for the shared peers, vite dev-server `fs.allow`, and an `optimizeDeps.exclude` for the package. Also
  re-exports the public types (`TryOnModel`, calibration and slot/state
  types). Hosts add one `modules` entry; nothing else.
- `build.config.ts` — module-builder (unbuild) hook that rewrites the worker
  URL in the built `useFaceLandmarker.js` from `.ts` to `.js` (mkdist
  transpiles the worker but not the `new URL()` string). Fails the build if
  the reference moves.
- `src/runtime/` — everything shipped to the host app. Paths below are
  relative to it.
- `components/` — the entire public surface, exactly two SFCs:
  - `VirtualTryOnExperience.vue` — the main entry (props: `models:
    TryOnModel[]`, `calibration-url`, `auto-start`, tuning/self-hosting
    overrides; `v-model:model`; emits `track`). **Headless**: renders only
    the mirrored video + tracked frame, filling its container, with
    structural scoped CSS. Consent, errors, guide hints and controls are the
    host's, built from the default scoped slot (`status`, `error`,
    `faceError`, `hasFace`, `guideHint`, `start`, `stop`; also exposed on
    the ref). Never add UI copy, icons, a UI library or utility classes.
  - `TryOnScene.vue` — the TresJS scene (GLB loading, occluder, environment).
    Uses three's own `GLTFLoader`/`DRACOLoader`/`HDRLoader`, not
    `@tresjs/cientos` — cientos does not tree-shake, so keep it out.
- `composables/tryon/` — stateful logic:
  - `useFaceLandmarker.ts` — worker-backed MediaPipe integration, rAF detect
    loop, pose/confidence exposure.
  - `useWebcamStream.ts` — webcam lifecycle (`getUserMedia`).
  - `useTryOnSmoothing.ts` — One-Euro filtering of landmarks/pose.
  - `useFrameCalibration.ts` — loads `calibration.json` and resolves
    per-model calibration.
  - `useTryOnModels.ts` — model list types/helpers (`TryOnModel`).
- `workers/face-landmarker.worker.ts` — MediaPipe `FaceLandmarker` in a
  dedicated **classic** Web Worker (see constraints).
  `face-landmarker.worker.types.ts` holds the request/response types consumed
  by the main thread.
- `utils/` — pure, unit-testable math: `tryon.ts` (landmark→NDC/world
  remapping, metric/IPD scaling, occluder geometry, One-Euro filter,
  `TRYON_CAMERA` constants), `tryon-occluder.ts` (per-frame landmark-built
  face-mesh occluder: the tracked 468-point face surface rendered depth-only,
  so frame parts behind the skin are hidden exactly where the real head hides
  them), `face-mesh-triangles.ts` (generated canonical-model triangulation),
  `tryon-pose.ts` (matrix → face-pose decomposition).
- `types/tryon-calibration.ts` — calibration manifest types
  (`TryOnCalibrationFile`, `TryOnModelCalibration`, `TryOnFrameCalibration`).
- `types/tryon-experience.ts` — slot/state types (`TryOnStatus`,
  `TryOnGuideHint`, `WebcamError`, `FaceLandmarkerError`), re-exported by
  `src/module.ts`.
- No i18n layer and no UI copy — do not add `vue-i18n` / `@nuxtjs/i18n`.
- `playground/` — standalone dev-only Nuxt app (`npm run playground`, port
  4000). Consumes this repo through `src/module.ts` itself (dogfooding the exact
  host integration), mounts `playground/components/VirtualTryOnPrototype.vue`
  (tuning UI: model picker, sliders, occluder/bounding-box debug views,
  `?model=` + `?debug_tryon=true`), and serves GLBs + `calibration.json` from
  the host checkout via nitro `publicAssets` (override with
  `TRYON_MODELS_DIR`). Not part of the shipped module.
- `scripts/` — CLIs:
  - `generate-calibration.ts` — scans a GLB directory and emits
    `calibration.json` (bounding-box recentring + scale normalization against
    a reference model).
  - `compress-models.ts` — Draco-compresses GLBs via `@gltf-transform`. Run
    `generate-calibration` against the compressed output (compression shifts
    bounding boxes by float rounding).
  - `trim-temple-tips.ts` — shortens curled ear-hook temple tips on catalog
    GLBs. Only ever run against `public/models/virtual-try-on`, **never**
    `public/models/original` or `public/models/compressed`.
  - `verify-playground.mjs` — playground smoke test (build + boot + asset
    checks). Renders the shipped component via the playground's
    `?view=experience` and looks for its `vto-stage` class.
- `tests/unit/` — Vitest unit tests (run from this repo). `tests/nuxt/` —
  Nuxt-environment tests, run from the host project.
- `tests/e2e/` — Playwright face-fixture harness (`npm run verify:e2e`,
  `playwright.config.ts`). `tests/fixtures/faces/<model>.jpg` are portraits
  of a person wearing that catalog frame; `fixtures.ts` renders them with
  ffmpeg into still/motion Y4M clips for Chromium's fake camera.
  `tracking.spec.ts` drives the playground prototype through its
  `?harness=true` hook (`window.__tryOnHarness`) and asserts detection rate
  and still-input jitter; `render.spec.ts` screenshots the shipped component
  (`?view=experience`) against goldens in `tests/e2e/__screenshots__/`.
  Tracking runs on the real GPU (MediaPipe's GPU delegate is unusably slow on
  SwiftShader); goldens run on SwiftShader so pixels match across machines.
  Local-only like `verify:playground`: skips when the models dir or ffmpeg
  is missing. After an intended visual change, run
  `npm run verify:e2e -- --update-snapshots` and review the PNG diffs.

## Build and test commands

Local consumers load source; `npm run build` (also `prepack`) emits `dist/`
for npm.

```bash
npm install            # only needed when working standalone
npx vitest run         # unit tests (tests/unit only, per vitest.config.ts)
npm run playground     # dev playground on :4000
npm run typecheck      # vue-tsc against the playground's generated tsconfig
npm run verify:e2e     # face-fixture tracking + golden screenshots (needs ffmpeg)
npm run verify         # vitest + playground smoke test + face-fixture e2e
npm run build          # dist/ via nuxt-module-build
npm pack --dry-run     # tarball must hold only dist/, CHANGELOG.md, README.md, package.json
```

Releases run only through release-please
(`.github/workflows/release-please.yml`, `release-please-config.json`,
`.release-please-manifest.json`): pushes to `main` maintain a release PR;
merging it tags, creates the GitHub Release and publishes to npm. Never
hand-edit the version, the manifest or `CHANGELOG.md`; keep commit messages conventional
(`feat:` / `fix:` / `chore(deps):` …) since they *are* the changelog.

Testing strategy: unit tests target the pure functions in `utils/` and
worker-independent composable logic — no camera, GPU, or real MediaPipe.
`tests/nuxt/**/*.nuxt.test.ts` needs the Nuxt test environment and runs from
the host, faking the worker with a `FakeWorker` class. New pure logic goes in
`utils/` and gets a unit test; worker-dependent composables get a
`FakeWorker`-style nuxt test.

## Host integration contract

- Host adds `'@eleven.spectacles/virtual-try-on'` (or the local
  `src/module` path) to `modules`; the module self-registers everything else.
- Host provides VueUse (TresJS and three ship with the module) and
  builds all UI around the component from its slot — the module depends on
  no UI library. `@nuxt/ui` is a playground-only devDependency.
- Host logs failures from its `track` handler (`TRY_ON_ERROR` events); the
  module has no logger.
- Host supplies GLB assets and a generated `calibration.json` at a
  host-controlled URL, passes `models` + `calibration-url`, and consumes the
  `track` event (all analytics stay in the host).
- Host owns all UI: consent, error states, guide hints, modal/overlay,
  close button and frame picker. The host also sizes the component (it fills
  its container).

## Code style and conventions

- English for code, comments, and docs.
- Vue 3 Composition API with `<script setup lang="ts">`, typed props via
  `defineProps<{…}>` + `withDefaults`, typed composable options/returns.
- Composables return plain refs/computed; SSR-safe guards via
  `import.meta.client` around browser-only work.
- Heavy doc comments are the norm: coordinate conventions, MediaPipe quirks,
  and reasoning behind non-obvious decisions are documented inline. Keep them
  accurate when changing behavior.
- Pure math lives in `utils/` (no Vue/Nuxt imports) so it stays unit-testable;
  composables and components hold the stateful glue.

## Critical constraints (do not break)

- **Classic worker, zero imports**: `workers/face-landmarker.worker.ts` must
  contain no static `import`/`export` syntax — esbuild would emit a module
  marker that is a SyntaxError in a classic worker, and MediaPipe's WASM
  loader relies on synchronous `importScripts`, which module workers don't
  support. Worker message types are duplicated inline; the main-thread source
  of truth is `face-landmarker.worker.types.ts` — keep both in sync.
- **Works from both layouts**: `src/module.ts` must resolve everything via
  `createResolver` against `./runtime/…` and never assume `.ts` files exist —
  from npm it runs as `dist/module.mjs` next to transpiled `.js` runtime.
  Verify publish-affecting changes by installing the `npm pack` tarball into
  the playground (`modules: ['@eleven.spectacles/virtual-try-on']`).
- **Mirror-once convention**: the camera preview is mirrored via
  `scaleX(-1)` on the `<video>` only; landmark `x` is flipped in
  `landmarkToNdc` to match. Never mirror the canvas/scene too.
- **One in-flight detection**: `useFaceLandmarker` allows a single outstanding
  detect request (`pendingRequestId`); stale responses are discarded by
  request id.
- **VIDEO mode only**: the `FaceLandmarker` runs in VIDEO running mode and
  never switches — the live camera is the only input source.
- MediaPipe WASM and the face model load from CDNs (jsdelivr / Google
  storage) by default — first load needs network unless the host passes
  `mediapipeBasePath` / `mediapipeModelAssetPath` self-hosted overrides (also
  `dracoDecoderPath` for the Draco decoder).

## Security and privacy

- Camera frames are processed **entirely on-device**; no video leaves the
  browser. Hosts promise this in their consent copy — never
  introduce network transmission of imagery.
- All analytics flow through the `track` event to the host; the module sends
  nothing.
- The module holds no credentials; `.env` / `*.local` are git-ignored.
