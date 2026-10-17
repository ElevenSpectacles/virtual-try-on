import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DRACO_DECODER_ORIGIN,
  ENVIRONMENT_ORIGIN,
  MEDIAPIPE_MODEL_ORIGIN,
  MEDIAPIPE_WASM_ORIGIN,
  preconnectOrigins
} from '../../../src/runtime/utils/tryon-preconnect'

const source = (path: string) =>
  readFileSync(new URL(`../../../src/runtime/${path}`, import.meta.url), 'utf8')

describe('preconnectOrigins', () => {
  it('lists every default CDN when nothing is self-hosted', () => {
    expect(preconnectOrigins({})).toEqual([
      MEDIAPIPE_WASM_ORIGIN,
      MEDIAPIPE_MODEL_ORIGIN,
      DRACO_DECODER_ORIGIN,
      ENVIRONMENT_ORIGIN
    ])
  })

  it('leaves out what the host self-hosts', () => {
    expect(
      preconnectOrigins({
        mediapipeBasePath: '/mediapipe/wasm',
        mediapipeModelAssetPath: '/mediapipe/face_landmarker.task',
        dracoDecoderPath: '/draco/',
        presetEnvironment: false
      })
    ).toEqual([])
  })

  it('keeps Google Storage for a CDN-hosted hair model', () => {
    expect(
      preconnectOrigins({
        mediapipeModelAssetPath: '/face_landmarker.task',
        hairOcclusion: true
      })
    ).toContain(MEDIAPIPE_MODEL_ORIGIN)
  })

  it('skips the Draco CDN with Draco off', () => {
    expect(preconnectOrigins({ draco: false })).not.toContain(DRACO_DECODER_ORIGIN)
  })

  it('matches the defaults the workers, the model cache and the scene fetch from', () => {
    const face = source('workers/face-landmarker.worker.ts')
    const hair = source('workers/hair-segmenter.worker.ts')
    const modelCache = source('composables/tryon/useTryOnModelCache.ts')
    const scene = source('components/TryOnScene.vue')
    expect(face).toContain(`'${MEDIAPIPE_WASM_ORIGIN}/`)
    expect(face).toContain(`'${MEDIAPIPE_MODEL_ORIGIN}/`)
    expect(hair).toContain(`'${MEDIAPIPE_MODEL_ORIGIN}/`)
    expect(modelCache).toContain(`'${DRACO_DECODER_ORIGIN}/`)
    expect(scene).toContain(`'${ENVIRONMENT_ORIGIN}/`)
  })
})
