# 0019. Prepare assets idempotently and calibrate after compression

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Catalog exports differ in origin, scale and tilt. Trimming is destructive and compression shifts bounds.

## Decision

Preparation records each step in GLB extras, compresses before measuring, and keeps hand-tuned calibration fields. Runtime validation falls back field by field.

## Consequences

Run the single preparation command on the final catalog and review lint and tilt reports.

## Detailed records

### `scripts/audit-tilt.ts`

#### File overview

Pantoscopic tilt audit (issue #87): fits each GLB's lens plane and reports
its effective tilt (lens plane + calibration rotation.x) against the
7–12° fitting range, with the rotation.x that gives 9°.

`npx tsx scripts/audit-tilt.ts --input <dir> --calibration <dir>/calibration.json`

Exits non-zero when a model is out of range, so it can gate a catalog PR.

### `scripts/compress-models.ts`

#### File overview

Compresses a directory of GLBs with Draco mesh compression via
@gltf-transform/functions' `draco()` transform. Run against the host's
model directory before shipping — the module's model cache already expects to decode Draco
meshes when present, and is a no-op passthrough for meshes that aren't.

### `scripts/generate-calibration.ts`

#### File overview

Writes the `calibration.json` the component loads (`calibration-url`):
measures every GLB in --input and normalises it against --reference (see
scripts/lib/calibration.ts for the maths). Run it on the final, compressed
models: Draco compression shifts bounding boxes by float rounding.

`npm run generate-calibration -- --input <dir> --output <dir>/calibration.json`

When --output already exists, its hand-tuned fields (rotation, lens, pads) are kept.

### `scripts/lib/calibration.ts`

#### File overview

Calibration maths for `scripts/generate-calibration.ts`, kept free of file
and GLB I/O so it can be unit-tested (tests/unit/scripts/calibration.test.ts).

GLB exports rarely share an origin or a scale, so each frame gets:
- `translation`: brings its bounding box onto the tracked anchor. X and Y
  centre the box; Z puts the FRONT of the frame (the lens plane, `max.z`)
  on it. Centring Z would put the middle of the temples at the anchor and
  push the lenses half a temple-length toward the camera.
- `scale`: normalises its size to the reference frame, from the mean of the
  width and height ratios. Depth is barely visible face-on, so it is left
  out.
- `frameWidthMm`: the frame's rendered width (bounding box × `scale`), for
  ranking the catalog by fit without loading GLBs.

Fields tuned by hand (`rotation`, `lens`, `pads`) are carried over from
the previous manifest, so regenerating never wipes them.
`templeWidthBoost` (removed in 5.0) is dropped.

#### `return Number(value.toFixed(digits)) + 0`

`+ 0` turns -0 into 0, so a centred axis serialises as 0, not -0.

#### `entry.frameWidthMm = round(width * entry.scale * 1000, 1)`

The rendered width (GLB metres × scale), as the component measures it,
so a host can rank the catalog by fit without loading the GLBs.

#### `buildCalibration`

The manifest for `models`, normalised against `referenceName`. `previous`
(the manifest being replaced, if any) supplies the hand-tuned fields.
Models are listed in name order, so regenerating gives a stable diff.

#### `parseCalibrationFile`

Validate an existing manifest (parsed JSON) before its hand-tuned fields
are carried over. Throws on anything that isn't a calibration manifest, so
a wrong `--output` path or a hand-edit typo fails loudly instead of feeding
bad tuning back in. Only the carried-over fields are checked in depth.

### `scripts/lib/colour.ts`

#### File overview

Colour QA maths (issue #85): sRGB → CIELAB (D65) and the CIEDE2000 colour
difference, for comparing rendered frame and lens swatches with product
photos (tests/e2e/colour.spec.ts). Tooling only; not shipped.

ΔE2000 below ~1 is invisible, ~2–3 is what a trained eye notices side by
side; the spec's threshold is 3.

#### `deltaE2000`

CIEDE2000 colour difference (Sharma, Wu & Dalal, 2005), kL = kC = kH = 1.

### `scripts/lib/model-lint.ts`

#### File overview

Catalog model lint (issue #103): what the runtime needs from a GLB, and
what silently produces a bad try-on. Pure over a gltf-transform Document.

Errors fail `scripts/lint-models.ts`; warnings are listed.

#### `PLACEHOLDER_LENS_COLOURS`

Lens base colours shared across the catalog as placeholders (issue #85):
a lens that still has one renders the wrong colour.

#### `FRAME_WIDTH_RANGE`

Plausible frame size, metres (GLBs are authored in metres).

#### `MAX_TEXTURE_SIDE`

Texture side above which KTX2 (or a smaller texture) is worth it.

### `scripts/lib/model-prep.ts`

#### File overview

Model preparation steps for `scripts/prepare-model.ts` (issue #103), kept
free of file I/O so they are unit-tested on synthetic documents. The
order matters and the trim must never run twice (each run tilts the
temples again), so every step records itself in the GLB's root
`extras.tryOnPrepared` and is skipped when already there.

`backfillPrepared` recognises GLBs prepared before the marker existed
(#157): a temple that reaches no further than the trim threshold (plus
`TRIM_DETECT_MARGIN`) is already trimmed, and a GLB using
`KHR_draco_mesh_compression` is already compressed. Measured on the
catalog: trimmed temples reach 0.1046 in local X, untrimmed ones 0.151.
`prepare-model` then copies such a file unchanged, and the lint accepts
Draco without the marker.

trim temple tips → Draco-compress → (measure for calibration)

Calibration is measured on the compressed output, since compression
shifts bounding boxes by float rounding.

#### `tiltPrimitive`

Rotates the kept temple-shaft vertices upward around the hinge, pitching
in the local X/Z plane (world reach/up). The pivot comes from the data
(the lowest local-X vertices near the hinge), not a hardcoded value.

#### `theta`

Positive angle raises local +X (the shaft) toward local +Z (world up):
a rotation by -angle about local Y, around the hinge.

#### `prim.setIndices(index.clone().setArray(Uint32Array.from(kept)))`

Move the primitive onto fresh accessors holding only the referenced
vertices, so the trim stays scoped to pt2 even with shared accessors.

#### `compressOnce`

Draco-compress, once. The IO writing the document needs the encoder.

### `scripts/lib/tilt.ts`

#### File overview

Pantoscopic tilt audit (issue #87). Tooling only.

A worn frame's front tilts forward at the bottom by 7–12° (ZEISS
dispensing guide: default 9°) so the lenses follow the cheekbones and the
eye's downward gaze. On the try-on, a model's effective tilt is its lens
plane's own tilt in the GLB plus the calibration `rotation.x`. This fits
the lens plane to the lens vertices (least squares over depth = a·x + b·y
+ c, the front of a lens being nearly flat), reads the tilt from its slope
in y, and suggests the `rotation.x` that brings the model to the target.

Conventions: GLB y up, z toward the viewer (glTF). A positive tilt has the
lens bottom closer to the face (further from the viewer) than its top.

#### `pantoscopicTiltDeg`

Pantoscopic tilt of a lens plane in degrees: the forward lean of its
bottom. With depth z = a·x + b·y + c, going up by 1 moves the surface
toward the viewer by b, so the bottom sits back by the angle atan(b).

#### `auditTilt`

Audit one model: lens vertices in the GLB frame and its calibration
`rotation.x` (radians; three.js rotation about x, positive tips the top
toward the viewer, which adds tilt).

### `scripts/lint-models.ts`

#### File overview

Model lint (issue #103): checks every GLB in --input for what the try-on
needs (lens material, temple node, sane size) and what silently looks
wrong (placeholder lens colour, big textures). Exits non-zero on errors.

`npx tsx scripts/lint-models.ts --input <dir>`

### `scripts/prepare-model.ts`

#### File overview

One command from a raw catalog GLB to a try-on-ready GLB and its
calibration entry (issue #103). Steps, in order, each at most once (they
record themselves in the GLB's extras, so a second run changes nothing):

1. trim the curled temple tips and tilt the shafts (never twice)
  2. Draco-compress
  3. lint (scripts/lib/model-lint)
  4. regenerate calibration.json for the output directory, keeping the
     hand-tuned fields (calibration is measured on the compressed GLBs)

`npx tsx scripts/prepare-model.ts --input <glb or dir> --output <catalog dir> \`

[--calibration &lt;catalog dir>/calibration.json] [--reference iris-bronze]

The output directory is the catalog: it must hold the reference model for
the calibration step.

### `scripts/trim-temple-tips.ts`

#### File overview

Shortens the temple arms in the catalog GLBs by dropping the curled
ear-hook geometry past a local-space X threshold, then tilts the
remaining straight shaft upward around the hinge. Every catalog frame
shares the same authored structure: a node named `pt2` holds both temple
arms as one mirrored mesh (split by the sign of local Y), running local-X
from the hinge (~0.018) to the tip (~0.151). Tracing the arm's centerline
along X shows it runs a straight shaft out to ~0.10, then curves down and
back (the ear-hook) for the remaining ~0.05 — the default threshold cuts
right where that curve starts, dropping the whole hook, not just its
rounded end cap. Dropping triangles with any vertex past the threshold
removes it cleanly. The cut leaves each arm's tube open, so every closed
loop of edges the dropped triangles shared is fanned shut with the
dropped surface's winding (outward-facing); loops that don't close are
counted as `open` and reported. The catalog arms cap as 2 loops, 0 open.

Without the hook, though, the leftover shaft is dead flat (local Z is
near-constant along its whole length) — it runs level into the ear rather
than arcing over the top of it the way a real temple does, so it reads as
poking past the ear instead of resting on it. `pt2`'s node transform (see
its parent `glasses` node's rotation) maps local X -> world -Z (reach),
local Y -> world X (left/right side-select), local Z -> world +Y (up) —
so tilting the tip toward the top of the ear means rotating the kept
vertices around the hinge in the local X/Z plane (a pitch around the
left/right axis), not touching Y.

GLBs it trimmed are marked in their extras (`tryOnPrepared`) and skipped
on a second run, since every run would tilt the shaft another
--tilt-degrees; GLBs trimmed before the marker existed are recognised by
their geometry (see `model-prep.ts`). `scripts/prepare-model.ts` runs
this and the other steps in order.

### `src/runtime/composables/tryon/useFrameCalibration.ts`

#### `validateCalibration`

Calibration of `model` from a manifest, plus what is wrong with its entry
(issue #103). A typo used to show only as a misplaced frame; now each
invalid field falls back to its default and is listed in `problems`, for
the component to report (`TRY_ON_ERROR`, source `calibration`). A model
without an entry is not a problem: it gets the identity calibration.

#### `loadError`

A manifest that fails to load still falls back to identity calibration for
every frame, so the try-on keeps working, but `useFetch`'s error is now read
and reported once as `TRY_ON_ERROR` (source `calibration`, `errorType`
`load_failed`, `message` starting with the URL).

#### `translation`

Translations are metres (a frame is ~0.14 m), rotations radians.

#### `gradient`

resolveLens clamps, so check the raw values: a sheet in percent
(top: 85) would otherwise become an opaque lens without a report.

### `src/runtime/types/tryon-calibration.ts`

#### File overview

Per-model calibration for the Virtual Try-On module.

Because GLB frame models do not share a consistent bounding-box baseline,
each model needs explicit offsets so the frame sits on the user's face in
the same way.

The values are expressed in the model's local coordinate space and applied
before user-facing scale/yaw fine-tuning.

#### `model`

Model identifier — matches the GLB filename without extension.

#### `translation`

Translation offset applied to the face landmark position (metres).

#### `rotation`

Rotation offset applied on top of the tracked head pose (radians).

#### `scale`

Scale multiplier applied to the base uniform scale.
A value of 1 leaves the artist-authored size unchanged.

#### `lens`

Lens tint and density, replacing the GLB's authored lens colour and
opacity — e.g. one GLB shipped in several lens colours. Optional.

#### `pads`

Nose pads: the distance between their contact points, mm. With it the
frame seats lower on a narrow nose and higher on a wide one
(utils/tryon-seat). Optional; without it every nose seats the frame at
the same point.

#### `frameWidthMm`

Total frame width in millimetres (bounding-box width × `scale`), written
by `generate-calibration`. Lets a host rank its catalog by fit without
loading every GLB. Optional; `TryOnModel.frameWidthMm` wins when set.

#### `reference`

Reference model used to normalize the baseline.

#### `frameWidthMm`

Frame width from the manifest, mm; 0 when it has none.
