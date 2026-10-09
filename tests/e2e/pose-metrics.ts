/**
 * Compares the tracker's head pose against UPNA ground truth.
 *
 * The two streams differ in three ways, so the comparison ignores each of them:
 * - Sign: the tracker's camera-space axes may be mirrored relative to UPNA's.
 *   Correlation is taken on magnitude, and the sign is reported.
 * - Offset: the tracker's zero is not UPNA's zero, so both series are
 *   centred before comparing.
 * - Alignment: the harness records wall-clock times, and the clip's start
 *   isn't known. The best frame lag is searched for.
 *
 * Pure functions only, so the comparison is unit-tested on synthetic series.
 */

/** A tracker sample: time in ms and one angle in degrees. */
export interface TimedValue {
  atMs: number
  value: number
}

/**
 * Resample irregular samples onto a fixed frame grid: frame `k` takes the
 * nearest sample to `startMs + k * 1000 / fps`. A frame with no sample within
 * `maxGapMs` is null.
 */
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

/** Pearson correlation of two equal-length series; 0 when either is constant. */
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
  /** Truth frame the tracker starts at: tracker frame k ↔ truth frame (k + lag) mod length. */
  lag: number
  /** Signed correlation at the chosen lag. Negative means the axes are mirrored. */
  r: number
  /** RMS residual in degrees after the best linear fit of tracker on truth (shape error). */
  rmsDeg: number
  /**
   * Least-squares slope of tracker on truth: degrees the tracker moves per
   * degree of ground truth. 1 is matched amplitude; far from 1 means the
   * tracker's angles are scaled, even when the shape matches (high |r|).
   */
  slope: number
  /** Frames compared at the chosen lag. */
  pairs: number
}

/**
 * Best alignment of `tracker` onto `truth`, chosen by the largest |r|.
 *
 * The lag runs over a full loop of the truth. The fake camera replays the
 * clip, so the tracker can start anywhere in it, and the truth index wraps
 * around. Frames where the tracker has no sample are skipped. Returns null
 * when fewer than `minPairs` frames overlap at every lag.
 */
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
    // Residual after the best linear fit, so a mirrored or scaled tracker is
    // scored on its shape, not penalised for the sign or amplitude slope reports.
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

/** Parse a UPNA 3D ground-truth file: rows of `Tx Ty Tz Roll Yaw Pitch`. */
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
