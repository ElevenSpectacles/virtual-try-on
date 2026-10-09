import { estimateFrameLighting, type FrameLighting } from '../../utils/tryon-lighting'

/** Side of the downscaled sample. 16×16 is 256 pixels: enough for mean luma and colour. */
const SAMPLE_SIZE = 16

/**
 * Estimates room lighting from the detection frame. Each frame is drawn into
 * a 16×16 canvas, so the work is a few hundred pixels per detection.
 *
 * Returns null when sampling is unavailable or fails (no 2D context, a
 * tainted or closed bitmap). The caller then keeps the neutral lighting
 * instead of erroring: the module never logs, so a failure stays silent.
 */
export function useFrameLightingSampler() {
  let context: CanvasRenderingContext2D | null = null
  let unavailable = false

  function getContext(): CanvasRenderingContext2D | null {
    if (context) return context
    if (unavailable || typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) unavailable = true
    return context
  }

  function sample(bitmap: ImageBitmap): FrameLighting | null {
    const ctx = getContext()
    if (!ctx) return null
    try {
      ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      return estimateFrameLighting(data, SAMPLE_SIZE, SAMPLE_SIZE)
    } catch {
      return null
    }
  }

  return { sample }
}
