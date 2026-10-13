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
  /** Raw landmarks: the face estimate updates on every detection result. */
  landmarks: Ref<NormalizedLandmark[]>
  hasFace: Ref<boolean>
  /** Pose-compensated ear-level width and IPD, normalized (see useTryOnPlacement). */
  earWidth: () => number
  ipd: () => number
  /** Total width of the selected frame, mm; 0 while unknown (GLB loading). */
  frameWidthMm: () => number
  /** Half-width of the good band (see `faceWidthVerdict`). */
  tolerance: () => number
}

/**
 * Fit verdict (issue #12): the selected frame's width against the tracked
 * face's width. The face width is a running average over detections, reset
 * when the face is lost (it may be a different person when it comes back);
 * the verdict appears after FIT_MIN_SAMPLES detections and has hysteresis.
 * Call `reset()` when the frame changes, so its verdict starts fresh.
 */
export function useTryOnFit(options: UseTryOnFitOptions) {
  const faceWidthEstimate = ref<FaceWidthEstimate | null>(null)
  const verdict = ref<TryOnFitVerdict | null>(null)

  // Every detection, not a derived width: equal widths in a row still count
  // toward FIT_MIN_SAMPLES.
  watch(options.landmarks, () => {
    if (!options.hasFace.value) {
      faceWidthEstimate.value = null
      return
    }
    faceWidthEstimate.value = updateFaceWidthEstimate(
      faceWidthEstimate.value,
      estimateFaceWidthMm(options.earWidth(), options.ipd())
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
