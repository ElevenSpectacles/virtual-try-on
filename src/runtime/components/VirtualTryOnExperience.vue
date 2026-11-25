<script setup lang="ts">
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
  occluder: undefined,
  tier: undefined
})

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
  metrics: [payload: TryOnSessionMetrics]
}>()

const route = useRoute()
const { getCalibration, getCalibrationProblems, loadError: calibrationLoadError } =
  useFrameCalibration(props.calibrationUrl)

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

const tracking = useTryOnTracking(videoRef, {
  props,
  isActive,
  onPlayError: camera.failPlay,
  mediaAspect: stage.mediaAspect,
  lightingEnabled: () => features.lightingEnabled.value,
  onLatency: (ms) => metrics?.onLatency(ms),
  track: trackTryOn
})
const { lightGain, lightTint, lighting, roomLuma, roomSample, lightDirection } = tracking
const { faceError, hasFace, frozen, freeze, unfreeze } = tracking

const { metrics, watchSessionEnd } = useTryOnSessionMetrics({
  enabled: props.reportMetrics,
  isActive,
  tracking: tracking.trackerHasFace,
  model: () => model.value ?? '',
  features: () => features.snapshot(),
  emit
})

const capability = useCapabilityTier({
  forcedTier: () => props.tier,
  sampling: () => isActive.value && hasFace.value,
  onChange: (change) => reportTierChange(trackTryOn, metrics, change)
})

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

const features = useTryOnFeatures({
  props,
  capability,
  moduleOccluder: () => runtimeConfig.public.virtualTryOn?.occluder,
  camera,
  tracking
})
const { occluderEnabled, contactShadowEnabled, cameraMatchEnabled, physicalLensEnabled } = features
const { tintedLensShadowEnabled } = features
const FROZEN_GRAIN_SEED = 0.5
const { hairSegmenter, hairActive, hair, contactShadowStrength } = features

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

const { capture, onSceneSnapshot } = useTryOnCapture(camera, stage, frame, features, trackTryOn)

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

const { onSceneError } = useTryOnTrackEvents({
  track: trackTryOn,
  camera,
  tracking,
  hairError: () => hairSegmenter.error.value,
  hairOcclusion: () => props.hairOcclusion,
  calibrationFile: () => model.value ?? initialModel,
  calibrationLoadError: () => calibrationLoadError.value,
  getCalibrationProblems,
  hasReportedFaceDetected,
  tier: () => capability.tier.value,
  fit: frameFit
})

watchSessionEnd()

watch(model, (value) => {
  modelSwitch.onModelSwitch()
  capability.resetWarmup()
  frameFit.reset()
  if (hasConsented.value) trackTryOn('TRY_ON_FRAME_CHANGED', { model: value })
})
</script>

<template>
  <div ref="stageRef" class="vto-stage">
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

.vto-frame {
  transition: opacity 150ms ease-out;
}

.vto-frame--hidden {
  opacity: 0;
}

.vto-layer--camera-match {
  filter: blur(var(--vto-camera-blur));
}
</style>
