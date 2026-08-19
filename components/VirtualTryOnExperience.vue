<script setup lang="ts">
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
  ASSUMED_FRAME_HALF_DEPTH_METERS,
  ASSUMED_FACE_WIDTH_METERS,
  ASSUMED_IPD_METERS,
  ASSUMED_EAR_WIDTH_METERS,
  type NormalizedLandmark
} from '../utils/tryon'
import { faceEulerToThree } from '../utils/tryon-pose'
import { useWebcamStream } from '../composables/tryon/useWebcamStream'
import { useFaceLandmarker } from '../composables/tryon/useFaceLandmarker'
import { useFrameCalibration } from '../composables/tryon/useFrameCalibration'
import {
  getTryOnModel,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'
import { useTryOnSmoothing } from '../composables/tryon/useTryOnSmoothing'

const props = withDefaults(
  defineProps<{
    models: TryOnModel[]
    calibrationUrl: string
    modelBaseUrl?: string
    initialModel?: string
    simplifiedControls?: boolean
  }>(),
  {
    modelBaseUrl: '/models',
    simplifiedControls: true
  }
)

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
}>()

const route = useRoute()
const { t } = useI18n()
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

const { videoRef, isActive, isStarting, error, start, stop } = useWebcamStream()
const prefersReducedMotion = usePreferredReducedMotion()

const stageRef = ref<HTMLElement | null>(null)
const { width: stageWidth, height: stageHeight } = useElementSize(stageRef)

const viewfinderLocked = isActive

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
const exposure = ref(1)
const fineTuneScale = ref(1)
const referenceFaceWidth = ref(0.32)
// The calibration translation now y-centers each model's bbox on the anchor
// landmark, which is where the lens line naturally sits — the old -0.08
// world-unit drop predates that recentring and would double-lower the frame.
const DEFAULT_ANCHOR_Y_OFFSET = 0
const debugYOffset = ref(0)
const debugZOffset = ref(0)
const debugScaleBoost = ref(1)
const debugTempleBoost = ref(1)
const rotationDeg = ref(0)
const rotationY = computed(() => (rotationDeg.value * Math.PI) / 180)
const mirrorLandmarks = true
const useFaceTracking = ref(true)
const noFaceDetectedAt = ref<number | null>(null)
const occluderEnabled = ref(true)

