import { computed, ref, watch, type Ref } from 'vue'
import { getTryOnModel, type TryOnModel } from '../useTryOnModels'
import { useTryOnFit } from '../useTryOnFit'
import { useTryOnFaceShape } from '../useTryOnFaceShape'
import type { TryOnCardCalibration } from '../useTryOnCardCalibration'
import {
  FIT_MIN_SAMPLES,
  fitVerdictFor,
  rankByFit,
  type TryOnFit,
  type TryOnFitRank
} from '../../../utils/tryon-fit'
import { pdConfidence, type PdEstimate } from '../../../utils/tryon-measure'
import type { NormalizedLandmark } from '../../../utils/tryon'
import type { FacePose } from '../../../utils/tryon-pose'
import type { TryOnFrameCalibration } from '../../../types/tryon-calibration'
import type { TryOnMeasurements } from '../../../types/tryon-experience'
import type { TryOnTrack } from './useTryOnTrackEvents'

export interface UseTryOnFrameFitOptions {
  props: { models: TryOnModel[]; fitTolerance: number }
  /** The selected frame (`v-model:model`). */
  model: Ref<string | undefined>
  /** Calibration of the selected frame (its scale: GLB units → metres). */
  calibration: Ref<TryOnFrameCalibration>
  /** Calibration of any catalog frame, for its manifest `frameWidthMm`. */
  getCalibration: (file: string) => TryOnFrameCalibration
  /** The held face and the card calibration (`useTryOnTracking`). */
  tracking: {
    landmarks: Ref<NormalizedLandmark[]>
    pose: Ref<FacePose | null>
    hasFace: Ref<boolean>
    cardCalibration: {
      calibration: Ref<TryOnCardCalibration>
      start: () => void
      cancel: () => void
    }
  }
  /** Camera frame aspect (`useTryOnStage`). */
  stage: { mediaAspect: Ref<number> }
  /** The face measures from the placement (`useTryOnPlacement`). */
  placement: {
    earWidth: Ref<number>
    ipd: Ref<number>
    poseCompensated: (measure: number) => number
    rulerPd: Ref<number>
    measurement: Ref<PdEstimate | null>
  }
  track: TryOnTrack
}

/**
 * The frame advisor's numbers for the tracked face: the selected frame's fit
 * verdict, the on-device measurements (PD, face width, face shape), the card
 * calibration's controls and its TRY_ON_CALIBRATED report, and the fit of
 * any catalog frame (`fitFor`, `fitRanking`). Call `onModelLoaded` with each
 * loaded GLB's width, and `reset()` when the model changes.
 */
export function useTryOnFrameFit(options: UseTryOnFrameFitOptions) {
  const { props, model, calibration, tracking, placement, track } = options

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
    landmarks: tracking.landmarks,
    hasFace: tracking.hasFace,
    earWidth: () => placement.poseCompensated(placement.earWidth.value),
    ipd: () => placement.poseCompensated(placement.ipd.value),
    ipdMm: () => placement.rulerPd.value,
    frameWidthMm: () => frameWidthMm.value,
    tolerance: () => props.fitTolerance
  })

  // Face shape (frame-advisor styling hint), from frontal detections.
  const { faceShape } = useTryOnFaceShape({
    landmarks: tracking.landmarks,
    pose: tracking.pose,
    mediaAspect: options.stage.mediaAspect
  })

  // On-device face measurements (frame advisor, issue #98): the measured PD
  // (distance PD, as an optician measures it), the face width the fit verdict
  // uses, and the face shape. Null while nothing is measured yet.
  const measuredFaceWidthMm = computed(() => {
    const estimate = fitState.faceWidthEstimate.value
    return estimate && estimate.samples >= FIT_MIN_SAMPLES ? estimate.mean : null
  })
  const measurements = computed<TryOnMeasurements | null>(() => {
    const pd = placement.measurement.value
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

  const { cardCalibration } = tracking

  /** Start a card calibration (see README); restarts one in progress. */
  function startCalibration() {
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
        track('TRY_ON_CALIBRATED', { pdMm: calibrationState.value.pdMm })
      } else if (status === 'failed') {
        track('TRY_ON_ERROR', {
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
    return options.getCalibration(file).frameWidthMm
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

  return {
    fit: fitState.fit,
    verdict: fitState.verdict,
    faceWidthEstimate: fitState.faceWidthEstimate,
    frameWidthMm,
    glbWidthMeters,
    faceShape,
    measurements,
    calibrationState,
    startCalibration,
    cancelCalibration,
    fitFor,
    fitRanking,
    /** The scene loaded the selected frame's GLB, `widthMeters` wide. */
    onModelLoaded(widthMeters: number) {
      glbWidthMeters.value = widthMeters
    },
    /** The model changed. The new frame has its own width: no verdict until its GLB has loaded. */
    reset() {
      glbWidthMeters.value = 0
      fitState.reset()
    }
  }
}
