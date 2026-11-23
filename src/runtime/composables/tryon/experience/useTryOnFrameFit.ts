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
  model: Ref<string | undefined>
  calibration: Ref<TryOnFrameCalibration>
  getCalibration: (file: string) => TryOnFrameCalibration
  tracking: {
    landmarks: Ref<NormalizedLandmark[]>
    pose: Ref<FacePose | null>
    hasFace: Ref<boolean>
    frozen: Ref<boolean>
    unfreeze: () => Promise<void>
    cardCalibration: {
      calibration: Ref<TryOnCardCalibration>
      start: () => void
      cancel: () => void
    }
  }
  stage: { mediaAspect: Ref<number> }
  placement: {
    earWidth: Ref<number>
    ipd: Ref<number>
    poseCompensated: (measure: number) => number
    rulerPd: Ref<number>
    measurement: Ref<PdEstimate | null>
  }
  track: TryOnTrack
}

export function useTryOnFrameFit(options: UseTryOnFrameFitOptions) {
  const { props, model, calibration, tracking, placement, track } = options

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

  const { faceShape } = useTryOnFaceShape({
    landmarks: tracking.landmarks,
    pose: tracking.pose,
    mediaAspect: options.stage.mediaAspect
  })

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

  async function startCalibration() {
    if (tracking.frozen.value) await tracking.unfreeze()
    cardCalibration.start()
  }

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

  function frameWidthFor(file: string): number {
    const spec = getTryOnModel(props.models, file)?.frameWidthMm
    if (spec && spec > 0) return spec
    if (file === model.value && frameWidthMm.value > 0) return frameWidthMm.value
    return options.getCalibration(file).frameWidthMm
  }

  function fitFor(file: string): TryOnFit | null {
    const face = measuredFaceWidthMm.value
    const frame = frameWidthFor(file)
    if (face === null) return null
    const verdict = fitVerdictFor(frame, face, props.fitTolerance)
    return verdict ? { verdict, faceWidthMm: face, frameWidthMm: frame } : null
  }

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
    onModelLoaded(widthMeters: number) {
      glbWidthMeters.value = widthMeters
    },
    reset() {
      glbWidthMeters.value = 0
      fitState.reset()
    }
  }
}
