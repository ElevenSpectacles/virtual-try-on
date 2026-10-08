import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The worker bundles @mediapipe/tasks-vision's JS but loads its WASM from a
// CDN by default. Mixing versions is unsupported, so the pinned dependency
// and the default WASM URL must move together.
describe('MediaPipe version', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  ) as { dependencies: Record<string, string> }
  const worker = readFileSync(
    new URL(
      '../../src/runtime/workers/face-landmarker.worker.ts',
      import.meta.url
    ),
    'utf8'
  )

  it('pins an exact dependency version', () => {
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('loads the WASM matching the pinned JS', () => {
    const wasmVersion = worker.match(/@mediapipe\/tasks-vision@([\d.]+)\/wasm/)?.[1]
    expect(wasmVersion).toBe(pkg.dependencies['@mediapipe/tasks-vision'])
  })
})
