export const HAIR_PLANE_SETBACK_METERS = 0.035

export const HAIR_PLANE_SIZE_METERS = 0.6

export const HAIR_SEGMENT_INTERVAL_MS = 100

export const HAIR_INPUT_WIDTH = 192

export const HAIR_MASK_WIDTH = 96
export const HAIR_MASK_HEIGHT = 128

export const HAIR_MASK_SMOOTHING = 0.5

export const HAIR_SEGMENT_BUDGET_MS = 40

export const HAIR_TIMING_SMOOTHING = 0.2

export const HAIR_BUDGET_MIN_SAMPLES = 10

export const HAIR_TIMING_WARMUP = 3

export interface MediaWindow {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export const SCREEN_TO_MEDIA_GLSL = /* glsl */ `
vec2 tryOnScreenToMedia(vec2 screen, vec4 window) {
  return vec2(
    window.x + (1.0 - screen.x) * (window.y - window.x),
    window.z + screen.y * (window.w - window.z)
  );
}
`

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

export function maskCoverage(mask: ArrayLike<number>): number {
  if (mask.length === 0) return 0
  let hair = 0
  for (let i = 0; i < mask.length; i++) if ((mask[i] ?? 0) >= 128) hair++
  return hair / mask.length
}

export interface SegmentTiming {
  meanMs: number | null
  samples: number
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
