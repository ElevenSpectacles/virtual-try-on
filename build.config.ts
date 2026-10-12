import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildConfig } from 'unbuild'

// mkdist transpiles the workers to `.js`, but leaves the
// `new URL('…worker.ts', import.meta.url)` string in the composables that
// start them untouched — point each built composable at its emitted `.js`
// worker. Fails the build loudly if a reference ever moves, instead of
// shipping a 404.
const WORKERS = [
  {
    composable: 'runtime/composables/tryon/useFaceLandmarker.js',
    worker: 'face-landmarker.worker'
  },
  {
    composable: 'runtime/composables/tryon/useHairSegmenter.js',
    worker: 'hair-segmenter.worker'
  }
]

export default {
  hooks: {
    async 'build:done'(ctx) {
      for (const { composable, worker } of WORKERS) {
        const file = join(ctx.options.outDir, composable)
        const code = await readFile(file, 'utf8')
        if (!code.includes(`${worker}.ts`)) {
          throw new Error(`[build] ${composable} no longer references ${worker}.ts`)
        }
        await writeFile(file, code.replaceAll(`${worker}.ts`, `${worker}.js`))
      }
    }
  }
} satisfies BuildConfig
