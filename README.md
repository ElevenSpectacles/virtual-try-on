# Virtual Try-On

[![npm](https://img.shields.io/npm/v/@eleven.spectacles/virtual-try-on)](https://www.npmjs.com/package/@eleven.spectacles/virtual-try-on)
[![CI](https://github.com/ElevenSpectacles/virtual-try-on/actions/workflows/ci.yml/badge.svg)](https://github.com/ElevenSpectacles/virtual-try-on/actions/workflows/ci.yml)

Real-time virtual try-on for eyewear, as a Nuxt module. Renders 3D glasses
(GLB) on the user's face over a live front-camera feed: MediaPipe
`FaceLandmarker` tracks the face in a Web Worker, TresJS (Three.js) renders
the frame, and everything runs on-device.

Built by [Eleven Spectacles](https://elevenspectacles.com) — luxury eyewear,
with virtual try-on for every frame in the catalog.

- **Headless** — renders only the camera feed and the tracked frame. No UI
  library, no copy, no utility classes: your app draws every control.
- **One `modules` entry** — components and composables register themselves.
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

- **Nuxt 4** and `@vueuse/core` 15.
- **Browser**: WebAssembly, Web Workers, `createImageBitmap` and
  `getUserMedia` — every current evergreen browser, desktop and mobile.
  Unsupported browsers get an error state instead of a crash.
- **Secure context**: camera access only works over HTTPS (or `localhost`).

## Installation

```bash
npm i @eleven.spectacles/virtual-try-on
```

Install `@vueuse/core` if your app doesn't already have it:

```bash
npm i @vueuse/core
```

TresJS (`@tresjs/nuxt`, `@tresjs/core`), `three` and MediaPipe
(`@mediapipe/tasks-vision`) are regular dependencies of the module — your
app doesn't install them. The module registers `@tresjs/nuxt` itself;
listing it in your own `modules` too is harmless.

Register the module:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@eleven.spectacles/virtual-try-on']
})
```

That's all the wiring. The module registers TresJS, its components and
composables.

## Usage

The component renders the mirrored camera feed and the tracked frame, and
fills its container — give it a size. Everything else is yours: consent,
error messages, positioning hints, the frame picker, the modal. Build them
in the default slot, which renders on top of the feed and receives the
current state and actions:

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
  <div class="relative aspect-3/4 w-full">
    <VirtualTryOnExperience
      v-model:model="activeModel"
      :models="models"
      calibration-url="/models/virtual-try-on/calibration.json"
      @track="onTrack"
    >
      <template #default="{ status, error, guideHint, isStarting, start }">
        <div v-if="status !== 'active'" class="absolute inset-0 grid place-items-center">
          <p v-if="error">Camera unavailable ({{ error }})</p>
          <button :disabled="isStarting" @click="start">
            {{ error ? 'Retry' : 'Allow camera access' }}
          </button>
        </div>
        <p v-else-if="guideHint === 'noFace'" class="absolute inset-x-0 bottom-4">
          Position your face in view
        </p>
      </template>
    </VirtualTryOnExperience>
  </div>
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
| `autoStart` | `boolean` | `false` | Starts the camera on mount. Use when your app already collected consent. |
| `exposure` | `number` | `1` | Renderer tone-mapping exposure. |
| `frameScale` | `number` | `1` | Multiplier on the computed frame scale. |
| `frameYaw` | `number` | `0` | Manual frame yaw in degrees, used only while no face is tracked. |
| `templeWidth` | `number` | `1` | Multiplier on the calibrated temple width. |
| `mediapipeBasePath` | `string` | jsDelivr CDN | Directory of the MediaPipe Wasm fileset, for self-hosting. |
| `mediapipeModelAssetPath` | `string` | Google Storage | URL of `face_landmarker.task`, for self-hosting. |
| `draco` | `boolean` | `true` | Enables Draco decompression in the GLB loader. |
| `dracoDecoderPath` | `string` | gstatic CDN | Draco decoder path, for self-hosting. |

### Default slot

Rendered inside the stage, on top of the feed. Position its content
yourself (e.g. `absolute inset-0`). The same state and actions are exposed
on the component ref.

| Slot prop | Type | Description |
| --- | --- | --- |
| `status` | `TryOnStatus` | `'idle'` \| `'starting'` \| `'active'` \| `'error'` |
| `isStarting` | `boolean` | Camera permission prompt / stream start in progress. |
| `error` | `WebcamError \| null` | `'denied'` \| `'unsupported'` \| `'unavailable'` |
| `faceError` | `FaceLandmarkerError \| null` | `'unsupported'` \| `'load_failed'` \| `'runtime_failed'` |
| `hasFace` | `boolean` | A face is currently tracked. |
| `guideHint` | `TryOnGuideHint \| null` | `'noFace'` \| `'aligned'`; `null` while the camera is off. |
| `start` | `() => Promise<void>` | Start or retry the camera. |
| `stop` | `() => void` | Stop the camera. |

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
| `TRY_ON_OPENED` | First `start()` call (or mount with `autoStart`) | `entryPoint`: `'camera_consent'` \| `'auto_start'` |
| `TRY_ON_CAMERA_GRANTED` | Camera stream started | — |
| `TRY_ON_CAMERA_DENIED` | Camera permission refused | — |
| `TRY_ON_FACE_DETECTED` | First face detected in the session | `confidence` |
| `TRY_ON_FRAME_CHANGED` | Active frame changed | — |
| `TRY_ON_ERROR` | Camera, tracker or asset failure | `errorType`, `source` (`camera` \| `face_landmarker` \| `model` \| `environment`), `message` |

### Exported types

```ts
import type {
  TryOnModel,
  TryOnModelFamily,
  TryOnCalibrationFile,
  TryOnModelCalibration,
  TryOnFrameCalibration,
  TryOnStatus,
  TryOnGuideHint,
  WebcamError,
  FaceLandmarkerError
} from '@eleven.spectacles/virtual-try-on'
```

`TryOnModel.file` is the only field the component needs. `label`,
`family`, `color`, `colorClass` and `thumbnailUrl` are catalog metadata for
your own picker UI (see the auto-imported `getTryOnModelFamilies()`).

## Configuration

### Errors and logging

The module never logs. Every failure is reported as a `TRY_ON_ERROR`
`track` event, so log it from your handler:

```ts
function onTrack(event: string, payload: Record<string, unknown>) {
  if (event === 'TRY_ON_ERROR') console.error('[virtual-try-on]', payload)
  // forward to your analytics
}
```

| `source` | `errorType` | Effect |
| --- | --- | --- |
| `camera` | `'unsupported'` \| `'unavailable'` | No feed; slot `error` is set. `message` is the `DOMException` name. |
| `face_landmarker` | `'unsupported'` \| `'load_failed'` \| `'runtime_failed'` | Feed shows, no tracking; slot `faceError` is set. |
| `model` | `'load_failed'` | The GLB failed to load; `message` starts with its URL. |
| `environment` | `'load_failed'` | Reflections lost; the frame still renders. |

A denied camera permission is reported as `TRY_ON_CAMERA_DENIED`, not as an
error.

### Self-hosting third-party assets

By default the MediaPipe Wasm, the face model and the Draco decoder load
from public CDNs on first use. To remove those dependencies (for a strict
CSP or offline use), serve the files yourself and pass
`mediapipe-base-path`, `mediapipe-model-asset-path` and
`draco-decoder-path`. Serve the Wasm fileset from the same
`@mediapipe/tasks-vision` version the module pins (see its `package.json`) —
mixed versions are unsupported.

## Privacy

Camera frames are processed entirely in the browser. No video or image data
is uploaded, and nothing is recorded or stored. The module makes no network
calls of its own apart from loading the assets above, and all analytics go
through the `track` event, so your app decides what is sent.

## Development

```bash
npm install
npm run playground   # tuning playground on http://localhost:4000
npm run verify       # unit tests + playground smoke test + face-fixture e2e
npm run verify:e2e   # tracking + golden screenshots on fake-camera face clips
npm run typecheck
npm run build        # dist/ via @nuxt/module-builder
```

`playground/` is a dev-only Nuxt app that loads the module from source
(`src/module.ts`) and mounts a tuning UI with the full frame catalog
(`?model=<file>`, `?debug_tryon=true`). It serves GLBs and
`calibration.json` from a sibling host checkout — set `TRYON_MODELS_DIR` if
yours live elsewhere.

**Face-fixture tests** — `verify:e2e` feeds portraits from
`tests/fixtures/faces/` to Chromium as a fake camera (rendered to video with
`ffmpeg`), asserts detection rate and landmark jitter, and compares the
fitted frame against golden screenshots in `tests/e2e/__screenshots__/`.
After an intended visual change, run
`npm run verify:e2e -- --update-snapshots` and review the new images. It
skips when `ffmpeg` or the models directory is missing.

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
