import type { NormalizedLandmark } from './tryon'

function widthUnitDistance(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number): number {
  const dy = (a.y - b.y) / (aspect > 0 ? aspect : 1)
  return Math.hypot(a.x - b.x, dy)
}

export const NOSE_SIDE_PAIRS = [
  [188, 412],
  [174, 399],
  [236, 456],
  [198, 420],
  [131, 360]
] as const

export interface NoseProfilePoint {
  dropMm: number
  widthMm: number
}

export const REFERENCE_NOSE_PROFILE: readonly NoseProfilePoint[] = [
  { dropMm: 0, widthMm: 20.4 },
  { dropMm: 8.2, widthMm: 20.8 },
  { dropMm: 15.4, widthMm: 21 },
  { dropMm: 18.6, widthMm: 30.6 },
  { dropMm: 25.5, widthMm: 34 }
]

export const MAX_SEAT_OFFSET_MM = 4

export function noseProfile(
  landmarks: NormalizedLandmark[],
  aspect: number,
  mmPerUnit: number
): NoseProfilePoint[] | null {
  const points: NoseProfilePoint[] = []
  let topY: number | null = null
  for (const [right, left] of NOSE_SIDE_PAIRS) {
    const a = landmarks[right]
    const b = landmarks[left]
    if (!a || !b) return null
    const y = (a.y + b.y) / 2 / (aspect > 0 ? aspect : 1)
    topY ??= y
    points.push({
      dropMm: (y - topY) * mmPerUnit,
      widthMm: widthUnitDistance(a, b, aspect) * mmPerUnit
    })
  }
  return points
}

export function seatDropMm(profile: readonly NoseProfilePoint[], spacingMm: number): number {
  if (!profile.length) return 0
  if (profile[0]!.widthMm >= spacingMm) return profile[0]!.dropMm
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!
    const b = profile[i]!
    if (b.widthMm >= spacingMm) {
      const t = (spacingMm - a.widthMm) / (b.widthMm - a.widthMm)
      return a.dropMm + t * (b.dropMm - a.dropMm)
    }
  }
  return profile[profile.length - 1]!.dropMm
}

export function seatOffsetMm(
  profile: readonly NoseProfilePoint[],
  spacingMm: number,
  reference: readonly NoseProfilePoint[] = REFERENCE_NOSE_PROFILE
): number {
  const offset = seatDropMm(profile, spacingMm) - seatDropMm(reference, spacingMm)
  return Math.min(Math.max(offset, -MAX_SEAT_OFFSET_MM), MAX_SEAT_OFFSET_MM)
}

export interface NoseProfileEstimate {
  mean: NoseProfilePoint[]
  samples: number
}

export function updateNoseProfile(
  estimate: NoseProfileEstimate | null,
  profile: NoseProfilePoint[] | null,
  alpha = 0.05
): NoseProfileEstimate | null {
  if (!profile) return estimate
  if (!estimate) return { mean: profile.map((p) => ({ ...p })), samples: 1 }
  return {
    mean: estimate.mean.map((p, i) => ({
      dropMm: p.dropMm + alpha * (profile[i]!.dropMm - p.dropMm),
      widthMm: p.widthMm + alpha * (profile[i]!.widthMm - p.widthMm)
    })),
    samples: estimate.samples + 1
  }
}

export const SEAT_MIN_SAMPLES = 30

export function headUpOffset(
  euler: { x: number; y: number; z: number },
  distance: number
): { x: number; y: number; z: number } {
  const cx = Math.cos(euler.x)
  const sx = Math.sin(euler.x)
  const cy = Math.cos(euler.y)
  const sy = Math.sin(euler.y)
  const cz = Math.cos(euler.z)
  const sz = Math.sin(euler.z)
  return {
    x: distance * (sy * sx * cz - cy * sz),
    y: distance * cx * cz,
    z: distance * (sy * sz + cy * sx * cz)
  }
}
