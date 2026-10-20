<script setup lang="ts">
/**
 * Headless virtual try-on view: renders only the mirrored camera feed and the
 * tracked 3D frame, sized to fill its container. It ships no UI copy, icons
 * or utility classes — consent, error states, positioning guidance and any
 * tuning controls are the host's job, built from the state and actions the
 * default slot (and the component ref) exposes. Slot content is rendered on
 * top of the feed inside the stage.
 *
 * The stateful glue lives in `composables/tryon/experience/` (internal, not
 * auto-imported). Watchers and lifecycle hooks run in the order they register:
 * keep the calls below in order.
 */
import { NeutralToneMapping, VSMShadowMap } from 'three'
import { useWebcamStream } from '../composables/tryon/useWebcamStream'
import { useFrameCalibration } from '../composables/tryon/useFrameCalibration'
import { getTryOnModel } from '../composables/tryon/useTryOnModels'
import { useCapabilityTier } from '../composables/tryon/useCapabilityTier'
import { useTryOnStage } from '../composables/tryon/experience/useTryOnStage'
import { useTryOnTracking } from '../composables/tryon/experience/useTryOnTracking'
import { useTryOnSessionMetrics } from '../composables/tryon/experience/useTryOnSessionMetrics'
import { useTryOnModelSwitch } from '../composables/tryon/experience/useTryOnModelSwitch'
import { useTryOnFeatures } from '../composables/tryon/experience/useTryOnFeatures'
import { useTryOnFrame } from '../composables/tryon/experience/useTryOnFrame'
import { useTryOnFrameFit } from '../composables/tryon/experience/useTryOnFrameFit'
import { useTryOnSession } from '../composables/tryon/experience/useTryOnSession'
import { useTryOnCapture } from '../composables/tryon/experience/useTryOnCapture'
import {
  createTryOnTrack,
  reportTierChange,
  useTryOnTrackEvents
} from '../composables/tryon/experience/useTryOnTrackEvents'
import type { TryOnSessionMetrics } from '../utils/tryon-metrics'
import { FIT_DEFAULT_TOLERANCE } from '../utils/tryon-fit'
import { CAMERA_BLUR_PX } from '../utils/tryon-camera-match'
import type { VirtualTryOnExperienceSlotProps } from '../types/tryon-experience'
import type { VirtualTryOnExperienceProps } from '../types/tryon-experience-props'

import TryOnScene from './TryOnScene.vue'
import { useRoute, useRuntimeConfig } from '#imports'
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<VirtualTryOnExperienceProps>(), {
  adaptiveLighting: true,
  contactShadow: true,
  reportMetrics: false,
  fitTolerance: FIT_DEFAULT_TOLERANCE,
  trueToSize: true,
  physicalLens: true,
  hairOcclusion: false,
  tintedLensShadow: false,
  templeEarBend: false,
  preload: 1,
  roomReflections: false,
  cameraMatch: false,
  modelBaseUrl: '/models/virtual-try-on',
  autoStart: false,
  exposure: 1,
  frameScale: 1,
  draco: true,
  // Explicit undefined, not Vue's absent-boolean `false`, so an omitted
  // prop falls through to the module option.
  occluder: undefined,
  tier: undefined
})

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
  metrics: [payload: TryOnSessionMetrics]
}>()

const route = useRoute()
const { getCalibration, getCalibrationProblems } = useFrameCalibration(props.calibrationUrl)

const queryModel = route.query.model as string | undefined
const initialModel =
  getTryOnModel(props.models, props.initialModel ?? queryModel)?.file ??
  props.models[0]?.file

if (!initialModel) {
  throw new Error('VirtualTryOnExperience requires at least one model')
}

const camera = useWebcamStream()
const { videoRef, isActive, isStarting, error, stop } = camera
const stage = useTryOnStage(videoRef)
const { stageRef, coverWindow, onVideoLoadedMetadata } = stage

const model = defineModel<string>('model')
if (!model.value) model.value = initialModel
const calibration = computed(() => getCalibration(model.value ?? initialModel))
const useFaceTracking = ref(true)
const runtimeConfig = useRuntimeConfig()
const trackTryOn = createTryOnTrack(emit, () => model.value)

// The face tracker and what its worker feeds (see useTryOnTracking).
const tracking = useTryOnTracking(videoRef, {
  props,
  isActive,
  mediaAspect: stage.mediaAspect,
  lightingEnabled: () => features.lightingEnabled.value,
  onLatency: (ms) => metrics?.onLatency(ms),
  track: trackTryOn
})
const { lightGain, lightTint, lighting, roomLuma, roomSample, lightDirection } = tracking
const { faceError, hasFace, frozen, freeze, unfreeze } = tracking

