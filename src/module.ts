import { addComponentsDir, addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export type { TryOnModel, TryOnModelFamily } from './runtime/composables/tryon/useTryOnModels'
export type { TryOnFeature, TryOnTier } from './runtime/utils/tryon-capability'
export type { TryOnAsset, TryOnMetrics, TryOnSessionMetrics } from './runtime/utils/tryon-metrics'
export type { TryOnFit, TryOnFitRank, TryOnFitVerdict } from './runtime/utils/tryon-fit'
export type { TryOnFaceShape } from './runtime/utils/tryon-face-shape'
export type { TryOnCardCalibration } from './runtime/composables/tryon/useTryOnCardCalibration'
export type { TryOnCardCalibrationStatus } from './runtime/utils/tryon-card'
export type { TryOnCaptureOptions, TryOnCaptureType } from './runtime/utils/tryon-capture'
export type {
  TryOnCalibrationFile,
  TryOnFrameCalibration,
  TryOnModelCalibration
} from './runtime/types/tryon-calibration'
export type {
  FaceLandmarkerError,
  TryOnGuideHint,
  TryOnMeasurements,
  TryOnStatus,
  VirtualTryOnExperienceSlotProps,
  WebcamError
} from './runtime/types/tryon-experience'
export type { VirtualTryOnExperienceProps } from './runtime/types/tryon-experience-props'

export interface ModuleOptions {
  occluder: boolean
}

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig {
    virtualTryOn: { occluder: boolean }
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@eleven.spectacles/virtual-try-on',
    configKey: 'virtualTryOn',
    compatibility: { nuxt: '>=4.0.0' }
  },
  moduleDependencies: {
    '@tresjs/nuxt': {}
  },
  defaults: {
    occluder: true
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.runtimeConfig.public.virtualTryOn = {
      occluder: options.occluder
    }
    const componentsDir = resolve('./runtime/components')

    addComponentsDir({ path: componentsDir, pathPrefix: false })

    addImportsDir([
      resolve('./runtime/composables'),
      resolve('./runtime/composables/tryon'),
      resolve('./runtime/utils')
    ])

    nuxt.options.vite.optimizeDeps ??= {}
    nuxt.options.vite.optimizeDeps.exclude ??= []
    nuxt.options.vite.optimizeDeps.exclude.push('@eleven.spectacles/virtual-try-on')

    nuxt.options.vite.optimizeDeps.include ??= []
    nuxt.options.vite.optimizeDeps.include.push(
      import.meta.url.includes('/node_modules/')
        ? '@eleven.spectacles/virtual-try-on > @mediapipe/tasks-vision'
        : '@mediapipe/tasks-vision'
    )

    nuxt.options.vite.resolve ??= {}
    nuxt.options.vite.resolve.dedupe ??= []
    nuxt.options.vite.resolve.dedupe.push('vue', 'three', '@tresjs/core')

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

    nuxt.options.vite.server ??= {}
    nuxt.options.vite.server.fs ??= {}
    nuxt.options.vite.server.fs.allow ??= []
    nuxt.options.vite.server.fs.allow.push(resolve('./runtime'))
  }
})
