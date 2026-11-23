import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildConfig } from 'unbuild'

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