// Session metrics (opt-in, see useTryOnSessionMetrics).
const { metrics, watchSessionEnd } = useTryOnSessionMetrics({
  enabled: props.reportMetrics,
  isActive,
  tracking: tracking.trackerHasFace,
  model: () => model.value ?? '',
  features: () => features.snapshot(),
  emit
})

// Frames count toward the step-down only while a face is tracked, so idle
// camera time never looks like a slow device.
const capability = useCapabilityTier({
  forcedTier: () => props.tier,
  sampling: () => isActive.value && hasFace.value,
  onChange: (change) => reportTierChange(trackTryOn, metrics, change)
})

// GLB cache, neighbour prefetch and switch latency (see useTryOnModelSwitch).
const modelSwitch = useTryOnModelSwitch({
  props,
  model,
  initialModel,
  capability,
  tracking: () => isActive.value && hasFace.value,
  metrics,
  onLoaded: (widthMeters) => frameFit.onModelLoaded(widthMeters)
})
const { modelSrc, modelCache, preloadModel, onModelLoaded } = modelSwitch

// Opt-in features the tier allows, and the hair segmenter (see useTryOnFeatures).
const features = useTryOnFeatures({
  props,
  capability,
  moduleOccluder: () => runtimeConfig.public.virtualTryOn?.occluder,
  camera,
  tracking
})
const { occluderEnabled, contactShadowEnabled, cameraMatchEnabled, physicalLensEnabled } = features
const { tintedLensShadowEnabled } = features
// While frozen the camera image is a still photo: hold the grain still too,
// instead of re-seeding it every render (which would shimmer over the photo).
const FROZEN_GRAIN_SEED = 0.5
const { hairSegmenter, hairActive, hair, contactShadowStrength } = features

// Whether and where the frame shows, and the guide hint (see useTryOnFrame).
const frame = useTryOnFrame({
  props,
  camera,
  faceTracking: useFaceTracking,
  tracking,
  stage,
  calibration
})
const { frameVisible, frameFading, guideHint, framePosition, smoothedScale, smoothedEuler } = frame
const { occluderGeometry, occluderPosition, occluderPositions } = frame

// Fit, measurements, card calibration and fit advisor (see useTryOnFrameFit).
const frameFit = useTryOnFrameFit({
  props,
  model,
  calibration,
  getCalibration,
  tracking,
  stage,
  placement: frame,
  track: trackTryOn
})
const { fit, measurements, calibrationState, startCalibration, cancelCalibration } = frameFit

// Consent, start, status and the time to first frame (see useTryOnSession).
const session = useTryOnSession({
  props,
  camera,
  tracking,
  faceTracking: useFaceTracking,
  frameShown: () => frameVisible.value && frameFit.glbWidthMeters.value > 0,
  metrics,
  track: trackTryOn
})
const { status, hasConsented, hasReportedFaceDetected, start, prefetch, onSceneTiming } = session

const { capture, onSceneSnapshot } = useTryOnCapture(
  camera,
  stage,
  { visible: () => frameVisible.value, cameraMatch: () => cameraMatchEnabled.value },
  trackTryOn
)

defineExpose({
  start,
  stop,
  capture,
  preloadModel,
  freeze,
  unfreeze,
  frozen,
  prefetch,
  status,
  error,
  faceError,
  hasFace,
  guideHint,
  fit,
  lighting,
  hair,
  measurements,
  calibration: calibrationState,
  startCalibration,
  cancelCalibration,
  fitRanking: frameFit.fitRanking,
  fitFor: frameFit.fitFor
})

defineSlots<{ default?: (props: VirtualTryOnExperienceSlotProps) => unknown }>()

// Failures, the first face, fit and face shape on `track` (see useTryOnTrackEvents).
const { onSceneError } = useTryOnTrackEvents({
  track: trackTryOn,
  camera,
  tracking,
  hairError: () => hairSegmenter.error.value,
  hairOcclusion: () => props.hairOcclusion,
  calibrationFile: () => model.value ?? initialModel,
  getCalibrationProblems,
  hasReportedFaceDetected,
  tier: () => capability.tier.value,
  fit: frameFit
})

// The session's final `metrics` report: registered after the track events.
watchSessionEnd()

