# @elevenspectacles/virtual-try-on

Nuxt-only module for the Eleven Spectacles virtual try-on experience. It
composites 3D eyewear GLB models over a live front-camera feed using
MediaPipe face tracking and TresJS rendering.

This module is consumed as a git submodule. It is intentionally **not**
published to npm and is not designed for reuse outside the Eleven Spectacles
Nuxt project.

## What lives here

- `module.ts` — Nuxt module entry: registers components, composables/utils
  auto-imports, Tailwind v4 source scanning, i18n messages, and dev-server
  worker access automatically
- `components/` — `VirtualTryOnExperience`, `VirtualTryOnModal`,
  `VirtualTryOnSuggestions`, `TryOnScene`, `VirtualTryOnPrototype`
- `composables/tryon/` — MediaPipe worker integration, webcam lifecycle,
  smoothing, frame calibration lookup, model helpers
- `utils/` — pure math for landmark remapping, metric scaling, occluder
  geometry, and face-pose decomposition
- `workers/` — MediaPipe `FaceLandmarker` Web Worker
- `types/` — calibration TypeScript types
- `i18n/` — default translations for `virtualTryOn.*` keys
- `scripts/` — GLB calibration manifest generator

## Host expectations

The consuming Nuxt project must provide:

- `@nuxt/ui` for UI components (`UButton`, `UModal`, `USlider`, etc.)
- `@nuxtjs/i18n` for `useI18n()` / `$t()` and `<NuxtLinkLocale>`
- `@tresjs/nuxt` registered in `nuxt.config.ts`
- `@vueuse/core` composables
- `useLogger()` composable, imported as `~/composables/useLogger`
- GLB model assets and a generated `calibration.json` at a host-controlled path

## Usage in host

### 1. Register the module

Keep this repo as a **sibling checkout** (or git submodule) and add it to the
host's `modules` array by local path:

```ts
// nuxt.config.ts
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxtjs/i18n',
    '@tresjs/nuxt',
    fileURLToPath(new URL('../virtual-try-on', import.meta.url))
  ]
})
```

That single line registers everything the try-on needs:

- `components/*.vue` as auto-imported, unprefixed components
- `composables/` + `utils/` auto-imports
- Tailwind v4 `@source` scanning of the module's components (they live
  outside the host root, so default scanning misses them — the module
  appends the directive to every CSS entry that imports Tailwind itself)
- `virtualTryOn.*` messages merged into each locale via
  `@nuxtjs/i18n`'s `i18n:registerModule` hook (no-op without i18n)
- Vite dev-server `fs.allow` for serving this repo's classic worker

The host must still provide `@nuxt/ui`, `@nuxtjs/i18n`, `@tresjs/nuxt`,
`@vueuse/core`, and a `useLogger()` composable at `~/composables/useLogger`.
This repo's own source imports everything explicitly — the host disables Nuxt
auto-imports, so bare globals are not available here.

### 2. Provide models and calibration

```vue
<script setup lang="ts">
import type { TryOnModel } from '~/virtual-try-on/composables/tryon/useTryOnModels'

const models: TryOnModel[] = [
  { label: 'Iris · Bronze', file: 'iris-bronze', family: 'iris', color: 'Bronze', colorClass: 'bg-amber-700' },
  // ...
]

const { track } = useTracking()

function onTryOnTrack(event: string, payload: Record<string, unknown>) {
  track(event, payload).catch(() => {})
}
</script>

<template>
  <VirtualTryOnExperience
    :models="models"
    calibration-url="/models/calibration.json"
    @track="onTryOnTrack"
  />
</template>
```

### Public contract: `VirtualTryOnExperience`

Props:

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `models` | `TryOnModel[]` | required | Full catalog. Must contain at least one model. |
| `calibrationUrl` | `string` | required | URL of the generated `calibration.json`. |
| `modelBaseUrl` | `string` | `'/models'` | Directory the GLB files are served from (`<modelBaseUrl>/<file>.glb`). |
| `initialModel` | `string` | — | `file` of the model to render first. Falls back to the `?model=` query param, then to `models[0]`. |
| `simplifiedControls` | `boolean` | `true` | Hides the tuning sliders (exposure, scale, yaw, temple width). |
| `mediapipeBasePath` | `string` | jsDelivr CDN | Directory the MediaPipe Wasm fileset is served from. Pass a same-origin path to self-host. |
| `mediapipeModelAssetPath` | `string` | Google-storage CDN | URL/path to the `face_landmarker.task` model asset. |
| `draco` | `boolean` | `true` | Whether the GLB loader wires up Draco decompression. Safe to leave on even for uncompressed GLBs. |
| `dracoDecoderPath` | `string` | TresJS's gstatic CDN default | Draco decoder path override — pass a same-origin path to self-host. |

