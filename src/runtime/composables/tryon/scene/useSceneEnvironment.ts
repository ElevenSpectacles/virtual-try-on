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
// three's own loaders instead of @tresjs/cientos: cientos ships as one
// non-tree-shakeable file, so `useGLTF` + `Environment` pulled the whole
// library (plus three-stdlib and camera-controls) into the host bundle. The
// GLTF/Draco loaders live in the model cache.
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

// Camera reflections (issue #84): the room sample becomes a 128×64 equirect
// (utils/tryon-room `cameraEnvironment`, blended with the studio map),
// PMREM-filtered at most every CAMERA_ENV_INTERVAL_MS (the sample is
// smoothed anyway; ~0.3 ms per update on a laptop GPU). Without a sample
// the studio map stays.
const CAMERA_ENV_INTERVAL_MS = 500

/**
 * The scene's image-based lighting, as `scene.environment`: the studio map
 * (an HDR file, the preset's or `environmentUrl`, or three's procedural
 * room), replaced by the camera's own reflections while a room sample is
 * known, and the environment intensity.
 */
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
    /** URL of a preset's HDR file (the component's `ENV_PRESET_FILES`). */
    presetUrl: (preset: EnvPreset) => string
    timing: (ms: number) => void
    error: (message: string) => void
  }
) {
  // Image-based lighting from an equirect HDR, set as scene.environment —
  // the renderer PMREM-filters equirect environments itself. If the HDR
  // fails to load only reflections are lost; the ambient/directional lights
  // still light the frame.
  const { scene, renderer } = useTres()
  let envTexture: Texture | null = null
  // The studio map downsampled to the camera environment's size, for blending.
  let studioGrid: Float32Array | null = null
  let envLoadId = 0

  function clearEnvironment() {
    if (scene.value.environment === envTexture) scene.value.environment = null
    envTexture?.dispose()
    envTexture = null
    studioGrid = null
  }

  // Procedural room: three's RoomEnvironment PMREM-filtered once on the GPU.
  // No download, a few ms of GPU time; neutral soft-box reflections.
  function roomEnvironment(): Texture | null {
    const target = renderer as unknown as WebGLRenderer
    if (typeof target?.getContext !== 'function') return null
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
      const target = renderer as unknown as WebGLRenderer
      if (typeof target?.getContext !== 'function') return
      cameraEnvUpdatedAt = now
      // Half float: linear filtering of full floats is an extension
      // (OES_texture_float_linear) some GPUs lack; half floats always filter.
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
          scene.value.environment = envTexture
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
