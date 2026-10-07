<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
  getEyeAspectRatio,
  ASSUMED_FACE_WIDTH_METERS,
  ASSUMED_EAR_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  FRAME_FIT_SCALE_BOOST,
  type NormalizedLandmark
} from '../../src/runtime/utils/tryon'
import { faceEulerToThree } from '../../src/runtime/utils/tryon-pose'
import { buildFaceMeshOccluderPositions } from '../../src/runtime/utils/tryon-occluder'
import { useWebcamStream } from '../../src/runtime/composables/tryon/useWebcamStream'
import { useFaceLandmarker } from '../../src/runtime/composables/tryon/useFaceLandmarker'
import { useTryOnSmoothing } from '../../src/runtime/composables/tryon/useTryOnSmoothing'
import { useFrameCalibration } from '../../src/runtime/composables/tryon/useFrameCalibration'
import {
  getTryOnModel,
  type TryOnModel
} from '../../src/runtime/composables/tryon/useTryOnModels'

import TryOnScene from '../../src/runtime/components/TryOnScene.vue'
import { useRoute } from '#imports'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  models: TryOnModel[]
  calibrationUrl: string
  modelBaseUrl?: string
}>()

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
}>()

const route = useRoute()
const { t } = useI18n()
const { getCalibration } = useFrameCalibration(props.calibrationUrl)

// Prototype for issue #606: how a TresJS-rendered frame composites over a live
// front-camera feed. Deliberately minimal — a pointer stands in for a tracked
// landmark so the mirroring behaviour is inspectable.

const queryModel = route.query.model as string | undefined
const initialModel =
  getTryOnModel(props.models, queryModel)?.file ?? props.models[0]?.file

if (!initialModel) {
  throw new Error('VirtualTryOnPrototype requires at least one model')
}

const isDebugMode = computed(() => route.query.debug_tryon === 'true')

const hasConsented = ref(false)
const hasReportedFaceDetected = ref(false)

const { videoRef, isActive, isStarting, error, start, stop } = useWebcamStream()
const prefersReducedMotion = usePreferredReducedMotion()

const stageRef = ref<HTMLElement | null>(null)
const canvasWrapperRef = ref<HTMLElement | null>(null)
const debugCanvasRef = ref<HTMLCanvasElement | null>(null)
const { width: stageWidth, height: stageHeight } = useElementSize(stageRef)

const aspect = computed(() =>
  stageHeight.value > 0 ? stageWidth.value / stageHeight.value : 3 / 4
)

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

const selectedModel = ref(initialModel)
const modelBaseUrl = computed(
  () => props.modelBaseUrl ?? '/models/virtual-try-on'
)
const modelSrc = computed(() => `${modelBaseUrl.value}/${selectedModel.value}.glb`)
const calibration = computed(() => getCalibration(selectedModel.value))
const exposure = ref(1)
const fineTuneScale = ref(1)
const referenceFaceWidth = ref(0.32)
const enableAutoScale = ref(true)
const DEFAULT_ANCHOR_Y_OFFSET = 0
const debugYOffset = ref(0)
const debugZOffset = ref(0)
const debugScaleBoost = ref(1)

const correctedIpd = computed(() =>
  getInterPupillaryDistance(correctedFaceLandmarks.value)
)

const correctedEarWidth = computed(() =>
  getEarWidth(correctedFaceLandmarks.value)
)

function poseCompensated(measure: number): number {
  if (!facePose.value) return measure
  return compensateMeasureForPose(
    measure,
    facePose.value.euler.yaw,
    facePose.value.euler.pitch
  )
}

