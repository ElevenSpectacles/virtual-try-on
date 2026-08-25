import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

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
 * - `virtualTryOn.*` i18n messages via the `@nuxtjs/i18n`
 *   `i18n:registerModule` hook (a no-op when i18n isn't installed)
 * - Vite dev-server `fs.allow` so the classic face-landmarker worker can
 *   be served from outside the host project root
 *
 * Consumption is by local path only:
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: [fileURLToPath(new URL('../virtual-try-on', import.meta.url))]
 * })
 * ```
 */
export default defineNuxtModule({
  meta: {
    name: '@elevenspectacles/virtual-try-on',
    configKey: 'virtualTryOn',
    compatibility: { nuxt: '>=4.0.0' }
  },
  setup(_options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const componentsDir = resolve('./components')

    addComponentsDir({ path: componentsDir, pathPrefix: false })

    addImportsDir([resolve('./composables'), resolve('./utils')])

    // Dev server must be allowed to serve this module's classic worker and
    // component sources from outside the host project root.
    nuxt.options.vite.server ??= {}
    nuxt.options.vite.server.fs ??= {}
    nuxt.options.vite.server.fs.allow ??= []
    nuxt.options.vite.server.fs.allow.push(resolve('./'))

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

    // Merge the module's translations into every matching locale when the
    // host uses @nuxtjs/i18n. Never fires when it doesn't.
    nuxt.hook('i18n:registerModule', (register) => {
      register({
        langDir: resolve('./i18n'),
        locales: [
          { code: 'bg', language: 'bg-BG', file: 'bg.ts' },
          { code: 'de', language: 'de-DE', file: 'de.ts' },
          { code: 'en', language: 'en-US', file: 'en.ts' },
          { code: 'es', language: 'es-ES', file: 'es.ts' },
          { code: 'fr', language: 'fr-FR', file: 'fr.ts' },
          { code: 'it', language: 'it-IT', file: 'it.ts' },
          { code: 'nl', language: 'nl-NL', file: 'nl.ts' }
        ]
      })
    })
  }
})
