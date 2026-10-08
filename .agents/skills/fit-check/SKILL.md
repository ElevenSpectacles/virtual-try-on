---
name: fit-check
description: Measure how the rendered try-on frame fits real faces (size, position, rotation, temple/occluder clipping) against the face fixtures, before and after a change. Use when touching frame scale, anchor/position, pose, the occluder, calibration, or when a user reports the frame looks wrong, too big/small, shifted, or cut off.
---

# Fit check

Evidence before tuning. Every fit change in this repo gets a number from the
face fixtures, not an eyeball verdict on one screenshot.

## What the fixtures can and cannot tell you

- `tests/fixtures/faces/<model>.jpg` are campaign photos of a person wearing
  that exact catalog frame — ground truth for **where the real frame is**.
- They are **long-lens** shots. Our virtual camera uses MediaPipe's 63° FOV.
  Do not tune FOV or perspective against them. (Measured: 63° → 15° changes
  ~1% of pixels, so FOV is rarely the cause anyway.)
- MediaPipe yaw saturates around 45° (kairos-amber is ~75° real, reports 44°).
  Residual error on extreme profiles is a tracker limit, not a fit bug.
- Scale and population: head widths vary ~5%; don't retune
  `FRAME_FIT_SCALE_BOOST` for a < 5% delta on two faces.
- The GLB bbox (≈ 0.1397 m) includes hinges outside the lens edges. Compare
  **lens edge to lens edge** and **bridge to bridge**, never bbox widths.

## Loop

1. Baseline. Goldens on the current commit are the "before":
   `tests/e2e/__screenshots__/render.spec.ts/<face>-darwin.png`
   (shipped `VirtualTryOnExperience`, occluder **off**, mirrored).
2. Make the change.
3. Re-render without touching goldens:
   `rm -rf test-results && npx playwright test render.spec.ts --reporter=line`
   Failing tests write `test-results/**/<face>-actual.png` — that's the "after".
   For the playground prototype (occluder on, debug panel), serve it and shoot:
   ```bash
   npx nuxt build playground && PORT=3298 node playground/.output/server/index.mjs &
   node .agents/skills/fit-check/scripts/proto-shot.mjs kairos-amber /tmp/ka.png [--occluder-off] [--occluder-debug]
   ```
   Rebuild after every source change — it serves the production build.
4. Measure with gridded zooms, same region on source, before and after:
   ```bash
   node .agents/skills/fit-check/scripts/grid-crop.mjs <png> /tmp/crop.png <left> <top> <w> <h>
   ```
   Read the outer lens edges and the bridge centre. Goldens are 448×598,
   the 480×640 source cover-scaled by 0.934 and **mirrored**:
   `golden_x ≈ (480 − source_x) × 0.934`.
5. Sweep a constant with 3 values (e.g. 8 / 12 / 18 mm), keep the one with
   the smallest **mean** error across fixtures, prefer physically plausible
   values. Record the table in the PR.
6. Accept: `npm run verify:e2e -- --update-snapshots`, look at every new PNG,
   then `npx vitest run` and `npm run typecheck`.

## Where fit lives

- Scale: `autoMetricScale` in `VirtualTryOnExperience.vue` (ear width →
  metric, `FRAME_FIT_SCALE_BOOST`), mirrored in the playground prototype —
  change both.
- Position: `framePosition` (anchor + `FRAME_BRIDGE_STANDOFF_METERS` along
  the head's forward axis).
- Occluder: `utils/tryon-occluder.ts` (`inflate`, `collarFlare`,
  `nearSideWeight`). Shipped component has it **off**; check the prototype.
- Per-model offsets: the host's `calibration.json`.

## Report

Lead with a before/after table in source or golden px, name what was ruled
out, and state what still looks off and why it wasn't tuned.
