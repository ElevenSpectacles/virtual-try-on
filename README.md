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
- **True to size** — the shopper's PD is measured on-device against the iris,
  so the frame shows at its real size on their face; per-frame calibration, a frame seated on the nose bridge, and a face-mesh occluder
  that hides temples behind the head.
- **Tells the customer if it fits** — a narrow / good / wide verdict from
  the frame's width against the tracked face, for your UI and analytics.
- **Looks real** — lenses with Fresnel reflections and an anti-reflective
  sheen, a soft shadow of the frame on the skin, and lighting that follows
  the room the camera sees.
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

- **Nuxt 4**.
- **Browser**: WebAssembly, Web Workers, `createImageBitmap` and
  `getUserMedia` — every current evergreen browser, desktop and mobile.
  Unsupported browsers get an error state instead of a crash.
- **Secure context**: camera access only works over HTTPS (or `localhost`).

## Installation

```bash
npm i @eleven.spectacles/virtual-try-on
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
import { ref } from 'vue'
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
      "templeWidthBoost": 1,           // deprecated: stretches the whole frame; leave at 1
      "lens": { "tint": "#3a4a5c", "category": 3 },  // optional lens colour/darkness override (see below)
      "frameWidthMm": 139.7            // rendered width, written by generate-calibration (fit ranking)
    }
  }
}
```

The full types are exported as `TryOnCalibrationFile` and
`TryOnModelCalibration`.

Two optional fitting fields:

- `pads: { spacingMm }`: the distance between the nose pads' contact
  points. With it the frame seats lower on a narrow nose and higher on a
  wide one (up to ±4 mm), from the shopper's nose profile on frontal frames.
- `rotation.x` sets the pantoscopic tilt. Worn frames tilt 7–12° (9° is
  the usual fit). `npx tsx scripts/audit-tilt.ts --input <glb dir>
  --calibration <calibration.json>` measures each model's lens plane,
  reports its effective tilt and suggests the `rotation.x` for 9°; it exits
  non-zero when a model is out of range.

The `lens` entry overrides the GLB's lens. Give its darkness in the
product's own units, from its sheet:

| Field | Meaning |
| --- | --- |
| `tint` | Lens colour, `#rrggbb`. Its hue also tints the lens shadow. |
| `category` | ISO 12312-1 filter category `0`–`4` (cat. 2: 18–43 % light through, cat. 3: 8–18 %). The middle of the band is used. |
| `transmittance` | Luminous transmittance τv, 0–1, when the sheet gives it. More precise than the category. |
| `density` | Raw darkness 0 (clear) – 1 (opaque) = 1 − τv. Wins over the two above. |
| `gradient` | `{ top, bottom }` densities for a gradient lens, dark to light top to bottom. Replaces the single darkness. |

