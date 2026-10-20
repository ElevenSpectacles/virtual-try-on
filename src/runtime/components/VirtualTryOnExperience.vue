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
import { useTryOnFit } from '../composables/tryon/useTryOnFit'
import { useTryOnLighting } from '../composables/tryon/useTryOnLighting'
import { useTryOnElementSize } from '../composables/tryon/useTryOnElementSize'
import { useTryOnFrameLoop } from '../composables/tryon/useTryOnFrameLoop'
import { useCapabilityTier } from '../composables/tryon/useCapabilityTier'
import { useHairSegmenter } from '../composables/tryon/useHairSegmenter'
import { useTryOnFreeze } from '../composables/tryon/useTryOnFreeze'
import { useTryOnTrackingHold } from '../composables/tryon/useTryOnTrackingHold'
import { guideHintFor } from '../utils/tryon-guide'
import { maskCoverage } from '../utils/tryon-hair'
import { useTryOnModelCache } from '../composables/tryon/useTryOnModelCache'
import { modelCacheCapacity, neighbourFiles } from '../utils/tryon-model-cache'
import { faceRegion } from '../utils/tryon-room'
import type { TryOnTier } from '../utils/tryon-capability'
import {
  createMetricsAccumulator,
  type TryOnSessionMetrics
} from '../utils/tryon-metrics'
import { CONTACT_SHADOW_STRENGTH } from '../utils/tryon-contact-shadow'
import {
  FIT_DEFAULT_TOLERANCE,
  FIT_MIN_SAMPLES,
  fitVerdictFor,
  rankByFit,
  type TryOnFit,
  type TryOnFitRank
} from '../utils/tryon-fit'
import { useTryOnFaceShape } from '../composables/tryon/useTryOnFaceShape'
import { pdConfidence } from '../utils/tryon-measure'
import {
  useTryOnCardCalibration,
  type TryOnCardCalibration
} from '../composables/tryon/useTryOnCardCalibration'
import {
  captureLayout,
  captureQuality,
  type TryOnCaptureOptions
} from '../utils/tryon-capture'
import { preconnectOrigins } from '../utils/tryon-preconnect'
import { CAMERA_BLUR_PX } from '../utils/tryon-camera-match'
import type {
  FaceLandmarkerError,
  TryOnGuideHint,
  TryOnMeasurements,
  TryOnStatus,
  WebcamError
} from '../types/tryon-experience'

import TryOnScene from './TryOnScene.vue'
import { useHead, useRoute, useRuntimeConfig } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'

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
     * the ideal frame width for the tracked face (default 0.06). Until the
     * PD is measured the face estimate assumes an average IPD (about ±5%),
     * so tighter bands mostly add noise.
     */
    fitTolerance?: number
    /**
     * Show the frame at its real size: measure the shopper's PD against the
     * iris (on-device, over the first seconds of frontal tracking) and size
     * the frame and the fit verdict from it instead of population averages.
     * Off keeps the average-face sizing.
     */
    trueToSize?: boolean
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
    /**
     * Tint the lenses' shadow with their colour: a brown lens throws a warm
     * shadow, a green one a green shadow. Costs a second shadow map and a
     * camera-texture upload per frame, so it is opt-in and needs the `high`
     * tier and `contactShadow`.
     */
    tintedLensShadow?: boolean
    /**
     * Bend the temple tips down behind the ears, as an optician fits a
     * frame. Visible when the shopper turns to see the temples. Off keeps
     * the straight authored tips.
     */
    templeEarBend?: boolean
    /**
     * Frames to prefetch on each side of the active one in `models` (its
     * neighbouring colourways), in idle time once a face is tracked, so
     * switching to them is instant. `false` or 0 turns it off. The low tier
     * never prefetches.
     */
    preload?: number | false
    /**
     * URL of the equirect `.hdr` environment map, to self-host it. Omit for
     * the built-in preset (GitHub raw CDN). The `low` tier uses a procedural
     * environment instead and downloads nothing.
     */
    environmentUrl?: string | undefined
    /**
     * Reflect the shopper's own room in the lenses (the camera's view,
     * blended with the studio environment) and aim the key light and the
     * contact shadow at where the room's light comes from. Needs
     * `adaptiveLighting` (and so the `mid` tier). On-device: it uses the
     * 16×16 room sample the lighting already takes.
     */
    roomReflections?: boolean
    /**
     * Make the frame look filmed with the face: grain that grows in dim
     * rooms, a sub-pixel blur, and light wrap at its edges. Needs the `mid`
     * tier or higher.
     */
    cameraMatch?: boolean
  }>(),
  {
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
  }
)

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
function srcFor(file: string): string {
  return `${props.modelBaseUrl}/${file}.glb`
}
const modelSrc = computed(() => srcFor(model.value ?? initialModel))
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

