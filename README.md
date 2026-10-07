# @elevenspectacles/virtual-try-on

Nuxt module that renders 3D eyewear (GLB models) over a live front-camera
feed — MediaPipe `FaceLandmarker` tracking in a Web Worker, TresJS (Three.js)
rendering, all processing on-device.

Published to npm as a scoped package (built with `@nuxt/module-builder`);
can also be consumed from a local checkout.

## Setup

```bash
npm i @elevenspectacles/virtual-try-on
```

The host Nuxt app provides the peer dependencies: `@nuxt/ui`, `@nuxtjs/i18n`
(+ `vue-i18n`), `@tresjs/nuxt` + `@tresjs/cientos`, `@vueuse/core`, `three`,
`@mediapipe/tasks-vision`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxtjs/i18n',
    '@tresjs/nuxt',
    '@elevenspectacles/virtual-try-on'
  ]
})
```

**Local checkout** (no build needed): point `modules` at the source entry
instead, e.g.
`fileURLToPath(new URL('../virtual-try-on/src/module', import.meta.url))`.

That one entry auto-registers the components, composables/utils, Tailwind v4
`@source` scanning, the `virtualTryOn.*` i18n messages
(`bg`, `de`, `en`, `es`, `fr`, `it`, `nl`), and dev-server access to the
worker. Nothing else to wire.

### Logging

Module logs go to the console by default. To route them into the host's
logger, provide `$tryOnLogger` (any object with `info`/`warn`/`error`):

```ts
// app/plugins/tryon-logger.ts
export default defineNuxtPlugin(() => ({
  provide: { tryOnLogger: useLogger() }
}))
```

## Usage

The host owns the surrounding UI (modal, page layout, analytics). The module
renders just the camera view with the tracked frame:

```vue
<script setup lang="ts">
import type { TryOnModel } from '@elevenspectacles/virtual-try-on'

const models: TryOnModel[] = [
  { label: 'Iris · Bronze', file: 'iris-bronze', family: 'iris', color: 'Bronze', colorClass: 'bg-amber-700' }
]

function onTrack(event: string, payload: Record<string, unknown>) {
  // forward to host analytics
}
</script>

<template>
  <VirtualTryOnExperience
    :models="models"
    calibration-url="/models/virtual-try-on/calibration.json"
    @track="onTrack"
  />
</template>
```

GLBs are served as `<modelBaseUrl>/<file>.glb` (`modelBaseUrl` defaults to
`/models`).

| Prop | Default | Purpose |
| --- | --- | --- |
| `models` | required | `TryOnModel[]` catalog, at least one entry |
| `calibrationUrl` | required | URL of the generated `calibration.json` |
| `initialModel` | — | first frame; falls back to `?model=`, then `models[0]` |
| `simplifiedControls` | `true` | hides the tuning sliders |
| `mediapipeBasePath` / `mediapipeModelAssetPath` | CDN | self-hosting overrides for MediaPipe assets |
| `draco` / `dracoDecoderPath` | `true` / CDN | Draco decoding + self-hosted decoder path |

`v-model:model` exposes the active frame's `file`. The `track` event emits
`TRY_ON_OPENED`, `TRY_ON_CAMERA_GRANTED`, `TRY_ON_CAMERA_DENIED`,
`TRY_ON_FACE_DETECTED`, `TRY_ON_FRAME_CHANGED`, `TRY_ON_ERROR`.

## Model tooling

```bash
npm run compress-models -- --input <dir> --output <dir>     # Draco-compress GLBs
npm run generate-calibration -- \
  --input <dir> --output <dir>/calibration.json --reference <file>
```

Compress first, then generate calibration against the compressed output
(compression can shift bounding boxes by float rounding).

## Playground & verification

```bash
npm install
npm run playground   # dev playground on http://localhost:4000
npm run verify       # unit tests + playground build + smoke test
npm run build        # dist/ via @nuxt/module-builder
```

`playground/` is a dev-only Nuxt app that dogfoods the module through
`src/module.ts` itself, mounting a tuning prototype with the full frame catalog
(`?model=<file>`, `?debug_tryon=true`). GLBs and `calibration.json` are served
from the host checkout; override with `TRYON_MODELS_DIR`.

## Releasing

Releases are cut from GitHub: **Actions → Release → Run workflow** (on
`main`). Pick `auto` (bump derived from conventional commits: `feat` → minor,
`fix` → patch, breaking → major) or force `patch` / `minor` / `major`. The
workflow runs the tests, bumps `package.json`, prepends
[`CHANGELOG.md`](./CHANGELOG.md), publishes to npm, pushes the
`chore(release)` commit + `vX.Y.Z` tag, and creates a GitHub Release from the
same changelog section.

One-time setup: an npm automation token with publish rights on the
`@elevenspectacles` org, stored as the `NPM_TOKEN` repository secret. If
`main` is branch-protected, allow `github-actions[bot]` to push.

Preview the next changelog locally with `npm run changelog`.

`publishConfig.access` is `restricted` (private scoped package, needs a paid
org); change it to `public` to publish openly. Check the tarball with
`npm pack --dry-run` — it should contain only `dist/`, `CHANGELOG.md`,
`README.md` and `package.json`.

## Privacy

Camera frames are processed entirely on-device — no video leaves the browser.
Analytics flow only through the `track` event; the module sends nothing.
