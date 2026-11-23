export const NEUTRAL_LUMA = 0.5
export const LIGHT_GAIN_RANGE = { min: 0.5, max: 1.5 } as const
export const TINT_STRENGTH = 0.5
export const LIGHTING_SAMPLE_EVERY = 4

export const LIGHTING_SMOOTHING = 1 - (1 - 0.1) ** LIGHTING_SAMPLE_EVERY

export interface FrameLighting {
  luma: number
  tint: [number, number, number]
}

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

  const peak = Math.max(r, g, b)
  if (peak === 0) return { luma: 0, tint: [1, 1, 1] }
  return { luma, tint: [r / peak, g / peak, b / peak] }
}

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

export function lightingGain(luma: number): number {
  const gain = luma / NEUTRAL_LUMA
  return Math.min(LIGHT_GAIN_RANGE.max, Math.max(LIGHT_GAIN_RANGE.min, gain))
}

export function lightingColor(tint: readonly [number, number, number]): [number, number, number] {
  const mix = (channel: number) => 1 + TINT_STRENGTH * (channel - 1)
  return [mix(tint[0]), mix(tint[1]), mix(tint[2])]
}
