# Architecture decision records

Source files carry no comments, so the reasons for non-obvious code live here. Before changing a file, open the records listed for it and search for the symbol. A new decision gets a new numbered ADR; an existing record changes when its code changes.

| ADR | Decision |
| --- | --- |
| [0001](0001-module-packaging.md) | Ship a self-registering Nuxt module that works from source and from dist |
| [0002](0002-headless-public-api.md) | Keep the component headless and report through slot state and track events |
| [0003](0003-classic-workers.md) | Run MediaPipe in import-free classic workers, on the device |
| [0004](0004-detection-pipeline.md) | Detect once per camera frame, with one request in flight |
| [0005](0005-coordinate-conventions.md) | Mirror once and work in visible-window coordinates |
| [0006](0006-metric-sizing.md) | Size frames in metres from facial measurements |
| [0007](0007-card-calibration.md) | Offer an ID-1 card as an optional, more precise ruler |
| [0008](0008-pose-smoothing.md) | Smooth adaptively and predict only for display |
| [0009](0009-frame-placement.md) | Anchor the frame to the skull and pivot it with the head |
| [0010](0010-face-occluder.md) | Occlude with the tracked face mesh and lateral collars |
| [0011](0011-temple-fit.md) | Fit temples at load and at render without editing GLBs |
| [0012](0012-hair-occlusion.md) | Make depth-only hair occlusion opt-in |
| [0013](0013-lens-materials.md) | Rebuild lenses as dielectrics in physical units |
| [0014](0014-contact-shadows.md) | Ground the frame with multiply shadows and analytic contact occlusion |
| [0015](0015-room-lighting.md) | Match lighting, reflections and grain to the camera |
| [0016](0016-performance-and-tiers.md) | Degrade by capability and keep first load off the critical path |
| [0017](0017-fit-and-face-shape.md) | Give soft, stable fit and shape advice |
| [0018](0018-tracking-robustness.md) | Hold brief losses and coach longer ones |
| [0019](0019-asset-pipeline.md) | Prepare assets idempotently and calibrate after compression |
| [0020](0020-verification.md) | Verify locally on fixed fixtures, with real and software GL |
| [0021](0021-ci-and-release.md) | Run hermetic CI and publish only through release-please |
| [0022](0022-frame-removal-spike.md) | Keep the frame-removal spike reproducible and unshipped |

## By file

