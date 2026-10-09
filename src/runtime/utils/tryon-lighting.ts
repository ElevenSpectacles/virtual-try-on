/**
 * Ambient lighting estimated from the camera image, so the frame's lights
 * track the room the user is in instead of a fixed studio setup.
 *
 * Pure functions only (no DOM, no Vue). The caller hands over RGBA pixels of
 * a small downscaled copy of the frame (see `useFrameLightingSampler`).
 */

/** Mean BT.709 luma of a neutral room; a frame at this level keeps the scene's own lighting. */
export const NEUTRAL_LUMA = 0.5
/** Lower and upper bound on the light gain: a dark room never goes black, a bright one never blows out. */
export const LIGHT_GAIN_RANGE = { min: 0.5, max: 1.5 } as const
/** How much of the room's colour cast the lights take on, 0 = none, 1 = full. */
export const TINT_STRENGTH = 0.5
/**
 * EMA weight of each new estimate. Low, so a passing hand or a screen flash
 * doesn't flicker the lighting.
 */
export const LIGHTING_SMOOTHING = 0.1

export interface FrameLighting {
  /** Mean luma of the frame, 0 (black) … 1 (white). */
  luma: number
  /** Colour cast of the room, each channel 0…1 with the brightest channel at 1. */
  tint: [number, number, number]
}

/**
 * Mean luma and colour cast of an RGBA pixel buffer (`width * height * 4`
 * bytes). An empty or all-black buffer reads as luma 0 with a white tint.
 */
export function estimateFrameLighting(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): FrameLighting {
  const count = width * height
  if (count === 0) return { luma: 0, tint: [1, 1, 1] }

  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    sumR += rgba[offset] ?? 0
    sumG += rgba[offset + 1] ?? 0
    sumB += rgba[offset + 2] ?? 0
  }

  const r = sumR / count / 255
  const g = sumG / count / 255
  const b = sumB / count / 255
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

  // Normalise by the brightest channel so the tint describes the hue of the
  // light, not its brightness (brightness is `luma`).
  const peak = Math.max(r, g, b)
  if (peak === 0) return { luma: 0, tint: [1, 1, 1] }
  return { luma, tint: [r / peak, g / peak, b / peak] }
}

/** Exponential smoothing of two estimates; `alpha` is the weight of `next`. */
export function smoothFrameLighting(
  previous: FrameLighting | null,
  next: FrameLighting,
  alpha: number = LIGHTING_SMOOTHING
): FrameLighting {
  if (!previous) return next
  const mix = (a: number, b: number) => a + alpha * (b - a)
  return {
    luma: mix(previous.luma, next.luma),
    tint: [
      mix(previous.tint[0], next.tint[0]),
      mix(previous.tint[1], next.tint[1]),
      mix(previous.tint[2], next.tint[2])
    ]
  }
}

/**
 * Multiplier on the scene's lights for a given luma: 1 at a neutral room,
 * clamped to `LIGHT_GAIN_RANGE`.
 */
export function lightingGain(luma: number): number {
  const gain = luma / NEUTRAL_LUMA
  return Math.min(LIGHT_GAIN_RANGE.max, Math.max(LIGHT_GAIN_RANGE.min, gain))
}

/**
 * The light colour: white pulled toward the room's tint by `TINT_STRENGTH`.
 * A neutral room gives pure white.
 */
export function lightingColor(tint: readonly [number, number, number]): [number, number, number] {
  const mix = (channel: number) => 1 + TINT_STRENGTH * (channel - 1)
  return [mix(tint[0]), mix(tint[1]), mix(tint[2])]
}
