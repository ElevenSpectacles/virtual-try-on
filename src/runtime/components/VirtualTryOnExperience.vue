<script setup lang="ts">
/**
 * Headless virtual try-on view: renders only the mirrored camera feed and the
 * tracked 3D frame, sized to fill its container. It ships no UI copy, icons
 * or utility classes — consent, error states, positioning guidance and any
 * tuning controls are the host's job, built from the state and actions the
 * default slot (and the component ref) exposes. Slot content is rendered on
 * top of the feed inside the stage.
 */
import { NeutralToneMapping, Euler, Vector3 } from 'three'
import {
  useElementSize,
  usePreferredReducedMotion,
  useRafFn
} from '@vueuse/core'
import {
  landmarkToWorld,
  computeMetricBaseScale,
  computeMetricScaleFromMeasure,
  compensateMeasureForPose,
  getInterPupillaryDistance,
  computeHeadOccluderGeometry,
  worldPlaneWidth,
  objectCoverWindow,
  mapLandmarkToObjectCover,
  getFaceWidth,
  getEarWidth,
  isBlinking,
  ASSUMED_FACE_WIDTH_METERS,
  ASSUMED_EAR_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  FRAME_FIT_SCALE_BOOST,
  type NormalizedLandmark
} from '../utils/tryon'
import { faceEulerToThree } from '../utils/tryon-pose'
import { buildFaceMeshOccluderPositions } from '../utils/tryon-occluder'
import { useWebcamStream } from '../composables/tryon/useWebcamStream'
import { useFaceLandmarker } from '../composables/tryon/useFaceLandmarker'
import { useFrameCalibration } from '../composables/tryon/useFrameCalibration'
import {
  getTryOnModel,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'
import { useTryOnSmoothing } from '../composables/tryon/useTryOnSmoothing'
import type {
  FaceLandmarkerError,
  TryOnGuideHint,
  TryOnStatus,
  WebcamError
} from '../types/tryon-experience'

import TryOnScene from './TryOnScene.vue'
import { useRoute } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'

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
    /** Manual frame yaw in degrees, used only while no face is tracked. */
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
    /** Draco decoder path override — omit to use TresJS's CDN default. */
    dracoDecoderPath?: string | undefined
  }>(),
  {
    modelBaseUrl: '/models/virtual-try-on',
    autoStart: false,
    exposure: 1,
    frameScale: 1,
    frameYaw: 0,
    templeWidth: 1,
    draco: true
  }
)

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
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
  start: startStream,
  stop
} = useWebcamStream()
const prefersReducedMotion = usePreferredReducedMotion()

const stageRef = ref<HTMLElement | null>(null)
const { width: stageWidth, height: stageHeight } = useElementSize(stageRef)

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
const referenceFaceWidth = ref(0.32)
// The calibration translation now y-centers each model's bbox on the anchor
// landmark, which is where the lens line naturally sits — the old -0.08
// world-unit drop predates that recentring and would double-lower the frame.
const DEFAULT_ANCHOR_Y_OFFSET = 0
const debugYOffset = ref(0)
const debugZOffset = ref(0)
const debugScaleBoost = ref(1)
const rotationY = computed(() => (props.frameYaw * Math.PI) / 180)
const mirrorLandmarks = true
const useFaceTracking = ref(true)
const occluderEnabled = ref(false)

// Normalized inter-pupillary distance from the iris landmarks — varies far
// less between people than cheek-to-cheek width, so it stays the fallback
// when face width isn't trackable.
const correctedIpd = computed(() =>
  getInterPupillaryDistance(correctedFaceLandmarks.value)
)

// Normalized ear-to-ear width (face-oval points at temple height) — the
// measure a real frame is sized from: the temple arms must span it. Drives
// the metric scale when trackable.
const correctedEarWidth = computed(() =>
  getEarWidth(correctedFaceLandmarks.value)
)

// Undo the cos(yaw)·cos(pitch) foreshortening of an on-screen measure so the
// frame does not shrink when the head turns.
function poseCompensated(measure: number): number {
  if (!facePose.value) return measure
  return compensateMeasureForPose(
    measure,
    facePose.value.euler.yaw,
    facePose.value.euler.pitch
  )
}

// GLBs are authored in metres — derive scale metrically from the tracked
// ear-to-ear width (what a frame's temple arms actually span), falling back
// to cheek width, to IPD, and to the static reference width in pointer/idle
// mode. Same chain as VirtualTryOnPrototype, so playground tuning transfers
// 1:1.
const scaleSource = computed<'ear' | 'width' | 'ipd' | 'manual'>(() => {
  if (!hasFace.value) return 'manual'
  if (correctedEarWidth.value > 0) return 'ear'
  return correctedFaceWidth.value > 0 ? 'width' : 'ipd'
})