watch(model, (value) => {
  modelSwitch.onModelSwitch()
  // A new GLB compiles its shaders on the next frames: warm up again.
  capability.resetWarmup()
  // The new frame has its own width: no verdict until its GLB has loaded.
  frameFit.reset()
  if (hasConsented.value) trackTryOn('TRY_ON_FRAME_CHANGED', { model: value })
})
</script>

<template>
  <div ref="stageRef" class="vto-stage">
    <!-- Always mounted so the webcam stream has an element to attach to;
         hidden until the stream is active. Mirrored here and only here
         (see landmarkToNdc). -->
    <video
      ref="videoRef"
      class="vto-video"
      :class="{ 'vto-video--active': isActive }"
      playsinline
      muted
      autoplay
      aria-hidden="true"
      @loadedmetadata="onVideoLoadedMetadata"
    />

    <ClientOnly>
      <div
        class="vto-layer vto-frame"
        :class="{
          'vto-frame--hidden': !frameVisible,
          'vto-layer--camera-match': cameraMatchEnabled
        }"
        :style="cameraMatchEnabled ? { '--vto-camera-blur': `${CAMERA_BLUR_PX}px` } : undefined"
      >
        <!-- Neutral tone mapping (Khronos PBR Neutral), not ACES: the
             camera feed behind the canvas is untone-mapped sRGB, and
             ACES' filmic curve would desaturate frame colors against it.
             Neutral is near-identity in the SDR range — exactly what
             e-commerce frame colors need. -->
        <TresCanvas
          :alpha="true"
          :clear-alpha="0"
          :antialias="true"
          :dpr="[1, 2]"
          :tone-mapping="NeutralToneMapping"
          :tone-mapping-exposure="exposure"
          :shadows="contactShadowEnabled"
          :shadow-map-type="VSMShadowMap"
          power-preference="high-performance"
          render-mode="always"
          class="vto-layer"
        >
          <TryOnScene
            :src="modelSrc"
            :model-cache="modelCache"
            :visible="frameVisible || frameFading"
            :position="framePosition"
            :model-offset="calibration.translation"
            :scale="smoothedScale"
            :rotation="smoothedEuler"
            :occluder-enabled="occluderEnabled"
            :occluder-positions="occluderPositions"
            :contact-shadow="contactShadowEnabled && occluderEnabled"
            :contact-shadow-strength="contactShadowStrength"
            :tinted-lens-shadow="tintedLensShadowEnabled"
            :video-element="videoRef"
            :light-gain="lightGain"
            :light-tint="lightTint"
            :room-sample="roomSample"
            :light-direction="lightDirection"
            :camera-match="cameraMatchEnabled"
            :grain-seed="frozen ? FROZEN_GRAIN_SEED : undefined"
            :room-luma="roomLuma"
            :occluder-position="occluderPosition"
            :occluder-radius="occluderGeometry"
            :occluder-rotation="smoothedEuler"
            :physical-lens="physicalLensEnabled"
            :temple-ear-bend="templeEarBend"
            :lens="calibration.lens"
            :hair-mask="hairActive ? hairSegmenter.mask.value : null"
            :media-window="coverWindow"
            :environment-url="environmentUrl"
            :procedural-environment="capability.tier.value === 'low'"
            @error="onSceneError"
            @loaded="onModelLoaded"
            @snapshot="onSceneSnapshot"
            @timing="onSceneTiming"
          />
        </TresCanvas>
      </div>
    </ClientOnly>

    <slot
      :status="status"
      :is-starting="isStarting"
      :error="error"
      :face-error="faceError"
      :has-face="hasFace"
      :guide-hint="guideHint"
      :fit="fit"
      :measurements="measurements"
      :start="start"
      :stop="stop"
      :calibration="calibrationState"
      :start-calibration="startCalibration"
      :cancel-calibration="cancelCalibration"
      :capture="capture"
      :frozen="frozen"
      :freeze="freeze"
      :unfreeze="unfreeze"
    />
  </div>
</template>

<!-- Structural styles only (stacking, mirroring, fill) — no visual design.
     The host sizes the component; the stage fills it. -->
<style scoped>
.vto-stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.vto-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
  opacity: 0;
  transition: opacity 500ms;
}

.vto-video--active {
  opacity: 1;
}

.vto-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Keep in step with FRAME_FADE_MS. */
.vto-frame {
  transition: opacity 150ms ease-out;
}

.vto-frame--hidden {
  opacity: 0;
}

/* A webcam is a touch soft; only the rendered frame layer is blurred. */
.vto-layer--camera-match {
  filter: blur(var(--vto-camera-blur));
}
</style>
