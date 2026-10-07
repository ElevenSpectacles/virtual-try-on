# @eleven.spectacles/virtual-try-on

[![npm](https://img.shields.io/npm/v/@eleven.spectacles/virtual-try-on)](https://www.npmjs.com/package/@eleven.spectacles/virtual-try-on)
[![CI](https://github.com/ElevenSpectacles/virtual-try-on/actions/workflows/ci.yml/badge.svg)](https://github.com/ElevenSpectacles/virtual-try-on/actions/workflows/ci.yml)

Real-time virtual try-on for eyewear, as a Nuxt module. Renders 3D glasses
(GLB) on the user's face over a live front-camera feed: MediaPipe
`FaceLandmarker` tracks the face in a Web Worker, TresJS (Three.js) renders
the frame, and everything runs on-device.

Built by [Eleven Spectacles](https://elevenspectacles.com) — luxury eyewear,
with virtual try-on for every frame in the catalog.

- **One `modules` entry** — components, composables and Tailwind v4
  scanning register themselves.
- **Private by design** — camera frames never leave the browser.
- **Accurate fit** — metric scaling from the user's face width, per-frame
  calibration, and a face-mesh occluder that hides temples behind the head.
- **Smooth** — One-Euro filtering on landmarks and pose; detection runs off
  the main thread.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Serving models and calibration](#serving-models-and-calibration)
- [API](#api)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Requirements

- **Nuxt 4** with `@nuxt/ui` 4 and `@tresjs/nuxt` 5.
- **Browser**: WebAssembly, Web Workers, `createImageBitmap` and
  `getUserMedia` — every current evergreen browser, desktop and mobile.
  Unsupported browsers get an error state instead of a crash.
- **Secure context**: camera access only works over HTTPS (or `localhost`).

## Installation

```bash
npm i @eleven.spectacles/virtual-try-on
```

Install the peer dependencies your app doesn't already have:

```bash
npm i @nuxt/ui @tresjs/nuxt @tresjs/cientos three @vueuse/core @mediapipe/tasks-vision
```

Register the module after its peers:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@tresjs/nuxt',
    '@eleven.spectacles/virtual-try-on'
  ]
})
```

That's all the wiring. The module registers its components and
composables and adds its components to Tailwind v4 scanning.

## Usage

The module renders the try-on view only — consent screen, mirrored camera
and tracked frame. The host owns everything around it (modal, page layout,
frame picker, analytics):

```vue
<script setup lang="ts">
import type { TryOnModel } from '@eleven.spectacles/virtual-try-on'

const models: TryOnModel[] = [
  {
    label: 'Iris · Bronze',
    file: 'iris-bronze',
    family: 'iris',
    color: 'Bronze',
    colorClass: 'bg-amber-700'
  }
]
const activeModel = ref('iris-bronze')

function onTrack(event: string, payload: Record<string, unknown>) {
  // forward to your analytics
}
</script>

<template>
  <VirtualTryOnExperience
    v-model:model="activeModel"
    :models="models"
    calibration-url="/models/virtual-try-on/calibration.json"
    @track="onTrack"
  />
</template>
```

## Serving models and calibration

The component loads two kinds of static assets from your app:

| Asset | URL | Notes |
| --- | --- | --- |
| Frame models | `<modelBaseUrl>/<file>.glb` | `modelBaseUrl` defaults to `/models/virtual-try-on`. Draco compression is supported and recommended. |
| Calibration | `calibrationUrl` | One JSON manifest covering all frames. |

With the defaults, put the files in `public/models/virtual-try-on/`.

Calibration lines every frame up to the same baseline, because GLB exports
rarely share an origin or scale:

```jsonc
{
  "schemaVersion": "1.0.0",
  "reference": "iris-bronze",          // model the others are normalised against
  "models": {
    "iris-bronze": {
      "model": "iris-bronze",          // GLB filename without .glb
      "translation": { "x": 0, "y": 0, "z": 0 },   // metres
      "rotation": { "x": 0, "y": 0, "z": 0 },      // radians
      "scale": 1,
      "templeWidthBoost": 1            // optional horizontal-only scale
    }
  }
}
```

The full types are exported as `TryOnCalibrationFile` and
`TryOnModelCalibration`.

## API

### `<VirtualTryOnExperience>` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `models` | `TryOnModel[]` | required | Frame catalog, at least one entry. |
| `calibrationUrl` | `string` | required | URL of the calibration manifest. |
| `modelBaseUrl` | `string` | `/models/virtual-try-on` | Directory the GLBs are served from. |
| `initialModel` | `string` | — | First frame shown. Falls back to the `?model=` query, then `models[0]`. |
| `simplifiedControls` | `boolean` | `true` | Hides the tuning sliders (scale, yaw, temple width, exposure). |
| `mediapipeBasePath` | `string` | jsDelivr CDN | Directory of the MediaPipe Wasm fileset, for self-hosting. |
| `mediapipeModelAssetPath` | `string` | Google Storage | URL of `face_landmarker.task`, for self-hosting. |
| `draco` | `boolean` | `true` | Enables Draco decompression in the GLB loader. |
| `dracoDecoderPath` | `string` | TresJS CDN | Draco decoder path, for self-hosting. |

### `v-model:model`

Two-way binding to the active frame's `file`. Use it to drive the frame
from your own picker.

### `track` event

`(event: string, payload: Record<string, unknown>)` — the only way the
module reports anything. Every payload has this shape:

```ts
{
  contentType: 'product',
  contentName: string,       // active model file
  customData: { model: string, ...extra }
}
```

| Event | When | Extra `customData` |
| --- | --- | --- |
| `TRY_ON_OPENED` | User accepts the consent screen | `entryPoint: 'camera_consent'` |
| `TRY_ON_CAMERA_GRANTED` | Camera stream started | — |
| `TRY_ON_CAMERA_DENIED` | Camera permission refused | — |
| `TRY_ON_FACE_DETECTED` | First face detected in the session | `confidence` |
| `TRY_ON_FRAME_CHANGED` | Active frame changed | — |
| `TRY_ON_ERROR` | Camera or tracker failure | `errorType`, `source` (`camera` \| `face_landmarker`) |

### Exported types

```ts
import type {
  TryOnModel,
  TryOnModelFamily,
  TryOnLogger,
  TryOnCalibrationFile,
  TryOnModelCalibration,
  TryOnFrameCalibration
} from '@eleven.spectacles/virtual-try-on'
```

`TryOnModel.file` is the only field the component needs. `label`,
`family`, `color`, `colorClass` and `thumbnailUrl` are catalog metadata for
your own picker UI (see the auto-imported `getTryOnModelFamilies()`).

## Configuration

### Logging

Module logs go to the console. To route them into your own logger, provide
`$tryOnLogger` — any object with `info`, `warn` and `error`:

```ts
// app/plugins/tryon-logger.ts
export default defineNuxtPlugin(() => ({
  provide: { tryOnLogger: useLogger() }
}))
```

### Self-hosting third-party assets

By default the MediaPipe Wasm, the face model and the Draco decoder load
from public CDNs on first use. To remove those dependencies (for a strict
CSP or offline use), serve the files yourself and pass
`mediapipe-base-path`, `mediapipe-model-asset-path` and
`draco-decoder-path`.

### Copy and icons

All copy is English and built in; the module has no i18n dependency. The UI
uses Heroicons via
`@nuxt/ui`; install `@iconify-json/heroicons` to bundle them locally instead
of fetching them from the Iconify API.

## Privacy

Camera frames are processed entirely in the browser. No video or image data
is uploaded, and nothing is recorded or stored. The module makes no network
calls of its own apart from loading the assets above, and all analytics go
through the `track` event, so your app decides what is sent.

## Development

```bash
npm install
npm run playground   # tuning playground on http://localhost:4000
npm run verify       # unit tests + playground build + smoke test
npm run typecheck
npm run build        # dist/ via @nuxt/module-builder
```

`playground/` is a dev-only Nuxt app that loads the module from source
(`src/module.ts`) and mounts a tuning UI with the full frame catalog
(`?model=<file>`, `?debug_tryon=true`). It serves GLBs and
`calibration.json` from a sibling host checkout — set `TRYON_MODELS_DIR` if
yours live elsewhere.

**Compressing models** — Draco-compress a directory of GLBs:

```bash
npm run compress-models -- --input <dir> --output <dir>
```

Regenerate `calibration.json` after compressing, because compression can
shift bounding boxes slightly.

## Releasing

Releases are automated with
[release-please](https://github.com/googleapis/release-please) and
[Conventional Commits](https://www.conventionalcommits.org):

1. Every push to `main` updates a release PR with the next version and the
   new [`CHANGELOG.md`](./CHANGELOG.md) entry (`fix` → patch, `feat` →
   minor, `!` / `BREAKING CHANGE` → major).
2. Merging the release PR tags `vX.Y.Z`, creates the GitHub Release and
   publishes to npm.

Publishing uses npm
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): the
package trusts `ElevenSpectacles/virtual-try-on` →
`.github/workflows/release-please.yml`, so no npm token is stored and every
version gets a provenance attestation. Renaming that workflow file breaks
publishing until the trusted publisher on npmjs.com is updated. The repo
also needs **Allow GitHub Actions to create and approve pull requests**
enabled. Check what
ships with `npm pack --dry-run` — only `dist/`, `CHANGELOG.md`,
`README.md` and `package.json`.

## License

UNLICENSED — © Nikta 11 Ltd. The package is public on npm so it can be
installed, but it is not licensed for use outside Eleven Spectacles
projects.
