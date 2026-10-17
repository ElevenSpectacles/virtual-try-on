/**
 * The room in the lenses (issue #84): reflections built from the camera
 * feed, and the direction the light comes from. Pure functions, no three.js.
 *
 * In the one user study on eyeglass try-on realism we know of (Zhang et al.,
 * IEEE CG&A 2017), reflections were the strongest realism cue. Studio HDRs
 * never mirror the shopper's own room; the 16×16 room sample the
 * face-landmarker worker already returns (utils/tryon-lighting) does. It
 * becomes a tiny equirect environment, the mirrored frame as the front
 * hemisphere and its mean as the back (as Snap's camera reflections do),
 * blended with the studio map so highlights keep their sparkle.
 *
 * The same sample, over the face only, gives the dominant light direction
 * (an order-1 fit, after Knorr & Kurz, ISMAR 2014): the brighter half of the
 * face is toward the light. It aims the key light and the contact shadow,
 * so a window on the left throws the frame's shadow to the right.
 *
 * Everything stays on-device: the sample is 16×16 pixels, used in memory.
 */

/** A region of the raw camera frame, normalized `[0, 1]` (x from the raw left). */
export interface FrameRegion {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Light direction in scene space (x right in the mirrored preview, y up, z toward the camera). */
export interface LightDirection {
  x: number
  y: number
  z: number
  /** 0 … 1: how lopsided the lighting is (0: flat, 1: one side dark). */
  strength: number
}

/**
 * How far a fully lopsided face tips the light from frontal: luma gradient
 * 1 (one half twice as bright as the face mean) → 60°.
 */
export const LIGHT_DIRECTION_GAIN = Math.tan((60 * Math.PI) / 180)

/** Under this gradient the light reads as frontal (noise, skin tone). */
export const LIGHT_DIRECTION_DEADBAND = 0.05

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/**
 * Light direction from an RGBA sample over `region` (the face): the luma
 * difference between its halves, left/right and top/bottom, over its mean.
 * Mirrored once, like the preview. Null when the region has no pixels.
 */
export function estimateLightDirection(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  region: FrameRegion = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
): LightDirection | null {
  const x0 = Math.max(0, Math.floor(region.xMin * width))
  const x1 = Math.min(width, Math.ceil(region.xMax * width))
  const y0 = Math.max(0, Math.floor(region.yMin * height))
  const y1 = Math.min(height, Math.ceil(region.yMax * height))
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  let nLeft = 0
  let nRight = 0
  let nTop = 0
  let nBottom = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      const l = luma(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0)
      if (x + 0.5 < midX) (left += l), nLeft++
      else (right += l), nRight++
      if (y + 0.5 < midY) (top += l), nTop++
      else (bottom += l), nBottom++
    }
  }
  const mean = (left + right) / (nLeft + nRight)
  if (mean <= 0) return { x: 0, y: 0, z: 1, strength: 0 }
  // Raw left is the preview's right (mirror once).
  let gx = (left / nLeft - right / nRight) / mean
  let gy = (top / nTop - bottom / nBottom) / mean
  const magnitude = Math.hypot(gx, gy)
  if (magnitude < LIGHT_DIRECTION_DEADBAND) (gx = 0), (gy = 0)
  const x = gx * LIGHT_DIRECTION_GAIN
  const y = gy * LIGHT_DIRECTION_GAIN
  const length = Math.hypot(x, y, 1)
  return { x: x / length, y: y / length, z: 1 / length, strength: Math.min(magnitude, 1) }
}

/** EMA of two directions (renormalized); `alpha` is the weight of `next`. */
export function smoothLightDirection(
  previous: LightDirection | null,
  next: LightDirection,
  alpha: number
): LightDirection {
  if (!previous) return next
  const x = previous.x + alpha * (next.x - previous.x)
  const y = previous.y + alpha * (next.y - previous.y)
  const z = previous.z + alpha * (next.z - previous.z)
  const length = Math.hypot(x, y, z) || 1
  return {
    x: x / length,
    y: y / length,
    z: z / length,
    strength: previous.strength + alpha * (next.strength - previous.strength)
  }
}

/**
 * Where a light that defaults to `fallback` (unnormalized) should shine from,
 * leaning toward the estimated direction by its strength. Returns a unit
 * vector. Flat light keeps the fallback.
 */
