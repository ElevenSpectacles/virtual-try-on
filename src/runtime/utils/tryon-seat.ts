/**
 * Pad-contact nose seat (issue #87). Pure math, no Vue.
 *
 * A frame's pads rest where the nose is as wide as the pads are apart:
 * high on a wide bridge, lower on a narrow one. The placement anchors every
 * frame at the same point of the nose ridge (tuned on average noses), so a
 * narrow-bridged shopper sees a frame that floats a little high. With a
 * model's pad spacing in its calibration (`pads.spacingMm`), this finds how
 * far down the shopper's nose the pads would land, compares it with where
 * they land on the reference nose the placement was tuned for, and moves
 * the frame by the difference (clamped).
 *
 * Nose width comes from the face mesh's nose side wall, where it meets the
 * cheek: five landmark pairs down the nose (188/412 … 131/360). On real
 * MediaPipe landmarks (the face fixtures) they widen monotonically down the
 * nose, 20 → 34 mm over 25 mm. Only frontal detections count (the widths
 * foreshorten with yaw), averaged, like the PD.
 */

import type { NormalizedLandmark } from './tryon'

/** Distance in width units (y scaled by height / width). */
function widthUnitDistance(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number): number {
  const dy = (a.y - b.y) / (aspect > 0 ? aspect : 1)
  return Math.hypot(a.x - b.x, dy)
}

/** Nose side-wall landmark pairs, top (near the inner eye corners) to bottom. */
export const NOSE_SIDE_PAIRS = [
  [188, 412],
  [174, 399],
  [236, 456],
  [198, 420],
  [131, 360]
] as const

/** A nose profile: width at each depth below the top pair, millimetres. */
export interface NoseProfilePoint {
  dropMm: number
  widthMm: number
}

/**
 * The reference nose: the mean profile of the face fixtures the placement
 * was tuned on (iris-moss, pteron-azure; MediaPipe landmarks, ear width
 * 148 mm, drops corrected for their 25° yaw), 2026-10-17.
 */
export const REFERENCE_NOSE_PROFILE: readonly NoseProfilePoint[] = [
  { dropMm: 0, widthMm: 20.4 },
  { dropMm: 8.2, widthMm: 20.8 },
  { dropMm: 15.4, widthMm: 21 },
  { dropMm: 18.6, widthMm: 30.6 },
  { dropMm: 25.5, widthMm: 34 }
]

/** Largest seat correction either way, millimetres. */
export const MAX_SEAT_OFFSET_MM = 4

/**
 * The nose profile of one detection, in millimetres: `mmPerUnit` converts
 * width units (fractions of the frame width, see `widthUnitDistance`), e.g.
 * the ear-level width's millimetres over its width units. Null when a
 * landmark is missing.
 */
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

/**
 * How far below the top of the profile pads `spacingMm` apart come to rest:
 * the first depth where the nose is that wide, interpolated. At the top when
 * the nose is wider already; at the bottom when it never gets that wide.
 */
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

/**
 * How much lower (positive, mm) the frame should sit on this nose than on
 * the reference nose, for pads `spacingMm` apart; clamped.
 */
export function seatOffsetMm(
  profile: readonly NoseProfilePoint[],
  spacingMm: number,
  reference: readonly NoseProfilePoint[] = REFERENCE_NOSE_PROFILE
): number {
  const offset = seatDropMm(profile, spacingMm) - seatDropMm(reference, spacingMm)
  return Math.min(Math.max(offset, -MAX_SEAT_OFFSET_MM), MAX_SEAT_OFFSET_MM)
}

/** Running mean of nose profiles over frontal detections. */
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

/** Frontal detections averaged before the seat moves the frame (~1 s). */
export const SEAT_MIN_SAMPLES = 30

/**
 * `(0, distance, 0)` in head space rotated into world space by a three.js
 * `XYZ`-order Euler: `distance` along the head's own up axis.
 */
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
  // Second column of Rx·Ry·Rz (three.js XYZ).
  return {
    x: distance * (-cy * sz),
    y: distance * (cx * cz - sx * sy * sz),
    z: distance * (sx * cz + cx * sy * sz)
  }
}
