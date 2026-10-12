<script setup lang="ts">
/**
 * Headless virtual try-on view: renders only the mirrored camera feed and the
 * tracked 3D frame, sized to fill its container. It ships no UI copy, icons
 * or utility classes — consent, error states, positioning guidance and any
 * tuning controls are the host's job, built from the state and actions the
 * default slot (and the component ref) exposes. Slot content is rendered on
 * top of the feed inside the stage.
 */
import { NeutralToneMapping, VSMShadowMap } from 'three'
import { objectCoverWindow } from '../utils/tryon'
import { useWebcamStream } from '../composables/tryon/useWebcamStream'
import { useFaceLandmarker } from '../composables/tryon/useFaceLandmarker'
import { useFrameCalibration } from '../composables/tryon/useFrameCalibration'
import {
  getTryOnModel,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'
import { useTryOnPlacement } from '../composables/tryon/useTryOnPlacement'
import { useTryOnElementSize } from '../composables/tryon/useTryOnElementSize'
import { useTryOnFrameLoop } from '../composables/tryon/useTryOnFrameLoop'
import { useCapabilityTier } from '../composables/tryon/useCapabilityTier'
import { useHairSegmenter } from '../composables/tryon/useHairSegmenter'
import { maskCoverage } from '../utils/tryon-hair'
import type { TryOnTier } from '../utils/tryon-capability'
import {
  createMetricsAccumulator,
  type TryOnSessionMetrics
} from '../utils/tryon-metrics'
import {
  LIGHTING_SAMPLE_EVERY,
  estimateFrameLighting,
  lightingGain,
  smoothFrameLighting,
  type FrameLighting
} from '../utils/tryon-lighting'
import { CONTACT_SHADOW_STRENGTH } from '../utils/tryon-contact-shadow'
import {
  FIT_DEFAULT_TOLERANCE,
  FIT_MIN_SAMPLES,
  estimateFaceWidthMm,
  faceWidthVerdict,
  updateFaceWidthEstimate,
  type FaceWidthEstimate,
  type TryOnFit,
  type TryOnFitVerdict
} from '../utils/tryon-fit'
import type {
  FaceLandmarkerError,
  TryOnGuideHint,
  TryOnStatus,
  WebcamError
} from '../types/tryon-experience'

import TryOnScene from './TryOnScene.vue'
import { useRoute, useRuntimeConfig } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    models: TryOnModel[]
    calibrationUrl: string
    modelBaseUrl?: string | undefined
    initialModel?: string
    /**
     * Start the camera as soon as the component mounts. Use when the host
     * already collected consent (e.g. its own privacy step); otherwise call
     * the exposed `start()` from the host's consent UI.
     */
    autoStart?: boolean
    /** Renderer tone-mapping exposure. */
    exposure?: number
    /** Multiplier on the computed frame scale. */
    frameScale?: number
    /**
     * @deprecated No effect since 4.4.0 — the frame renders only on a
     * tracked face, which supplies its rotation. Removed in 5.0.
     */
    frameYaw?: number
    /** Multiplier on the calibrated temple-width boost. */
    templeWidth?: number
    /**
     * Directory the MediaPipe Wasm fileset is served from. Omit to use the
     * built-in jsDelivr CDN default; pass a same-origin path (e.g.
     * `/mediapipe/wasm`) to self-host and drop the CDN dependency.
     */
    mediapipeBasePath?: string | undefined
    /** URL/path to the `face_landmarker.task` model asset. */
    mediapipeModelAssetPath?: string | undefined
    /** Whether the GLB loader wires up Draco decompression support. */
    draco?: boolean
    /** Draco decoder path override — omit to use the gstatic CDN default. */
    dracoDecoderPath?: string | undefined
    /**
     * Hide frame parts behind the head (the far temple) with the face-mesh
     * occluder. Omit to use the module option `virtualTryOn.occluder`
     * (default `true`).
     */
    occluder?: boolean | undefined
    /**
     * Pin the device capability tier (`low` | `mid` | `high`). Omit to
     * classify the device and step down under sustained frame-time load.
     * Forcing a tier disables the step-down, so tests and goldens stay
     * deterministic.
     */
    tier?: TryOnTier | undefined
    /**
     * Light the frame from the room the camera sees (estimated luma and
     * colour cast). Off keeps the fixed studio lighting. Also needs the
     * `mid` tier or higher.
     */
    adaptiveLighting?: boolean
    /**
     * Soft shadow of the frame on the tracked skin under the bridge and
     * lenses. Needs the face-mesh occluder and the `mid` tier or higher.
     */
    contactShadow?: boolean
    /**
     * Emit `metrics` events (aggregated session numbers, no image data): every
     * 30 s while the camera is on, and once more when it stops. Read once at
     * setup. Off by default, so nothing is measured or emitted.
     */
    reportMetrics?: boolean
    /**
     * Half-width of the "good fit" band of the fit verdict, as a fraction of
     * the ideal frame width for the tracked face (default 0.06). The face
     * estimate itself carries about ±5% (it assumes an average IPD), so
     * tighter bands mostly add noise.
     */
    fitTolerance?: number
    /**
     * Physically-based lenses: Fresnel opacity, reflections that add on top
     * of the tint, an AR-coating sheen. Off keeps the cheaper standard lens.
     * Also needs the `mid` tier or higher.
     */
    physicalLens?: boolean
    /**
     * Hide the temple arms behind hair that hangs over them: a hair
     * segmenter (its own worker, ~0.8 MB model, loaded on the first tracked
     * face) masks the arms where the camera sees hair, so the real hair
     * shows in front. Opt-in, because a 2D mask can't tell hair over an arm
     * from hair under it, and arms usually rest on top of hair. Needs the
     * occluder and the `high` tier, and switches itself off for the session
     * if segmentation is too slow.
     */
    hairOcclusion?: boolean
    /** URL/path of `hair_segmenter.tflite`, to self-host it. */
    mediapipeHairModelAssetPath?: string | undefined
  }>(),
  {
    adaptiveLighting: true,
    contactShadow: true,
    reportMetrics: false,
    fitTolerance: FIT_DEFAULT_TOLERANCE,
    physicalLens: true,
    hairOcclusion: false,
    modelBaseUrl: '/models/virtual-try-on',
    autoStart: false,
    exposure: 1,
    frameScale: 1,
    frameYaw: 0,
    templeWidth: 1,
    draco: true,
    // Explicit undefined, not Vue's absent-boolean `false`, so an omitted
    // prop falls through to the module option.
    occluder: undefined,
    tier: undefined
  }
)

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
  metrics: [payload: TryOnSessionMetrics]
}>()

