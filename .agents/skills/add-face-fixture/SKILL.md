---
name: add-face-fixture
description: Add a new face fixture (a photo of a person wearing a catalog frame) to the Playwright harness — crop it, register it, record tracking metrics and a golden screenshot. Use when the harness needs coverage for a new pose (profile, tilt, glasses type, skin tone, lighting) or a new catalog model.
---

# Add a face fixture

Fixtures are the harness's ground truth: each JPEG shows a real person
wearing that exact catalog frame, so the file name doubles as the model to
render on it.

## Pick a source

- The storefront's campaign photos live in
  `../nuxt/public/images/campaign/<model>.jpg` (also `instagram/`,
  `announcements/`). Read only; never edit the storefront.
- The person must wear the **catalog frame named by the file**, and that
  model must exist in the host's `calibration.json`.
- Prefer poses the suite lacks. Current: iris-moss (~25° yaw, tilted),
  pteron-azure (~25° the other way), kairos-amber (near profile).
  Missing: frontal, pitch up/down, glasses on a darker skin tone.
- No camera footage of real users, ever (privacy rule in `AGENTS.md`).

## Steps

1. Find the head with a gridded view:
   `node .agents/skills/fit-check/scripts/grid-crop.mjs <photo> /tmp/g.png 0 0 <w> <h> 1`
2. Crop a 3:4 box around head and shoulders, then scale to 480×640:
   ```bash
   ffmpeg -loglevel error -y -i <photo> -vf "crop=<w>:<h>:<x>:<y>,scale=480:640" -q:v 3 tests/fixtures/faces/<model>.jpg
   ```
   Keep the face ≥ 150 px wide after scaling, or detection gets flaky.
3. Add `<model>` to `FACE_FIXTURES` in `tests/e2e/fixtures.ts`.
4. Run its tests and create its golden:
   ```bash
   npx playwright test -g "<model>" --update-snapshots --reporter=line
   ```
   Tracking must show 100% detection and still jitter ≤ 0.75 px. If
   detection fails, the pose is beyond MediaPipe; pick another photo rather
   than loosening thresholds.
5. Open the new `tests/e2e/__screenshots__/render.spec.ts/<model>-darwin.png`
   and check the frame is on the face. A golden records today's behaviour,
   bugs included. Mention known misfits in the PR.
6. Run the whole suite once (`npm run verify:e2e`) so the existing goldens
   stay green, and commit the JPEG, the golden and `fixtures.ts` together.

## Notes

- Clips are rendered from the JPEG into `os.tmpdir()` (Y4M is ~0.5 MB a
  frame; never commit them).
- Goldens are macOS-only (`-darwin`) until CI runs the harness (#16).
