# @elevenspectacles/virtual-try-on

Nuxt-only module for the Eleven Spectacles virtual try-on experience. It
composites 3D eyewear GLB models over a live front-camera feed or uploaded
photo using MediaPipe face tracking and TresJS rendering.

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

### 1. Mount the submodule

```bash
git submodule add git@github.com:your-org/virtual-try-on.git app/virtual-try-on
```

### 2. Register module directories in `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  components: {
    dirs: [
      { path: '~/components', pathPrefix: false },
      { path: '~/virtual-try-on/components', pathPrefix: false }
    ]
  },
  imports: {
    dirs: [
      '~/composables',
      '~/virtual-try-on/composables',
      '~/virtual-try-on/utils'
    ]
  }
})
```

### 3. Provide models and calibration

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

### 4. Merge translations

In each host locale file (e.g. `i18n/locales/en.ts`):

```ts
import virtualTryOn from '~/virtual-try-on/i18n/en'

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

## Tracking

All analytics stay in the host. The module emits a `track` event with the
standard try-on event names and payloads; the host forwards them to its own
`useTracking()` implementation.
