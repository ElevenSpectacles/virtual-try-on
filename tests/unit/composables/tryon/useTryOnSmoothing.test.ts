import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { useTryOnSmoothing } from '../../../../src/runtime/composables/tryon/useTryOnSmoothing'
import {
  landmarkStream,
  rms,
  stdDev,
  type Pose,
  type StreamFrame
} from '../../support/landmark-stream'

/**
 * Smoothing against synthetic tracker output with known ground truth
 * (umbrella #4, issue #15). The composable is driven through a stubbed rAF
 * at a fixed 60 fps, one tracker sample per frame.
 */

const FPS = 60
const FRAME_MS = 1000 / FPS

afterEach(() => {
  vi.unstubAllGlobals()
})

/** rAF stand-in: `frame()` runs the pending callback with the next timestamp. */
function stubRaf() {
  let pending: FrameRequestCallback | null = null
  let now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null
  })
  return {
    frame() {
      now += FRAME_MS
      const cb = pending
      pending = null
      cb?.(now)
    }
  }
}

interface Output {
  anchor: { x: number; y: number }
  euler: { x: number; y: number; z: number }
  scale: number
}

/** Feed `stream` through the smoothing, one frame at a time, recording its outputs. */
function run(stream: StreamFrame[], latencyMs = 0): Output[] {
  const raf = stubRaf()
  const anchor = ref({ x: 0, y: 0, z: 0 })
  const euler = ref({ x: 0, y: 0, z: 0 })
  const scale = ref(0)
  const tracking = ref(true)
  const hold = ref(false)
  const latency = ref(latencyMs)

  const scope = effectScope()
  const smoothing = scope.run(() =>
    useTryOnSmoothing({
      targetAnchor: computed(() => ({ ...anchor.value })),
      targetEuler: computed(() => euler.value),
      targetScale: computed(() => scale.value),
      isTracking: computed(() => tracking.value),
      holdScale: computed(() => hold.value),
      latencyMs: computed(() => latency.value)
    })
  )!

  const outputs: Output[] = []
  const feed = (measured: Pose) => {
    anchor.value = { x: measured.anchor.x, y: measured.anchor.y, z: 0 }
    euler.value = { ...measured.euler }
    scale.value = measured.scale
  }
  for (const f of stream) {
    feed(f.measured)
    tracking.value = f.tracking
    hold.value = f.holdScale
    raf.frame()
    outputs.push({
      anchor: { ...smoothing.smoothedAnchor.value },
      euler: { ...smoothing.smoothedEuler.value },
      scale: smoothing.smoothedScale.value
    })
  }
  scope.stop()
  return outputs
}

const REST: Pose = {
  anchor: { x: 0.5, y: 0.5 },
  euler: { x: 0, y: 0, z: 0 },
  scale: 0.1
}

const WARMUP_FRAMES = FPS * 1.5
const DEG = Math.PI / 180

/**
 * Delay (ms) of `output` behind `input`: the shift, in whole frames, that
 * maximises their cross-correlation (both mean-removed).
 */
function lagMs(input: readonly number[], output: readonly number[], maxFrames = 30): number {
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const mi = mean(input)
  const mo = mean(output)
  let best = 0
  let bestScore = -Infinity
  for (let shift = 0; shift <= maxFrames; shift++) {
    let score = 0
    for (let i = 0; i + shift < output.length; i++) {
      score += (input[i]! - mi) * (output[i + shift]! - mo)
    }
    if (score > bestScore) {
      bestScore = score
      best = shift
    }
  }
  return best * FRAME_MS
}