// Normalized inter-pupillary distance from the iris landmarks — IPD varies
// far less between people than cheek-to-cheek width, which is why eyewear
// sizing is built on it.
const correctedIpd = computed(() =>
  getInterPupillaryDistance(correctedFaceLandmarks.value)
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

const heuristicScaleSource = computed<'ear' | 'ipd' | 'width' | 'manual'>(
  () => {
    if (!hasFace.value) return 'manual'
    if (correctedEarWidth.value > 0) return 'ear'
    return correctedIpd.value > 0 ? 'ipd' : 'width'
  }
)

// GLBs are authored in metres — derive scale metrically from the tracked
// ear-width (preferred: the best available proxy for temple reach), falling
// back to IPD, then cheek-to-cheek width, and to the static reference width
// in pointer/idle mode. This heuristic chain is also the fallback used
// whenever the matrix-derived pose scale below isn't available yet.
const heuristicMetricScale = computed(() => {
  if (heuristicScaleSource.value === 'ear') {
    return computeMetricScaleFromMeasure(
      aspect.value,
      poseCompensated(correctedEarWidth.value),
      ASSUMED_EAR_WIDTH_METERS
    )
  }
  if (heuristicScaleSource.value === 'ipd') {
    return computeMetricScaleFromMeasure(
      aspect.value,
      poseCompensated(correctedIpd.value),
      ASSUMED_IPD_METERS
    )
  }
  if (heuristicScaleSource.value === 'width' && correctedFaceWidth.value > 0) {
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
  isReady: isFaceReady,
  error: faceError,
  hasFace,
  noFace,
  confidence,
  landmarks: faceLandmarks,
  pose: facePose,
  anchor: faceAnchor,
  init: initFaceLandmarker
} = useFaceLandmarker(videoRef)

// MediaPipe's transformation matrix scale is solved (Procrustes-style) over
// the entire canonical face shape rather than a single 2D landmark pair, and
// is already pose-aware by construction — no separate foreshortening
// correction needed. Rather than reverse-engineering MediaPipe's internal
// metric-space convention, calibrate its scale once against the app's own
// already-validated heuristic scale on the first confidently-tracked frame,
// then trust the matrix's frame-to-frame relative changes afterward. The
// ratio is frozen (not recomputed on tracking reacquisition) since it
// reflects this face's proportions relative to MediaPipe's canonical model,
// not something that should drift session to session.
const poseScaleCalibrationRatio = ref<number | null>(null)

watch(
  [hasFace, facePose, heuristicMetricScale],
  ([faceDetected, pose, heuristicScale]) => {
    if (
      poseScaleCalibrationRatio.value !== null ||
      !faceDetected ||
      !pose ||
      pose.scale <= 0 ||
      heuristicScale <= 0
    )
      return
    poseScaleCalibrationRatio.value = heuristicScale / pose.scale
  }
)

const scaleSource = computed<'pose' | 'ear' | 'ipd' | 'width' | 'manual'>(
  () => {
    if (!hasFace.value) return 'manual'
    if (facePose.value && poseScaleCalibrationRatio.value !== null)
      return 'pose'
    return heuristicScaleSource.value
  }
)

const autoMetricScale = computed(() => {
  if (
    scaleSource.value === 'pose' &&
    facePose.value &&
    poseScaleCalibrationRatio.value !== null
  ) {
    return facePose.value.scale * poseScaleCalibrationRatio.value
  }
  return heuristicMetricScale.value
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
const correctedEarWidth = computed(() =>
  getEarWidth(correctedFaceLandmarks.value)
)

const templeScaleBoost = computed(
  () => calibration.value.templeWidthBoost * debugTempleBoost.value
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
  // Iris landmarks drift while the eyelid covers the iris — freeze scale
  // for the blink instead of letting the frame visibly change size.
  holdScale: computed(() =>
    isBlinking(faceLandmarks.value, mediaAspect.value || 1)
  )
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

const showNoFaceMessage = computed(() => {
  if (!noFace.value || noFaceDetectedAt.value === null) return false
  return performance.now() - noFaceDetectedAt.value > 2500
})

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

async function onConsent() {
  hasConsented.value = true
  hasReportedFaceDetected.value = false
  trackTryOn('TRY_ON_OPENED', { entryPoint: 'camera_consent' })
  await start()
}

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

watch(noFace, (value) => {
  if (value && noFaceDetectedAt.value === null) {
    noFaceDetectedAt.value = performance.now()
  } else if (!value) {
    noFaceDetectedAt.value = null
  }
})

watch(model, (value) => {
  if (hasConsented.value) {
    trackTryOn('TRY_ON_FRAME_CHANGED', { model: value })
  }
})
</script>

<template>
  <div>
    <div class="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
      <!-- Stage -->
      <div
        ref="stageRef"
        class="relative aspect-3/4 w-full flex-1 overflow-hidden rounded-sm bg-stone-900 ring-1 ring-stone-950/10 touch-none"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
      >
        <!-- Always mounted so the webcam stream has an element to attach to;
             hidden until the stream is active. -->
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

        <ClientOnly>
          <div class="absolute inset-0 z-10 h-full w-full">
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
              class="absolute inset-0 h-full w-full"
            >
              <TryOnScene
                :src="modelSrc"
                :visible="frameVisible"
                :position="framePosition"
                :model-offset="calibration.translation"
                :scale="smoothedScale"
                :scale-x-boost="templeScaleBoost"
                :rotation="smoothedEuler"
                :occluder-enabled="occluderEnabled"
                :occluder-position="occluderPosition"
                :occluder-radius="occluderGeometry"
                :occluder-rotation="smoothedEuler"
              />
            </TresCanvas>
          </div>
        </ClientOnly>

        <!-- Viewfinder focus-lock brackets -->
        <div
          class="pointer-events-none absolute z-10 h-4 w-4 border-white/90 transition-all duration-500 ease-out motion-reduce:transition-none"
          :class="
            viewfinderLocked
              ? 'top-2 left-2 border-t border-l opacity-90'
              : 'top-6 left-6 border-t border-l opacity-40'
          "
          aria-hidden="true"
        />
        <div
          class="pointer-events-none absolute z-10 h-4 w-4 border-white/90 transition-all duration-500 ease-out motion-reduce:transition-none"
          :class="
            viewfinderLocked
              ? 'top-2 right-2 border-t border-r opacity-90'
              : 'top-6 right-6 border-t border-r opacity-40'
          "
          aria-hidden="true"
        />
        <div
          class="pointer-events-none absolute z-10 h-4 w-4 border-white/90 transition-all duration-500 ease-out motion-reduce:transition-none"
          :class="
            viewfinderLocked
              ? 'bottom-2 left-2 border-b border-l opacity-90'
              : 'bottom-6 left-6 border-b border-l opacity-40'
          "
          aria-hidden="true"
        />
        <div
          class="pointer-events-none absolute z-10 h-4 w-4 border-white/90 transition-all duration-500 ease-out motion-reduce:transition-none"
          :class="
            viewfinderLocked
              ? 'bottom-2 right-2 border-b border-r opacity-90'
              : 'bottom-6 right-6 border-b border-r opacity-40'
          "
          aria-hidden="true"
        />

        <!-- Consent / idle / error states -->
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

        <div
          v-if="faceErrorMessage || (useFaceTracking && isFaceReady)"
          class="absolute inset-x-3 bottom-3 z-20"
        >
          <UAlert
            v-if="faceErrorMessage"
            icon="i-heroicons-exclamation-triangle"
            color="error"
            variant="solid"
            :description="faceErrorMessage"
            :ui="{ description: 'text-xs' }"
          />
          <UBadge
            v-else-if="!hasFace"
            color="warning"
            variant="solid"
            size="sm"
            class="w-full justify-center"
          >
            {{ t('virtualTryOn.noFace') }}
          </UBadge>
          <p
            v-else
            class="w-full rounded-sm bg-black/40 px-2 py-1 text-center text-xs font-light text-white/90 backdrop-blur-sm"
          >
            {{
              confidence >= 0.6
                ? t('virtualTryOn.faceDetected')
                : t('virtualTryOn.trackingConfidence')
            }}
          </p>
        </div>

        <UButton
          v-if="isActive"
          icon="i-heroicons-stop-circle"
          color="neutral"
          variant="solid"
          size="md"
          square
          class="absolute top-4 right-4 z-20 rounded-full shadow-lg"
          :aria-label="t('virtualTryOn.stopCamera')"
          @click="stop"
        />
      </div>

      <!-- Controls -->
      <div
        v-if="!simplifiedControls"
        class="flex w-full flex-col gap-5 lg:w-56 lg:shrink-0"
      >
        <div class="flex flex-col gap-5">
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
            <USlider
              v-model="fineTuneScale"
              :min="0.5"
              :max="1.5"
              :step="0.02"
            />
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

          <UFormField
            :label="`${t('virtualTryOn.templeWidth')} · ${debugTempleBoost.toFixed(2)}`"
            size="xs"
          >
            <USlider
              v-model="debugTempleBoost"
              :min="0.8"
              :max="1.3"
              :step="0.01"
            />
          </UFormField>
        </div>
      </div>
    </div>
  </div>
</template>