const route = useRoute()
const { getCalibration } = useFrameCalibration(props.calibrationUrl)

const queryModel = route.query.model as string | undefined
const initialModel =
  getTryOnModel(props.models, props.initialModel ?? queryModel)?.file ??
  props.models[0]?.file

if (!initialModel) {
  throw new Error('VirtualTryOnExperience requires at least one model')
}

const hasConsented = ref(false)
const hasReportedFaceDetected = ref(false)

const {
  videoRef,
  isActive,
  isStarting,
  error,
  errorDetail: cameraErrorDetail,
  start: startStream,
  stop
} = useWebcamStream()

const stageRef = ref<HTMLElement | null>(null)
const { width: stageWidth, height: stageHeight } = useTryOnElementSize(stageRef)

const aspect = computed(() =>
  stageHeight.value > 0 ? stageWidth.value / stageHeight.value : 3 / 4
)

// MediaPipe runs on the raw media frame, but the video is displayed
// with object-fit: cover inside the fixed-aspect stage. Remap landmarks into
// the visible cropped window so positioning matches what the user sees.
const mediaAspect = ref(0)
const coverWindow = computed(() =>
  objectCoverWindow(mediaAspect.value, aspect.value)
)

function onVideoLoadedMetadata() {
  const video = videoRef.value
  if (video?.videoWidth && video.videoHeight) {
    mediaAspect.value = video.videoWidth / video.videoHeight
  }
}

