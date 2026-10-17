import { fileURLToPath } from 'node:url'

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Public static demo of <VirtualTryOnExperience> (issue #104), deployed to
// GitHub Pages by .github/workflows/demo.yml. Unlike the playground it is a
// plain host page: no tuning UI, no UI library, and every third-party asset
// served from its own origin (staged by scripts/prepare.mjs).
export default defineNuxtConfig({
  // A strict host, like the playground: the module must import everything.
  imports: { autoImport: false },
  compatibilityDate: '2026-08-01',

  modules: [r('../src/module')],

  // Static hosting: render on the client only. `DEMO_BASE_URL` is the Pages
  // project path (`/virtual-try-on/`).
  ssr: false,
  app: {
    baseURL: process.env.DEMO_BASE_URL ?? '/',
    head: {
      title: 'Virtual Try-On · Eleven Spectacles',
      htmlAttrs: { lang: 'en' },
      meta: [
        {
          name: 'description',
          content:
            'Try eyewear on with your camera. Face tracking and rendering run entirely in your browser.'
        },
        // Main-thread requests may only go to this origin, so a change that
        // reintroduces a CDN breaks the demo instead of slipping through.
        // The trackers' workers fetch their assets under the worker's own
        // policy; their paths are self-hosted props (see app.vue).
        {
          'http-equiv': 'Content-Security-Policy',
          content: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
            "worker-src 'self' blob:",
            "connect-src 'self' blob: data:",
            "img-src 'self' blob: data:",
            "media-src 'self' blob: mediastream:",
            "style-src 'self' 'unsafe-inline'"
          ].join('; ')
        }
      ]
    }
  },

  devtools: { enabled: false }
})
