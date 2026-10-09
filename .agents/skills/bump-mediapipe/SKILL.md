---
name: bump-mediapipe
description: Bump the pinned @mediapipe/tasks-vision version and its WASM base path together, then verify tracking. Use when upgrading MediaPipe, or when the mediapipe-version test fails.
disable-model-invocation: true
---

# Bump MediaPipe

`@mediapipe/tasks-vision` is pinned to an exact version in `package.json`, and
the worker loads its WASM from a CDN path that must carry the same version.
A mismatch loads a WASM that does not match the JS. `tests/unit/mediapipe-version.test.ts`
enforces the match, so the two move together or not at all.

## Steps

1. Choose the target version and check its release notes for breaking changes
   to `FaceLandmarker` options or blendshape names.
2. Set the exact pin in `package.json` (no caret) to the target version:
   `"@mediapipe/tasks-vision": "<version>"`.
3. Set `DEFAULT_WASM_BASE_PATH` in `src/runtime/workers/face-landmarker.worker.ts`
   to the same version: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@<version>/wasm`.
4. Run `npm install` so `package-lock.json` picks up the new version.
5. Run `npx vitest run`. `mediapipe-version.test.ts` must pass, which proves the
   pin and the WASM path agree.
6. Run the face-fixture tracking e2e on the real GPU:
   `npm run verify:e2e -- tests/e2e/tracking.spec.ts`. Check detection rate and
   jitter against the previous run, not only pass/fail.
7. The dependency change is publish-affecting. Run the `release-smoke` skill
   before opening the PR.
8. Do not touch the version, `CHANGELOG.md` or the release manifest. Release-please
   owns them. Commit with `chore(deps): bump @mediapipe/tasks-vision to <version>`.

## Stop and report if

- The test fails after step 3: the WASM path is not the one the package ships.
- Detection rate drops on the fixtures: report the numbers and do not tune
  around them.