| File | ADRs |
| --- | --- |
| `.agents/skills/fit-check/scripts/grid-crop.mjs` | [0020](0020-verification.md) |
| `.agents/skills/fit-check/scripts/proto-shot.mjs` | [0020](0020-verification.md) |
| `.agents/skills/release-smoke/scripts/release-smoke.mjs` | [0020](0020-verification.md) |
| `.github/workflows/ci.yml` | [0021](0021-ci-and-release.md) |
| `.github/workflows/release-please.yml` | [0021](0021-ci-and-release.md) |
| `.gitignore` | [0020](0020-verification.md) |
| `build.config.ts` | [0001](0001-module-packaging.md) |
| `docs/research/frame-removal/harness/analyze.py` | [0022](0022-frame-removal-spike.md) |
| `docs/research/frame-removal/harness/index.html` | [0022](0022-frame-removal-spike.md) |
| `docs/research/frame-removal/harness/segment.mjs` | [0022](0022-frame-removal-spike.md) |
| `playground/app.vue` | [0020](0020-verification.md) |
| `playground/components/TryOnFixtureScene.vue` | [0020](0020-verification.md) |
| `playground/components/VirtualTryOnPrototype.vue` | [0020](0020-verification.md) |
| `playground/nuxt.config.ts` | [0020](0020-verification.md) |
| `playwright.config.ts` | [0020](0020-verification.md) |
| `scripts/audit-tilt.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/compress-models.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/fetch-footage.mjs` | [0020](0020-verification.md) |
| `scripts/generate-calibration.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lib/calibration.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lib/colour.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lib/model-lint.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lib/model-prep.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lib/tilt.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/lint-models.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/prepare-model.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/trim-temple-tips.ts` | [0019](0019-asset-pipeline.md) |
| `scripts/verify-playground.mjs` | [0020](0020-verification.md) |
| `src/module.ts` | [0001](0001-module-packaging.md) |
| `src/runtime/components/TryOnScene.vue` | [0002](0002-headless-public-api.md), [0010](0010-face-occluder.md), [0015](0015-room-lighting.md) |
| `src/runtime/components/VirtualTryOnExperience.vue` | [0002](0002-headless-public-api.md), [0015](0015-room-lighting.md), [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/experience/useTryOnCapture.ts` | [0005](0005-coordinate-conventions.md) |
| `src/runtime/composables/tryon/experience/useTryOnFeatures.ts` | [0015](0015-room-lighting.md), [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/experience/useTryOnFrame.ts` | [0018](0018-tracking-robustness.md) |
| `src/runtime/composables/tryon/experience/useTryOnFrameFit.ts` | [0007](0007-card-calibration.md), [0017](0017-fit-and-face-shape.md) |
| `src/runtime/composables/tryon/experience/useTryOnModelSwitch.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/experience/useTryOnSession.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/experience/useTryOnSessionMetrics.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/experience/useTryOnStage.ts` | [0005](0005-coordinate-conventions.md) |
| `src/runtime/composables/tryon/experience/useTryOnTrackEvents.ts` | [0002](0002-headless-public-api.md), [0017](0017-fit-and-face-shape.md) |
| `src/runtime/composables/tryon/experience/useTryOnTracking.ts` | [0002](0002-headless-public-api.md), [0007](0007-card-calibration.md), [0018](0018-tracking-robustness.md) |
| `src/runtime/composables/tryon/scene/useBoundingBoxHelper.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/scene/useCameraMatch.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/composables/tryon/scene/useContactOcclusion.ts` | [0014](0014-contact-shadows.md) |
| `src/runtime/composables/tryon/scene/useContactShadow.ts` | [0014](0014-contact-shadows.md) |
| `src/runtime/composables/tryon/scene/useFaceMeshOccluder.ts` | [0010](0010-face-occluder.md) |
| `src/runtime/composables/tryon/scene/useHairOccluder.ts` | [0012](0012-hair-occlusion.md) |
| `src/runtime/composables/tryon/scene/useFrameMaterials.ts` | [0011](0011-temple-fit.md), [0013](0013-lens-materials.md), [0015](0015-room-lighting.md) |
| `src/runtime/composables/tryon/scene/useSceneEnvironment.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/composables/tryon/scene/useSceneModel.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/scene/useSceneSnapshot.ts` | [0005](0005-coordinate-conventions.md) |
| `src/runtime/composables/tryon/scene/useTempleFit.ts` | [0011](0011-temple-fit.md) |
| `src/runtime/composables/tryon/useCapabilityTier.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/useFaceLandmarker.ts` | [0003](0003-classic-workers.md), [0004](0004-detection-pipeline.md) |
| `src/runtime/composables/tryon/useFrameCalibration.ts` | [0019](0019-asset-pipeline.md) |
| `src/runtime/composables/tryon/useHairSegmenter.ts` | [0012](0012-hair-occlusion.md) |
| `src/runtime/composables/tryon/useTryOnCardCalibration.ts` | [0007](0007-card-calibration.md) |
| `src/runtime/composables/tryon/useTryOnElementSize.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/useTryOnFaceShape.ts` | [0017](0017-fit-and-face-shape.md) |
| `src/runtime/composables/tryon/useTryOnFit.ts` | [0017](0017-fit-and-face-shape.md) |
| `src/runtime/composables/tryon/useTryOnFrameLoop.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/useTryOnFreeze.ts` | [0004](0004-detection-pipeline.md) |
| `src/runtime/composables/tryon/useTryOnLighting.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/composables/tryon/useTryOnModelCache.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/composables/tryon/useTryOnModels.ts` | [0017](0017-fit-and-face-shape.md) |
| `src/runtime/composables/tryon/useTryOnPlacement.ts` | [0005](0005-coordinate-conventions.md), [0006](0006-metric-sizing.md), [0007](0007-card-calibration.md), [0009](0009-frame-placement.md), [0010](0010-face-occluder.md) |
| `src/runtime/composables/tryon/useTryOnSmoothing.ts` | [0008](0008-pose-smoothing.md) |
| `src/runtime/composables/tryon/useTryOnTrackingHold.ts` | [0018](0018-tracking-robustness.md) |
| `src/runtime/composables/tryon/useWebcamStream.ts` | [0004](0004-detection-pipeline.md) |
| `src/runtime/types/face-landmarker-worker.ts` | [0003](0003-classic-workers.md) |
| `src/runtime/types/hair-segmenter-worker.ts` | [0003](0003-classic-workers.md) |
| `src/runtime/types/tryon-calibration.ts` | [0019](0019-asset-pipeline.md) |
| `src/runtime/types/tryon-experience-props.ts` | [0002](0002-headless-public-api.md), [0016](0016-performance-and-tiers.md) |
| `src/runtime/types/tryon-experience.ts` | [0002](0002-headless-public-api.md), [0018](0018-tracking-robustness.md) |
| `src/runtime/types/tryon-scene-props.ts` | [0002](0002-headless-public-api.md) |
| `src/runtime/utils/face-mesh-triangles.ts` | [0010](0010-face-occluder.md) |
| `src/runtime/utils/tryon-camera-match.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/utils/tryon-capability.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/utils/tryon-capture.ts` | [0005](0005-coordinate-conventions.md) |
| `src/runtime/utils/tryon-card.ts` | [0007](0007-card-calibration.md) |
| `src/runtime/utils/tryon-contact-occlusion.ts` | [0014](0014-contact-shadows.md) |
| `src/runtime/utils/tryon-contact-shadow.ts` | [0014](0014-contact-shadows.md) |
| `src/runtime/utils/tryon-face-shape.ts` | [0017](0017-fit-and-face-shape.md) |
| `src/runtime/utils/tryon-fit.ts` | [0017](0017-fit-and-face-shape.md) |
| `src/runtime/utils/tryon-frame-schedule.ts` | [0004](0004-detection-pipeline.md) |
| `src/runtime/utils/tryon-guide.ts` | [0018](0018-tracking-robustness.md) |
| `src/runtime/utils/tryon-hair.ts` | [0012](0012-hair-occlusion.md) |
| `src/runtime/utils/tryon-lens-shadow.ts` | [0014](0014-contact-shadows.md) |
| `src/runtime/utils/tryon-lens.ts` | [0013](0013-lens-materials.md) |
| `src/runtime/utils/tryon-lighting.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/utils/tryon-measure.ts` | [0006](0006-metric-sizing.md) |
| `src/runtime/utils/tryon-metrics.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/utils/tryon-model-cache.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/utils/tryon-occluder.ts` | [0010](0010-face-occluder.md) |
| `src/runtime/utils/tryon-pose.ts` | [0005](0005-coordinate-conventions.md) |
| `src/runtime/utils/tryon-preconnect.ts` | [0016](0016-performance-and-tiers.md) |
| `src/runtime/utils/tryon-room.ts` | [0015](0015-room-lighting.md) |
| `src/runtime/utils/tryon-seat.ts` | [0009](0009-frame-placement.md) |
| `src/runtime/utils/tryon-shader.ts` | [0020](0020-verification.md) |
| `src/runtime/utils/tryon-temples.ts` | [0011](0011-temple-fit.md) |
| `src/runtime/utils/tryon.ts` | [0005](0005-coordinate-conventions.md), [0006](0006-metric-sizing.md), [0008](0008-pose-smoothing.md), [0009](0009-frame-placement.md), [0010](0010-face-occluder.md) |
| `src/runtime/workers/face-landmarker.worker.ts` | [0003](0003-classic-workers.md) |
| `src/runtime/workers/hair-segmenter.worker.ts` | [0003](0003-classic-workers.md) |
| `tests/e2e/camera-test.ts` | [0020](0020-verification.md) |
| `tests/e2e/capture.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/colour.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/fixtures.ts` | [0020](0020-verification.md) |
| `tests/e2e/freeze.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/hair-scene.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/hair.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/lighting.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/metrics.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/pose-metrics.ts` | [0020](0020-verification.md) |
| `tests/e2e/readiness.ts` | [0020](0020-verification.md) |
| `tests/e2e/record-tryon-pose.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/render.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/rendering-goldens.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/robustness.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/tracking-harness.ts` | [0020](0020-verification.md) |
| `tests/e2e/tracking.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/tryon-pose-faces.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/tryon-pose-scene.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/upna-pose.spec.ts` | [0020](0020-verification.md) |
| `tests/e2e/video-clip.spec.ts` | [0020](0020-verification.md) |
| `tests/mocks/nuxt-imports.ts` | [0020](0020-verification.md) |
| `tests/unit/mediapipe-version.test.ts` | [0020](0020-verification.md) |
| `tests/unit/scripts/colour.test.ts` | [0020](0020-verification.md) |
| `tests/unit/support/landmark-stream.ts` | [0020](0020-verification.md) |
| `tests/unit/utils/pose-metrics.test.ts` | [0020](0020-verification.md) |
| `tests/unit/utils/tryon-occluder.test.ts` | [0020](0020-verification.md) |
| `tests/unit/workers/worker-contract.test.ts` | [0003](0003-classic-workers.md) |
| `tests/unit/utils/tryon-shader.test.ts` | [0020](0020-verification.md) |
| `tests/e2e/fit.spec.ts` | [0017](0017-fit-and-face-shape.md) |
| `tests/e2e/frame-budget.spec.ts` | [0016](0016-performance-and-tiers.md) |
| `tests/glsl/shader-parity.spec.ts` | [0020](0020-verification.md) |
| `tests/glsl/glsl-harness.ts` | [0020](0020-verification.md) |

## Audit

[comment-audit-2026-11-22.tsv](comment-audit-2026-11-22.tsv) lists every comment removed in the first pass, with its category and destination.