// Same chain as VirtualTryOnExperience: ear-to-ear width first (what a
// frame's temple arms actually span), then cheek width, then IPD — so
// values tuned here transfer 1:1 to production.
const scaleSource = computed<'ear' | 'width' | 'ipd' | 'manual'>(() => {
  if (!enableAutoScale.value || !hasFace.value) return 'manual'
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
    fineTuneScale.value
)

const occluderEnabled = ref(true)
const occluderDebugVisible = ref(false)
const showModelBoundingBox = ref(false)
const occluderWidthRatio = ref(1.3)
const occluderHeightRatio = ref(1.3)
const occluderDepthRatio = ref(1.4)
// Landmark-shell occluder (the production path) with its tuning knobs; the
// width/height/depth ratios above only steer the ellipsoid fallback.
const occluderMeshEnabled = ref(true)
const occluderSkinSetback = ref(0.006)
const occluderMeshInflate = ref(1.04)
const occluderCollarDepth = ref(0.2)

// The occluder must stay skull-sized when the head turns: the cheek-to-cheek
// measure foreshortens by cos(yaw)·cos(pitch), so compensate it the same way
// the scale path does — otherwise the ellipsoid shrinks at yaw and the far
// temple arm escapes it, rendering on top of the face.
const faceWorldHalfWidth = computed(() => {
  const width =
    enableAutoScale.value && correctedFaceWidth.value
      ? poseCompensated(correctedFaceWidth.value)
      : referenceFaceWidth.value
  return (worldPlaneWidth(aspect.value) * width) / 2
})

const occluderGeometry = computed(() =>
  computeHeadOccluderGeometry(faceWorldHalfWidth.value, {
    widthRatio: occluderWidthRatio.value,
    heightRatio: occluderHeightRatio.value,
    depthRatio: occluderDepthRatio.value
  })
)

const occluderPosition = computed(() => {
  const position = landmarkToWorld(smoothedAnchor.value, aspect.value, {
    mirror: mirrorLandmarks
  })
  // Front-at-anchor calibration: the ellipsoid's front surface sits just past
  // the frame's endpiece wrap (~15mm back), matching the shell's cap.
  const setback = 0.015 * smoothedScale.value
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
const rotationDeg = ref(0)
const rotationY = computed(() => (rotationDeg.value * Math.PI) / 180)
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
const mirrorLandmarks = true
const useFaceTracking = ref(false)
const noFaceDetectedAt = ref<number | null>(null)
const showNoFaceMessage = computed(() => {
  if (!noFace.value || noFaceDetectedAt.value === null) return false
  return performance.now() - noFaceDetectedAt.value > 2500
})

const {
  isLoading: isFaceLoading,
  isReady: isFaceReady,
  error: faceError,
  hasFace,
  noFace,
  confidence,
  landmarks: faceLandmarks,
  pose: facePose,
  anchor: faceAnchor,
  latencyMs: faceLatencyMs,
  init: initFaceLandmarker
} = useFaceLandmarker(videoRef)

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

// Same guide behavior as VirtualTryOnExperience: blurred surround +
// corner-bracket rectangle while no face is found, fading out once a face is
// tracked. No distance hints — the metric scale adapts to any workable
// distance.
const showGuideOverlay = computed(
  () => isActive.value && useFaceTracking.value
)

type GuideHint = 'noFace' | 'aligned'

const guideHint = computed<GuideHint>(() =>
  !hasFace.value || !correctedFaceAnchor.value ? 'noFace' : 'aligned'
)

const guideHintText = computed(() =>
  guideHint.value === 'noFace' ? t('virtualTryOn.guide.noFace') : null
)

const guideVisible = ref(true)
let guideFadeTimer: ReturnType<typeof setTimeout> | null = null
watch(guideHint, (hint) => {
  if (hint === 'aligned') {
    if (guideFadeTimer) clearTimeout(guideFadeTimer)
    guideFadeTimer = setTimeout(() => {
      guideVisible.value = false
    }, 600)
    return
  }
  if (guideFadeTimer) {
    clearTimeout(guideFadeTimer)
    guideFadeTimer = null
  }
  guideVisible.value = true
})

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

const frameVisible = computed(() => {
  if (useFaceTracking.value && isActive.value) return hasFace.value
  return true
})

// Smoothing is shared with the production experience via the composable:
// One Euro filtering on anchor/scale, quaternion slerp on rotation, a snap
// reset when the face is (re)acquired, and a scale hold during blinks (the
// iris-driven scale signal is garbage for those few frames).
const { smoothedAnchor, smoothedEuler, smoothedScale } = useTryOnSmoothing({
  targetAnchor: effectiveLandmark,
  targetEuler: computed(() => faceRotation.value ?? manualRotation.value),
  targetScale: calibratedScale,
  isTracking: computed(() => useFaceTracking.value && hasFace.value),
  latencyMs: faceLatencyMs,
  holdScale: computed(() => isBlinking(faceLandmarks.value, mediaAspect.value || 1))
})

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

// Same face-mesh occluder wiring as VirtualTryOnExperience: shape from raw
// landmarks, placement from the smoothed transform. Null → ellipsoid.
const occluderMeshPositions = computed(() => {
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
    scale: smoothedScale.value,
    skinSetbackMeters: occluderSkinSetback.value,
    inflate: occluderMeshInflate.value,
    collarDepthMeters: occluderCollarDepth.value
  })
})

useRafFn(
  () => {
    const canvas = debugCanvasRef.value
    const stage = stageRef.value
    if (!isDebugMode.value || !canvas || !stage) return

    const rect = stage.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const landmarks = correctedFaceLandmarks.value
    if (landmarks.length > 0) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.6)'
      for (const lm of landmarks) {
        const x = (1 - lm.x) * canvas.width
        const y = lm.y * canvas.height
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }

      const anchor = correctedFaceAnchor.value
      if (anchor) {
        const ax = (1 - anchor.x) * canvas.width
        const ay = anchor.y * canvas.height
        ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'
        ctx.beginPath()
        ctx.arc(ax, ay, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(8, 8, 220, 158)
    ctx.fillStyle = '#fff'
    ctx.font = '11px monospace'
    ctx.textBaseline = 'top'
    const lines = [
      `faceWidth: ${correctedFaceWidth.value.toFixed(3)}`,
      `ipd: ${correctedIpd.value.toFixed(3)}`,
      `ear: ${getEyeAspectRatio(faceLandmarks.value, mediaAspect.value || 1).toFixed(3)} blink: ${isBlinking(faceLandmarks.value, mediaAspect.value || 1)}`,
      `scaleSource: ${scaleSource.value}`,
      `autoMetricScale: ${autoMetricScale.value.toFixed(3)}`,
      `effectiveScale: ${calibratedScale.value.toFixed(2)}`,
      `anchor: ${correctedFaceAnchor.value ? `${correctedFaceAnchor.value.x.toFixed(3)}, ${correctedFaceAnchor.value.y.toFixed(3)}` : 'none'}`,
      `pose: ${facePose.value ? `y:${facePose.value.euler.yaw.toFixed(2)} p:${facePose.value.euler.pitch.toFixed(2)} r:${facePose.value.euler.roll.toFixed(2)}` : 'none'}`,
      `calibration: ${selectedModel.value}`
    ]
    lines.forEach((line, i) => ctx.fillText(line, 14, 14 + i * 16))
  },
  { immediate: true }
)

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

const errorMessage = computed(() => {
  switch (error.value) {
    case 'denied':
      return t('virtualTryOn.denied.body')
    case 'unsupported':
      return t('virtualTryOn.noCamera.body')
    case 'unavailable':
      return t('virtualTryOn.noCamera.body')
    default:
      return null
  }
})

const faceErrorMessage = computed(() => {
  switch (faceError.value) {
    case 'unsupported':
      return t('virtualTryOn.noCamera.body')
    case 'load_failed':
      return t('virtualTryOn.denied.body')
    case 'runtime_failed':
      return t('virtualTryOn.denied.body')
    default:
      return null
  }
})

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
    contentName: selectedModel.value,
    customData: {
      model: selectedModel.value,
      ...extra
    }
  })
}

