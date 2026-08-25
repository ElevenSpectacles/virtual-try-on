import { fileURLToPath } from 'node:url'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Standalone dev playground for the virtual try-on module. It exists ONLY for
// local tuning — the module itself stays a source-only submodule consumed by
// the Eleven Spectacles host (`../..` = the Eleven workspace root).
//
// GLB frames + calibration.json are served straight from the host checkout so
// both apps always render the same assets. Override with TRYON_MODELS_DIR if
// your layout differs.
const modelsDir =
  process.env.TRYON_MODELS_DIR ?? r('../../nuxt/public/models/virtual-try-on')

export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',

  // Dogfooding: consume this repo through its own Nuxt module entry so the
  // auto-registration (components, composables/utils, Tailwind @source,
  // i18n messages, worker fs.allow) is exercised exactly like a host's.
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@tresjs/nuxt', r('..')],

  css: ['~/assets/css/main.css'],

  i18n: {
    locales: [{ code: 'en', language: 'en-US' }],
    defaultLocale: 'en',
    strategy: 'no_prefix',
    restructureDir: '.',
    vueI18n: './i18n.config.ts'
  },

  icon: {
    // The module's components live outside the playground root, so usage
    // scanning misses them — bundle both collections explicitly for the
    // Nitro endpoint and list the module's icons for the render bundle.
    serverBundle: { collections: ['heroicons', 'lucide'] },
    clientBundle: {
      icons: [
        'heroicons:arrow-path',
        'heroicons:arrow-right',
        'heroicons:check',
        'heroicons:computer-desktop',
        'heroicons:exclamation-triangle',
        'heroicons:shield-check',
        'heroicons:stop',
        'heroicons:stop-circle',
        'heroicons:trash',
        'heroicons:user-plus',
        'heroicons:video-camera',
        'heroicons:x-mark'
      ]
    }
  },

  nitro: {
    publicAssets: [{ dir: modelsDir, baseURL: 'models' }]
  },

  devtools: { enabled: true }
})
