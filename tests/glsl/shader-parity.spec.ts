import { expect, test } from '@playwright/test'
import { runGlsl } from './glsl-harness'
import {
  CAMERA_MATCH_GLSL,
  LIGHT_WRAP_STRENGTH,
  lightWrapAt
} from '../../src/runtime/utils/tryon-camera-match'
import {
  LENS_GLSL,
  gradientDensityAt,
  lensGradientLogTransmittance,
  lensOpacityAt
} from '../../src/runtime/utils/tryon-lens'
import { SCREEN_TO_MEDIA_GLSL, screenToMedia } from '../../src/runtime/utils/tryon-hair'
import {
  TINTED_SHADOW_GLSL,
  tintedShadowComposite,
  tintedShadowMultiply
} from '../../src/runtime/utils/tryon-lens-shadow'
import { EAR_BEND_GLSL, earBendPoint } from '../../src/runtime/utils/tryon-temples'
import {
  CONTACT_OCCLUSION_GLSL,
  OCCLUSION_RANGE_METERS,
  silhouetteFade,
  sphereOcclusion
} from '../../src/runtime/utils/tryon-contact-occlusion'

const SAMPLES = 256
const TOLERANCE = 1e-5
const EAR_BEND_TOLERANCE_METERS = 1e-4

function random(seed: number) {
  let state = seed
  return (min: number, max: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return min + (state / 4294967296) * (max - min)
  }
}

function samples(seed: number, make: (r: ReturnType<typeof random>, i: number) => number[]): number[][] {
  const r = random(seed)
  return Array.from({ length: SAMPLES }, (_, i) => make(r, i))
}

function expectClose(actual: number[][], expected: number[][], tolerance = TOLERANCE) {
  let worst = 0
  let at = -1
  actual.forEach((row, i) => {
    expected[i]!.forEach((value, c) => {
      const error = Math.abs(row[c]! - value) / Math.max(1, Math.abs(value))
      if (error > worst) {
        worst = error
        at = i
      }
    })
  })
  expect(worst, `worst error at sample ${at}: ${actual[at]} vs ${expected[at]}`).toBeLessThanOrEqual(tolerance)
}

