# Roadmap 2: status and merge plan (issue #105)

Roadmap 2 closes the gap with Fittingbox on four fronts: true-to-size fit,
shopper features, glasses-wearers and the finishing of realism. Every child
issue now has a branch with an implementation (or, for #100, a research
spike), unit tests, and a PR description. The PR descriptions say what was
verified and what still needs the local-only harness. This page tracks where
each one stands and the order to merge them in.

## Merge order: one linear stack

Each feature was first written against `main`. Nearly every pair touched the
same places: `VirtualTryOnExperience.vue` props, the exposed state, the
README tables, `AGENTS.md`. Merged one by one, every second PR would
conflict.

So the branches are **stacked**: each PR is based on the previous one. Each
PR shows only its own diff, and merging them **in this order with merge
commits** (the repo's existing style) never conflicts. GitHub retargets the
next PR to `main` when its base merges. Every step of the stack passes
`npx vitest run` and `nuxt typecheck` on its own.

| # | Issue | Branch | Base | Phase |
| --- | --- | --- | --- | --- |
| 1 | #83 temple ear bend | `feat/temple-ear-bend` | `main` | 0 |
| 2 | #87 pad-contact nose seat + tilt audit | `feat/nose-seat-tilt` | #83 | 0 |
| 3 | #92 true-to-size from the iris | `feat/true-to-size-iris` | #87 | 1 |
| 4 | #96 card calibration (±1 mm PD) | `feat/card-calibration` | #92 | 1 |
| 5 | #98 measurements, face shape, fit ranking | `feat/fit-advisor` | #96 | 3 |
| 6 | #93 `capture()` | `feat/capture` | #98 | 3 |
| 7 | #94 GLB cache + neighbour prefetch | `feat/glb-cache` | #93 | 3 |
| 8 | #97 `freeze()` / `unfreeze()` | `feat/freeze` | #94 | 3 |
| 9 | #95 time-to-first-frame | `perf/time-to-first-frame` | #97 | 4 |
| 10 | #99 tracking robustness, guide hints | `fix/tracking-robustness` | #95 | 4 |
| 11 | #84 camera reflections + light direction | `feat/camera-reflections` | #99 | 2 |
| 12 | #85 lens colour in physical units | `feat/lens-physical-colour` | #84 | 2 |
| 13 | #86 webcam match | `feat/webcam-match` | #85 | 2 |
| 14 | #103 model prep, lint, calibration validation | `feat/model-tooling` | #86 | 5 |
| 15 | #101 5.0 breaking cleanup | `feat/v5-breaking-cleanup` | #103 | 5 |
| 16 | #104 demo + README overhaul | `docs/demo-readme` | #101 | 5 |
| 17 | #102 split the SFCs into composables | `refactor/scene-composables` | #104 | 5 |

Off the stack (merge any time):

| Issue | Branch | Base | Note |
| --- | --- | --- | --- |
| #88 tinted lens shadow | `feat/tinted-lens-shadow` | `feat/shadow-multiply` (#89) | Waits for #89. #89 is older than `main` and conflicts only in its 56 re-recorded goldens: rebase it, re-record them, then merge #88. |
| #100 frame-removal spike | `docs/frame-removal-spike` | `main` | Docs and a harness only. |
| #105 this page | `docs/roadmap-2` | `main` | Docs only. |

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

- **Goldens.** Re-record after #84, #85, #86 and #88, which change pixels on
  purpose. Run `npx playwright test tests/e2e/rendering-goldens.spec.ts
  --update-snapshots` and review the diffs. #102 must pass **without**
  re-recording.
- **E2E specs.** The tracking, fit, hair, lighting and robustness specs, plus
  the new specs for capture, freeze, card calibration and the guide hints,
  run against the catalog models.
- **Colour QA.** `tests/e2e/colour.spec.ts` skips until
  `tests/fixtures/colour-swatches.json` has measured swatches (#85).
- **Phone timings.** Check the tier budgets and #95's time-to-first-frame on
  a mid-tier phone.

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
