import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildConfig } from 'unbuild'

// mkdist transpiles `workers/face-landmarker.worker.ts` to `.js`, but leaves
// the `new URL('…worker.ts', import.meta.url)` string in useFaceLandmarker
// untouched — point the built composable at the emitted `.js` worker. Fails
// the build loudly if the reference ever moves, instead of shipping a 404.
const WORKER_TS = 'face-landmarker.worker.ts'
const WORKER_JS = 'face-landmarker.worker.js'
const COMPOSABLE = 'runtime/composables/tryon/useFaceLandmarker.js'

export default {
  hooks: {
    async 'build:done'(ctx) {
      const file = join(ctx.options.outDir, COMPOSABLE)
      const code = await readFile(file, 'utf8')
      if (!code.includes(WORKER_TS)) {
        throw new Error(`[build] ${COMPOSABLE} no longer references ${WORKER_TS}`)
      }
      await writeFile(file, code.replaceAll(WORKER_TS, WORKER_JS))
    }
  }
} satisfies BuildConfig