describe('useTryOnSmoothing against synthetic tracker output', () => {
  it('damps measurement jitter at rest', () => {
    const stream = landmarkStream({
      seconds: 10,
      seed: 7,
      anchorNoise: 0.003,
      rotationNoise: 0.01,
      scaleNoise: 0.01,
      motion: () => REST
    })
    const out = run(stream)
    const settled = out.slice(WARMUP_FRAMES)
    const frames = stream.slice(WARMUP_FRAMES)

    const inputJitter = stdDev(frames.map((f) => f.measured.anchor.x - f.truth.anchor.x))
    const outputJitter = stdDev(settled.map((o, i) => o.anchor.x - frames[i]!.truth.anchor.x))
    console.log(`  rest anchor jitter: input ${inputJitter.toFixed(5)}, output ${outputJitter.toFixed(5)}, ratio ${(outputJitter / inputJitter).toFixed(3)}`)
    expect(outputJitter / inputJitter).toBeLessThan(0.35)
  })

  it('latency prediction cuts the tracking error on a moving target', () => {
    // A slow sweep: 0.1 of frame width each way, one cycle every 3 s.
    const sweep = (t: number): Pose => ({
      anchor: { x: 0.5 + 0.1 * Math.sin((2 * Math.PI * t) / 3), y: 0.5 },
      euler: { x: 0, y: 0, z: 0 },
      scale: 0.1
    })
    const stream = landmarkStream({ seconds: 8, seed: 3, motion: sweep })
    const frames = stream.slice(WARMUP_FRAMES)

    const error = (out: Output[]) =>
      rms(out.slice(WARMUP_FRAMES).map((o, i) => o.anchor.x - frames[i]!.truth.anchor.x))
    const noPrediction = error(run(stream, 0))
    const withPrediction = error(run(stream, 100))
    console.log(`  sweep rms error: no latency ${noPrediction.toFixed(5)}, latency 100 ms ${withPrediction.toFixed(5)}`)

    expect(withPrediction).toBeLessThan(noPrediction)
    expect(withPrediction).toBeLessThan(0.01)
  })

  it('holds the scale through a blink window', () => {
    const stream = landmarkStream({
      seconds: 4,
      seed: 5,
      scaleNoise: 0.2,
      motion: () => REST,
      holdFrames: [[120, 180]]
    })
    const out = run(stream)
    const held = out.slice(121, 180).map((o) => o.scale)
    // Control: the same noisy scale without the hold must move, so the flat line above is the hold.
    const unheld = run(landmarkStream({ seconds: 4, seed: 5, scaleNoise: 0.2, motion: () => REST })).slice(121, 180).map((o) => o.scale)
    expect(Math.max(...unheld) - Math.min(...unheld)).toBeGreaterThan(1e-3)
    console.log(`  blink hold: scale range ${(Math.max(...held) - Math.min(...held)).toExponential(2)}`)
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(1e-9)
  })

  it('snaps to a re-acquired face instead of sliding across the screen', () => {
    const jump = (t: number): Pose => ({
      anchor: { x: t < 1.5 ? 0.2 : 0.8, y: 0.5 },
      euler: { x: 0, y: 0, z: 0 },
      scale: 0.1
    })
    const stream = landmarkStream({
      seconds: 3,
      seed: 9,
      motion: jump,
      lostFrames: [[60, 90]]
    })
    const out = run(stream)
    // First frame the face is tracked again: the frame should be where the face is.
    const reacquired = out[90]!
    console.log(`  reacquire: smoothed x ${reacquired.anchor.x.toFixed(4)} vs target 0.8`)
    expect(Math.abs(reacquired.anchor.x - 0.8)).toBeLessThan(0.01)
  })

  it('damps rotation jitter at rest to under 0.2 degrees', () => {
    const stream = landmarkStream({
      seconds: 10,
      seed: 11,
      rotationNoise: 0.5 * DEG,
      motion: () => REST
    })
    // With and without latency prediction: prediction must not add jitter at rest.
    for (const latency of [0, 100]) {
      const settled = run(stream, latency).slice(WARMUP_FRAMES)
      const yawJitterDeg = stdDev(settled.map((o) => o.euler.y)) / DEG
      console.log(`  rest yaw jitter, latency ${latency} ms: input 0.5 deg, output ${yawJitterDeg.toFixed(3)} deg`)
      expect(yawJitterDeg).toBeLessThan(0.2)
    }
  })

  it('lags a slow yaw sweep by under 40 ms', () => {
    // 20 degrees each way, one cycle every 4 s: a customer slowly turning to
    // look at the temples.
    const sweep = (t: number): Pose => ({
      ...REST,
      euler: { x: 0, y: 20 * DEG * Math.sin((2 * Math.PI * t) / 4), z: 0 }
    })
    const stream = landmarkStream({ seconds: 8, seed: 13, motion: sweep })
    const out = run(stream).slice(WARMUP_FRAMES)
    const truth = stream.slice(WARMUP_FRAMES).map((f) => f.truth.euler.y)
    const lag = lagMs(truth, out.map((o) => o.euler.y))
    console.log(`  yaw sweep lag: ${lag.toFixed(1)} ms`)
    expect(lag).toBeLessThan(40)
  })

  it('does not overshoot a step in position', () => {
    const step = (t: number): Pose => ({
      ...REST,
      anchor: { x: t < 1 ? 0.4 : 0.5, y: 0.5 }
    })
    const stream = landmarkStream({ seconds: 3, seed: 17, motion: step })
    const out = run(stream).slice(FPS)
    const peak = Math.max(...out.map((o) => o.anchor.x))
    const overshoot = (peak - 0.5) / 0.1
    console.log(`  step overshoot: ${(overshoot * 100).toFixed(2)}%`)
    expect(overshoot).toBeLessThan(0.01)
    // And it does arrive: within 1% of the step half a second later.
    expect(Math.abs(out[FPS / 2]!.anchor.x - 0.5)).toBeLessThan(0.001)
  })

  it('predicts almost nothing on a still head', () => {
    const stream = landmarkStream({
      seconds: 6,
      seed: 19,
      anchorNoise: 0.003,
      motion: () => REST
    })
    const without = run(stream, 0).slice(WARMUP_FRAMES)
    const withLatency = run(stream, 100).slice(WARMUP_FRAMES)
    const jitterWithout = stdDev(without.map((o) => o.anchor.x))
    const jitterWith = stdDev(withLatency.map((o) => o.anchor.x))
    console.log(`  still-head jitter: no latency ${jitterWithout.toExponential(2)}, latency 100 ms ${jitterWith.toExponential(2)}`)
    // Prediction must not amplify jitter on a still head (it used to triple it).
    expect(jitterWith).toBeLessThan(jitterWithout * 1.25)
  })

  it('tracks ground truth "now" on a constant-velocity pan with prediction', () => {
    const pan = (t: number): Pose => ({
      ...REST,
      anchor: { x: 0.3 + 0.1 * t, y: 0.5 }
    })
    // The tracker reports where the head was 100 ms ago.
    const latency = 0.1
    const stream = landmarkStream({ seconds: 4, seed: 23, motion: (t) => pan(t - latency) })
    const out = run(stream, latency * 1000).slice(WARMUP_FRAMES)
    const error = rms(out.map((o, i) => o.anchor.x - pan((WARMUP_FRAMES + i) / FPS).anchor.x))
    const unpredicted = rms(
      run(stream, 0).slice(WARMUP_FRAMES).map((o, i) => o.anchor.x - pan((WARMUP_FRAMES + i) / FPS).anchor.x)
    )
    console.log(`  constant pan error vs now: predicted ${error.toExponential(2)}, unpredicted ${unpredicted.toExponential(2)}`)
    expect(error).toBeLessThan(unpredicted * 0.6)
  })

  it('latency prediction cuts the yaw error on a head turn', () => {
    // 30 degrees each way, one cycle every 3 s; the tracker reports the pose 100 ms late.
    const turn = (t: number): Pose => ({
      ...REST,
      euler: { x: 0, y: 30 * DEG * Math.sin((2 * Math.PI * t) / 3), z: 0 }
    })
    const latency = 0.1
    const stream = landmarkStream({
      seconds: 6,
      seed: 29,
      rotationNoise: 0.3 * DEG,
      motion: (t) => turn(t - latency)
    })
    const errorDeg = (latencyMs: number) =>
      rms(
        run(stream, latencyMs)
          .slice(WARMUP_FRAMES)
          .map((o, i) => o.euler.y - turn((WARMUP_FRAMES + i) / FPS).euler.y)
      ) / DEG
    const predicted = errorDeg(latency * 1000)
    const unpredicted = errorDeg(0)
    console.log(`  head turn yaw error vs now: predicted ${predicted.toFixed(2)} deg, unpredicted ${unpredicted.toFixed(2)} deg`)
    expect(predicted).toBeLessThan(unpredicted * 0.8)
  })
})
