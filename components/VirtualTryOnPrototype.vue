<script setup lang="ts">
import { computed, ref } from 'vue'
import { ACESFilmicToneMapping, Euler, Vector3 } from 'three'
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
  oneEuroFilter,
  ASSUMED_FRAME_HALF_DEPTH_METERS,
  ASSUMED_FACE_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  type NormalizedLandmark,
  type OneEuroState
} from '../utils/tryon'
import { faceEulerToThree } from '../utils/tryon-pose'
import { useWebcamStream } from '../composables/tryon/useWebcamStream'
import { useFaceLandmarker } from '../composables/tryon/useFaceLandmarker'
import { useFrameCalibration } from '../composables/tryon/useFrameCalibration'
import {
  getTryOnModel,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'

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
const mode = ref<'camera' | 'image' | null>(null)
const uploadedImage = ref<HTMLImageElement | null>(null)
const imageObjectUrl = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const hasReportedFaceDetected = ref(false)

const { videoRef, isActive, isStarting, error, start, stop } = useWebcamStream()
const prefersReducedMotion = usePreferredReducedMotion()

const stageRef = ref<HTMLElement | null>(null)
const canvasWrapperRef = ref<HTMLElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
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
const modelBaseUrl = computed(() => props.modelBaseUrl ?? '/models')
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

function poseCompensated(measure: number): number {
  if (!facePose.value) return measure
  return compensateMeasureForPose(
    measure,
    facePose.value.euler.yaw,
    facePose.value.euler.pitch
  )
}

const scaleSource = computed<'ipd' | 'width' | 'manual'>(() => {
  if (!enableAutoScale.value || !hasFace.value) return 'manual'
  return correctedIpd.value > 0 ? 'ipd' : 'width'
})

const autoMetricScale = computed(() => {
  if (scaleSource.value === 'ipd') {
    return computeMetricScaleFromMeasure(
      aspect.value,
      poseCompensated(correctedIpd.value),
      ASSUMED_IPD_METERS
    )
  }
  if (scaleSource.value === 'width' && correctedFaceWidth.value > 0) {
    return computeMetricScaleFromMeasure(
      aspect.value,
      poseCompensated(correctedFaceWidth.value),
      ASSUMED_FACE_WIDTH_METERS
    )
  }
  return computeMetricBaseScale(aspect.value, referenceFaceWidth.value)
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

const faceWorldHalfWidth = computed(() => {
  const width =
    enableAutoScale.value && correctedFaceWidth.value
      ? correctedFaceWidth.value
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
  const frameHalfDepth = ASSUMED_FRAME_HALF_DEPTH_METERS * smoothedScale.value
  const rot = smoothedEuler.value
  const back = new Vector3(
    0,
    0,
    -(frameHalfDepth + occluderGeometry.value.radiusZ)
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
  if ((!useFaceTracking.value && mode.value !== 'image') || !facePose.value)
    return null
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
  init: initFaceLandmarker,
  detectOnImage
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

const GUIDE_IPD_MIN = 0.11
const GUIDE_IPD_MAX = 0.19
const FACE_WIDTH_TO_IPD_RATIO = ASSUMED_FACE_WIDTH_METERS / ASSUMED_IPD_METERS

type GuideHint = 'noFace' | 'tooFar' | 'tooClose' | 'aligned'

const guideMeasure = computed(() => {
  if (scaleSource.value === 'ipd') return poseCompensated(correctedIpd.value)
  if (scaleSource.value === 'width' && correctedFaceWidth.value > 0) {
    return poseCompensated(correctedFaceWidth.value) / FACE_WIDTH_TO_IPD_RATIO
  }
  return 0
})

const showGuideOverlay = computed(
  () =>
    (isActive.value || mode.value === 'image') &&
    (useFaceTracking.value || mode.value === 'image')
)

const guideHint = computed<GuideHint>(() => {
  if (!hasFace.value || !correctedFaceAnchor.value) return 'noFace'
  const measure = guideMeasure.value
  if (measure > 0 && measure < GUIDE_IPD_MIN) return 'tooFar'
  if (measure > 0 && measure > GUIDE_IPD_MAX) return 'tooClose'
  return 'aligned'
})

const guideHintText = computed(() => {
  switch (guideHint.value) {
    case 'noFace':
      return t('virtualTryOn.guide.noFace')
    case 'tooFar':
      return t('virtualTryOn.guide.tooFar')
    case 'tooClose':
      return t('virtualTryOn.guide.tooClose')
    default:
      return null
  }
})

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
  if (
    (useFaceTracking.value || mode.value === 'image') &&
    hasFace.value &&
    correctedFaceAnchor.value
  ) {
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
  if (useFaceTracking.value && mode.value === 'camera') return hasFace.value
  return true
})

const POSE_FILTER = { minCutoff: 0.8, beta: 0.7 }
const EULER_FILTER = { minCutoff: 0.6, beta: 0.6 }
const SCALE_FILTER = { minCutoff: 0.6, beta: 1.2 }

const smoothedAnchor = ref<NormalizedLandmark>({ ...effectiveLandmark.value })
const smoothedEuler = ref({ x: 0, y: 0, z: 0 })
const smoothedScale = ref(calibratedScale.value)

let anchorXState: OneEuroState | null = null
let anchorYState: OneEuroState | null = null
let eulerXState: OneEuroState | null = null
let eulerYState: OneEuroState | null = null
let eulerZState: OneEuroState | null = null
let scaleState: OneEuroState | null = null
let wasTracking = useFaceTracking.value && hasFace.value

useRafFn(
  ({ delta }) => {
    const targetAnchor = effectiveLandmark.value
    const targetEuler = faceRotation.value ?? manualRotation.value
    const targetScale = calibratedScale.value
    const dtSeconds = delta / 1000

    if (useFaceTracking.value && hasFace.value && !wasTracking) {
      anchorXState = null
      anchorYState = null
      eulerXState = null
      eulerYState = null
      eulerZState = null
      scaleState = null
    }
    wasTracking = useFaceTracking.value && hasFace.value

    anchorXState = oneEuroFilter(
      anchorXState,
      targetAnchor.x,
      dtSeconds,
      POSE_FILTER
    )
    anchorYState = oneEuroFilter(
      anchorYState,
      targetAnchor.y,
      dtSeconds,
      POSE_FILTER
    )
    eulerXState = oneEuroFilter(
      eulerXState,
      targetEuler.x,
      dtSeconds,
      EULER_FILTER
    )
    eulerYState = oneEuroFilter(
      eulerYState,
      targetEuler.y,
      dtSeconds,
      EULER_FILTER
    )
    eulerZState = oneEuroFilter(
      eulerZState,
      targetEuler.z,
      dtSeconds,
      EULER_FILTER
    )
    scaleState = oneEuroFilter(scaleState, targetScale, dtSeconds, SCALE_FILTER)

    smoothedAnchor.value = { x: anchorXState.value, y: anchorYState.value }
    smoothedEuler.value = {
      x: eulerXState.value,
      y: eulerYState.value,
      z: eulerZState.value
    }
    smoothedScale.value = scaleState.value
  },
  { immediate: true }
)

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
    ctx.fillRect(8, 8, 220, 142)
    ctx.fillStyle = '#fff'
    ctx.font = '11px monospace'
    ctx.textBaseline = 'top'
    const lines = [
      `faceWidth: ${correctedFaceWidth.value.toFixed(3)}`,
      `ipd: ${correctedIpd.value.toFixed(3)}`,
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
    | 'TRY_ON_UPLOAD_USED'
    | 'TRY_ON_FACE_DETECTED'
    | 'TRY_ON_FRAME_CHANGED'
    | 'TRY_ON_ERROR',
  extra: Record<string, unknown> = {}
) {
  emit('track', event, {
    contentType: 'product',
    contentName: selectedModel.value,
    customData: {
      mode: mode.value,
      model: selectedModel.value,
      ...extra
    }
  })
}

async function onConsent() {
  hasConsented.value = true
  mode.value = 'camera'
  hasReportedFaceDetected.value = false
  trackTryOn('TRY_ON_OPENED', { entryPoint: 'camera_consent' })
  await start()
}

function onUploadClick() {
  fileInputRef.value?.click()
}

function resetImage() {
  if (imageObjectUrl.value) {
    URL.revokeObjectURL(imageObjectUrl.value)
  }
  uploadedImage.value = null
  imageObjectUrl.value = null
  mode.value = null
  hasConsented.value = false
  mediaAspect.value = 0
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  stop()
  resetImage()

  const url = URL.createObjectURL(file)
  imageObjectUrl.value = url
  mode.value = 'image'
  hasConsented.value = true
  hasReportedFaceDetected.value = false
  trackTryOn('TRY_ON_UPLOAD_USED')

  const img = new Image()
  img.src = url
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load uploaded image'))
  })
  uploadedImage.value = img
  mediaAspect.value = img.naturalWidth / img.naturalHeight

  await initFaceLandmarker()
  detectOnImage(img)
}

async function switchToCamera() {
  resetImage()
  mode.value = 'camera'
  hasConsented.value = true
  hasReportedFaceDetected.value = false
  await start()
}

onBeforeUnmount(() => {
  if (imageObjectUrl.value) {
    URL.revokeObjectURL(imageObjectUrl.value)
  }
  if (guideFadeTimer) clearTimeout(guideFadeTimer)
})

watch(isActive, (active) => {
  if (active && mode.value === 'camera') {
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
      mode: mode.value,
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
  if (mode.value) {
    trackTryOn('TRY_ON_FRAME_CHANGED', { model })
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Stage: mirrored <video> under a transparent TresJS canvas ---------- -->
    <div
      ref="stageRef"
      class="relative mx-auto aspect-3/4 w-full max-w-sm overflow-hidden rounded-2xl bg-stone-900 touch-none"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <!-- Layer 1: the camera feed or uploaded photo, mirrored ONCE here. -->
      <video
        v-if="mode === 'camera'"
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
      <img
        v-else-if="mode === 'image' && imageObjectUrl"
        ref="imageRef"
        :src="imageObjectUrl"
        class="absolute inset-0 z-0 h-full w-full object-cover"
        style="transform: scaleX(-1)"
        alt=""
        aria-hidden="true"
      />

      <!-- Layer 2: transparent WebGL canvas, matched sizing + clamped DPR. -->
      <ClientOnly>
        <div ref="canvasWrapperRef" class="absolute inset-0 z-10 h-full w-full">
          <TresCanvas
            :alpha="true"
            :clear-alpha="0"
            :antialias="true"
            :dpr="[1, 2]"
            :tone-mapping="ACESFilmicToneMapping"
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

      <!-- Positioning guide -->
      <div
        v-if="showGuideOverlay"
        class="pointer-events-none absolute inset-0 z-20 transition-opacity duration-500"
        :class="guideVisible ? 'opacity-100' : 'opacity-0'"
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          class="h-full w-full"
        >
          <ellipse
            cx="50"
            cy="42"
            rx="23"
            ry="30"
            fill="none"
            stroke="white"
            stroke-width="0.6"
            stroke-dasharray="3 2"
            :opacity="guideHint === 'aligned' ? 0.9 : 0.55"
          />
        </svg>
        <p
          v-if="guideHintText"
          class="absolute inset-x-3 bottom-16 text-center text-xs font-light tracking-wide text-white drop-shadow"
        >
          {{ guideHintText }}
        </p>
      </div>

      <!-- Consent / idle / error states -------------------------------------->
      <div
        v-if="!isActive && mode !== 'image'"
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
          <div class="flex flex-col gap-2">
            <UButton
              :loading="isStarting"
              color="neutral"
              variant="solid"
              size="sm"
              @click="onConsent"
            >
              {{ t('virtualTryOn.consent.cta') }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              @click="onUploadClick"
            >
              {{ t('virtualTryOn.consent.uploadFallback') }}
            </UButton>
          </div>
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
        v-if="
          (isActive || mode === 'image') &&
          (useFaceTracking || mode === 'image') &&
          isFaceReady &&
          showNoFaceMessage
        "
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
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        @change="onFileSelected"
      />
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

      <div v-else-if="mode === 'image'" class="flex justify-between gap-2">
        <UButton
          icon="i-heroicons-arrow-path"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="onUploadClick"
        >
          {{ t('virtualTryOn.upload.changePhoto') }}
        </UButton>
        <UButton
          icon="i-heroicons-video-camera"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="switchToCamera"
        >
          {{ t('virtualTryOn.upload.useCamera') }}
        </UButton>
      </div>

      <UFormField :label="t('virtualTryOn.frame')" size="xs">
        <USelect
          v-model="selectedModel"
          :items="models.map((m) => ({ label: m.label, value: m.file }))"
          class="w-full"
        />
      </UFormField>

      <div v-if="mode !== 'image'" class="flex flex-col gap-2">
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
