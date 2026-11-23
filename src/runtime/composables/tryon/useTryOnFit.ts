import { computed, ref, watch, type Ref } from 'vue'
import {
  FIT_MIN_SAMPLES,
  estimateFaceWidthMm,
  faceWidthVerdict,
  updateFaceWidthEstimate,
  type FaceWidthEstimate,
  type TryOnFit,
  type TryOnFitVerdict
} from '../../utils/tryon-fit'
import type { NormalizedLandmark } from '../../utils/tryon'

export interface UseTryOnFitOptions {
  landmarks: Ref<NormalizedLandmark[]>
  hasFace: Ref<boolean>
  earWidth: () => number
  ipd: () => number
  ipdMm?: () => number
  frameWidthMm: () => number
  tolerance: () => number
}

export function useTryOnFit(options: UseTryOnFitOptions) {
  const faceWidthEstimate = ref<FaceWidthEstimate | null>(null)
  const verdict = ref<TryOnFitVerdict | null>(null)

  watch(options.landmarks, () => {
    if (!options.hasFace.value) {
      faceWidthEstimate.value = null
      return
    }
    faceWidthEstimate.value = updateFaceWidthEstimate(
      faceWidthEstimate.value,
      estimateFaceWidthMm(options.earWidth(), options.ipd(), options.ipdMm?.())
    )
  })

  watch(
    [faceWidthEstimate, () => options.frameWidthMm(), () => options.tolerance()],
    ([estimate, frameWidth, tolerance]) => {
      verdict.value =
        estimate && estimate.samples >= FIT_MIN_SAMPLES
          ? faceWidthVerdict(estimate.mean, frameWidth, {
              tolerance,
              previous: verdict.value
            })
          : null
    }
  )

  const fit = computed<TryOnFit | null>(() =>
    verdict.value && faceWidthEstimate.value
      ? {
          verdict: verdict.value,
          faceWidthMm: faceWidthEstimate.value.mean,
          frameWidthMm: options.frameWidthMm()
        }
      : null
  )

  function reset() {
    verdict.value = null
  }

  return { fit, verdict, faceWidthEstimate, reset }
}
