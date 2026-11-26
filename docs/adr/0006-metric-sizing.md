# 0006. Size frames in metres from facial measurements

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

GLBs are authored in metres, while a monocular camera gives only normalized distances.

## Decision

Scale comes from ear width, with face width and IPD as fallbacks. The iris measures PD, a robust median freezes it, and confidence eases scale from population averages.

## Consequences

Accuracy is bounded by the iris assumption and pose gates. A change here moves both rendered size and fit verdicts.

## Known problems in these files

- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST

## Detailed records

### `src/runtime/composables/tryon/useTryOnPlacement.ts`

#### `trueToSize`

Size the frame from the shopper's measured PD (iris ruler, see
utils/tryon-measure) instead of population averages. Default on.

#### `PD_RESET_AFTER_LOSS_MS`

How long the face must stay lost before the PD measurement starts over:
a short loss (a turn past the tracker's range) is still the same person,
a longer one may not be.

#### `ipd`

Normalized inter-pupillary distance from the iris landmarks — varies far
less between people than cheek-to-cheek width, so it stays the fallback
when face width isn't trackable.

#### `earWidth`

Normalized ear-to-ear width (face-oval points at temple height) — the
measure a real frame is sized from: the temple arms must span it. Drives
the metric scale when trackable.

#### `poseCompensated`

Widths are measured in stage width units (`options.aspect`) and divided by
`compensateMeasureForPose`: the on-screen length of the head's own x axis
under the tracked yaw, pitch and roll (`|R·x̂|` projected, YXZ as ADR 0005).
Pitch alone leaves a horizontal segment's length unchanged and roll only
turns it; the old `cos(yaw)·cos(pitch)` divisor grew the frame 6% at a 20°
nod (#143). The divisor is clamped at 0.5 so a noisy near-profile pose
cannot blow up the scale. `fit.spec.ts` measures the same way.

#### `pdEstimate`

True-to-size (issue #92): the PD and ear-level width in millimetres,
measured against the iris on frontal, open-eyed detections (raw
landmarks: the ratios don't depend on the cover crop). Kept through a
short tracking loss; started over after PD_RESET_AFTER_LOSS_MS, since it
may be someone else.

#### `if (lostAt !== null && performance.now() - lostAt >= PD_RESET_AFTER_LOSS_MS) {`

The held face (useTryOnTrackingHold) goes empty only once per loss, so
a long loss is also caught when the face comes back.

#### `measurement`

A card calibration wins over the iris: it is the more accurate ruler.
The ear width keeps its measured ratio to the PD (iris samples, else
this detection's).

#### `noseEstimate`

Pad-contact seat (issue #87): for a model with pad spacing in its
calibration, the shopper's nose profile (frontal detections, averaged)
decides how much lower or higher than on the reference nose the frame
sits. Millimetres from the ear-level width (measured, else assumed).

#### `scaleSource`

GLBs are authored in metres — derive scale metrically from the tracked
ear-to-ear width (what a frame's temple arms actually span), falling back
to cheek width, to IPD, and to the static reference width while no face
is tracked.

### `src/runtime/utils/tryon-measure.ts`

#### File overview

True-to-size measurement (issue #92): the shopper's pupillary distance in
millimetres, from the iris. Pure math, no Vue.

Every scale source in the placement is a normalized on-screen measure that
needs a real-world length to become metres. Without a measurement that length is an
assumed population average (`ASSUMED_IPD_METERS`, `ASSUMED_EAR_WIDTH_METERS`),
so a 56 mm-PD face and a 70 mm-PD face got frames sized against the same
ruler. The iris is a better ruler: the horizontal visible iris diameter
(HVID) of adults is ~11.7 mm with a spread of only ~0.5 mm, and MediaPipe's
FaceLandmarker returns each iris ring (468–477). Iris diameter → mm per
normalized unit → the PD in millimetres, which then replaces the assumed
IPD as the ruler of every other measure.

A single frame is noisy (the iris is ~20 px wide in the 480 px detection
input, so half a pixel of landmark noise is ~2.5 %), so samples are
accepted only on frontal, open-eyed frames, and the PD is the median of a
few seconds of them. Once the spread is small it freezes, so the frame
doesn't "breathe" with the noise. While samples accumulate, `pdConfidence`
ramps from 0 to 1 and callers blend from the assumed value, so the switch
to the measured size has no visible jump.

Sources: HVID 11.7 ± 0.5 mm (Caroline & Andre); the MediaPipe Iris paper
(Ablavatski et al., 2020, arXiv:2006.11341) uses the same constant for
metric depth.
/

#### `IRIS_DIAMETER_MM`

Mean adult horizontal visible iris diameter, millimetres.

#### `PD_MIN_MM`

Plausible adult PD range, millimetres. Samples outside it are tracker
glitches (a ring collapsed during a squint, an iris mislocated), not faces.

#### `PD_MAX_YAW_RAD`

Head turn and nod beyond which a sample is rejected. The IPD foreshortens
by cos(yaw) while the iris ring (a circle) only partly does, so the ratio
is only trustworthy near frontal: 12° keeps the bias under 1 %.

#### `PD_WINDOW`

Samples kept for the median (~3 s of accepted frames at 30 fps).

#### `PD_STABLE_SAMPLES`

Accepted samples before the PD can freeze (and confidence reaches 1).

#### `PD_STABLE_SPREAD`

Relative spread (half the interquartile range / median) under which the PD
freezes. 2 % of a 63 mm PD is 1.3 mm. The interquartile range, not the
median absolute deviation: a tracker flipping between two values would
give a MAD of 0 and freeze on one of them.

#### `EYE_ROTATION_RADIUS_MM`

Distance from the eye's centre of rotation to the front of the cornea, mm.
Converging on a screen turns each eye inward, which moves the iris centres
closer together by about this lever arm times the vergence angle.

#### `widthUnitDistance`

A distance between two normalized landmarks in "width units" (fractions of
the image width): normalized y is a fraction of the height, so it is scaled
by height / width. `aspect` is the image's width / height.

#### `irisDiameter`

Mean iris diameter of both eyes, in width units: twice the mean distance
of each eye's four ring points from its centre. Order-independent, so it
does not care which ring point MediaPipe lists first. 0 when the result
has no iris landmarks (468-point model).

#### `pdFromIris`

PD in millimetres from the IPD and the iris diameter (same units, so the
camera distance cancels out). 0 when either is missing.

#### `viewingDistanceMm`

Camera-to-eye distance in millimetres from the iris's apparent size, for a
camera of horizontal field of view `hFovDeg`. A webcam's FOV is not known,
so this is a ±20 % estimate: good enough for the small vergence correction
below, not for anything else.

#### `ASSUMED_CAMERA_HFOV_DEG`

Horizontal field of view assumed for the vergence correction. Laptop
webcams are ~60–70° wide, phone front cameras in portrait ~50–60°; the
correction is ~1.7 mm, so a 25 % error in the distance moves the PD by
~0.4 mm.

#### `distancePdMm`

Distance PD (what an optician measures, eyes looking far) from the PD
measured while the eyes converge on a screen `distanceMm` away. Each eye
turns inward by atan((PD/2) / distance), pulling its iris centre in by
`EYE_ROTATION_RADIUS_MM` times that: about 1.7 mm in total at 50 cm.

#### `samples`

Recent accepted near-PD samples, mm (oldest first, at most `PD_WINDOW`).

#### `nearPdMm`

Median near PD, mm: the ruler for the on-screen measures.

#### `pdMm`

Median distance PD, mm: what an optician would measure.

#### `PdSample`

One frontal, open-eyed detection's measures, all in millimetres.

#### `pdConfidence`

0 … 1: how much to trust the measured PD over the assumed one. Ramps with
the accepted samples, so the scale eases from the assumed size to the
measured one over the first second or two instead of jumping.

#### `blendedMeters`

Real-world length (metres) to divide a normalized measure by: `assumed`
blended toward the measured length by `pdConfidence`. `measuredMm` 0 (not
measured) keeps `assumed`.

### `src/runtime/utils/tryon.ts`

#### `ASSUMED_FACE_WIDTH_METERS`

Assumed real-world face width (cheek-to-cheek) used to derive a metric base scale.

#### `getFaceWidth`

Approximate face width in normalized image coordinates using MediaPipe
face landmarks. Cheek-to-cheek (127 ↔ 356) gives a stable width that is
largely independent of expression.

#### `EAR_LEVEL_RIGHT`

Face-oval contour landmarks at temple/ear-attachment height — the
outermost points of the visible face silhouette, further out than the
127/356 cheek points `getFaceWidth` uses. MediaPipe's face mesh has no true
ear landmark (the ear itself sits behind the visible silhouette), so this
is the closest available proxy for "how far apart the ears are" and is
preferred over cheek-width for driving temple-reach scale.

#### `ASSUMED_EAR_WIDTH_METERS`

Assumed real-world ear-to-ear width (bitragion breadth) at temple height,
used to derive metric scale from `getEarWidth`. Averages ~145-150mm across
adults, wider than cheek-to-cheek (~140mm) since it's measured further back
toward the ears.

#### `ASSUMED_IPD_METERS`

Assumed real-world inter-pupillary distance. IPD averages ~63mm across
adults with a ~3mm standard deviation — far tighter than cheek-to-cheek
face width (~7mm SD) — and it is the measure the eyewear industry sizes
frames from. It is the scale fallback and the fit ruler.
/

#### `IRIS_CENTER_RIGHT`

Iris-center landmark indices (FaceLandmarker emits 478 landmarks).

#### `BLINK_EYE_ASPECT_RATIO`

Below this (aspect-corrected) ratio an eye counts as closed. Measured on
real detections: open eyes ≈ 0.23, a full blink ≈ 0.13. 0.17 sits between
with margin on both sides — a squint freezing the scale for a moment is
harmless, a missed blink lets the frame size jump.

#### `getEyeAspectRatio`

Eye aspect ratio (Soukupová-style, single vertical pair per eye): lid
opening divided by eye width, averaged over both eyes. Returns 0 when the
eye landmarks are absent, so callers can treat "no data" as "not a blink".

`aspect` (media width/height) corrects the per-axis normalization:
landmark y is normalized by image height, x by width, so the raw ratio is
inflated by W/H — without the correction the blink threshold would shift
~1.6× between a portrait photo and a landscape webcam.

#### `BLINK_SCORE_THRESHOLD`

Blendshape blink score (max of `eyeBlinkLeft`/`eyeBlinkRight`) above
which a frame counts as a blink. MediaPipe's blendshape scores are
calibrated probabilities, so 0.5 is the natural cut.

#### `shouldHoldScaleForBlink`

Whether to hold the frame's scale for this result: the blendshape blink
score when the model provides it, else the eyelid-landmark heuristic
(`isBlinking`) — e.g. a self-hosted model without blendshapes.
