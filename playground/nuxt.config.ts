import { fileURLToPath } from 'node:url'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const modelsDir =
  process.env.TRYON_MODELS_DIR ?? r('../../nuxt/public/models/virtual-try-on')

export default defineNuxtConfig({
  imports: { autoImport: false },
  compatibilityDate: '2026-08-01',

  modules: ['@nuxt/ui', 'nuxt-skill-hub', r('../src/module')],

  skillHub: {
    targets: ['claude-code'],
    moduleAuthoring: true
  },

  css: ['~/assets/css/main.css'],

  icon: {
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

  nitro: {
    publicAssets: [{ dir: modelsDir, baseURL: 'models/virtual-try-on' }]
  },

  devtools: { enabled: true }
})
