import { onBeforeUnmount } from 'vue'
import { Mesh, type Material, type Texture } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createLruCache } from '../../utils/tryon-model-cache'
import { rigTemples, type TempleRig } from '../../utils/tryon-temples'

// Same decoder build cientos defaulted to, so self-hosting paths carry over.
export const DEFAULT_DRACO_DECODER_PATH =
  'https://www.gstatic.com/draco/versioned/decoders/1.5.6/'

/** A parsed, rigged frame, ready to mount. */
export interface CachedModel {
  gltf: GLTF
  /** Temples on hinge pivots, rigged once at load (null: kept as authored). */
  rig: TempleRig | null
}

export interface UseTryOnModelCacheOptions {
  /** Wire up Draco decompression (harmless for uncompressed GLBs). Default on. */
  draco?: boolean
  dracoDecoderPath?: string | undefined
  /** Parsed GLBs kept in memory. Default 4. */
  capacity?: number
}

export type TryOnModelCache = ReturnType<typeof useTryOnModelCache>

// Free a GLB's GPU resources: geometries, the authored materials (built lens
// materials are freed by the scene that built them) and their textures.
function disposeModel({ gltf }: CachedModel) {
  const textures = new Set<Texture>()
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    obj.geometry?.dispose()
    const authored: Material | Material[] = obj.userData.tryOnAuthoredMaterial ?? obj.material
    for (const material of Array.isArray(authored) ? authored : [authored]) {
      for (const value of Object.values(material)) {
        if (value && (value as Texture).isTexture) textures.add(value as Texture)
      }
      material.dispose()
    }
  })
  for (const texture of textures) texture.dispose()
}

type IdleHandle = { cancel: () => void }

function onIdle(callback: () => void): IdleHandle {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: 2000 })
    return { cancel: () => cancelIdleCallback(id) }
  }
  // Safari before 18 has no requestIdleCallback.
  const id = setTimeout(callback, 200)
  return { cancel: () => clearTimeout(id) }
}

/**
 * Parsed-GLB cache (issue #94): every frame is fetched, parsed and rigged
 * once, kept in an LRU (disposed on eviction), and shared by concurrent
 * loads. `prefetch()` warms it in idle time, one GLB at a time, so it never
 * competes with the frame on screen. The frame on screen (`setActive`) is
 * never evicted.
 *
 * Client-only: the loaders are created on the first load.
 */
export function useTryOnModelCache(options: UseTryOnModelCacheOptions = {}) {
  let loader: GLTFLoader | null = null
  let dracoLoader: DRACOLoader | null = null
  let active: string | null = null

  const cache = createLruCache<string, Promise<CachedModel>>(
    options.capacity ?? 4,
    (pending) => {
      pending.then(disposeModel, () => {})
    },
    (key) => key === active
  )

  function gltfLoader(): GLTFLoader {
    if (loader) return loader
    loader = new GLTFLoader()
    if (options.draco ?? true) {
      dracoLoader = new DRACOLoader().setDecoderPath(
        options.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH
      )
      loader.setDRACOLoader(dracoLoader)
    }
    return loader
  }

  /** The parsed frame at `src`, from the cache or the network. */
  function load(src: string): Promise<CachedModel> {
    const cached = cache.get(src)
    if (cached) return cached
    const pending = gltfLoader()
      .loadAsync(src)
      .then((gltf) => ({ gltf, rig: rigTemples(gltf.scene) }))
    // A failed load is not cached: the next request retries.
    pending.catch(() => {
      if (cache.has(src)) cache.delete(src)
    })
    cache.set(src, pending)
    return pending
  }

  /** Whether `src` is parsed or on its way. */
  function has(src: string): boolean {
    return cache.has(src)
  }

  /** Mark the frame on screen: never evicted, and most recently used. */
  function setActive(src: string | null) {
    active = src
    if (src) cache.get(src)
  }

  // Idle prefetch queue: one GLB at a time, each in an idle slot.
  let queue: string[] = []
  let idle: IdleHandle | null = null
  let inFlight = false

  function pump() {
    if (idle || inFlight) return
    const next = queue.shift()
    if (next === undefined) return
    idle = onIdle(() => {
      idle = null
      if (has(next)) return pump()
      inFlight = true
      load(next)
        .catch(() => {
          // A failed prefetch is retried on demand; nothing to report.
        })
        .finally(() => {
          inFlight = false
          pump()
        })
    })
  }

  /**
   * Fetch and parse `srcs` in idle time, in order. Replaces any queued
   * prefetch that has not started.
   */
  function prefetch(srcs: readonly string[]) {
    queue = srcs.filter((src) => !has(src))
    pump()
  }

  function resize(capacity: number) {
    cache.resize(capacity)
  }

  function dispose() {
    queue = []
    idle?.cancel()
    idle = null
    active = null
    cache.clear()
    dracoLoader?.dispose()
    dracoLoader = null
    loader = null
  }

  onBeforeUnmount(dispose)

  return { load, has, setActive, prefetch, resize, dispose, keys: () => cache.keys() }
}