const model = defineModel<string>('model')
if (!model.value) {
  model.value = initialModel
}
const modelSrc = computed(() => `${props.modelBaseUrl}/${model.value}.glb`)
const calibration = computed(() => getCalibration(model.value ?? initialModel))
const useFaceTracking = ref(true)
const runtimeConfig = useRuntimeConfig()
// Each feature runs only when the host opted in AND the device tier allows
// it. Opt-in comes from the prop, then the module option, then `true`.
const occluderEnabled = computed(
  () =>
    (props.occluder ?? runtimeConfig.public.virtualTryOn?.occluder ?? true) &&
    capability.allows('occluder')
)

// Room lighting: while lighting is on, the worker returns a 16×16 downsample
// of every LIGHTING_SAMPLE_EVERY-th detection frame, which is averaged here
// and smoothed. With no
// sample (lighting off, or OffscreenCanvas unavailable in the worker)
// `frameLighting` stays null, which keeps the neutral studio lighting.
const frameLighting = ref<FrameLighting | null>(null)
const lastSampleMs = ref<number | null>(null)
let detectionsSinceSample = 0
const lightingEnabled = computed(
  () => props.adaptiveLighting && capability.allows('lightingEstimate')
)

const {
  error: faceError,
  errorDetail: faceErrorDetail,
  hasFace,
  confidence,
  landmarks: faceLandmarks,
  pose: facePose,
  blinkScore: faceBlinkScore,
  anchor: faceAnchor,
  latencyMs: faceLatencyMs,
  init: initFaceLandmarker
} = useFaceLandmarker(videoRef, {
  ...(props.mediapipeBasePath !== undefined
    ? { mediapipeBasePath: props.mediapipeBasePath }
    : {}),
  ...(props.mediapipeModelAssetPath !== undefined
    ? { mediapipeModelAssetPath: props.mediapipeModelAssetPath }
    : {}),
  onLatency: (ms) => metrics?.onLatency(ms),
  wantFrameSample: () => {
    if (!lightingEnabled.value) return false
    detectionsSinceSample = (detectionsSinceSample + 1) % LIGHTING_SAMPLE_EVERY
    return detectionsSinceSample === 0
  },
  onFrameSample: (rgba, width, height, sampleMs) => {
    if (!lightingEnabled.value) return
    frameLighting.value = smoothFrameLighting(
      frameLighting.value,
      estimateFrameLighting(rgba, width, height)
    )
    lastSampleMs.value = sampleMs
  }
})

// Session metrics (opt-in). With reportMetrics off there is no accumulator
// and no extra frame loop, so there is no cost to hosts that don't use it.
const metrics = props.reportMetrics ? createMetricsAccumulator() : null

function emitMetrics(final: boolean) {
  if (!metrics) return
  emit('metrics', {
    ...metrics.snapshot(),
    final,
    model: model.value ?? '',
    features: {
      occluder: occluderEnabled.value,
      contactShadow: contactShadowEnabled.value,
      adaptiveLighting: lightingEnabled.value,
      physicalLens: physicalLensEnabled.value,
      hairOcclusion: hairActive.value
    }
  })
}

if (metrics) {
  useTryOnFrameLoop((deltaMs) => {
    if (metrics.onFrame(deltaMs, isActive.value, hasFace.value)) emitMetrics(false)
  })
}

// Frames count toward the step-down only while a face is tracked, so idle
// camera time never looks like a slow device.
const capability = useCapabilityTier({
  forcedTier: () => props.tier,
  sampling: () => isActive.value && hasFace.value,
  onChange: (change) => {
    metrics?.onTierChange(change.tier, change.previousTier !== null)
    // The initial classification is reported with TRY_ON_FACE_DETECTED,
    // which fires after consent. Only step-downs need an event of their own.
    if (change.previousTier === null) return
    trackTryOn('TRY_ON_TIER', {
      tier: change.tier,
      previousTier: change.previousTier,
      p95Ms: change.p95Ms,
      maxTextureSize: change.signals?.maxTextureSize,
      deviceMemoryGb: change.signals?.deviceMemoryGb
    })
  }
})

