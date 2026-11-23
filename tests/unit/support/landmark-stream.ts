export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.MIN_VALUE)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface Pose {
  anchor: { x: number; y: number }
  euler: { x: number; y: number; z: number }
  scale: number
}

export interface StreamFrame {
  truth: Pose
  measured: Pose
  tracking: boolean
  holdScale: boolean
}

export interface StreamOptions {
  fps?: number
  seconds: number
  seed?: number
  anchorNoise?: number
  rotationNoise?: number
  scaleNoise?: number
  motion: (t: number) => Pose
  lostFrames?: Array<[number, number]>
  holdFrames?: Array<[number, number]>
}

export function landmarkStream(options: StreamOptions): StreamFrame[] {
  const fps = options.fps ?? 60
  const count = Math.round(options.seconds * fps)
  const rand = mulberry32(options.seed ?? 1)
  const anchorNoise = options.anchorNoise ?? 0
  const rotationNoise = options.rotationNoise ?? 0
  const scaleNoise = options.scaleNoise ?? 0
  const inRanges = (ranges: Array<[number, number]> | undefined, i: number) =>
    (ranges ?? []).some(([from, to]) => i >= from && i < to)

  const frames: StreamFrame[] = []
  for (let i = 0; i < count; i++) {
    const truth = options.motion(i / fps)
    const measured: Pose = {
      anchor: {
        x: truth.anchor.x + anchorNoise * gaussian(rand),
        y: truth.anchor.y + anchorNoise * gaussian(rand)
      },
      euler: {
        x: truth.euler.x + rotationNoise * gaussian(rand),
        y: truth.euler.y + rotationNoise * gaussian(rand),
        z: truth.euler.z + rotationNoise * gaussian(rand)
      },
      scale: truth.scale * (1 + scaleNoise * gaussian(rand))
    }
    frames.push({
      truth,
      measured,
      tracking: !inRanges(options.lostFrames, i),
      holdScale: inRanges(options.holdFrames, i)
    })
  }
  return frames
}

export function rms(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)
}

export function stdDev(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)
}
