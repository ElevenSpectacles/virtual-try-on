# 0017. Give soft, stable fit and shape advice

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

The render is scaled to the face, so it cannot show fit by itself, and face classes are only a convention.

## Decision

Fit compares physical frame and face width with a tolerance and hysteresis. Shape is an averaged coarse class with confidence.

## Consequences

Neither result filters the catalog. Only coarse results are reported.

## Known problems in these files

- [#156](https://github.com/ElevenSpectacles/virtual-try-on/issues/156): Testing: fit spec and FIT_IDEAL_RATIO use uncalibrated frame widths

## Detailed records

### `src/runtime/composables/tryon/experience/useTryOnFrameFit.ts`

#### `calibration`

Calibration of the selected frame (its scale: GLB units → metres).

#### `glbWidthMeters`

Fit verdict (frame width vs the tracked face's width). The frame width is
the catalog spec when the host passes one, else the GLB's measured width
(reported once per load) times the calibration scale. The face width is a
running average over detections, reset when the face is lost (it may be a
different person when it comes back).

#### `measuredFaceWidthMm`

On-device face measurements (frame advisor, issue #98): the measured PD
(distance PD, as an optician measures it), the face width the fit verdict
uses, and the face shape. Null while nothing is measured yet.

#### `frameWidthFor`

Width of any catalog frame without loading it: the catalog spec, else the
calibration manifest's `frameWidthMm`, else (the active frame only) its
loaded GLB. 0 while unknown.

### `src/runtime/composables/tryon/experience/useTryOnTrackEvents.ts`

#### `watch(fit.verdict, (verdict) => {`

One event per verdict change (per frame model too, since the frame width
changes), so the host can relate fit to conversion. Widths are rounded to
whole millimetres.

#### `watch(`

Face shape as a coarse class only (never measurements), once it appears
and on each change.

### `src/runtime/composables/tryon/useTryOnFaceShape.ts`

#### `landmarks`

Raw landmarks (normalized to the camera frame).

#### `useTryOnFaceShape`

Face-shape glue (issue #98): averages the face proportions over frontal
detections (same yaw/pitch gate as the PD measurement, since a turned head
foreshortens the widths) and classifies them with hysteresis. Null until
FACE_SHAPE_MIN_SAMPLES frames are in.

#### `if (lostAt !== null && performance.now() - lostAt >= resetAfterLossMs) {`

A held face goes empty only once per loss: also check on its return.

### `src/runtime/composables/tryon/useTryOnFit.ts`

#### `landmarks`

Raw landmarks: the face estimate updates on every detection result.

#### `earWidth`

Pose-compensated ear-level width and IPD, normalized (see useTryOnPlacement).

#### `useTryOnFit`

Fit verdict (issue #12): the selected frame's width against the tracked
face's width. The face width is a running average over detections, reset
when the face is lost (it may be a different person when it comes back);
the verdict appears after FIT_MIN_SAMPLES detections and has hysteresis.
Call `reset()` when the frame changes, so its verdict starts fresh.

#### `watch(options.landmarks, () => {`

Every detection, not a derived width: equal widths in a row still count
toward FIT_MIN_SAMPLES.

### `src/runtime/composables/tryon/useTryOnModels.ts`

#### `frameWidthMm`

Total frame width in millimetres from the catalog spec, for the fit
verdict. Omit to measure it from the GLB's bounding box.

### `src/runtime/utils/tryon-face-shape.ts`

#### File overview

Face shape (issue #98): a coarse oval / round / square / heart / oblong
class from landmark proportions, for frame-advisor styling hints. Pure
math, no Vue.

This is a styling hint, never a filter: the classes are a retail
convention, not anatomy, and real faces sit between them. So the result
carries a confidence (how much closer the face is to its class than to the
next one), and hosts should phrase it softly ("frames that suit oval
faces"), never hide frames because of it.

Three proportions, each relative to the ear-level width (234 ↔ 454, the
widest stable span of the face oval):
- length: forehead (10) to chin (152);
- forehead: 54 ↔ 284, the upper face-oval points at the temples;
- jaw: 172 ↔ 397, the face-oval points at the jaw angle.

A single frame's proportions are noisy and expressions move the jaw, so
callers average them over frontal frames (`updateFaceProportions`) and the
class has hysteresis (`classifyFaceShape` with `previous`).

#### `FACE_SHAPE_PROTOTYPES`

Prototype proportions of each class on the MediaPipe mesh (landmark 10 is
below the hairline, so lengths are shorter than a tape-measured face).
Oval is the balanced middle; round and square are short, with a soft or a
wide jaw; heart has a wide forehead over a narrow jaw; oblong is long.

#### `WEIGHTS`

Weight of each proportion in the distance to a prototype. Width ratios
vary less between people than length does, so the same absolute
difference in them means more.

#### `FACE_SHAPE_MIN_SAMPLES`

Frontal frames averaged before the first class (~1.5 s at 30 fps).

### `src/runtime/utils/tryon-fit.ts`

#### File overview

Fit feedback: does the selected frame suit the width of the tracked face?
(issue #12). Pure math, no Vue.

The rendered frame is always scaled to the face (see `autoMetricScale`), so
the picture alone can't tell a customer a frame is too wide for them. This
compares the frame's real width (catalog spec or GLB bounding box, both in
millimetres) with the customer's face width, estimated in millimetres from
two landmark measures: the ear-level width (234/454) and the inter-pupillary
distance, whose adult spread (63 mm, SD ~3 mm) is tight enough to act as
the ruler. The estimate inherits that spread (about ±5%), which is why the
default tolerance band is wider than an optician's.

#### `FIT_IDEAL_RATIO`

Frame width / ear-level face width of a good fit: a frame front about as
wide as the face at the temples. Measured on the face fixtures (people
wearing catalog frames that fit them, tests/e2e/fit.spec.ts, 2026-10-12):
1.045, 0.970 and 0.979, mean 1.00.

> Known problem: [#156](https://github.com/ElevenSpectacles/virtual-try-on/issues/156). This records why the code is as it is; it does not endorse it.

#### `FIT_HYSTERESIS`

Extra margin a verdict must cross before it changes, as a fraction of the
ideal width, so a face near a band edge doesn't flip the hint back and forth.

#### `estimateFaceWidthMm`

Face width at ear level in millimetres, from pose-compensated normalized
measures (ear width and IPD, same units). 0 when either is missing.

#### `FaceWidthEstimate`

Running estimate of the face width: an exponential moving average over
detections, reported only once `FIT_MIN_SAMPLES` have been seen so the first,
noisiest frames never produce a verdict.
/

#### `FIT_MIN_SAMPLES`

Detections averaged before the first verdict (~1 s at 30 fps).

#### `fitVerdictFor`

Fit verdict of any frame for a measured face, without loading its GLB
(issue #98): `frameWidthMm` from the catalog spec or the calibration's
`frameWidthMm`. No hysteresis: this is for ranking a catalog, not for a
live hint.

#### `deviation`

Frame width over the ideal width for the face, minus 1: 0 is a perfect
width, +0.05 is 5 % too wide.

#### `rankByFit`

Rank frames by how well their width suits a face, best first (smallest
|deviation|). Frames with an unknown width (0) are left out. Ties keep
the catalog order.
