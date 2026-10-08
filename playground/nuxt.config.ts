import { fileURLToPath } from 'node:url'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Standalone dev playground for the virtual try-on module. It exists ONLY for
// local tuning and loads the module from source (`src/module.ts`), like a
// sibling checkout of the Eleven Spectacles host would (`../..` = the Eleven
// workspace root).
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
  // worker fs.allow) is exercised exactly like a host's.
  modules: ['@nuxt/ui', r('../src/module')],

  css: ['~/assets/css/main.css'],

  icon: {
    // The module's components live outside the playground root, so usage
    // scanning misses them — bundle the heroicons collection explicitly for
    // the Nitro endpoint (lucide backs @nuxt/ui's default loading icon) and
    // list the module's icons for the render bundle.
    serverBundle: { collections: ['heroicons', 'lucide'] },
    clientBundle: {
      icons: [
        'heroicons:check',
        'heroicons:exclamation-triangle',
        'heroicons:stop',
        'heroicons:video-camera'
      ]
    }
  },

  // Same URL as the host and the component's `modelBaseUrl` default.
  nitro: {
    publicAssets: [{ dir: modelsDir, baseURL: 'models/virtual-try-on' }]
  },

  devtools: { enabled: true }
})