// Hair occlusion (opt-in, high tier). The segmenter starts on the first
// tracked face so it never delays the first try-on, and pauses while no face
// is tracked.
const hairOcclusionAllowed = computed(
  () =>
    props.hairOcclusion &&
    occluderEnabled.value &&
    capability.allows('segmentationOccluder')
)
const hairSegmenter = useHairSegmenter(videoRef, {
  enabled: () => hairOcclusionAllowed.value && isActive.value && hasFace.value,
  mediapipeBasePath: props.mediapipeBasePath,
  modelAssetPath: props.mediapipeHairModelAssetPath
})
const hairActive = computed(
  () =>
    hairOcclusionAllowed.value &&
    !hairSegmenter.overBudget.value &&
    !hairSegmenter.error.value
)

const templeScaleBoost = computed(
  () => calibration.value.templeWidthBoost * props.templeWidth
)

// The frame renders only on a tracked face: never before the camera starts
// (the host owns that screen — consent, previews), and not while tracking
// has momentarily lost the face (head turned past the tracker's yaw range,
// face out of frame), where it would freeze mid-air over the live video.
const frameVisible = computed(
  () => isActive.value && useFaceTracking.value && hasFace.value
)

// Where the frame goes (shared with the playground prototype): scale from
// the tracked face, smoothed pose, world position and the occluders.
const {
  correctedAnchor: correctedFaceAnchor,
  earWidth: correctedEarWidth,
  ipd: correctedIpd,
  poseCompensated,
  smoothedEuler,
  smoothedScale,
  framePosition,
  occluderGeometry,
  occluderPosition,
  occluderPositions
} = useTryOnPlacement({
  landmarks: faceLandmarks,
  anchor: faceAnchor,
  pose: facePose,
  blinkScore: faceBlinkScore,
  latencyMs: faceLatencyMs,
  hasFace,
  faceTracking: () => useFaceTracking.value,
  aspect,
  coverWindow,
  mediaAspect,
  calibration,
  scaleMultiplier: () => props.frameScale
})

const guideHint = computed<TryOnGuideHint | null>(() => {
  if (!isActive.value || !useFaceTracking.value) return null
  return !hasFace.value || !correctedFaceAnchor.value ? 'noFace' : 'aligned'
})

// Fit verdict (frame width vs the tracked face's width). The frame width is
// the catalog spec when the host passes one, else the GLB's measured width
// (reported once per load) times the calibration scale. The face width is a
// running average over detections, reset when the face is lost (it may be a
// different person when it comes back).
const glbWidthMeters = ref(0)
const frameWidthMm = computed(() => {
  const spec = getTryOnModel(props.models, model.value)?.frameWidthMm
  if (spec && spec > 0) return spec
  return glbWidthMeters.value * calibration.value.scale * 1000
})
const faceWidthEstimate = ref<FaceWidthEstimate | null>(null)
const fitVerdict = ref<TryOnFitVerdict | null>(null)

watch(faceLandmarks, () => {
  if (!hasFace.value) {
    faceWidthEstimate.value = null
    return
  }
  faceWidthEstimate.value = updateFaceWidthEstimate(
    faceWidthEstimate.value,
    estimateFaceWidthMm(
      poseCompensated(correctedEarWidth.value),
      poseCompensated(correctedIpd.value)
    )
  )
})

watch(
  [faceWidthEstimate, frameWidthMm, () => props.fitTolerance],
  ([estimate, frameWidth, tolerance]) => {
    fitVerdict.value =
      estimate && estimate.samples >= FIT_MIN_SAMPLES
        ? faceWidthVerdict(estimate.mean, frameWidth, {
            tolerance,
            previous: fitVerdict.value
          })
        : null
  }
)

const fit = computed<TryOnFit | null>(() =>
  fitVerdict.value && faceWidthEstimate.value
    ? {
        verdict: fitVerdict.value,
        faceWidthMm: faceWidthEstimate.value.mean,
        frameWidthMm: frameWidthMm.value
      }
    : null
)

function onModelLoaded(widthMeters: number) {
  glbWidthMeters.value = widthMeters
}