async function onConsent() {
  hasConsented.value = true
  hasReportedFaceDetected.value = false
  trackTryOn('TRY_ON_OPENED', { entryPoint: 'camera_consent' })
  await start()
}

onBeforeUnmount(() => {
  if (guideFadeTimer) clearTimeout(guideFadeTimer)
})

watch(isActive, (active) => {
  if (active) {
    trackTryOn('TRY_ON_CAMERA_GRANTED')
    useFaceTracking.value = true
    initFaceLandmarker().catch(() => {})
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

watch(noFace, (value) => {
  if (value && noFaceDetectedAt.value === null) {
    noFaceDetectedAt.value = performance.now()
  } else if (!value) {
    noFaceDetectedAt.value = null
  }
})

watch(selectedModel, (model) => {
  if (hasConsented.value) {
    trackTryOn('TRY_ON_FRAME_CHANGED', { model })
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Stage: mirrored <video> under a transparent TresJS canvas. Sized to
         dominate the layout like the Blackfin/Fittingbox reference — roughly
         square, capped by viewport height so it never scrolls away. -->
    <div
      ref="stageRef"
      data-testid="tryon-stage"
      class="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-stone-900 touch-none sm:max-w-xl lg:max-w-[min(44rem,75vh)]"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <!-- Layer 1: the camera feed, mirrored ONCE here. Always mounted so the
           webcam stream has an element to attach to; hidden until active. -->
      <video
        ref="videoRef"
        class="absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-500"
        :class="isActive ? 'opacity-100' : 'opacity-0'"
        style="transform: scaleX(-1)"
        playsinline
        muted
        autoplay
        aria-hidden="true"
        @loadedmetadata="onVideoLoadedMetadata"
      />

      <!-- Layer 2: transparent WebGL canvas, matched sizing + clamped DPR. -->
      <ClientOnly>
        <div ref="canvasWrapperRef" class="absolute inset-0 z-10 h-full w-full">
          <TresCanvas
            :alpha="true"
            :clear-alpha="0"
            :antialias="true"
            :dpr="[1, 2]"
            :tone-mapping="NeutralToneMapping"
            :tone-mapping-exposure="exposure"
            power-preference="high-performance"
            render-mode="always"
            class="absolute inset-0 h-full w-full"
          >
            <TryOnScene
              :src="modelSrc"
              :visible="frameVisible"
              :position="framePosition"
              :model-offset="calibration.translation"
              :scale="smoothedScale"
              :rotation="smoothedEuler"
              :occluder-enabled="occluderEnabled"
              :occluder-positions="
                occluderMeshEnabled ? occluderMeshPositions : null
              "
              :occluder-position="occluderPosition"
              :occluder-radius="occluderGeometry"
              :occluder-rotation="smoothedEuler"
              :occluder-debug-visible="occluderDebugVisible"
              :show-bounding-box="showModelBoundingBox"
            />
          </TresCanvas>
        </div>
      </ClientOnly>

      <!-- Layer 3: debug landmark overlay. -->
      <canvas
        v-if="isDebugMode"
        ref="debugCanvasRef"
        class="pointer-events-none absolute inset-0 z-30 h-full w-full"
      />

      <!-- Positioning guide (Blackfin/Fittingbox-style): corner-bracket
           rectangle; everything outside it is blurred + dimmed until a face
           is found, then the whole overlay fades once aligned. -->
      <div
        v-if="showGuideOverlay"
        class="pointer-events-none absolute inset-0 z-20 transition-opacity duration-500"
        :class="guideVisible ? 'opacity-100' : 'opacity-0'"
      >
        <!-- Blurred/dimmed surround, cut out around the guide rect. Shown
             only while no face is found (hint states keep the feed clear). -->
        <div
          class="absolute inset-0 transition-opacity duration-500"
          :class="guideHint === 'noFace' ? 'opacity-100' : 'opacity-0'"
        >
          <div class="absolute inset-x-0 top-0 h-[14%] bg-black/40 backdrop-blur-md" />
          <div class="absolute inset-x-0 bottom-0 h-[14%] bg-black/40 backdrop-blur-md" />
          <div class="absolute left-0 top-[14%] bottom-[14%] w-[22%] bg-black/40 backdrop-blur-md" />
          <div class="absolute right-0 top-[14%] bottom-[14%] w-[22%] bg-black/40 backdrop-blur-md" />
        </div>

        <!-- Corner brackets (borders, not SVG strokes, so thickness stays
             uniform under the stage's non-uniform aspect). -->
        <div
          class="absolute left-[22%] right-[22%] top-[14%] bottom-[14%] drop-shadow-md transition-opacity duration-300"
          :class="guideHint === 'aligned' ? 'opacity-95' : 'opacity-70'"
        >
          <span class="absolute left-0 top-0 h-10 w-10 rounded-tl-xl border-l-4 border-t-4 border-white" />
          <span class="absolute right-0 top-0 h-10 w-10 rounded-tr-xl border-r-4 border-t-4 border-white" />
          <span class="absolute bottom-0 left-0 h-10 w-10 rounded-bl-xl border-b-4 border-l-4 border-white" />
          <span class="absolute bottom-0 right-0 h-10 w-10 rounded-br-xl border-b-4 border-r-4 border-white" />
        </div>

        <p
          v-if="guideHintText"
          class="absolute inset-x-3 bottom-[4%] text-center text-xs font-light tracking-wide text-white drop-shadow"
        >
          {{ guideHintText }}
        </p>
      </div>

      <!-- Consent / idle / error states -------------------------------------->
      <div
        v-if="!isActive"
        class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/50 px-6 text-center backdrop-blur-sm"
      >
        <template v-if="!hasConsented && !error">
          <UIcon
            name="i-heroicons-video-camera"
            class="h-10 w-10 text-white/90"
          />
          <div class="space-y-2">
            <h3
              class="text-sm font-semibold uppercase tracking-wide text-white"
            >
              {{ t('virtualTryOn.consent.title') }}
            </h3>
            <p class="text-xs font-light leading-5 text-white/90">
              {{ t('virtualTryOn.consent.subtitle') }}
            </p>
          </div>
          <ul class="text-left text-xs font-light leading-5 text-white/80">
            <li class="flex items-center gap-2">
              <UIcon name="i-heroicons-check" class="h-3 w-3" />
              {{ t('virtualTryOn.consent.cameraUse') }}
            </li>
            <li class="flex items-center gap-2">
              <UIcon name="i-heroicons-check" class="h-3 w-3" />
              {{ t('virtualTryOn.consent.privacy') }}
            </li>
            <li class="flex items-center gap-2">
              <UIcon name="i-heroicons-check" class="h-3 w-3" />
              {{ t('virtualTryOn.consent.noStorage') }}
            </li>
            <li class="flex items-center gap-2">
              <UIcon name="i-heroicons-check" class="h-3 w-3" />
              {{ t('virtualTryOn.consent.localProcessing') }}
            </li>
          </ul>
          <UButton
            :loading="isStarting"
            color="neutral"
            variant="solid"
            size="sm"
            @click="onConsent"
          >
            {{ t('virtualTryOn.consent.cta') }}
          </UButton>
        </template>

        <template v-else>
          <UIcon
            name="i-heroicons-exclamation-triangle"
            class="h-8 w-8 text-white/90"
          />
          <p class="text-xs font-light tracking-wider text-white/90">
            {{ errorMessage ?? t('virtualTryOn.noCamera.body') }}
          </p>
          <UButton
            :loading="isStarting"
            color="neutral"
            variant="solid"
            size="sm"
            @click="start"
          >
            {{
              error
                ? t('virtualTryOn.retryCamera')
                : t('virtualTryOn.startCamera')
            }}
          </UButton>
        </template>
      </div>

      <!-- No-face / low-confidence states for face tracking. -->
      <div
        v-if="isActive && useFaceTracking && isFaceReady && showNoFaceMessage"
        class="absolute inset-x-3 top-3 z-20"
      >
        <UBadge
          color="warning"
          variant="solid"
          size="sm"
          class="w-full justify-center"
        >
          {{ t('virtualTryOn.noFace') }}
        </UBadge>
      </div>

      <div class="pointer-events-none absolute bottom-3 right-3 z-20">
        <UBadge color="neutral" variant="soft" size="sm">
          {{ t('virtualTryOn.prototypeBadge') }}
        </UBadge>
      </div>
    </div>

    <!-- Controls ------------------------------------------------------------->
    <div class="flex w-full flex-col gap-5 lg:max-w-xs">
      <div v-if="isActive" class="flex justify-end">
        <UButton
          icon="i-heroicons-stop"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="stop"
        >
          {{ t('virtualTryOn.stopCamera') }}
        </UButton>
      </div>

      <UFormField :label="t('virtualTryOn.frame')" size="xs">
        <USelect
          v-model="selectedModel"
          :items="models.map((m) => ({ label: m.label, value: m.file }))"
          class="w-full"
        />
      </UFormField>

      <div class="flex flex-col gap-2">
        <USwitch
          v-model="useFaceTracking"
          :label="t('virtualTryOn.trackMyFace')"
          size="sm"
          :disabled="!isActive || isFaceLoading"
          @update:model-value="(v) => v && initFaceLandmarker()"
        />
        <UAlert
          v-if="faceErrorMessage"
          icon="i-heroicons-exclamation-triangle"
          color="error"
          variant="soft"
          :description="faceErrorMessage"
          :ui="{ description: 'text-xs' }"
        />
        <UBadge
          v-else-if="useFaceTracking && isFaceReady && !hasFace"
          color="warning"
          variant="soft"
          size="sm"
          class="justify-center"
        >
          {{ t('virtualTryOn.noFace') }}
        </UBadge>
        <p
          v-else-if="useFaceTracking && isFaceReady && hasFace"
          class="text-xs font-light text-stone-500"
        >
          {{
            confidence >= 0.6
              ? t('virtualTryOn.faceDetected')
              : t('virtualTryOn.trackingConfidence')
          }}
        </p>
      </div>

      <UFormField
        :label="`${t('virtualTryOn.exposure')} · ${exposure.toFixed(2)}`"
        size="xs"
      >
        <USlider v-model="exposure" :min="0.4" :max="1.8" :step="0.05" />
      </UFormField>

      <UFormField
        :label="`${t('virtualTryOn.frameScale')} · ${fineTuneScale.toFixed(2)}`"
        size="xs"
      >
        <USlider v-model="fineTuneScale" :min="0.5" :max="1.5" :step="0.02" />
      </UFormField>

      <UFormField
        :label="`${t('virtualTryOn.frameYaw')} · ${rotationDeg}°`"
        size="xs"
      >
        <USlider
          v-model="rotationDeg"
          :min="-90"
          :max="90"
          :step="1"
          :disabled="!!faceRotation"
        />
      </UFormField>

      <!-- Debug tuning controls ------------------------------------------------ -->
      <template v-if="isDebugMode">
        <USeparator />

        <USwitch
          v-model="enableAutoScale"
          label="Auto-scale from face width"
          size="sm"
        />

        <UFormField
          :label="`Reference face width · ${referenceFaceWidth.toFixed(3)}`"
          size="xs"
        >
          <USlider
            v-model="referenceFaceWidth"
            :min="0.1"
            :max="0.6"
            :step="0.01"
          />
        </UFormField>

        <UFormField
          :label="`Debug Y offset · ${debugYOffset.toFixed(3)}`"
          size="xs"
        >
          <USlider
            v-model="debugYOffset"
            :min="-0.3"
            :max="0.3"
            :step="0.005"
          />
        </UFormField>

        <UFormField
          :label="`Debug Z offset · ${debugZOffset.toFixed(3)}`"
          size="xs"
        >
          <USlider v-model="debugZOffset" :min="-0.5" :max="0.5" :step="0.01" />
        </UFormField>

        <UFormField
          :label="`Debug scale boost · ${debugScaleBoost.toFixed(2)}`"
          size="xs"
        >
          <USlider v-model="debugScaleBoost" :min="0.5" :max="2" :step="0.05" />
        </UFormField>

        <USeparator label="Head occluder" />

        <USwitch v-model="occluderEnabled" label="Occluder enabled" size="sm" />

        <USwitch
          v-model="occluderDebugVisible"
          label="Show occluder (red)"
          size="sm"
        />

        <USwitch
          v-model="showModelBoundingBox"
          label="Show model bounding box"
          size="sm"
        />

        <USwitch
          v-model="occluderMeshEnabled"
          label="Face-mesh occluder (falls back to ellipsoid when off)"
          size="sm"
        />

        <UFormField
          :label="`Skin setback · ${(occluderSkinSetback * 1000).toFixed(1)}mm`"
          size="xs"
        >
          <USlider
            v-model="occluderSkinSetback"
            :min="0"
            :max="0.01"
            :step="0.0005"
          />
        </UFormField>

        <UFormField
          :label="`Mesh inflate · ${occluderMeshInflate.toFixed(2)}`"
          size="xs"
        >
          <USlider
            v-model="occluderMeshInflate"
            :min="1"
            :max="1.15"
            :step="0.01"
          />
        </UFormField>

        <UFormField
          :label="`Collar depth · ${(occluderCollarDepth * 1000).toFixed(0)}mm`"
          size="xs"
        >
          <USlider
            v-model="occluderCollarDepth"
            :min="0.06"
            :max="0.25"
            :step="0.005"
          />
        </UFormField>

        <UFormField
          :label="`Occluder width ratio · ${occluderWidthRatio.toFixed(2)}`"
          size="xs"
        >
          <USlider
            v-model="occluderWidthRatio"
            :min="0.5"
            :max="1.5"
            :step="0.05"
          />
        </UFormField>

        <UFormField
          :label="`Occluder height ratio · ${occluderHeightRatio.toFixed(2)}`"
          size="xs"
        >
          <USlider
            v-model="occluderHeightRatio"
            :min="0.8"
            :max="2"
            :step="0.05"
          />
        </UFormField>

        <UFormField
          :label="`Occluder depth ratio · ${occluderDepthRatio.toFixed(2)}`"
          size="xs"
        >
          <USlider
            v-model="occluderDepthRatio"
            :min="0.5"
            :max="2"
            :step="0.05"
          />
        </UFormField>
      </template>

      <UAlert
        icon="i-heroicons-exclamation-triangle"
        color="warning"
        variant="soft"
        :title="t('virtualTryOn.prototypeBadge')"
        description="GLBs are ~5.8 MB each — fine to eyeball, untenable to download per session alongside a MediaPipe WASM graph. Compression/decimation is a prerequisite for production use."
        :ui="{ description: 'text-xs' }"
      />
    </div>
  </div>
</template>
