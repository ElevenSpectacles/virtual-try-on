import { onUnmounted, watch } from 'vue'
import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget
} from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useTres } from '@tresjs/core'
import type { EnvPreset } from '../../../utils/tryon'
import {
  CAMERA_ENV_HEIGHT,
  CAMERA_ENV_WIDTH,
  cameraEnvironment,
  downsampleEquirect
} from '../../../utils/tryon-room'
import type { RoomSample } from '../useTryOnLighting'
import { errorMessage } from './useSceneModel'

const CAMERA_ENV_INTERVAL_MS = 500

export function useSceneEnvironment(
  props: {
    useEnvironment: boolean
    envPreset: EnvPreset
    environmentUrl?: string | undefined
    proceduralEnvironment: boolean
    envIntensity: number
    roomSample: RoomSample | null
  },
  options: {
    presetUrl: (preset: EnvPreset) => string
    timing: (ms: number) => void
    error: (message: string) => void
  }
) {
  const { scene, renderer } = useTres()
  let envTexture: Texture | null = null
  let studioGrid: Float32Array | null = null
  let envLoadId = 0

  function clearEnvironment() {
    if (scene.value.environment === envTexture) scene.value.environment = null
    envTexture?.dispose()
    envTexture = null
    studioGrid = null
  }

  function webglRenderer(): WebGLRenderer | null {
    if ('isRenderer' in renderer) return null
    return typeof renderer.getContext === 'function' ? renderer : null
  }

  function roomEnvironment(): Texture | null {
    const target = webglRenderer()
    if (!target) return null
    const generator = new PMREMGenerator(target)
    const room = new RoomEnvironment()
    const texture = generator.fromScene(room, 0.04).texture
    room.dispose()
    generator.dispose()
    return texture
  }

  let pmrem: PMREMGenerator | null = null
  let cameraEnvTarget: WebGLRenderTarget | null = null
  let cameraEnvUpdatedAt = -Infinity

  function clearCameraEnvironment() {
    if (cameraEnvTarget && scene.value.environment === cameraEnvTarget.texture) {
      scene.value.environment = envTexture
    }
    cameraEnvTarget?.dispose()
    cameraEnvTarget = null
  }

  watch(
    () => props.roomSample,
    (sample) => {
      if (!sample || !props.useEnvironment) {
        clearCameraEnvironment()
        return
      }
      const now = performance.now()
      if (now - cameraEnvUpdatedAt < CAMERA_ENV_INTERVAL_MS) return
      const target = webglRenderer()
      if (!target) return
      cameraEnvUpdatedAt = now
      const radiance = cameraEnvironment(sample.pixels, sample.width, sample.height, {
        studio: studioGrid
      })
      const half = new Uint16Array(radiance.length)
      for (let i = 0; i < radiance.length; i++) half[i] = DataUtils.toHalfFloat(radiance[i]!)
      const equirect = new DataTexture(
        half,
        CAMERA_ENV_WIDTH,
        CAMERA_ENV_HEIGHT,
        RGBAFormat,
        HalfFloatType
      )
      equirect.mapping = EquirectangularReflectionMapping
      equirect.colorSpace = LinearSRGBColorSpace
      equirect.magFilter = LinearFilter
      equirect.minFilter = LinearFilter
      equirect.needsUpdate = true
      pmrem ??= new PMREMGenerator(target)
      const next = pmrem.fromEquirectangular(equirect)
      equirect.dispose()
      cameraEnvTarget?.dispose()
      cameraEnvTarget = next
      scene.value.environment = next.texture
    }
  )

  watch(
    [
      () => props.useEnvironment,
      () => props.envPreset,
      () => props.environmentUrl,
      () => props.proceduralEnvironment
    ],
    async ([enabled, preset, url, procedural]) => {
      const id = ++envLoadId
      clearEnvironment()
      if (!enabled) return
      const startedAt = performance.now()
      if (procedural) {
        envTexture = roomEnvironment()
        if (envTexture) {
          if (!cameraEnvTarget) scene.value.environment = envTexture
          options.timing(performance.now() - startedAt)
        }
        return
      }
      try {
        const texture = await new HDRLoader().loadAsync(url ?? options.presetUrl(preset))
        if (id !== envLoadId) {
          texture.dispose()
          return
        }
        texture.mapping = EquirectangularReflectionMapping
        envTexture = texture
        const image = texture.image as { data: ArrayLike<number>; width: number; height: number }
        studioGrid = downsampleEquirect(
          image.data,
          image.width,
          image.height,
          4,
          CAMERA_ENV_WIDTH,
          CAMERA_ENV_HEIGHT,
          texture.type === HalfFloatType ? DataUtils.fromHalfFloat : (v) => v
        )
        if (!cameraEnvTarget) scene.value.environment = texture
        options.timing(performance.now() - startedAt)
      } catch (err) {
        if (id === envLoadId) options.error(errorMessage(err))
      }
    },
    { immediate: true }
  )

  watch(
    () => props.envIntensity,
    (intensity) => {
      scene.value.environmentIntensity = intensity
    },
    { immediate: true }
  )

  onUnmounted(() => {
    envLoadId++
    clearCameraEnvironment()
    pmrem?.dispose()
    clearEnvironment()
  })
}
