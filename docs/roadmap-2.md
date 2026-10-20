# Roadmap 2: status and merge record (issue #105)

Roadmap 2 closes the gap with Fittingbox on four fronts: true-to-size fit,
shopper features, glasses-wearers and the finishing of realism. Every child
issue has landed on `main` (or, for #102, is in review). This page records
which PR delivered each one and the order they merged in.

## Status

Each feature was first written against `main`. Nearly every pair touched the
same places: `VirtualTryOnExperience.vue` props, the exposed state, the
README tables, `AGENTS.md`. So the branches were **stacked**, each PR based
on the previous one, and merged in this order with merge commits. Every step
passed `npx vitest run` and `nuxt typecheck` on its own.

| # | Issue | PR | Phase |
| --- | --- | --- | --- |
| 1 | #83 temple ear bend | #108 | 0 |
| 2 | #87 pad-contact nose seat + tilt audit | #109 | 0 |
| 3 | #92 true-to-size from the iris | #110 | 1 |
| 4 | #96 card calibration (±1 mm PD) | #111 | 1 |
| 5 | #98 measurements, face shape, fit ranking | #112 | 3 |
| 6 | #93 `capture()` | #113 | 3 |
| 7 | #94 GLB cache + neighbour prefetch | #114 | 3 |
| 8 | #97 `freeze()` / `unfreeze()` | #115 | 3 |
| 9 | #95 time-to-first-frame | #116 | 4 |
| 10 | #99 tracking robustness, guide hints | #117 | 4 |
| 11 | #84 camera reflections + light direction | #118 | 2 |
| 12 | #85 lens colour in physical units | #119 | 2 |
| 13 | #86 webcam match | #120 | 2 |
| 14 | #103 model prep, lint, calibration validation | #121 | 5 |
| 15 | #101 5.0 breaking cleanup | #122 | 5 |
| 16 | #104 demo + README overhaul | #123 | 5 |
| 17 | #102 split the SFCs into composables | #129 (in review) | 5 |

Off the stack:

| Issue | PR | Note |
| --- | --- | --- |
| #88 realism shadows | #89, #124, #127 | #89: multiply-blended receiver and analytic contact occlusion (steps 1–2). #124: tinted lens shadow, opt-in, `high` tier (step 3). #127: occlusion follows the hinged and bent temples. The contact shadow is off on the `low` tier (`FEATURE_MIN_TIER.contactShadow = 'mid'`). |
| #100 frame-removal spike | #125 | Docs and a harness only. |
| #105 this page | #126 | Docs only. |
| — | #128 | Integration fixes found by an audit of the merged stack. |

### Why the order differs from the issue's suggestion

- **#102 goes last, not early.** The issue suggested splitting the SFCs
  between feature PRs, so that later PRs would touch smaller files. All
  feature PRs already existed against the unsplit files, so porting 16
  features onto the split would have meant 16 conflict resolutions. Redoing
  the split once on the final code is one mechanical step. The PR proves it
  changes nothing: built runtime props are identical, the scene renders
  pixel-identical, and the live track events are the same.
- **Shopper features (phase 3) come before realism (phase 2).** They touch
  the component's API rather than the scene, and #98 builds directly on #92
  and #96.
- **#101 (5.0) sits after every feature** that still wrote
  `templeWidthBoost`, so the cleanup removes it once, everywhere. #104 rides
  with it as the 5.0 docs.

## Integration choices made while stacking

Some features met in the same code. These are the behaviours the stack
settled on. Each is in the PR of the later feature.

- **#92 × #87.** The nose seat converts the nose width to millimetres with
  the iris-measured ear width once there is one, else the assumed width.
- **#96 × #98.** A card calibration flows through the placement
  `measurement`, so `measurements.pdMm`, the fit verdict, `fitFor` and
  `fitRanking` all use the card PD.
- **#94 × #83 / #95.** GLB loading moved into the model cache. The ear bend
  restores the authored arm materials on a frame switch, so a cached frame
  comes back clean. The model-load timing is measured around the cache, and
  the preconnect guard test reads the Draco default from the cache.
- **#99 × all.** Placement, card calibration, freeze, fit and face shape read
  the *held* face. Session metrics read the raw tracker.
- **#84 × #95 × #99 × #86.**
  - One lighting sampler serves the tier-independent `roomLuma` (the
    `tooDark` hint), the room sample and the light direction (camera
    reflections).
  - Camera-match grain follows `roomLuma`, so it works with
    `adaptiveLighting` off.
  - The procedural low-tier environment and the camera environment share
    one restore path.
- **#103 × #85 / #87 / #98 / #101.** `validateCalibration` carries and
  validates `pads`, `frameWidthMm` and the lens category, transmittance and
  gradient. In 5.0 it ignores `templeWidthBoost`.

## What still needs the local harness

The unit suites, typecheck, build and in-browser smoke checks ran for every
branch. Some checks need the catalog GLBs or real hardware, so they are
local-only by design (decided in #16):

- **Goldens.** Re-recorded with #89. Re-record after any further change
  that moves pixels on purpose. Run `npx playwright test tests/e2e/rendering-goldens.spec.ts
  --update-snapshots` and review the diffs. #102 must pass **without**
  re-recording.
- **E2E specs.** The tracking, fit, hair, lighting and robustness specs, plus
  the new specs for capture, freeze, card calibration and the guide hints,
  run against the catalog models.
- **Colour QA.** `tests/e2e/colour.spec.ts` skips until
  `tests/fixtures/colour-swatches.json` has measured swatches (#85).
- **Phone timings.** Check the tier budgets, #95's time-to-first-frame and
  #88's < 1 ms contact-shadow GPU budget on a
  mid-tier phone.

## Follow-ups (not in this roadmap)

- **Demo deployment (#104).** Pick frames cleared for publishing, set the
  `DEMO_MODELS_URL` secret, set Pages to "GitHub Actions", run the Demo
  workflow, and record the README GIF from the live demo.
- **Frame removal (#100).** The spike is a go for clear prescription
  glasses. Its first task is a clear-lens fixture set of three consenting
  people. The estimate is ~2 weeks after that.
- **Host follow-ups.** Each PR lists the storefront UI it enables:
  - capture and share;
  - compare on a held pose;
  - "frames that fit you";
  - the card-calibration screen;
  - guide-hint copy.
