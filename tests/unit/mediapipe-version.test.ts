import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('MediaPipe version', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  ) as { dependencies: Record<string, string> }
  const workers = ['face-landmarker.worker.ts', 'hair-segmenter.worker.ts']

  it('pins an exact dependency version', () => {
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  for (const name of workers) {
    it(`${name} loads the WASM matching the pinned JS`, () => {
      const worker = readFileSync(
        new URL(`../../src/runtime/workers/${name}`, import.meta.url),
        'utf8'
      )
      const wasmVersion = worker.match(/@mediapipe\/tasks-vision@([\d.]+)\/wasm/)?.[1]
      expect(wasmVersion).toBe(pkg.dependencies['@mediapipe/tasks-vision'])
    })
  }
})
