import { describe, expect, it } from 'vitest'
import {
  CAMERA_ENV_HEIGHT,
  CAMERA_ENV_WIDTH,
  LIGHT_DIRECTION_DEADBAND,
  aimLight,
  cameraEnvironment,
  downsampleEquirect,
  equirectDirection,
  estimateLightDirection,
  faceRegion,
  smoothLightDirection,
  srgbToLinear
} from '../../../src/runtime/utils/tryon-room'

/** A 16×16 RGBA sample whose luma is `f(x, y)` (0…255 grey). */
function sample(f: (x: number, y: number) => number, size = 16) {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = f(x, y)
      rgba.set([v, v, v, 255], (y * size + x) * 4)
    }
  }
  return rgba
}

describe('estimateLightDirection', () => {
  it('reads flat light as frontal', () => {
    const d = estimateLightDirection(sample(() => 128), 16, 16)!
    expect(d).toEqual({ x: 0, y: 0, z: 1, strength: 0 })
  })

  it('puts a light on the raw left on the preview right (mirror once)', () => {
    const d = estimateLightDirection(sample((x) => (x < 8 ? 200 : 80)), 16, 16)!
    expect(d.x).toBeGreaterThan(0.5)
    expect(Math.abs(d.y)).toBeLessThan(1e-9)
    expect(d.z).toBeGreaterThan(0)
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9)
  })

  it('reads a light from above as up', () => {
    const d = estimateLightDirection(sample((_, y) => (y < 8 ? 200 : 80)), 16, 16)!
    expect(d.y).toBeGreaterThan(0.5)
    expect(Math.abs(d.x)).toBeLessThan(1e-9)
  })

  it('only looks inside the face region', () => {
    // Bright window on the far raw right, face (cols 2–9) evenly lit.
    const rgba = sample((x) => (x >= 12 ? 255 : 120))
    const d = estimateLightDirection(rgba, 16, 16, { xMin: 2 / 16, xMax: 10 / 16, yMin: 0, yMax: 1 })!
    expect(d.strength).toBe(0)
  })

  it('ignores gradients under the deadband', () => {
    const lift = (LIGHT_DIRECTION_DEADBAND * 100) / 2
    const d = estimateLightDirection(sample((x) => (x < 8 ? 100 + lift / 2 : 100 - lift / 2)), 16, 16)!
    expect(d.x).toBe(0)
  })
})

describe('aimLight', () => {
  const fallback = { x: 0.6, y: 2, z: 6 }

  it('keeps the fallback for flat light', () => {
    const aimed = aimLight(fallback, { x: 0, y: 0, z: 1, strength: 0 })
    const f = Math.hypot(0.6, 2, 6)
    expect(aimed.x).toBeCloseTo(0.6 / f, 9)
  })

  it('swings toward a strong side light, so the shadow falls the other way', () => {
    const aimed = aimLight(fallback, { x: -0.7, y: 0, z: 0.71, strength: 0.6 })
    expect(aimed.x).toBeLessThan(0)
    expect(Math.hypot(aimed.x, aimed.y, aimed.z)).toBeCloseTo(1, 9)
  })
})

describe('smoothLightDirection', () => {
  it('moves part of the way and stays a unit vector', () => {
    const a = { x: 0, y: 0, z: 1, strength: 0 }
    const b = { x: 1, y: 0, z: 0, strength: 1 }
    const m = smoothLightDirection(a, b, 0.5)
    expect(m.x).toBeCloseTo(Math.SQRT1_2, 9)
    expect(m.strength).toBe(0.5)
  })
})

describe('camera environment', () => {
  it('uses three.js equirect directions (u = atan2(z, x)/2π + 0.5, v = asin(y)/π + 0.5)', () => {
    const d = equirectDirection(5, 3, CAMERA_ENV_WIDTH, CAMERA_ENV_HEIGHT)
    const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5
    const v = Math.asin(d.y) / Math.PI + 0.5
    expect(u).toBeCloseTo(5.5 / CAMERA_ENV_WIDTH, 9)
    expect(v).toBeCloseTo(3.5 / CAMERA_ENV_HEIGHT, 9)
  })

  // Texel facing a direction (front: +z), red channel.
  function redToward(env: Float32Array, x: number, y: number, z: number) {
    let best = 0
    let bestDot = -Infinity
    for (let row = 0; row < CAMERA_ENV_HEIGHT; row++) {
      for (let column = 0; column < CAMERA_ENV_WIDTH; column++) {
        const d = equirectDirection(column, row, CAMERA_ENV_WIDTH, CAMERA_ENV_HEIGHT)
        const dot = d.x * x + d.y * y + d.z * z
        if (dot > bestDot) (bestDot = dot), (best = env[(row * CAMERA_ENV_WIDTH + column) * 4]!)
      }
    }
    return best
  }

  it('shows the mirrored frame in front and its mean behind', () => {
    // Raw left half red, right half black.
    const rgba = new Uint8ClampedArray(16 * 16 * 4)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) rgba.set([255, 0, 0, 255], (y * 16 + x) * 4)
    const env = cameraEnvironment(rgba, 16, 16)
    // Raw left = preview right = +x, in front.
    expect(redToward(env, 0.7, 0, 0.7)).toBeCloseTo(1, 6)
    expect(redToward(env, -0.7, 0, 0.7)).toBeCloseTo(0, 6)
    // Behind: the mean (half the pixels at linear 1).
    expect(redToward(env, 0, 0, -1)).toBeCloseTo(0.5, 6)
  })

  it('blends with the studio map by weight', () => {
    const rgba = sample(() => 255)
    const studio = new Float32Array(CAMERA_ENV_WIDTH * CAMERA_ENV_HEIGHT * 4).fill(3)
    const env = cameraEnvironment(rgba, 16, 16, { studio, weight: 0.25 })
    expect(env[0]).toBeCloseTo(3 * 0.75 + 1 * 0.25, 6)
    expect(env[3]).toBe(1)
  })

  it('downsamples a studio equirect by box average', () => {
    const data = new Float32Array(512 * 256 * 4).map((_, i) => (i % 4 === 0 ? 2 : 0))
    const grid = downsampleEquirect(data, 512, 256, 4)
    expect(grid[0]).toBeCloseTo(2, 9)
    expect(grid[1]).toBe(0)
    expect(grid.length).toBe(CAMERA_ENV_WIDTH * CAMERA_ENV_HEIGHT * 4)
  })

  it('fills the grid from a source smaller than it', () => {
    const grid = downsampleEquirect(new Float32Array(8 * 4 * 4).fill(1), 8, 4, 4)
    expect(grid.every((v) => v === 1)).toBe(true)
  })

  it('decodes sRGB bytes to linear', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(255)).toBeCloseTo(1, 9)
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3)
  })
})

describe('faceRegion', () => {
  it('is the landmarks bounding box', () => {
    expect(faceRegion([{ x: 0.3, y: 0.2 }, { x: 0.6, y: 0.7 }, { x: 0.4, y: 0.5 }])).toEqual({
      xMin: 0.3,
      xMax: 0.6,
      yMin: 0.2,
      yMax: 0.7
    })
    expect(faceRegion([])).toBeNull()
  })
})