v-model:

- `v-model:model` (`string`) — the `file` of the currently rendered model.
  To render a single product's glasses, pass `:models="[thatModel]"` (or the
  full catalog with `:initial-model="file"`) and drive switches via
  `v-model:model`.

Events:

- `track(event: string, payload: Record<string, unknown>)` — emitted with
  `TRY_ON_OPENED`, `TRY_ON_CAMERA_GRANTED`, `TRY_ON_CAMERA_DENIED`,
  `TRY_ON_FACE_DETECTED`, `TRY_ON_FRAME_CHANGED`,
  `TRY_ON_ERROR`. Forward to the host's analytics.

### Debug playground: `VirtualTryOnPrototype`

For a host debug page that exercises every model, mount
`VirtualTryOnPrototype` and pass the whole catalog — it renders a model
picker (all `models`, switchable at runtime) plus tuning sliders for scale,
offsets, and the occluder:

```vue
<template>
  <VirtualTryOnPrototype
    :models="models"
    calibration-url="/models/calibration.json"
    @track="onTryOnTrack"
  />
</template>
```

Props: `models`, `calibrationUrl`, `modelBaseUrl` (same semantics as
`VirtualTryOnExperience`). It also honors `?model=` for deep-linking a
specific frame and `?debug_tryon=true` for extra diagnostics.

### 3. Translations

Nothing to do — the module registers its `virtualTryOn.*` messages for all
supported locales (`en`, `bg`, `de`, `es`, `fr`, `it`, `nl`) automatically
when `@nuxtjs/i18n` is installed. Host translations win over the module's on
key conflicts.

## Calibration generation

The module includes a script that scans a directory of GLB files and emits a
`calibration.json` manifest.

```bash
npx tsx app/virtual-try-on/scripts/generate-calibration.ts \
  --input public/models \
  --output public/models/calibration.json \
  --reference iris-bronze
```

The calibration is per-model: it recenters each GLB's bounding box onto the
tracked face anchor and normalizes the scale against the reference model.

## GLB compression

GLBs in the catalog run several MB uncompressed. Before shipping a model
directory to production, compress it with Draco mesh compression:

```bash
npx tsx app/virtual-try-on/scripts/compress-models.ts \
  --input public/models \
  --output public/models
```

`TryOnScene`'s GLB loader (`draco` prop, default `true`) already decodes
Draco-compressed meshes — compressing the source files needs no component
changes. Run `generate-calibration` against the compressed output, since
compression can shift bounding boxes by float rounding.

## Self-hosting MediaPipe and Draco assets

By default the module loads MediaPipe's Wasm fileset and model weights from
CDNs (`cdn.jsdelivr.net`, `storage.googleapis.com`), and the Draco decoder
from TresJS's gstatic CDN default. To remove those runtime CDN dependencies,
host the files yourself and pass overrides:

```vue
<VirtualTryOnExperience
  :models="models"
  calibration-url="/models/calibration.json"
  mediapipe-base-path="/mediapipe/wasm"
  mediapipe-model-asset-path="/mediapipe/face_landmarker.task"
  draco-decoder-path="/draco/"
  @track="onTryOnTrack"
/>
```

The MediaPipe Wasm binaries ship inside
`@mediapipe/tasks-vision`'s own package (`wasm/`) — copy them into a public
directory the host serves. The `.task` model file is downloadable from
Google's model zoo. The Draco decoder ships inside `three`'s `examples/jsm/libs/draco/`.

## Module-only tests

```bash
npm install  # only needed if running standalone
npx vitest
```

Nuxt-environment tests for the module are intended to be run from the host
project, which includes the module's `tests/nuxt` directory in its Vitest config.

## Local playground

A self-contained Nuxt app for visual tuning lives in `playground/`:

```bash
npm install
npm run playground   # serves on http://localhost:4000
```

It mounts `VirtualTryOnPrototype` with the full frame catalog — model picker,
tuning sliders, occluder/bounding-box debug views. Query params:
`?model=<file>` deep-links a frame, `?debug_tryon=true` shows extra
diagnostics.

GLBs and `calibration.json` are served from the host checkout
(`../nuxt/public/models`); point `TRYON_MODELS_DIR` elsewhere if your layout
differs. The playground is dev-only and is not part of the shipped module.

## Verification

```bash
npm run verify
```

Runs the unit tests, builds the playground, boots the production server, and
smoke-tests that the page, `calibration.json`, and GLB assets serve and that
icons render without errors. Exits non-zero on any failure — safe to gate CI
on.

## Tracking

All analytics stay in the host. The module emits a `track` event with the
standard try-on event names and payloads; the host forwards them to its own
`useTracking()` implementation.