test.describe('GLSL mirrors match their TypeScript twins', () => {
  test('light wrap rim', async ({ page }) => {
    const inputs = samples(1, (r) => [r(-1.2, 1.2)])
    const out = await runGlsl(page, {
      functions: CAMERA_MATCH_GLSL,
      body: 'result.x = tryOnLightWrapRim(in0.x);',
      inputs
    })
    expectClose(
      out.map(([rim]) => [rim! * LIGHT_WRAP_STRENGTH]),
      inputs.map(([c]) => [lightWrapAt(c!)])
    )
  })

  test('grain hash is uniform noise in [0, 1) that changes with the seed', async ({ page }) => {
    const far = samples(9, (r) => [Math.floor(r(0, 1920)), Math.floor(r(0, 1080)), 0.25, 0.75])
    const farOut = await runGlsl(page, {
      functions: CAMERA_MATCH_GLSL,
      body: 'result.x = tryOnGrainHash(in0.xy, in0.z);\n  result.y = tryOnGrainHash(in0.xy, in0.w);',
      inputs: far
    })
    const values = farOut.map(([h]) => h!)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(Math.abs(values.reduce((a, b) => a + b, 0) / values.length - 0.5)).toBeLessThan(0.06)
    expect(farOut.filter(([a, b]) => a === b).length).toBeLessThan(SAMPLES / 50)
  })

  test('gradient lens density', async ({ page }) => {
    const inputs = samples(3, (r) => {
      const gradient = { top: r(0.2, 0.95), bottom: r(0, 0.4) }
      return [r(-0.2, 1.2), ...lensGradientLogTransmittance(gradient), gradient.top, gradient.bottom]
    })
    const out = await runGlsl(page, {
      functions: LENS_GLSL,
      body: 'result.x = tryOnGradientAlpha(in0.x, in0.yz);',
      inputs
    })
    expectClose(
      out.map(([a]) => [a!]),
      inputs.map(([t, , , top, bottom]) => [gradientDensityAt({ top: top!, bottom: bottom! }, t!)])
    )
  })

  test('lens opacity at an angle', async ({ page }) => {
    const inputs = samples(4, (r) => [r(0, 1), r(-1, 1)])
    const out = await runGlsl(page, {
      functions: LENS_GLSL,
      body: 'result.x = tryOnLensOpacity(in0.x, in0.y);',
      inputs
    })
    expectClose(
      out.map(([o]) => [o!]),
      inputs.map(([opacity, c]) => [lensOpacityAt(opacity!, c!)])
    )
  })

  test('screen to camera-frame mapping', async ({ page }) => {
    const inputs = samples(5, (r) => {
      const xMin = r(0, 0.3)
      const yMin = r(0, 0.3)
      return [r(0, 1), r(0, 1), 0, 0, xMin, r(0.7, 1), yMin, r(0.7, 1)]
    })
    const out = await runGlsl(page, {
      functions: SCREEN_TO_MEDIA_GLSL,
      body: 'result.xy = tryOnScreenToMedia(in0.xy, in1);',
      inputs
    })
    expectClose(
      out.map(([x, y]) => [x!, y!]),
      inputs.map(([sx, sy, , , xMin, xMax, yMin, yMax]) => {
        const m = screenToMedia(sx!, sy!, { xMin: xMin!, xMax: xMax!, yMin: yMin!, yMax: yMax! })
        return [m.x, m.y]
      })
    )
  })

  test('tinted lens shadow multiply and composite', async ({ page }) => {
    const inputs = samples(6, (r) => [r(0, 1), r(0, 1), r(0, 1), 0, r(0, 1), r(0, 1), r(0, 1), 0, r(0, 1), r(0, 1), r(0, 1)])
    const out = await runGlsl(page, {
      functions: TINTED_SHADOW_GLSL,
      body: 'result = tryOnTintedComposite(in2.rgb, tryOnTintedMultiply(in0.x, in0.y, in0.z, in1.rgb));',
      inputs
    })
    expectClose(
      out,
      inputs.map(([frameLit, occluded, lensBlock, , tr, tg, tb, , vr, vg, vb]) => {
        const multiply = tintedShadowMultiply(frameLit!, occluded!, lensBlock!, [tr!, tg!, tb!])
        const { rgb, alpha } = tintedShadowComposite([vr!, vg!, vb!], multiply)
        return [...rgb, alpha]
      })
    )
  })

  test('ear bend', async ({ page }) => {
    const inputs = samples(7, (r) => [r(-0.02, 0.16), r(-0.02, 0.02), r(-0.08, 0.02), 0, r(0.05, 0.12), r(-0.06, -0.02), r(-0.6, 0), r(0.005, 0.03)])
    const out = await runGlsl(page, {
      functions: EAR_BEND_GLSL,
      body: 'float theta; result.xyz = tryOnEarBend(in0.xyz, in1, theta);',
      inputs
    })
    expectClose(
      out.map(([x, y, z]) => [x!, y!, z!]),
      inputs.map(([x, y, z, , start, bz, angle, ramp]) => {
        const p = earBendPoint({ x: x!, y: y!, z: z! }, { start: start!, z: bz!, angle: angle! }, ramp!)
        return [p.x, p.y, p.z]
      }),
      EAR_BEND_TOLERANCE_METERS
    )
  })

  test('contact occlusion of one sphere and the silhouette fade', async ({ page }) => {
    const inputs = samples(8, (r) => {
      const theta = r(0, Math.PI)
      const phi = r(0, 2 * Math.PI)
      return [
        r(-0.02, 0.02), r(-0.02, 0.02), r(-0.02, 0.02), r(-1, 1),
        Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta), 0,
        r(-0.02, 0.02), r(-0.02, 0.02), r(-0.02, 0.02), r(0.001, 0.008)
      ]
    })
    const out = await runGlsl(page, {
      functions: CONTACT_OCCLUSION_GLSL,
      body: `result.x = tryOnSphereOcclusion(in0.xyz, in1.xyz, in2, ${OCCLUSION_RANGE_METERS});
  result.y = tryOnSilhouetteFade(in0.w);`,
      inputs
    })
    expectClose(
      out.map(([o, f]) => [o!, f!]),
      inputs.map(([px, py, pz, cosView, nx, ny, nz, , sx, sy, sz, sr]) => [
        sphereOcclusion({ x: px!, y: py!, z: pz! }, { x: nx!, y: ny!, z: nz! }, { x: sx!, y: sy!, z: sz!, r: sr! }),
        silhouetteFade(cosView!)
      ])
    )
  })
})