const autoMetricScale = computed(() => {
  if (scaleSource.value === 'manual') {
    return computeMetricBaseScale(aspect.value, referenceFaceWidth.value)
  }
  const measure =
    scaleSource.value === 'ear'
      ? ([correctedEarWidth.value, ASSUMED_EAR_WIDTH_METERS] as const)
      : scaleSource.value === 'width'
        ? ([correctedFaceWidth.value, ASSUMED_FACE_WIDTH_METERS] as const)
        : ([correctedIpd.value, ASSUMED_IPD_METERS] as const)
  // Tracked sources get the fit boost on top — a real frame is worn
  // slightly wider than the skull (see FRAME_FIT_SCALE_BOOST).
  return (
    computeMetricScaleFromMeasure(aspect.value, poseCompensated(measure[0]), measure[1]) *
    FRAME_FIT_SCALE_BOOST
  )
})

const calibratedScale = computed(
  () =>
    autoMetricScale.value *
    calibration.value.scale *
    debugScaleBoost.value *
    props.frameScale
)

// The occluder must stay skull-sized when the head turns: the cheek-to-cheek
// measure foreshortens by cos(yaw)·cos(pitch), so compensate it the same way
// the scale path does — otherwise the ellipsoid shrinks at yaw and the far
// temple arm escapes it, rendering on top of the face.
const faceWorldHalfWidth = computed(
  () =>
    (worldPlaneWidth(aspect.value) *
      (correctedFaceWidth.value
        ? poseCompensated(correctedFaceWidth.value)
        : referenceFaceWidth.value)) /
    2
)

const occluderGeometry = computed(() =>
  computeHeadOccluderGeometry(faceWorldHalfWidth.value, {
    widthRatio: 1.3,
    heightRatio: 1.3,
    depthRatio: 1.4
  })
)

// Push-back is applied along the head's own backward axis, not the camera's:
// at yaw the skull sits diagonally behind the nose bridge, and pushing
// straight back along camera Z drifts the ellipsoid off the head, exposing
// the far temple arm it exists to hide.
//
// Calibration anchors each frame at its front face, so the ellipsoid's front
// surface must sit behind that plane — at the eye/cheek plane a real face
// recesses behind the nose-ridge anchor (same convention as the head-shell
// cap: just past the frame's endpiece wrap, ~15mm). Pushing it back by a
// frame half-depth on top (the pre-shell convention) leaves a gap where the
// frame's front half renders on top of the head.
const EYE_PLANE_SETBACK_METERS = 0.015
const occluderPosition = computed(() => {
  const position = landmarkToWorld(smoothedAnchor.value, aspect.value, {
    mirror: mirrorLandmarks
  })
  const setback = EYE_PLANE_SETBACK_METERS * smoothedScale.value
  const rot = smoothedEuler.value
  const back = new Vector3(
    0,
    0,
    -(occluderGeometry.value.radiusZ + setback)
  ).applyEuler(new Euler(rot.x, rot.y, rot.z))
  return {
    x: position.x + back.x,
    y: position.y + back.y,
    z: framePosition.value.z + back.z
  }
})

const faceRotation = computed(() => {
  if (!useFaceTracking.value || !facePose.value) return null
  const euler = faceEulerToThree(facePose.value.euler)
  return {
    x: euler.x + calibration.value.rotation.x,
    y: euler.y + calibration.value.rotation.y,
    z: euler.z + calibration.value.rotation.z
  }
})

const manualRotation = computed(() => ({
  x: calibration.value.rotation.x,
  y: rotationY.value + calibration.value.rotation.y,
  z: calibration.value.rotation.z
}))

const {
  error: faceError,
  hasFace,
  confidence,
  landmarks: faceLandmarks,
  pose: facePose,
  anchor: faceAnchor,
  latencyMs: faceLatencyMs,
  init: initFaceLandmarker
} = useFaceLandmarker(videoRef, {
  ...(props.mediapipeBasePath !== undefined
    ? { mediapipeBasePath: props.mediapipeBasePath }
    : {}),
  ...(props.mediapipeModelAssetPath !== undefined
    ? { mediapipeModelAssetPath: props.mediapipeModelAssetPath }
    : {})
})

const correctedFaceLandmarks = computed(() =>
  faceLandmarks.value.map((lm) =>
    mapLandmarkToObjectCover(lm, coverWindow.value)
  )
)
const correctedFaceAnchor = computed(() =>
  faceAnchor.value
    ? mapLandmarkToObjectCover(faceAnchor.value, coverWindow.value)
    : null
)
const correctedFaceWidth = computed(() =>
  getFaceWidth(correctedFaceLandmarks.value)
)

const templeScaleBoost = computed(
  () => calibration.value.templeWidthBoost * props.templeWidth
)

const pointerActive = ref(false)
const landmark = ref<NormalizedLandmark>({ x: 0.5, y: 0.45 })

const idlePhase = ref(0)
useRafFn(
  ({ delta }) => {
    if (prefersReducedMotion.value === 'reduce' || pointerActive.value) return
    idlePhase.value += delta / 1000
  },
  { immediate: true }
)