`generate-calibration` keeps all of them when it regenerates the file.

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
| `frameYaw` | `number` | `0` | **Deprecated**, no effect since 4.4.0 — the frame renders only on a tracked face. Removed in 5.0. |
| `templeWidth` | `number` | `1` | **Deprecated**: multiplier on the calibrated `templeWidthBoost`, which stretches the whole frame. The temple arms open at the hinge to meet the tracked head. Removed in 5.0. |
| `mediapipeBasePath` | `string` | jsDelivr CDN | Directory of the MediaPipe Wasm fileset, for self-hosting. |
| `mediapipeModelAssetPath` | `string` | Google Storage | URL of `face_landmarker.task`, for self-hosting. |
| `draco` | `boolean` | `true` | Enables Draco decompression in the GLB loader. |
| `dracoDecoderPath` | `string` | gstatic CDN | Draco decoder path, for self-hosting. |
| `occluder` | `boolean` | module option (`true`) | Hides frame parts behind the head (the far temple). Overrides `virtualTryOn.occluder` for this instance. |
| `tier` | `'low' \| 'mid' \| 'high'` | — | Pins the device capability tier. Omit to classify the device and step down under sustained frame-time load. A pinned tier never steps down. |
| `adaptiveLighting` | `boolean` | `true` | Lights the frame from the room the camera sees. Needs the `mid` tier or higher. |
| `roomReflections` | `boolean` | `false` | Reflects the shopper's own room in the lenses (the camera's view, blended with the studio environment) and aims the key light and the contact shadow at where the room's light comes from. Needs `adaptiveLighting`. |
| `contactShadow` | `boolean` | `true` | Soft shadow the frame casts on the tracked skin (rims, temples, and a partial shadow from tinted lenses). Needs the face-mesh occluder and the `mid` tier or higher. |
| `physicalLens` | `boolean` | `true` | Lenses that read as glass: opacity rises toward grazing angles, reflections add on top of the tint, and an anti-reflective sheen. Needs the `mid` tier or higher; off keeps the cheaper standard lens. |
| `cameraMatch` | `boolean` | `false` | Makes the frame look filmed with the face: grain that grows in dim rooms (re-seeded every frame like sensor noise), a 0.6 px blur of the frame layer, and light wrap in the room's colour at its edges. Needs the `mid` tier or higher. |
| `fitTolerance` | `number` | `0.06` | Half-width of the "good fit" band of the fit verdict, as a fraction of the ideal frame width. The face estimate itself carries about ±5% until the PD is measured. |
| `trueToSize` | `boolean` | `true` | Sizes the frame and the fit verdict from the shopper's measured PD (see [True to size](#true-to-size)). Off keeps the average-face sizing. |
| `reportMetrics` | `boolean` | `false` | Emits the `metrics` event (see below). Off means nothing is measured. |
| `hairOcclusion` | `boolean` | `false` | Hides the temple arms behind hair that hangs over them (see [Hair occlusion](#hair-occlusion-opt-in)). Needs the occluder and the `high` tier. |
| `mediapipeHairModelAssetPath` | `string` | Google Storage | URL of `hair_segmenter.tflite`, for self-hosting. |
| `templeEarBend` | `boolean` | `false` | Bends the temple tips down behind the ears (30°, from ~1.5 cm behind the tracked front of the ear), as an optician fits a frame. Visible when the shopper turns to see the temples. |
| `preload` | `number \| false` | `1` | Frames to prefetch on each side of the active one in `models`, in idle time once a face is tracked, so switching to them is instant (see [Instant frame switching](#instant-frame-switching)). `false` turns it off. |
| `environmentUrl` | `string` | GitHub raw CDN | URL of the equirect `.hdr` environment map, for self-hosting. The `low` tier uses a procedural environment and downloads nothing. |

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
| `guideHint` | `TryOnGuideHint \| null` | `'noFace'` \| `'aligned'` \| `'turnBack'` \| `'tooDark'`; `null` while the camera is off (see [Guide hints](#guide-hints)). |
| `fit` | `TryOnFit \| null` | `{ verdict, faceWidthMm, frameWidthMm }`: whether the frame suits the face's width. `null` until about a second of tracking, and while no face is tracked. |
| `measurements` | `TryOnMeasurements \| null` | `{ pdMm, faceWidthMm, confidence, stable, faceShape, faceShapeConfidence }`: on-device face measurements for a frame advisor (see [Frame advisor](#frame-advisor)). `null` until something is measured. |
| `start` | `() => Promise<void>` | Start or retry the camera. |
| `stop` | `() => void` | Stop the camera. |
| `calibration` | `TryOnCardCalibration` | Card calibration state: `{ status, progress, pdMm }`, `status` `'idle'` \| `'detecting'` \| `'done'` \| `'failed'` (see [Card calibration](#card-calibration)). |
| `startCalibration` / `cancelCalibration` | `() => void` | Start a card calibration / stop it or drop its result. |
| `capture` | `(options?) => Promise<Blob>` | Snapshot of the try-on as the shopper sees it (see [Capture](#capture)). |
| `frozen` | `boolean` | The camera frame and pose are held (see [Freeze](#freeze-and-compare)). |
| `freeze` / `unfreeze` | `() => Promise<void>` | Hold the current frame and pose / go back to the live camera. |

The ref also exposes a read-only `lighting`: `{ luma, gain, sampleMs,
direction }`, the smoothed room luma (`null` while lighting is off), the
light multiplier it drives, the time of the last room sample, and (with
`roomReflections`) the estimated light direction `{ x, y, z, strength }`.

### True to size

Landmarks are measured on screen, so turning them into millimetres needs a
ruler. The module uses the iris: the visible iris of adults is 11.7 mm wide
with a spread of only ~0.5 mm, and MediaPipe tracks its outline. Over the
first seconds of frontal, open-eyed tracking it measures the shopper's PD
and ear-level face width against it (median of the samples, frozen once
they agree), and sizes the frame from them instead of population averages.
A wider face gets a relatively smaller-looking frame, as in a mirror. Until
enough samples are in, the size eases from the average face to the measured
one, so there is no visible jump.

The slot and ref expose the measurement in `measurements` (see
[Frame advisor](#frame-advisor)): `pdMm`, its `confidence` (0 → 1 as samples
come in) and `stable` (frozen). `pdMm` is the
distance PD, the number an optician measures: corrected for the eyes
converging on the screen. Expect about ±2–3 mm; it is a sizing aid, not a
prescription measurement. It stays in the browser unless your app sends it.

### Card calibration

For a ±1 mm PD (an optician-grade "your size", or PD-based
recommendations), offer an optional step: the shopper holds any standard
bank, ID or loyalty card (ISO/IEC 7810 ID-1, 85.60 mm wide) flat and level
against their forehead, facing the camera. Your app draws the instructions
and calls `startCalibration()`; the module finds the card's edges in the
forehead band on each frontal frame (full camera resolution while it runs),
and when a dozen readings agree sets `calibration.status` to `'done'` with
`calibration.pdMm` (the distance PD, corrected for the card sitting ~12 mm in
front of the eyes and for convergence on the screen). From then on the
frame size and fit verdict use it instead of the iris measurement.

`progress` (0–1) can drive a progress ring. If no stable card reading
arrives within 10 s (no card, poor light, card tilted), the status becomes
`'failed'`: ask the shopper to try again in better light. Nothing runs, and
no crop is made, unless calibration was started. The result lives in memory
only; it is reported once as `TRY_ON_CALIBRATED` with `pdMm` so your app can
store it if the shopper agrees.

### Guide hints

`guideHint` tells your UI why the try-on may not look right, so you can
coach the shopper in your own words:

| Hint | When | Example copy |
| --- | --- | --- |
| `aligned` | A face is tracked and placed. | — |
| `noFace` | No face in view. | "Position your face in view" |
| `turnBack` | The head is turned more than 55° (or was, when tracking lost it). | "Turn back toward the camera" |
| `tooDark` | The room is too dark for stable tracking (room luma under 0.12). | "Find more light" |

When tracking drops the face for less than 300 ms (a hand passing, motion
blur in a quick turn), the frame stays on its last pose instead of
vanishing and popping back; after a longer loss it fades out. `hasFace`
follows the same hold, so a short dropout doesn't flash your "no face" UI.

### Fit verdict

`fit.verdict` is `'narrow'`, `'good'` or `'wide'`: the frame's total width
against the customer's face width at the temples. Show it in your own words,
for example "Good fit", "May be wide for you", "May be narrow for you". The
face width is measured from the tracked landmarks against the measured PD
(see [True to size](#true-to-size)); until that is in, against an average
inter-pupillary distance (63 mm), about ±5%. The verdict has hysteresis, so
it doesn't flicker at a band edge.

The frame width is `TryOnModel.frameWidthMm` when you pass it (the catalog
spec, most accurate), else the GLB's width times its calibration scale. Each
verdict change is reported as a `TRY_ON_FIT` `track` event, so you can relate
fit to conversion.

### Frame advisor

For "frames that fit you" lists, the ref ranks the whole catalog on the
tracked face without loading any GLB:

- `fitRanking`: `TryOnFitRank[]`, best first: `{ file, verdict,
  frameWidthMm, deviation }`, where `deviation` is the frame width over the
  ideal width minus 1 (0 is ideal, `0.05` is 5 % too wide). Empty until the
  face width is measured. Frames whose width is unknown are left out.
- `fitFor(file)`: the `TryOnFit` of any catalog frame on the measured face.

Each frame's width comes from `TryOnModel.frameWidthMm`, else the
calibration's `frameWidthMm` (written by `generate-calibration`), else, for
the active frame, its loaded GLB. The same helpers are exported as pure
functions (`rankByFit`, `fitVerdictFor`) for ranking on your own data, e.g.
on a server from a stored face width.

`measurements.faceShape` is a coarse `'oval' | 'round' | 'square' | 'heart'
| 'oblong'` from the face's proportions (length, forehead and jaw against
the width at the temples), averaged over frontal frames and held with
hysteresis. Treat it as a styling hint, with its `faceShapeConfidence`
(low means "between two shapes"), never as a filter.

Measurements stay in the browser. The module reports only the coarse
`faceShape` class (`TRY_ON_FACE_SHAPE`) and the fit verdict on `track`; it
is your app's decision whether to send the PD or face width anywhere, and
your consent copy should say so if it does.

### Capture

`capture({ type?, quality?, maxWidth? })` returns the composited try-on as
an image `Blob` (`image/jpeg` by default): the visible part of the camera
frame, mirrored like the preview, with the frame rendered on it. It renders
the scene on demand, so the canvas never needs `preserveDrawingBuffer`.
The output defaults to the camera's resolution across the visible window;
`maxWidth` caps it. It rejects while the camera is off.

```ts
const blob = await tryOn.value.capture({ type: 'image/jpeg', quality: 0.9 })
const url = URL.createObjectURL(blob) // show it, save it, or share it
```

The image is made on-device and stays in the browser. Uploading or sharing
it is your app's decision, and it is a photo of the shopper's face: say so
in your consent copy. Each capture is reported as `TRY_ON_CAPTURE`.

### Instant frame switching

Parsed frames are kept in memory (an LRU of 4–6 GLBs, 2 on the `low`
tier), so switching back to a frame shows it at once. Once a face is
tracked, the module also fetches the active frame's neighbours in `models`
in idle time (`preload` on each side, default 1), one at a time, so it never
competes with the first frame and loads nothing before the camera starts.
For frames you know are next (hover on a swatch), call
`preloadModel(file)` on the ref. The `metrics` event reports how long
switches took (`modelSwitchMeanMs`, `modelSwitchP95Ms`).

### Freeze and compare

`freeze()` holds the current camera frame and the tracked pose: the preview
stops on that frame and tracking pauses (the worker sits idle, which saves
battery). While frozen, changing `model` renders the new frame exactly
where the previous one sat, with the same occlusion and shadow, so shoppers
can compare frames on one look. Build an A/B compare, a "tap to freeze"
button, or a grid of looks with `capture()` on top of it. `unfreeze()`
resumes the live camera; tracking picks up on the next camera frame.

The held pose is detected on the held frame itself, so `freeze()` resolves
once that detection is in (one detection, ~10–30 ms). Each change is
reported as `TRY_ON_FREEZE` with `frozen: true | false`. Stopping the
camera clears the freeze.

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
| `TRY_ON_FACE_DETECTED` | First face detected in the session | `confidence`, `tier` (device tier at that moment) |
| `TRY_ON_FIT` | The fit verdict appeared or changed (also on each frame change) | `verdict`, `faceWidthMm`, `frameWidthMm` (whole mm) |
| `TRY_ON_CALIBRATED` | A card calibration finished | `pdMm` |
| `TRY_ON_FACE_SHAPE` | The face-shape class appeared or changed | `faceShape` (coarse class only) |
| `TRY_ON_CAPTURE` | `capture()` produced an image | `type` (MIME type of the Blob) |
| `TRY_ON_FREEZE` | `freeze()` held the pose, or `unfreeze()` released it | `frozen` |
| `TRY_ON_FRAME_CHANGED` | Active frame changed | — |
| `TRY_ON_TIER` | The device tier stepped down under sustained frame-time load | `tier`, `previousTier`, `p95Ms`, `maxTextureSize`, `deviceMemoryGb` |
| `TRY_ON_ERROR` | Camera, tracker or asset failure, a failed card calibration, or an invalid calibration entry | `errorType`, `source` (`camera` \| `face_landmarker` \| `model` \| `environment` \| `hair_segmenter` \| `card_calibration` \| `calibration`), `message` |

### `metrics` event

`(payload: TryOnSessionMetrics)`, emitted only with `reportMetrics`: every
30 s of camera-on time, and once more when the camera stops or the component
unmounts (`final: true`). Each report covers the session so far.

| Field | Type | Meaning |
| --- | --- | --- |
| `activeMs` | `number` | Camera-on time. Frame stalls over 500 ms are excluded. |
| `timeToFirstFrameMs` | `number \| null` | Camera granted → first frame rendered on a face (wall clock). |
| `assetTimings` | `{ tracker, model, environment }` | First-load time of each asset in ms (`null` until loaded): the tracker (Wasm + face model, from `start()`), the first GLB, and the environment map. |
| `timeToFirstTrackMs` | `number \| null` | Camera-on time until the first tracked face. `null` if none. |
| `trackUptimePct` | `number` | Share of camera-on time with a tracked face, 0–100. |
| `trackLossPerMin` | `number` | Tracked-to-lost transitions per camera-on minute. |
| `detectLatencyMeanMs` / `detectLatencyP95Ms` | `number \| null` | Camera-to-result detection latency over the last ~1000 detections. |
| `renderFpsMean` | `number \| null` | Mean render frame rate over camera-on time. |
| `modelSwitches` | `number` | Frame changes in the session. |
| `modelSwitchMeanMs` / `modelSwitchP95Ms` | `number \| null` | Time from a frame change to the new frame on screen. |
| `tierChanges` | `number` | Capability tier step-downs in the session. |
| `tier` | `'low' \| 'mid' \| 'high' \| null` | Current device capability tier. |
| `endedWithoutTrack` | `boolean` | No face was tracked and the frame was never changed. The "looked broken" proxy. |
| `final` | `boolean` | `true` on the report sent at stop or unmount. |
| `model` | `string` | Active frame file. |
| `features` | `Record<string, boolean>` | Which opt-in features were on at report time, one flag each (see `TryOnSessionMetrics`). |

No frames, landmarks or other image-derived data are in the payload. It holds
only these numbers and the frame file name. Forward it to your analytics if
you want the before/after baseline; the module sends nothing itself.

### Hair occlusion (opt-in)

With `hairOcclusion`, a MediaPipe hair segmenter finds hair in the camera
frame, and the temple arms are not drawn where hair hangs over them, so the
customer's own hair shows in front, as in a mirror. Only the arms behind the
temple roots can be hidden; lenses, rims and hinges always stay on top.

It is off by default. A 2D mask can't tell hair over an arm from hair under
it, and arms usually rest on top of hair, so turn it on where long loose
hair is common, or behind an A/B test. It runs on the `high` tier only, in
its own Web Worker. The 0.8 MB model downloads on the first tracked face,
so it never delays the first try-on. It switches itself off for the session
if segmentation is too slow on the device. The ref exposes its state as a
read-only `hair`: `{ active, coverage, segmentMs, masks, overBudget, error }`.

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
  FaceLandmarkerError,
  TryOnTier,
  TryOnFeature,
  TryOnMetrics,
  TryOnSessionMetrics,
  TryOnFit,
  TryOnFitVerdict,
  TryOnFitRank,
  TryOnFaceShape,
  TryOnMeasurements,
  TryOnCaptureOptions,
  TryOnCaptureType
} from '@eleven.spectacles/virtual-try-on'
```

`TryOnModel.file` is the only field the component needs. Pass
`frameWidthMm` (the frame's total width from your catalog) to make the fit
verdict use the spec instead of the GLB's measured width. `label`,
`family`, `color`, `colorClass` and `thumbnailUrl` are catalog metadata for
your own picker UI (see the auto-imported `getTryOnModelFamilies()`).

## Configuration

### Module options

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@eleven.spectacles/virtual-try-on'],
  virtualTryOn: {
    occluder: true // default
  }
})
```

| Option | Default | Description |
| --- | --- | --- |
| `occluder` | `true` | Hides the parts of the frame the head would hide — the far temple behind the face — using the tracked face mesh. The `occluder` prop overrides it per component; `NUXT_PUBLIC_VIRTUAL_TRY_ON_OCCLUDER=false` overrides it at runtime. |

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
| `hair_segmenter` | `'unsupported'` \| `'load_failed'` | Only with `hairOcclusion`: hair occlusion is off; the face-mesh occluder still works. |

A denied camera permission is reported as `TRY_ON_CAMERA_DENIED`, not as an
error.

### Self-hosting third-party assets

By default the first load fetches from four public CDNs: the MediaPipe Wasm
(jsDelivr), the face model (Google Storage), the Draco decoder (gstatic) and
the environment map (GitHub raw). The component adds `<link rel="preconnect">`
hints for the ones it will use, and starts loading the tracker on `start()`,
in parallel with the camera prompt. Serving them yourself removes the
foreign origins (for a strict CSP, offline use, or a faster cold start):

| Asset | Copy from | Prop |
| --- | --- | --- |
| MediaPipe Wasm fileset | `node_modules/@mediapipe/tasks-vision/wasm/` | `mediapipeBasePath` |
| Face model | [`face_landmarker.task`](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | `mediapipeModelAssetPath` |
| Draco decoder | `node_modules/three/examples/jsm/libs/draco/` (`draco_wasm_wrapper.js`, `draco_decoder.wasm`) | `dracoDecoderPath` |
| Environment map | [`canary_wharf_1k.hdr`](https://raw.githubusercontent.com/Tresjs/assets/main/textures/hdr/city/canary_wharf_1k.hdr) (CC0, Poly Haven) | `environmentUrl` |
| Hair model (only with `hairOcclusion`) | [`hair_segmenter.tflite`](https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite) | `mediapipeHairModelAssetPath` |

Serve the Wasm fileset from the same `@mediapipe/tasks-vision` version the
module pins (see its `package.json`) — mixed versions are unsupported. With
Nitro, serve the package directories straight from `node_modules` and put
the downloaded files in `public/`:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    publicAssets: [
      { baseURL: '/vto/wasm', dir: '../node_modules/@mediapipe/tasks-vision/wasm', maxAge: 31536000 },
      { baseURL: '/vto/draco', dir: '../node_modules/three/examples/jsm/libs/draco', maxAge: 31536000 }
    ]
  }
})
```

```vue
<VirtualTryOnExperience
  :models="models"
  calibration-url="/models/virtual-try-on/calibration.json"
  mediapipe-base-path="/vto/wasm"
  mediapipe-model-asset-path="/vto/face_landmarker.task"
  draco-decoder-path="/vto/draco/"
  environment-url="/vto/canary_wharf_1k.hdr"
/>
```

`face_landmarker.task` and `canary_wharf_1k.hdr` go in `public/vto/`. With
every path set, the try-on makes no third-party requests and adds no
preconnect hints.

To shave the tracker's load off the critical path entirely, call
`prefetch()` on the ref before the shopper taps "Try on" (e.g. on hover of
your button). It loads the tracker without touching the camera. Report
`timeToFirstFrameMs` and `assetTimings` from the `metrics` event to see the
effect in the field.

## Privacy

Camera frames are processed entirely in the browser. No video or image data
is uploaded, and nothing is recorded or stored. The one exception is an
explicit `capture()`, whose image is handed to your app and goes no further
unless your app sends it. The module makes no network
calls of its own apart from loading the assets above, and all analytics go
through the `track` and `metrics` events, so your app decides what is sent.
The `metrics` payload holds aggregated numbers only.

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

**Real footage** — `npm run fetch-footage` downloads a few stock portrait
clips (Mixkit, free licence, never committed) into the OS temp dir and
prints the `TRYON_VIDEO_CLIP=…` to run `tests/e2e/video-clip.spec.ts` with.
That spec checks tracking on the clip and saves a screenshot of the try-on
for review.

**Adding a frame to the catalog** — one command takes a raw GLB to a
try-on-ready one and its calibration entry:

```bash
npm run prepare-model -- --input <raw.glb or dir> --output <catalog dir> --calibration <catalog dir>/calibration.json
```

It trims the curled temple tips (once: each run would tilt them again, so
the GLB records it in its extras), Draco-compresses, lints the result and
regenerates `calibration.json` for the catalog, keeping your hand-tuned
fields. Running it twice changes nothing. To check a catalog without
changing it:

```bash
npm run lint-models -- --input <catalog dir>
```

The lint fails on a missing lens material or a frame in the wrong units, and
warns about a missing `pt2` temple node, the placeholder lens colour, files
over 1.5 MB, textures over 1024 px and uncompressed GLBs. At runtime, an
invalid calibration entry (a typo, degrees instead of radians) falls back
field by field to the defaults and is reported once as `TRY_ON_ERROR`
(`source: 'calibration'`).

The individual steps are still available:

**Compressing models** — Draco-compress a directory of GLBs:

```bash
npm run compress-models -- --input <dir> --output <dir>
```

Regenerate `calibration.json` after compressing, because compression can
shift bounding boxes slightly:

```bash
npm run generate-calibration -- --input <dir> --output <dir>/calibration.json [--reference iris-bronze]
```

It recentres and scales every GLB against the reference frame, and keeps
the fields you tuned by hand (`rotation`, `templeWidthBoost`, `lens`) when
the output file already exists.

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
`LICENSE`, `README.md` and `package.json`.

## License

[MIT](LICENSE).