const status = computed<TryOnStatus>(() => {
  if (isActive.value) return 'active'
  if (isStarting.value) return 'starting'
  if (error.value) return 'error'
  return 'idle'
})

function trackTryOn(
  event:
    | 'TRY_ON_OPENED'
    | 'TRY_ON_CAMERA_GRANTED'
    | 'TRY_ON_CAMERA_DENIED'
    | 'TRY_ON_FACE_DETECTED'
    | 'TRY_ON_FRAME_CHANGED'
    | 'TRY_ON_TIER'
    | 'TRY_ON_FIT'
    | 'TRY_ON_ERROR',
  extra: Record<string, unknown> = {}
) {
  emit('track', event, {
    contentType: 'product',
    contentName: model.value,
    customData: {
      model: model.value,
      ...extra
    }
  })
}

/** Start (or retry) the camera. The first call reports TRY_ON_OPENED. */
async function start() {
  if (!hasConsented.value) {
    hasConsented.value = true
    hasReportedFaceDetected.value = false
    trackTryOn('TRY_ON_OPENED', {
      entryPoint: props.autoStart ? 'auto_start' : 'camera_consent'
    })
  }
  await startStream()
}

onMounted(() => {
  if (props.autoStart) void start()
})

// Room-lighting state, read-only on the ref (not the slot: hosts don't need
// it for UI). `luma` is the smoothed room estimate (null while lighting is
// off or unsampled), `gain` the light multiplier it drives, `sampleMs` the
// worker's time for the last 16×16 downsample (one per
// LIGHTING_SAMPLE_EVERY detections).
const lighting = computed(() => ({
  luma: lightingEnabled.value ? (frameLighting.value?.luma ?? null) : null,
  gain: lightGain.value,
  sampleMs: lastSampleMs.value
}))

// Hair-occlusion state, read-only on the ref: whether it runs, the share of
// the frame the current mask calls hair, the worker's mean time per
// segmentation, masks received, and why it stopped (budget, load error).
const hair = computed(() => ({
  active: hairActive.value,
  coverage: hairSegmenter.mask.value
    ? maskCoverage(hairSegmenter.mask.value.data)
    : null,
  segmentMs: hairSegmenter.segmentMs.value,
  masks: hairSegmenter.masks.value,
  overBudget: hairSegmenter.overBudget.value,
  error: hairSegmenter.error.value
}))

defineExpose({
  start,
  stop,
  status,
  error,
  faceError,
  hasFace,
  guideHint,
  fit,
  lighting,
  hair
})

defineSlots<{
  default?: (props: {
    status: TryOnStatus
    isStarting: boolean
    /** Camera failure: 'denied' | 'unsupported' | 'unavailable'. */
    error: WebcamError | null
    /** Face tracker failure: 'unsupported' | 'load_failed' | 'runtime_failed'. */
    faceError: FaceLandmarkerError | null
    hasFace: boolean
    guideHint: TryOnGuideHint | null
    /**
     * Whether the selected frame suits the tracked face's width, with the
     * two widths in mm. Null until about a second of tracking has given a
     * stable estimate, and while no face is tracked.
     */
    fit: TryOnFit | null
    start: () => Promise<void>
    stop: () => void
  }) => unknown
}>()

watch(isActive, (active) => {
  if (active) {
    trackTryOn('TRY_ON_CAMERA_GRANTED')
    useFaceTracking.value = true
    initFaceLandmarker().catch(() => {
      // Failure is surfaced via faceError.
    })
  }
})

watch(error, (err) => {
  if (err === 'denied') {
    trackTryOn('TRY_ON_CAMERA_DENIED')
  } else if (err) {
    trackTryOn('TRY_ON_ERROR', {
      errorType: err,
      source: 'camera',
      message: cameraErrorDetail.value
    })
  }
})

watch(
  () => hairSegmenter.error.value,
  (message) => {
    if (!message || !props.hairOcclusion) return
    trackTryOn('TRY_ON_ERROR', {
      errorType: message === 'unsupported' ? 'unsupported' : 'load_failed',
      source: 'hair_segmenter',
      message
    })
  }
)

