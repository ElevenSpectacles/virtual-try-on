export interface FrameRegion {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface LightDirection {
  x: number
  y: number
  z: number
  strength: number
}

export const LIGHT_DIRECTION_GAIN = Math.tan((60 * Math.PI) / 180)

export const LIGHT_DIRECTION_DEADBAND = 0.05

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

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
  let gx = (left / nLeft - right / nRight) / mean
  let gy = (top / nTop - bottom / nBottom) / mean
  const magnitude = Math.hypot(gx, gy)
  if (magnitude < LIGHT_DIRECTION_DEADBAND) (gx = 0), (gy = 0)
  const x = gx * LIGHT_DIRECTION_GAIN
  const y = gy * LIGHT_DIRECTION_GAIN
  const length = Math.hypot(x, y, 1)
  return { x: x / length, y: y / length, z: 1 / length, strength: Math.min(magnitude, 1) }
}

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

export const CAMERA_ENV_WIDTH = 128
export const CAMERA_ENV_HEIGHT = 64

export const CAMERA_ENV_WEIGHT = 0.6

export function srgbToLinear(byte: number): number {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

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
