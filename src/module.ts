import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export type { TryOnModel, TryOnModelFamily } from './runtime/composables/tryon/useTryOnModels'
export type { TryOnLogger } from './runtime/utils/tryon-logger'
export type {
  TryOnCalibrationFile,
  TryOnFrameCalibration,
  TryOnModelCalibration
} from './runtime/types/tryon-calibration'

/**
 * Nuxt module wrapper around the virtual try-on experience.
 *
 * Registers everything a host previously had to wire by hand in its
 * `nuxt.config.ts`:
 *
 * - `components/` (unprefixed auto-imported component names)
 * - `composables/` + `utils/` auto-imports
 * - Tailwind v4 source detection for this module's components (they live
 *   outside the host root, so they are invisible to default scanning —
 *   a tiny vite transform appends an `@source` directive to every CSS
 *   entry that pulls in Tailwind)
 * - Vite dev-server `fs.allow` so the classic face-landmarker worker can
 *   be served from outside the host project root
 *
 * Built with `@nuxt/module-builder`: the published package ships
 * `dist/module.mjs` + transpiled `dist/runtime/`, while local-path consumers
 * (the playground, a sibling host checkout) load this source file directly
 * and resolve `./runtime` against `src/` — both layouts must keep working.
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['@eleven.spectacles/virtual-try-on']
 * })
 * ```
 */
export default defineNuxtModule({
  meta: {
    name: '@eleven.spectacles/virtual-try-on',
    configKey: 'virtualTryOn',
    compatibility: { nuxt: '>=4.0.0' }
  },
  setup(_options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const componentsDir = resolve('./runtime/components')

    addComponentsDir({ path: componentsDir, pathPrefix: false })

    // addImportsDir scans only the top level of each dir, and the
    // composables live in composables/tryon/ — register it explicitly.
    addImportsDir([
      resolve('./runtime/composables'),
      resolve('./runtime/composables/tryon'),
      resolve('./runtime/utils')
    ])

    // The classic worker is referenced via `new URL(…, import.meta.url)`;
    // esbuild dep pre-bundling would relocate the runtime and break that URL
    // when the package is consumed from node_modules.
    nuxt.options.vite.optimizeDeps ??= {}
    nuxt.options.vite.optimizeDeps.exclude ??= []
    nuxt.options.vite.optimizeDeps.exclude.push('@eleven.spectacles/virtual-try-on')

    // Peers must resolve to the host's single copy: a sibling checkout with
    // its own node_modules would otherwise bundle a second vue/three
    // (duplicate renderer state, broken reactivity, ~600 KB extra).
    nuxt.options.vite.resolve ??= {}
    nuxt.options.vite.resolve.dedupe ??= []
    nuxt.options.vite.resolve.dedupe.push(
      'vue',
      'three',
      '@tresjs/core',
      '@tresjs/cientos',
      '@vueuse/core'
    )

    // Dev server must be allowed to serve this module's classic worker and
    // component sources from outside the host project root.
    nuxt.options.vite.server ??= {}
    nuxt.options.vite.server.fs ??= {}
    nuxt.options.vite.server.fs.allow ??= []
    nuxt.options.vite.server.fs.allow.push(resolve('./runtime'))

    // Tailwind v4 only scans the host root; register this module's
    // components as an explicit source on every CSS entry that imports
    // Tailwind. The plugin is PREPENDED so it appends the @source directive
    // before @tailwindcss/vite compiles the entry (hook-appended plugins run
    // after it — verified empirically). Idempotent per file via includes().
    const sourceDir = componentsDir.replaceAll('\\', '/')
    nuxt.hook('vite:extendConfig', (config) => {
      const cfg = config as { plugins?: unknown[] }
      ;(cfg.plugins ??= []).unshift({
        name: 'virtual-try-on:tailwind-source',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (!/\.css($|\?)/.test(id)) return
          if (!/@import\s+["'][^"']*tailwindcss/.test(code)) return
          if (code.includes(sourceDir)) return
          return `${code}\n@source "${sourceDir}";\n`
        }
      })
    })
  }
})
