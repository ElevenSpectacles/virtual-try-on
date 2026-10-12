/**
 * Hair occlusion of the temple arms (issue #9). Pure math, no Vue or three.
 *
 * The face-mesh occluder hides the arms behind the face, but not behind hair
 * that hangs over them. A MediaPipe hair segmenter (its own worker, see
 * `useHairSegmenter`) gives a per-pixel hair confidence of the camera frame.
 * Where it says hair, the scene writes depth on a plane in head space
 * HAIR_PLANE_SETBACK_METERS behind the frame's front, so arm parts behind
 * that plane are not drawn and the live camera's hair shows in front of them.
 * Everything in front of the plane (lenses, rims, hinges and the start of
 * the arms) stays, so bangs never cover the frame front, which matches
 * reality: the frame sits in front of the fringe.
 *
 * A 2D mask can't tell hair hanging over an arm from hair the arm rests on.
 * Glasses usually sit on top of hair at the temple, and a vanishing arm looks
 * broken, so the feature is opt-in (`hair-occlusion` prop).
 */

/** Distance behind the frame's front plane (GLB metres) beyond which hair may cover the arms. */
export const HAIR_PLANE_SETBACK_METERS = 0.035

/** Side of the square head-space plane the hair is redrawn on (GLB metres). Covers both arms with margin. */
export const HAIR_PLANE_SIZE_METERS = 0.6

/** Minimum time between two segmentations. Hair moves slowly; ~10 Hz is plenty. */
export const HAIR_SEGMENT_INTERVAL_MS = 100

/**
 * Width of the segmenter's input frame (px). The hair model resizes to 512²
 * internally; the confidence it returns at this size is read back from the
 * GPU, and the mask is cut down to HAIR_MASK_WIDTH anyway.
 */
export const HAIR_INPUT_WIDTH = 192

/** Size of the mask sent back to the main thread. Bilinear sampling smooths its edges. */
export const HAIR_MASK_WIDTH = 96
export const HAIR_MASK_HEIGHT = 128

/**
 * EMA weight of a new mask. Each mask is a whole new estimate, so a single
 * noisy frame shouldn't make hair strands flicker over the arm.
 */
export const HAIR_MASK_SMOOTHING = 0.5

/**
 * Worker time per segmentation (EMA) above which hair occlusion switches
 * itself off for the session: under half of HAIR_SEGMENT_INTERVAL_MS, so the
 * segmenter keeps the GPU for less than half the time. The capability
 * step-down samples render-thread frames only, so it would never see a slow
 * segmenter in its own worker. Measured on a laptop: ~14 ms alone, ~24 ms
 * while the face tracker shares the GPU.
 */
export const HAIR_SEGMENT_BUDGET_MS = 40

/** EMA weight of each new segmentation time in the budget check. */
export const HAIR_TIMING_SMOOTHING = 0.2

/** Segmentations to average before the budget check can switch the feature off. */
export const HAIR_BUDGET_MIN_SAMPLES = 10

/**
 * First segmentations left out of the timing: the first one compiles shaders
 * and uploads the model to the GPU (~170–260 ms against ~14 ms after, on a
 * laptop), which would keep the average over budget long after.
 */
export const HAIR_TIMING_WARMUP = 3

/** Visible `object-fit: cover` window of the camera frame, raw-media normalized (see `objectCoverWindow`). */
export interface MediaWindow {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/**
 * Raw camera-frame coordinates (0…1, top-left origin, unmirrored) of a
 * screen point (0…1, top-left origin) on the mirrored, cover-cropped preview.
 * The leftmost screen column shows the rightmost visible camera column (the
 * `<video>` is mirrored), so x runs backwards. Mirrors the hair-layer shader
 * in TryOnScene.vue.
 */
export function screenToMedia(
  sx: number,
  sy: number,
  window: MediaWindow
): { x: number; y: number } {
  return {
    x: window.xMin + (1 - sx) * (window.xMax - window.xMin),
    y: window.yMin + sy * (window.yMax - window.yMin)
  }
}

/**
 * Box-average a single-channel confidence mask (`width * height` floats,
 * 0…1, row-major from the top) down to `outWidth * outHeight` bytes (0…255).
 */
export function downsampleConfidence(
  confidence: ArrayLike<number>,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number
): Uint8Array {
  const out = new Uint8Array(outWidth * outHeight)
  if (width <= 0 || height <= 0) return out
  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = Math.floor((oy * height) / outHeight)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outHeight))
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = Math.floor((ox * width) / outWidth)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outWidth))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          sum += confidence[y * width + x] ?? 0
          count++
        }
      }
      const mean = count ? sum / count : 0
      out[oy * outWidth + ox] = Math.round(Math.min(Math.max(mean, 0), 1) * 255)
    }
  }
  return out
}

/**
 * Blend `next` into `previous` in place (`previous += alpha * (next -
 * previous)`), or return a copy of `next` when there is no previous mask or
 * the sizes differ.
 */
export function blendMask(
  previous: Uint8Array | null,
  next: Uint8Array,
  alpha: number = HAIR_MASK_SMOOTHING
): Uint8Array {
  if (!previous || previous.length !== next.length) return new Uint8Array(next)
  for (let i = 0; i < next.length; i++) {
    previous[i] = Math.round(previous[i]! + alpha * (next[i]! - previous[i]!))
  }
  return previous
}

/** Share of mask pixels at or above half confidence. */
export function maskCoverage(mask: ArrayLike<number>): number {
  if (mask.length === 0) return 0
  let hair = 0
  for (let i = 0; i < mask.length; i++) if ((mask[i] ?? 0) >= 128) hair++
  return hair / mask.length
}

/** Running worker time per segmentation, for the budget check. */
export interface SegmentTiming {
  /** Mean of the counted segmentations (EMA); null until the first one after warm-up. */
  meanMs: number | null
  /** Segmentations counted in the mean. */
  samples: number
  /** Segmentations seen, warm-up included. */
  seen: number
}

export function updateSegmentTiming(
  timing: SegmentTiming | null,
  ms: number,
  alpha: number = HAIR_TIMING_SMOOTHING
): SegmentTiming {
  const seen = (timing?.seen ?? 0) + 1
  if (seen <= HAIR_TIMING_WARMUP) return { meanMs: timing?.meanMs ?? null, samples: 0, seen }
  const meanMs = timing?.meanMs == null ? ms : timing.meanMs + alpha * (ms - timing.meanMs)
  return { meanMs, samples: (timing?.samples ?? 0) + 1, seen }
}

/** True once enough segmentations have run and their mean time is over budget. */
export function overSegmentBudget(
  timing: SegmentTiming | null,
  budgetMs: number = HAIR_SEGMENT_BUDGET_MS
): boolean {
  return (
    !!timing &&
    timing.meanMs !== null &&
    timing.samples >= HAIR_BUDGET_MIN_SAMPLES &&
    timing.meanMs > budgetMs
  )
}