// Room lighting (adaptive, mid tier): the face-landmarker worker returns a
// small downsample of some detection frames, turned into a light gain/tint.
const lightingEnabled = computed(
  () => props.adaptiveLighting && capability.allows('lightingEstimate')
)
// The room is sampled on every tier while the camera is on, for the guide's
// `tooDark` hint (one 16×16 readback in the worker every few detections);
// the lighting itself still needs the mid tier.
const {
  wantFrameSample,
  onFrameSample,
  lightGain,
  lightTint,
  lighting,
  roomLuma,
  roomSample,
  lightDirection
} = useTryOnLighting({
  enabled: () => lightingEnabled.value,
  sample: () => isActive.value,
  room: () => props.roomReflections,
  // The face's box in the raw frame, for the light direction. Read when a
  // sample arrives, after its detection.
  faceRegion: () => faceRegion(faceLandmarks.value)
})

const {
  error: faceError,
  errorDetail: faceErrorDetail,
  hasFace: trackerHasFace,
  confidence,
  landmarks: trackerLandmarks,
  pose: trackerPose,
  blinkScore: trackerBlinkScore,
  anchor: trackerAnchor,
  latencyMs: faceLatencyMs,
  isReady: faceReady,
  init: initFaceLandmarker,
  detectHeld
} = useFaceLandmarker(videoRef, {
  ...(props.mediapipeBasePath !== undefined
    ? { mediapipeBasePath: props.mediapipeBasePath }
    : {}),
  ...(props.mediapipeModelAssetPath !== undefined
    ? { mediapipeModelAssetPath: props.mediapipeModelAssetPath }
    : {}),
  onLatency: (ms) => metrics?.onLatency(ms),
  wantFrameSample,
  onFrameSample,
  wantCardRegion: () => cardCalibration.wantCardRegion(),
  onCardCrop: (gray, width, height, region) =>
    cardCalibration.onCardCrop(gray, width, height, region)
})

// Tracking hold: a dropout shorter than TRACKING_HOLD_MS keeps the last
// pose, so the frame doesn't vanish and pop back. Everything downstream
// reads the held face; only the session metrics see the raw tracker.
const {
  landmarks: faceLandmarks,
  pose: facePose,
  blinkScore: faceBlinkScore,
  anchor: faceAnchor,
  hasFace,
  lastYaw
} = useTryOnTrackingHold({
  landmarks: trackerLandmarks,
  pose: trackerPose,
  blinkScore: trackerBlinkScore,
  anchor: trackerAnchor
})

// Card calibration (optional, ±1 mm PD): the host shows its own "hold a
// card to your forehead" UI and calls `startCalibration()`; the result
// replaces the iris PD for the session (memory only).
// Raw tracker, not the held face: each card crop must be measured against
// the landmarks of its own detection.
const cardCalibration = useTryOnCardCalibration({
  landmarks: trackerLandmarks,
  pose: trackerPose,
  mediaAspect
})

// Freeze / unfreeze (compare frames on a held pose): the video and the
// tracked pose are held; tracking idles until unfreeze.
const {
  frozen,
  freeze: freezeTryOn,
  unfreeze: unfreezeTryOn
} = useTryOnFreeze(videoRef, { active: isActive, detectHeld })

/** Hold the current camera frame and pose; switching `model` re-renders on it. */
async function freeze() {
  // A calibration needs live frames; drop it rather than let it time out.
  if (cardCalibration.calibration.value.status === 'detecting') cardCalibration.cancel()
  const wasFrozen = frozen.value
  await freezeTryOn()
  if (frozen.value && !wasFrozen) trackTryOn('TRY_ON_FREEZE', { frozen: true })
}

