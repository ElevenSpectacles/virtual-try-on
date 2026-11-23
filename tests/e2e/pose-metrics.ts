export interface TimedValue {
  atMs: number
  value: number
}

export function resampleToFrames(
  samples: readonly TimedValue[],
  startMs: number,
  fps: number,
  frames: number,
  maxGapMs = 100
): (number | null)[] {
  const out: (number | null)[] = []
  const sorted = [...samples].sort((a, b) => a.atMs - b.atMs)
  let cursor = 0
  for (let k = 0; k < frames; k++) {
    const t = startMs + (k * 1000) / fps
    while (cursor + 1 < sorted.length && Math.abs(sorted[cursor + 1]!.atMs - t) <= Math.abs(sorted[cursor]!.atMs - t)) {
      cursor++
    }
    const nearest = sorted[cursor]
    out.push(nearest && Math.abs(nearest.atMs - t) <= maxGapMs ? nearest.value : null)
  }
  return out
}

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  if (n < 2) return 0
  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA
    const db = b[i]! - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return 0
  return cov / Math.sqrt(varA * varB)
}

export interface AxisComparison {
  lag: number
  r: number
  rmsDeg: number
  slope: number
  pairs: number
}

export function compareAxis(
  tracker: readonly (number | null)[],
  truth: readonly number[],
  minPairs = 60
): AxisComparison | null {
  let best: AxisComparison | null = null
  for (let lag = 0; lag < truth.length; lag++) {
    const t: number[] = []
    const g: number[] = []
    for (let k = 0; k < tracker.length; k++) {
      const value = tracker[k]
      const truthValue = truth[(k + lag) % truth.length]
      if (value === null || value === undefined || truthValue === undefined) continue
      t.push(value)
      g.push(truthValue)
    }
    if (t.length < minPairs) continue

    const meanT = t.reduce((s, v) => s + v, 0) / t.length
    const meanG = g.reduce((s, v) => s + v, 0) / g.length
    let crossed = 0
    let truthVariance = 0
    for (let i = 0; i < t.length; i++) {
      crossed += (t[i]! - meanT) * (g[i]! - meanG)
      truthVariance += (g[i]! - meanG) ** 2
    }
    const slope = truthVariance === 0 ? 0 : crossed / truthVariance
    let squared = 0
    for (let i = 0; i < t.length; i++) {
      const residual = t[i]! - meanT - slope * (g[i]! - meanG)
      squared += residual * residual
    }
    const candidate: AxisComparison = {
      lag,
      r: pearson(t, g),
      rmsDeg: Math.sqrt(squared / t.length),
      slope,
      pairs: t.length
    }
    if (!best || Math.abs(candidate.r) > Math.abs(best.r)) best = candidate
  }
  return best
}

export function parseGroundTruth(text: string): {
  roll: number[]
  yaw: number[]
  pitch: number[]
} {
  const roll: number[] = []
  const yaw: number[] = []
  const pitch: number[] = []
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/).map(Number)
    if (cols.length < 6 || cols.some((c) => Number.isNaN(c))) continue
    roll.push(cols[3]!)
    yaw.push(cols[4]!)
    pitch.push(cols[5]!)
  }
  return { roll, yaw, pitch }
}
