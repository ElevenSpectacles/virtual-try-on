# 0007. Offer an ID-1 card as an optional, more precise ruler

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

The iris ruler is good to about 2–3 mm. Optical use needs better.

## Decision

During an explicit calibration the worker returns small forehead crops. Agreeing card-edge measurements replace the iris PD for the session.

## Consequences

The crop stays on the device and is taken only while calibrating. A missed frame is preferred to a wrong PD.

## Known problems in these files

- [#143](https://github.com/ElevenSpectacles/virtual-try-on/issues/143): Bug: face-width compensation is wrong for pitch and roll (up to 24% scale error)
- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST

## Detailed records

### `src/runtime/composables/tryon/experience/useTryOnFrameFit.ts`

#### `if (tracking.frozen.value) await tracking.unfreeze()`

Card crops come from live detections: resume the camera first.

### `src/runtime/composables/tryon/experience/useTryOnTracking.ts`

#### `faceRegion`

The face's box in the raw frame, for the light direction. Read when a
sample arrives, after its detection.

#### `cardCalibration`

Card calibration (optional, ±1 mm PD): the host shows its own "hold a
card to your forehead" UI and calls `startCalibration()`; the result
replaces the iris PD for the session (memory only).
Raw tracker, not the held face: each card crop must be measured against
the landmarks of its own detection.

### `src/runtime/composables/tryon/useTryOnCardCalibration.ts`

#### `landmarks`

Raw landmarks (normalized to the camera frame).

#### `useTryOnCardCalibration`

Card calibration glue (issue #96). While detecting, every detection asks
the worker for a grey crop of the forehead band (`wantCardRegion`, at
full camera resolution) and each crop is measured (`onCardCrop`); see
utils/tryon-card for the maths. Only frontal frames count. Fails after
CARD_TIMEOUT_MS without a stable reading, also when no face (so no crop)
arrives at all. A crop the worker can't take (`observer_failed`) or a
throwing `onCardCrop` fails it at once (`fail()`), and is reported as
`TRY_ON_ERROR` (source `card_calibration`), so a broken crop never looks
like a shopper who timed out. Nothing runs, and nothing is cropped, while
idle.

#### `onCardCrop`

One grey crop from the worker; the landmarks are its detection's.

#### `calibratedNearPdMm`

The calibrated near PD (mm) once done: the on-screen ruler.

### `src/runtime/composables/tryon/useTryOnPlacement.ts`

#### `calibratedPd`

A card-calibrated PD (utils/tryon-card), which replaces the iris
measurement while set: `nearPdMm` as measured at the screen (the ruler),
`pdMm` the distance PD. Needs `trueToSize`.

### `src/runtime/utils/tryon-card.ts`

#### File overview

Card calibration (issue #96): ±1 mm PD from a standard ID-1 card held
flat against the forehead. Pure math, no DOM.

The iris ruler (utils/tryon-measure) is good to ~±2–3 mm. A bank, ID or
loyalty card is ISO/IEC 7810 ID-1, 85.60 mm wide to ±0.1 mm, which makes
it a far better ruler: held horizontally against the forehead, its two
vertical edges are ~250 px apart in a 480 px detection frame at arm's
length, so a one-pixel edge error is ~0.4 %.

The pipeline, per detection while calibrating:
1. `cardRegion`: the forehead band above the brows, from the landmarks,
   wide enough for an off-centre card. The face-landmarker worker crops it
   from the frame it just tracked and returns it as a small grey image.
   (The crop stays in the browser, like every other frame sample.)
2. `findCardEdges`: the card's left and right edges are the two strongest
   vertical-gradient columns at a plausible card width apart, with the
   edge running down most of the band (a stray vertical line in the hair
   is short).
3. `nearPdFromCard`: mm per pixel at the card, corrected to the eyes'
   depth (the card sits ~12 mm in front of them, closer to the camera),
   times the IPD in pixels, then vergence-corrected to a distance PD
   (`distancePdMm`), like the iris measurement.
4. `updateCardCalibration`: a median over a few agreeing frames, or a
   failure after a timeout.

#### `CARD_WIDTH_MM`

ISO/IEC 7810 ID-1 card width, millimetres.

#### `CARD_STANDOFF_MM`

How far in front of the pupils the card sits when pressed to the
forehead: the brow ridge stands ~8–12 mm proud of the corneas, and the
pupil is ~3 mm behind the cornea. 12 mm puts the card's ruler ~2–3 %
closer to the camera than the eyes at 40–60 cm.

#### `CARD_MAX_SPREAD`

Relative spread (half IQR / median) the samples must stay under.

#### `CardRegion`

A region of the camera frame, normalized `[0, 1]` (raw camera space).

#### `CARD_REGION_WIDTH_FACTOR`

The forehead band to search, from the landmarks: centred on the forehead
midline (landmark 151), `CARD_REGION_WIDTH_FACTOR`× the ear-level width wide (an 86 mm card is
~0.6× a 145 mm face, so there is room either side), from just above the
brows (landmark 9) up by 0.5× the face width (a 54 mm card is ~0.37×). Null when a
landmark is missing.

#### `CARD_FACE_RATIO`

Card width over the ear-level face width: 85.6 mm against adult faces of
~120–165 mm, with margin. Spans outside it are not a card (a forehead
between two hairlines is ~0.8).

#### `height`

Heights in y units: a width-unit length is `aspect` times longer in y.

#### `CARD_MIN_EDGE_SCORE`

Weakest edge a card may have, relative to the crop's mean gradient. On
the face fixtures a drawn card scored 5.4–13.6 and the strongest false
pair on a bare forehead (hair strands either side) 2.0: a missed frame is
cheap, a hairline taken for a card is a wrong PD.

#### `findCardEdges`

The card's left and right edges in a grey crop (`width` × `height`, one
byte per pixel): a column profile of the horizontal gradient, counting
only rows where the gradient is strong (so a long straight edge beats a
short bright texture), then the best pair of peaks between `minFraction`
and `maxFraction` of the crop width apart (by default, a card's width
relative to a face in a `cardRegion` crop). Null when nothing card-like.

#### `pairs`

Every plausible pair, scored by its weaker edge (a card has two). Just
inside both edges is the card itself, so the two inner sides must look
alike: that rejects a card edge paired with a hairline, the face's
outline, or the edge of a logo printed on the card (dark inside one
edge, card colour inside the other).

#### `nearPdFromCard`

PD in millimetres from one frame, as measured (eyes converged on the
screen): the card's width and the IPD, in the same units (camera pixels,
or fractions of the frame width), and the viewing distance (mm, for the
card-to-eye depth correction; 0 skips it). `distancePdMm` turns it into
the optician's distance PD.

#### `nearPdMm`

The calibrated PD as measured at the screen, mm: the on-screen ruler.

#### `updateCardCalibration`

Add one frame's near PD (0 when no card was found) taken at
`distanceMm`, at time `now`. Done once the last `CARD_SAMPLES` plausible
readings agree within `CARD_MAX_SPREAD`; failed after `CARD_TIMEOUT_MS`
without that. Only a detecting state changes.