export function aimLight(
  fallback: { x: number; y: number; z: number },
  estimate: LightDirection | null
): { x: number; y: number; z: number } {
  const f = Math.hypot(fallback.x, fallback.y, fallback.z) || 1
  const base = { x: fallback.x / f, y: fallback.y / f, z: fallback.z / f }
  if (!estimate || estimate.strength <= 0) return base
  const w = Math.min(estimate.strength * 2, 1)
  const x = base.x + w * (estimate.x - base.x)
  const y = base.y + w * (estimate.y - base.y)
  const z = base.z + w * (estimate.z - base.z)
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

/**
 * Size of the camera environment map (equirect). Small: it is PMREM-blurred
 * anyway, but not smaller, since PMREMGenerator sizes its cube at width / 4
 * and needs at least 16 (2^LOD_MIN) texels a face; below that the
 * reflections come out black.
 */
export const CAMERA_ENV_WIDTH = 128
export const CAMERA_ENV_HEIGHT = 64

/** Share of the camera in the blended environment; the studio map keeps the rest. */
export const CAMERA_ENV_WEIGHT = 0.6

/** sRGB byte → linear. */
export function srgbToLinear(byte: number): number {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Direction of an equirect texel in three.js's convention (`equirectUv`):
 * u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5, rows from the bottom.
 */
export function equirectDirection(
  column: number,
  row: number,
  width: number,
  height: number
): { x: number; y: number; z: number } {
  const phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI
  const theta = ((row + 0.5) / height - 0.5) * Math.PI
  return { x: Math.cos(theta) * Math.cos(phi), y: Math.sin(theta), z: Math.cos(theta) * Math.sin(phi) }
}

/**
 * Linear RGBA (Float32, `width × height × 4`, rows from the bottom) of an
 * equirect environment made from a room sample. The front hemisphere (+z,
 * toward the camera, what the lenses face) shows the mirrored frame as an
 * orthographic projection; the back is the frame's mean; they blend over
 * the horizon. With `studio` (same layout, linear), the result is
 * `studio·(1 − weight) + camera·weight`.
 */
export function cameraEnvironment(
  rgba: ArrayLike<number>,
  sampleWidth: number,
  sampleHeight: number,
  {
    width = CAMERA_ENV_WIDTH,
    height = CAMERA_ENV_HEIGHT,
    studio = null,
    weight = CAMERA_ENV_WEIGHT
  }: { width?: number; height?: number; studio?: ArrayLike<number> | null; weight?: number } = {}
): Float32Array {
  const out = new Float32Array(width * height * 4)
  const count = sampleWidth * sampleHeight
  const mean = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) mean[c]! += srgbToLinear(rgba[i * 4 + c] ?? 0) / count
  }
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const d = equirectDirection(column, row, width, height)
      // Front: preview x (mirrored raw) ↔ +x, y up ↔ image top.
      const sx = Math.min(sampleWidth - 1, Math.max(0, Math.floor((0.5 - d.x * 0.5) * sampleWidth)))
      const sy = Math.min(sampleHeight - 1, Math.max(0, Math.floor((0.5 - d.y * 0.5) * sampleHeight)))
      const front = Math.min(Math.max((d.z + 0.2) / 0.4, 0), 1)
      const blend = front * front * (3 - 2 * front)
      const o = (row * width + column) * 4
      for (let c = 0; c < 3; c++) {
        const pixel = srgbToLinear(rgba[(sy * sampleWidth + sx) * 4 + c] ?? 0)
        const camera = mean[c]! + blend * (pixel - mean[c]!)
        out[o + c] = studio ? (studio[o + c] ?? 0) * (1 - weight) + camera * weight : camera
      }
      out[o + 3] = 1
    }
  }
  return out
}

/**
 * Box-downsample an equirect (rows from the bottom, `channels` per texel,
 * values via `decode`) to `width × height` linear RGBA, for blending a
 * studio HDR with the camera environment.
 */
export function downsampleEquirect(
  data: ArrayLike<number>,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
  width: number = CAMERA_ENV_WIDTH,
  height: number = CAMERA_ENV_HEIGHT,
  decode: (value: number) => number = (v) => v
): Float32Array {
  const out = new Float32Array(width * height * 4)
  const bw = sourceWidth / width
  const bh = sourceHeight / height
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const sums = [0, 0, 0]
      let n = 0
      // At least one source texel, so a source smaller than the grid still fills it.
      const y0 = Math.floor(row * bh)
      const x0 = Math.floor(column * bw)
      for (let y = y0; y < Math.max(y0 + 1, Math.floor((row + 1) * bh)); y++) {
        for (let x = x0; x < Math.max(x0 + 1, Math.floor((column + 1) * bw)); x++) {
          const i = (y * sourceWidth + x) * channels
          for (let c = 0; c < 3; c++) sums[c]! += decode(data[i + c] ?? 0)
          n++
        }
      }
      const o = (row * width + column) * 4
      for (let c = 0; c < 3; c++) out[o + c] = n ? sums[c]! / n : 0
      out[o + 3] = 1
    }
  }
  return out
}

/** Face region of the raw camera frame from landmarks (their bounding box), or null. */
export function faceRegion(landmarks: readonly { x: number; y: number }[]): FrameRegion | null {
  if (!landmarks.length) return null
  let xMin = 1
  let xMax = 0
  let yMin = 1
  let yMax = 0
  for (const { x, y } of landmarks) {
    xMin = Math.min(xMin, x)
    xMax = Math.max(xMax, x)
    yMin = Math.min(yMin, y)
    yMax = Math.max(yMax, y)
  }
  return xMax > xMin && yMax > yMin ? { xMin, xMax, yMin, yMax } : null
}
