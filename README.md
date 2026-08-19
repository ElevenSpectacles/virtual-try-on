# @elevenspectacles/virtual-try-on

Nuxt-only module for the Eleven Spectacles virtual try-on experience. It
composites 3D eyewear GLB models over a live front-camera feed using
MediaPipe face tracking and TresJS rendering.

This module is consumed as a git submodule. It is intentionally **not**
published to npm and is not designed for reuse outside the Eleven Spectacles
Nuxt project.

## What lives here

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
- `useLogger()` composable (auto-imported by host)
- GLB model assets and a generated `calibration.json` at a host-controlled path

## Usage in host

### 1. Mount the module

The Eleven Spectacles host keeps this repo as a **sibling checkout** and
references it through a Nuxt alias (a git submodule under `app/` also works —
point the alias there instead):

```ts
// nuxt.config.ts
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  alias: {
    'virtual-try-on': fileURLToPath(
      new URL('../virtual-try-on', import.meta.url)
    )
  }
})
```

### 2. Register module directories in `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  modules: ['@tresjs/nuxt' /* …host modules… */],
  components: {
    dirs: [
      { path: '~/components', pathPrefix: false },
      { path: 'virtual-try-on/components', pathPrefix: false }
    ]
  },
  imports: {
    dirs: [
      '~/composables',
      'virtual-try-on/composables',
      'virtual-try-on/utils'
    ]
  },
  vite: {
    server: {
      fs: {
        // Dev server must be allowed to serve the module's classic worker
        // from outside the host root.
        allow: [fileURLToPath(new URL('..', import.meta.url))]
      }
    }
  }
})
```

### 3. Source the module's CSS utilities

Tailwind v4 only auto-scans the host root — the module's components live
outside it, so their utilities silently never generate unless you add an
explicit `@source` to the host's main stylesheet (path relative to the CSS
file):

```css
/* app/assets/css/main.css */
@source "../../../../virtual-try-on/components";
```

### 4. Provide models and calibration

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

### 4. Merge translations

In each host locale file (e.g. `i18n/locales/en.ts`):

```ts
import virtualTryOn from 'virtual-try-on/i18n/en'

export default {
  // ...host translations
  ...virtualTryOn
}
```

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