watch(faceError, (err) => {
  if (err) {
    trackTryOn('TRY_ON_ERROR', {
      errorType: err,
      source: 'face_landmarker',
      message: faceErrorDetail.value
    })
  }
})

function onSceneError(source: 'model' | 'environment', message: string) {
  trackTryOn('TRY_ON_ERROR', {
    errorType: 'load_failed',
    source,
    message
  })
}

// Light gain and tint from the smoothed room estimate; neutral (gain 1,
// white) whenever lighting is disabled or no estimate is available.
const lightGain = computed(() =>
  lightingEnabled.value && frameLighting.value
    ? lightingGain(frameLighting.value.luma)
    : 1
)
const lightTint = computed<[number, number, number]>(() =>
  lightingEnabled.value && frameLighting.value
    ? frameLighting.value.tint
    : [1, 1, 1]
)

// Contact shadow under the bridge and lenses, on the tracked skin only (the
// occluder mesh is the skin). Its ellipse follows the face width, and its
// strength follows the room light.
const contactShadowEnabled = computed(
  () => props.contactShadow && capability.allows('contactShadow')
)
const physicalLensEnabled = computed(
  () => props.physicalLens && capability.allows('physicalLens')
)

// Shadow opacity follows the room light: a bright room casts a stronger shadow.
const contactShadowStrength = computed(
  () => CONTACT_SHADOW_STRENGTH * lightGain.value
)

watch(hasFace, (detected) => {
  if (detected && !hasReportedFaceDetected.value) {
    hasReportedFaceDetected.value = true
    trackTryOn('TRY_ON_FACE_DETECTED', {
      confidence: confidence.value,
      tier: capability.tier.value
    })
  }
})

// One event per verdict change (per frame model too, since the frame width
// changes), so the host can relate fit to conversion. Widths are rounded to
// whole millimetres.
watch(fitVerdict, (verdict) => {
  if (!verdict || !faceWidthEstimate.value) return
  trackTryOn('TRY_ON_FIT', {
    verdict,
    faceWidthMm: Math.round(faceWidthEstimate.value.mean),
    frameWidthMm: Math.round(frameWidthMm.value)
  })
})

// Camera stopped: send the session's final report and start the next session fresh.
watch(isActive, (active, wasActive) => {
  if (!active && wasActive && metrics) {
    emitMetrics(true)
    metrics.reset()
  }
})

onBeforeUnmount(() => {
  if (metrics && isActive.value) emitMetrics(true)
})

watch(model, (value) => {
  metrics?.onModelSwitch()
  // A new GLB compiles its shaders on the next frames: warm up again.
  capability.resetWarmup()
  // The new frame has its own width: no verdict until its GLB has loaded.
  glbWidthMeters.value = 0
  fitVerdict.value = null
  if (hasConsented.value) {
    trackTryOn('TRY_ON_FRAME_CHANGED', { model: value })
  }
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
      <div class="vto-layer">
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
            :draco="draco"
            v-bind="{
              ...(dracoDecoderPath !== undefined ? { dracoDecoderPath } : {})
            }"
            :visible="frameVisible"
            :position="framePosition"
            :model-offset="calibration.translation"
            :scale="smoothedScale"
            :scale-x-boost="templeScaleBoost"
            :rotation="smoothedEuler"
            :occluder-enabled="occluderEnabled"
            :occluder-positions="occluderPositions"
            :contact-shadow="contactShadowEnabled && occluderEnabled"
            :contact-shadow-strength="contactShadowStrength"
            :light-gain="lightGain"
            :light-tint="lightTint"
            :occluder-position="occluderPosition"
            :occluder-radius="occluderGeometry"
            :occluder-rotation="smoothedEuler"
            :physical-lens="physicalLensEnabled"
            :lens="calibration.lens"
            :hair-mask="hairActive ? hairSegmenter.mask.value : null"
            :media-window="coverWindow"
            @error="onSceneError"
            @loaded="onModelLoaded"
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
      :start="start"
      :stop="stop"
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
</style>