/** Back to the live camera; tracking resumes on the next frame. */
async function unfreeze() {
  const wasFrozen = frozen.value
  await unfreezeTryOn()
  if (wasFrozen) trackTryOn('TRY_ON_FREEZE', { frozen: false })
}

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
      hairOcclusion: hairActive.value,
      tintedLensShadow: tintedLensShadowEnabled.value,
      cameraMatch: cameraMatchEnabled.value
    }
  })
}

if (metrics) {
  useTryOnFrameLoop((deltaMs) => {
    if (metrics.onFrame(deltaMs, isActive.value, trackerHasFace.value)) emitMetrics(false)
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

// Parsed-GLB cache (issue #94): switching back to a frame, or to a
// prefetched neighbour, mounts it at once. Prefetch runs only while a face is
// tracked, so it never competes with the first frame or loads anything
// before the camera starts; the low tier keeps two GLBs and never prefetches.
const preloadPerSide = computed(() =>
  props.preload === false ? 0 : Math.max(0, Math.floor(props.preload))
)
const modelCache = useTryOnModelCache({
  draco: props.draco,
  dracoDecoderPath: props.dracoDecoderPath,
  capacity: modelCacheCapacity(false, preloadPerSide.value)
})
watch(
  [() => capability.tier.value, preloadPerSide],
  ([tier, perSide]) => modelCache.resize(modelCacheCapacity(tier === 'low', perSide)),
  { immediate: true }
)
watch(
  [model, () => isActive.value && hasFace.value, () => capability.tier.value, preloadPerSide],
  ([file, tracking, tier, perSide]) => {
    if (!tracking || tier === 'low' || perSide <= 0) return
    const files = props.models.map((m) => m.file)
    modelCache.prefetch(neighbourFiles(files, file, perSide).map(srcFor))
  }
)

/**
 * Fetch and parse a frame ahead of a likely switch (e.g. hover on a swatch),
 * in idle time. Unknown files are ignored.
 */
function preloadModel(file: string) {
  if (!getTryOnModel(props.models, file)) return
  modelCache.prefetch([srcFor(file)])
}

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

// The frame renders only on a tracked face: never before the camera starts
// (the host owns that screen — consent, previews), and not while tracking
// has momentarily lost the face (head turned past the tracker's yaw range,
// face out of frame), where it would freeze mid-air over the live video.
const frameVisible = computed(
  () => isActive.value && useFaceTracking.value && hasFace.value
)

// The frame fades out (CSS, on the canvas layer) when the face is lost for
// longer than the hold; the scene keeps drawing it until the fade is done.
const FRAME_FADE_MS = 150
const frameFading = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | null = null
watch(frameVisible, (visible, wasVisible) => {
  if (fadeTimer !== null) clearTimeout(fadeTimer)
  fadeTimer = null
  frameFading.value = !visible && wasVisible
  if (frameFading.value) {
    fadeTimer = setTimeout(() => {
      fadeTimer = null
      frameFading.value = false
    }, FRAME_FADE_MS)
  }
})
onBeforeUnmount(() => {
  if (fadeTimer !== null) clearTimeout(fadeTimer)
})

// Where the frame goes (shared with the playground prototype): scale from
// the tracked face, smoothed pose, world position and the occluders.
const {
  correctedAnchor: correctedFaceAnchor,
  earWidth: correctedEarWidth,
  ipd: correctedIpd,
  poseCompensated,
  measurement: pdMeasurement,
  rulerPd,
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
  scaleMultiplier: () => props.frameScale,
  trueToSize: () => props.trueToSize,
  calibratedPd: () => {
    const { state } = cardCalibration
    return state.value.status === 'done' && state.value.nearPdMm && state.value.pdMm
      ? { nearPdMm: state.value.nearPdMm, pdMm: state.value.pdMm }
      : null
  }
})

// Coaching for the host's guide UI (no copy here): no face, turned too far,
// too dark, or aligned. Keeps its previous value for the hysteresis.
const guideHint = ref<TryOnGuideHint | null>(null)
watchEffect(() => {
  guideHint.value = guideHintFor({
    tracking: isActive.value && useFaceTracking.value,
    hasFace: hasFace.value,
    anchored: !!correctedFaceAnchor.value,
    yaw: facePose.value?.euler.yaw ?? null,
    lastYaw: lastYaw.value,
    luma: roomLuma.value,
    previous: guideHint.value
  })
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
const fitState = useTryOnFit({
  landmarks: faceLandmarks,
  hasFace,
  earWidth: () => poseCompensated(correctedEarWidth.value),
  ipd: () => poseCompensated(correctedIpd.value),
  ipdMm: () => rulerPd.value,
  frameWidthMm: () => frameWidthMm.value,
  tolerance: () => props.fitTolerance
})
const fit = fitState.fit

// Face shape (frame-advisor styling hint), from frontal detections.
const { faceShape } = useTryOnFaceShape({
  landmarks: faceLandmarks,
  pose: facePose,
  mediaAspect
})

// On-device face measurements (frame advisor, issue #98): the measured PD
// (distance PD, as an optician measures it), the face width the fit verdict
// uses, and the face shape. Null while nothing is measured yet.
const measuredFaceWidthMm = computed(() => {
  const estimate = fitState.faceWidthEstimate.value
  return estimate && estimate.samples >= FIT_MIN_SAMPLES ? estimate.mean : null
})
const measurements = computed<TryOnMeasurements | null>(() => {
  const pd = pdMeasurement.value
  const shape = faceShape.value
  if (!pd && measuredFaceWidthMm.value === null && !shape) return null
  return {
    pdMm: pd?.pdMm ?? null,
    faceWidthMm: measuredFaceWidthMm.value,
    confidence: pdConfidence(pd),
    stable: pd?.stable ?? false,
    faceShape: shape?.shape ?? null,
    faceShapeConfidence: shape?.confidence ?? 0
  }
})

/** Start a card calibration (see README); restarts one in progress. */
async function startCalibration() {
  // Card crops come from live detections: resume the camera first.
  if (frozen.value) await unfreeze()
  cardCalibration.start()
}

/** Stop a calibration in progress, or drop a finished one. */
function cancelCalibration() {
  cardCalibration.cancel()
}

const calibrationState = cardCalibration.calibration

watch(
  () => calibrationState.value.status,
  (status) => {
    if (status === 'done') {
      trackTryOn('TRY_ON_CALIBRATED', { pdMm: calibrationState.value.pdMm })
    } else if (status === 'failed') {
      trackTryOn('TRY_ON_ERROR', {
        errorType: 'calibration_failed',
        source: 'card_calibration',
        message: 'no stable card reading'
      })
    }
  }
)

// Width of any catalog frame without loading it: the catalog spec, else the
// calibration manifest's `frameWidthMm`, else (the active frame only) its
// loaded GLB. 0 while unknown.
function frameWidthFor(file: string): number {
  const spec = getTryOnModel(props.models, file)?.frameWidthMm
  if (spec && spec > 0) return spec
  if (file === model.value && frameWidthMm.value > 0) return frameWidthMm.value
  return getCalibration(file).frameWidthMm
}

/** Fit of any catalog frame on the measured face; null until measured or when its width is unknown. */
function fitFor(file: string): TryOnFit | null {
  const face = measuredFaceWidthMm.value
  const frame = frameWidthFor(file)
  if (face === null) return null
  const verdict = fitVerdictFor(frame, face, props.fitTolerance)
  return verdict ? { verdict, faceWidthMm: face, frameWidthMm: frame } : null
}

/** The catalog ranked by fit on the measured face, best first; empty until measured. */
const fitRanking = computed<TryOnFitRank[]>(() => {
  const face = measuredFaceWidthMm.value
  if (face === null) return []
  return rankByFit(
    props.models.map((m) => ({ file: m.file, frameWidthMm: frameWidthFor(m.file) })),
    face,
    props.fitTolerance
  )
})

// Frame-switch latency for the metrics event: switch → new frame shown.
let switchStartedAt: number | null = null

function onModelLoaded(widthMeters: number) {
  glbWidthMeters.value = widthMeters
  if (switchStartedAt !== null) {
    metrics?.onModelSwitchLatency(performance.now() - switchStartedAt)
    switchStartedAt = null
  }
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
    | 'TRY_ON_CALIBRATED'
    | 'TRY_ON_FACE_SHAPE'
    | 'TRY_ON_CAPTURE'
    | 'TRY_ON_FREEZE'
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

// Time to first frame (issue #95). The tracker (MediaPipe Wasm + face
// model, the largest first-load cost) starts loading with `start()` or
// `prefetch()`, in parallel with the camera permission prompt and stream
// start, instead of after the stream is up.
let trackerRequestedAt: number | null = null
function initTracker() {
  if (trackerRequestedAt === null) trackerRequestedAt = performance.now()
  const requestedAt = trackerRequestedAt
  initFaceLandmarker()
    .then(() => {
      if (faceReady.value) metrics?.onAssetTiming('tracker', performance.now() - requestedAt)
    })
    .catch(() => {
      // Failure is surfaced via faceError.
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
  initTracker()
  await startStream()
}

/**
 * Warm up before the shopper taps "Try on" (e.g. on hover of the button):
 * loads the face tracker. Does not touch the camera, so it needs no consent;
 * it does download the MediaPipe Wasm and model.
 */
function prefetch() {
  initTracker()
}

// Open connections to the default CDNs early (skipped for self-hosted
// assets), while the shopper reads the consent screen.
useHead({
  link: preconnectOrigins({
    mediapipeBasePath: props.mediapipeBasePath,
    mediapipeModelAssetPath: props.mediapipeModelAssetPath,
    hairOcclusion: props.hairOcclusion,
    mediapipeHairModelAssetPath: props.mediapipeHairModelAssetPath,
    draco: props.draco,
    dracoDecoderPath: props.dracoDecoderPath,
    presetEnvironment: props.environmentUrl === undefined
  }).map((href) => ({ rel: 'preconnect', href, crossorigin: 'anonymous' as const }))
})

// Camera granted → first rendered frame on a face, once per camera session.
let grantedAt: number | null = null
watch(isActive, (active) => {
  grantedAt = active ? performance.now() : null
})
watch(
  () => frameVisible.value && glbWidthMeters.value > 0,
  (shown) => {
    if (!shown || grantedAt === null || !metrics) return
    const since = grantedAt
    grantedAt = null
    // The frame is on screen once the next frame has been drawn.
    requestAnimationFrame(() => metrics.onFirstFrame(performance.now() - since))
  }
)

function onSceneTiming(asset: 'model' | 'environment', ms: number) {
  metrics?.onAssetTiming(asset, ms)
}

onMounted(() => {
  if (props.autoStart) void start()
})

// Snapshot of the composited try-on (issue #93), set by the scene.
let renderSnapshot: (() => HTMLCanvasElement | null) | null = null
function onSceneSnapshot(render: () => HTMLCanvasElement | null) {
  renderSnapshot = render
}

/**
 * The try-on as the shopper sees it, as an image Blob: the visible
 * (`object-fit: cover`) window of the camera frame, mirrored like the
 * preview, with the frame rendered over it. Made on-device; the Blob stays in
 * the browser unless the host uploads or shares it. Rejects while the camera
 * is off.
 */
async function capture(options: TryOnCaptureOptions = {}): Promise<Blob> {
  const video = videoRef.value
  if (!isActive.value || !video) throw new Error('capture: camera is not active')
  const layout = captureLayout(
    video.videoWidth,
    video.videoHeight,
    stageWidth.value,
    stageHeight.value,
    options.maxWidth
  )
  if (!layout) throw new Error('capture: camera frame not ready')
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('capture: 2D canvas unavailable')
  const { source } = layout
  // Mirrored once, like the preview's `scaleX(-1)`; the scene is not.
  context.save()
  context.translate(layout.width, 0)
  context.scale(-1, 1)
  context.drawImage(
    video,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    layout.width,
    layout.height
  )
  context.restore()
  // Render and copy in the same task: the drawing buffer is still intact.
  // As on screen: no frame while it is hidden (it fades out), and the
  // camera-match blur scaled from stage pixels to output pixels.
  const scene = frameVisible.value ? renderSnapshot?.() : null
  if (scene && scene.width > 0 && scene.height > 0) {
    if (cameraMatchEnabled.value && stageWidth.value > 0) {
      context.filter = `blur(${(CAMERA_BLUR_PX * layout.width) / stageWidth.value}px)`
    }
    context.drawImage(scene, 0, 0, layout.width, layout.height)
    context.filter = 'none'
  }
  const type = options.type ?? 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, captureQuality(options.quality))
  )
  if (!blob) throw new Error('capture: encoding failed')
  trackTryOn('TRY_ON_CAPTURE', { type: blob.type })
  return blob
}

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
  fitRanking,
  fitFor
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
    /**
     * On-device face measurements: PD, face width, face shape. Null until
     * something is measured.
     */
    measurements: TryOnMeasurements | null
    start: () => Promise<void>
    stop: () => void
    /** Card calibration: `{ status, progress, pdMm }` ('idle' until started). */
    calibration: TryOnCardCalibration
    startCalibration: () => Promise<void>
    cancelCalibration: () => void
    /** Snapshot of the composited try-on as an image Blob (on-device). */
    capture: (options?: TryOnCaptureOptions) => Promise<Blob>
    /** The camera frame and pose are held (see `freeze`). */
    frozen: boolean
    /** Hold the current frame and pose, e.g. to compare frames on one look. */
    freeze: () => Promise<void>
    /** Back to the live camera. */
    unfreeze: () => Promise<void>
  }) => unknown
}>()

watch(isActive, (active) => {
  if (active) {
    trackTryOn('TRY_ON_CAMERA_GRANTED')
    useFaceTracking.value = true
    // Already loading since `start()`; this covers a retry after a failure.
    initTracker()
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

// A bad calibration entry is reported once per model (the frame still
// renders, with the invalid fields at their defaults).
const reportedCalibration = new Set<string>()
watch(
  () => {
    const file = model.value ?? initialModel
    return { file, problems: getCalibrationProblems(file) }
  },
  ({ file, problems }) => {
    if (!problems.length || reportedCalibration.has(file)) return
    reportedCalibration.add(file)
    trackTryOn('TRY_ON_ERROR', {
      errorType: 'invalid_calibration',
      source: 'calibration',
      message: `${file}: ${problems.join('; ')}`
    })
  },
  { immediate: true }
)

function onSceneError(source: 'model' | 'environment', message: string) {
  trackTryOn('TRY_ON_ERROR', {
    errorType: 'load_failed',
    source,
    message
  })
}

// Contact shadow under the bridge and lenses, on the tracked skin only (the
// occluder mesh is the skin). Its ellipse follows the face width, and its
// strength follows the room light.
const contactShadowEnabled = computed(
  () => props.contactShadow && capability.allows('contactShadow')
)
const tintedLensShadowEnabled = computed(
  () =>
    props.tintedLensShadow &&
    contactShadowEnabled.value &&
    capability.allows('tintedLensShadow')
)
// While frozen the camera image is a still photo: hold the grain still too,
// instead of re-seeding it every render (which would shimmer over the photo).
const FROZEN_GRAIN_SEED = 0.5
const cameraMatchEnabled = computed(
  () => props.cameraMatch && capability.allows('cameraMatch')
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
watch(fitState.verdict, (verdict) => {
  const estimate = fitState.faceWidthEstimate.value
  if (!verdict || !estimate) return
  trackTryOn('TRY_ON_FIT', {
    verdict,
    faceWidthMm: Math.round(estimate.mean),
    frameWidthMm: Math.round(frameWidthMm.value)
  })
})

// Face shape as a coarse class only (never measurements), once it appears
// and on each change.
watch(
  () => faceShape.value?.shape ?? null,
  (shape) => {
    if (shape) trackTryOn('TRY_ON_FACE_SHAPE', { faceShape: shape })
  }
)

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
  switchStartedAt = performance.now()
  // A new GLB compiles its shaders on the next frames: warm up again.
  capability.resetWarmup()
  // The new frame has its own width: no verdict until its GLB has loaded.
  glbWidthMeters.value = 0
  fitState.reset()
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