const effectiveLandmark = computed<NormalizedLandmark>(() => {
  if (useFaceTracking.value && hasFace.value && correctedFaceAnchor.value) {
    return correctedFaceAnchor.value
  }
  if (pointerActive.value) return landmark.value
  if (prefersReducedMotion.value === 'reduce') return { x: 0.5, y: 0.45 }
  return {
    x: 0.5 + 0.06 * Math.sin(idlePhase.value),
    y: 0.45 + 0.03 * Math.sin(idlePhase.value * 0.7)
  }
})

// Hide the frame while camera tracking has momentarily lost the face (head
// turned past the tracker's yaw range, face out of frame). Without this the
// glasses freeze mid-air or drift on the idle animation over a live video of
// a face they no longer follow. Pointer mode is unaffected.
const frameVisible = computed(() => {
  if (useFaceTracking.value && isActive.value) return hasFace.value
  return true
})

const { smoothedAnchor, smoothedEuler, smoothedScale } = useTryOnSmoothing({
  targetAnchor: effectiveLandmark,
  targetEuler: computed(() => faceRotation.value ?? manualRotation.value),
  targetScale: calibratedScale,
  isTracking: computed(() => useFaceTracking.value && hasFace.value),
  latencyMs: faceLatencyMs,
  // Iris landmarks drift while the eyelid covers the iris — freeze scale
  // for the blink instead of letting the frame visibly change size.
  holdScale: computed(() =>
    isBlinking(faceLandmarks.value, mediaAspect.value || 1)
  )
})

// Face-mesh occluder vertices, rebuilt per detection. Shape comes from the
// RAW landmarks/pose (so the mesh hugs the real face surface); placement
// comes from the SMOOTHED anchor/euler/scale the glasses render with — the
// mesh and frame move as one rigid body and occluder edges never shimmer
// against the glasses. Null when no face is tracked → the scene falls back
// to the ellipsoid proxy (pointer/idle mode).
const occluderPositions = computed(() => {
  if (
    !useFaceTracking.value ||
    !hasFace.value ||
    !facePose.value ||
    !faceRotation.value ||
    !correctedFaceAnchor.value
  ) {
    return null
  }
  return buildFaceMeshOccluderPositions({
    landmarks: correctedFaceLandmarks.value,
    aspect: aspect.value,
    mirror: mirrorLandmarks,
    rawAnchor: correctedFaceAnchor.value,
    rawEuler: faceRotation.value,
    smoothedAnchor: smoothedAnchor.value,
    smoothedEuler: smoothedEuler.value,
    scale: smoothedScale.value
  })
})

// The calibration recentring translation is NOT applied here — it is passed
// to the scene as `model-offset` and applied inside the rotated group, so it
// pivots with the head. Adding it to this world-space position kept the
// recentring un-rotated and drifted the frame sideways at yaw.
const framePosition = computed(() => {
  const position = landmarkToWorld(smoothedAnchor.value, aspect.value, {
    mirror: mirrorLandmarks
  })
  return {
    x: position.x,
    y: position.y + DEFAULT_ANCHOR_Y_OFFSET + debugYOffset.value,
    z: debugZOffset.value
  }
})

const guideHint = computed<TryOnGuideHint | null>(() => {
  if (!isActive.value || !useFaceTracking.value) return null
  return !hasFace.value || !correctedFaceAnchor.value ? 'noFace' : 'aligned'
})

const status = computed<TryOnStatus>(() => {
  if (isActive.value) return 'active'
  if (isStarting.value) return 'starting'
  if (error.value) return 'error'
  return 'idle'
})

function onPointerMove(event: PointerEvent) {
  const el = stageRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = (event.clientX - rect.left) / rect.width
  const py = (event.clientY - rect.top) / rect.height
  pointerActive.value = true
  landmark.value = {
    x: 1 - Math.min(Math.max(px, 0), 1),
    y: Math.min(Math.max(py, 0), 1)
  }
}

function onPointerLeave() {
  pointerActive.value = false
}

function trackTryOn(
  event:
    | 'TRY_ON_OPENED'
    | 'TRY_ON_CAMERA_GRANTED'
    | 'TRY_ON_CAMERA_DENIED'
    | 'TRY_ON_FACE_DETECTED'
    | 'TRY_ON_FRAME_CHANGED'
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

defineExpose({ start, stop, status, error, faceError, hasFace, guideHint })

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
    trackTryOn('TRY_ON_ERROR', { errorType: err, source: 'camera' })
  }
})

watch(faceError, (err) => {
  if (err) {
    trackTryOn('TRY_ON_ERROR', { errorType: err, source: 'face_landmarker' })
  }
})

watch(hasFace, (detected) => {
  if (detected && !hasReportedFaceDetected.value) {
    hasReportedFaceDetected.value = true
    trackTryOn('TRY_ON_FACE_DETECTED', {
      confidence: confidence.value
    })
  }
})

watch(model, (value) => {
  if (hasConsented.value) {
    trackTryOn('TRY_ON_FRAME_CHANGED', { model: value })
  }
})
</script>

<template>
  <div
    ref="stageRef"
    class="vto-stage"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
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
            :occluder-position="occluderPosition"
            :occluder-radius="occluderGeometry"
            :occluder-rotation="smoothedEuler"
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
  touch-action: none;
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
