import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export type { TryOnModel, TryOnModelFamily } from './runtime/composables/tryon/useTryOnModels'
export type {
  TryOnCalibrationFile,
  TryOnFrameCalibration,
  TryOnModelCalibration
} from './runtime/types/tryon-calibration'
export type {
  FaceLandmarkerError,
  TryOnGuideHint,
  TryOnStatus,
  WebcamError
} from './runtime/types/tryon-experience'

/**
 * Nuxt module wrapper around the virtual try-on experience.
 *
 * Registers everything a host previously had to wire by hand in its
 * `nuxt.config.ts`:
 *
 * - `@tresjs/nuxt` (a dependency, installed via `moduleDependencies`)
 * - `components/` (unprefixed auto-imported component names)
 * - `composables/` + `utils/` auto-imports
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
  // TresJS (and three) ship with this module: Nuxt installs @tresjs/nuxt
  // before setup, so hosts add only this module. A host that also lists
  // @tresjs/nuxt itself still gets a single installation.
  moduleDependencies: {
    '@tresjs/nuxt': {}
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

    // MediaPipe is a dependency of this module, reachable only through the
    // worker's dynamic import(), which Vite's dep scanner never crawls —
    // pre-bundle it up front so the first try-on doesn't trigger a dev
    // re-optimisation + full reload. Installed from npm it may sit nested
    // under this package, hence the `parent > dep` form; local checkouts
    // resolve it from their own node_modules.
    nuxt.options.vite.optimizeDeps.include ??= []
    nuxt.options.vite.optimizeDeps.include.push(
      import.meta.url.includes('/node_modules/')
        ? '@eleven.spectacles/virtual-try-on > @mediapipe/tasks-vision'
        : '@mediapipe/tasks-vision'
    )

    // Peers must resolve to the host's single copy: a sibling checkout with
    // its own node_modules would otherwise bundle a second vue/three
    // (duplicate renderer state, broken reactivity, ~600 KB extra).
    nuxt.options.vite.resolve ??= {}
    nuxt.options.vite.resolve.dedupe ??= []
    nuxt.options.vite.resolve.dedupe.push('vue', 'three', '@tresjs/core')

    // three's DRACOLoader references its bundled decoder via
    // `new URL(…, import.meta.url)`, so Vite emits ~1.3 MB of decoder files
    // and Nuxt preloads/prefetches them wherever the try-on chunk renders.
    // The loader is pointed at `dracoDecoderPath` (gstatic by default) and
    // never requests them — drop them from the resource hints.
    const DRACO_ASSET = /(^|\/)draco_(decoder|wasm_wrapper)[.-]/
    nuxt.hook('build:manifest', (manifest) => {
      for (const entry of Object.values(manifest)) {
        if (DRACO_ASSET.test(entry.file)) {
          entry.preload = false
          entry.prefetch = false
        }
        if (entry.assets) {
          entry.assets = entry.assets.filter((a) => !DRACO_ASSET.test(a))
        }
        if (entry.imports) {
          entry.imports = entry.imports.filter(
            (key) => !DRACO_ASSET.test(manifest[key]?.file ?? key)
          )
        }
      }
    })

    // Dev server must be allowed to serve this module's classic worker and
    // component sources from outside the host project root.
    nuxt.options.vite.server ??= {}
    nuxt.options.vite.server.fs ??= {}
    nuxt.options.vite.server.fs.allow ??= []
    nuxt.options.vite.server.fs.allow.push(resolve('./runtime'))
  }
})
