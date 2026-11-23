# 0022. Keep the frame-removal spike reproducible and unshipped

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Issue #100 explored removing glasses the shopper is already wearing.

## Decision

The research harness stays under `docs/research` and records its inputs, model and scoring method.

## Consequences

It is not part of the module or its verification. See `docs/research/frame-removal.md` for findings.

## Detailed records

### `docs/research/frame-removal/harness/analyze.py`

#### File overview

Frame-removal spike (#100), step 2: for each fixture, the segmenter's classes
inside a landmark-built lens region, the landmark glasses mask, classic
inpainting (Telea, Navier-Stokes) of it, and a thin-rim removal test with
ground truth (a 4 px bar drawn over skin and hair, then inpainted).

`python3 analyze.py <seg.json> <faces-dir> <out-dir>   (needs numpy, opencv-python-headless)`

#### `rim = np.zeros((h, w), np.uint8)`

Thin-rim test: a 4 px frame-coloured bar across the forehead and one
across the temple hair, removed again; scored against the original.

### `docs/research/frame-removal/harness/index.html`

#### `times`

The first call warms up; the median of the rest is reported.

#### `acc`

Confidence of class 5 ("others": accessories), 0–255.

### `docs/research/frame-removal/harness/segment.mjs`

#### File overview

Frame-removal spike (#100), step 1: landmarks + multiclass segmentation of
the committed glasses-wearing fixtures, in headless Chromium.

`node docs/research/frame-removal/harness/segment.mjs <models-dir> <out.json>`

&lt;models-dir> holds face_landmarker.task and selfie_multiclass_256x256.tflite
(https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite).
Set CHROMIUM_PATH to use a specific browser binary.
