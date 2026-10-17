import { shallowRef, watch } from 'vue'
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OneEuroState } from '../../../utils/tryon'
import type { TempleRig } from '../../../utils/tryon-temples'
import { useTryOnModelCache, type TryOnModelCache } from '../useTryOnModelCache'

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// The GLB's local-space bounding box: the debug helper
// (`useBoundingBoxHelper`), and the frame width the fit verdict compares
// with the face. Calibration y-centers the bbox on the tracked anchor and
// places the frame's FRONT face on it in z (the frame extends backward
// toward the temples), so this box shows exactly what the calibration
// anchors against. The box is accumulated relative to the GLB scene root
// (not via `setFromObject`, which measures in world space and would
// double-apply the group transform once the scene is mounted).
export function localBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true)
  const sceneInverse = new Matrix4().copy(root.matrixWorld).invert()
  const box = new Box3()
  const meshBox = new Box3()
  const relative = new Matrix4()
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return
    obj.geometry.computeBoundingBox()
    relative.multiplyMatrices(sceneInverse, obj.matrixWorld)
    meshBox.copy(obj.geometry.boundingBox!).applyMatrix4(relative)
    box.union(meshBox)
  })
  return box
}

/**
 * The shown GLB's temples on hinge pivots (null: kept as authored), and
 * the One-Euro state of each arm's opening angle (`useTempleFit`).
 */
export interface TempleState {
  rig: TempleRig | null
  filters: (OneEuroState | null)[]
  time: number
}

/**
 * The frame GLB for `TryOnScene`, mounted through the parsed-GLB cache
 * (`useTryOnModelCache`): the shown model, its temple rig (made once at
 * load by the cache) and the load's `timing` / `loaded` / `error` reports.
 */
export function useSceneModel(
  props: {
    src: string
    draco: boolean
    dracoDecoderPath?: string | undefined
    modelCache?: TryOnModelCache | undefined
  },
  emit: {
    timing: (ms: number) => void
    loaded: (widthMeters: number) => void
    error: (message: string) => void
  }
) {
  // Parsed GLBs come from the cache: a switch back to a frame (or to a
  // prefetched one) mounts it at once instead of fetching and parsing again.
  const modelCache =
    props.modelCache ??
    useTryOnModelCache({
      draco: props.draco,
      dracoDecoderPath: props.dracoDecoderPath,
      capacity: 2
    })

  // Non-blocking loader: `model` is null until the first GLB resolves, so a
  // heavy frame download never stalls the whole scene graph. On a model switch
  // the previous frame stays up until the next one arrives; responses for a
  // superseded `src` are dropped.
  const model = shallowRef<GLTF | null>(null)
  let modelLoadId = 0
  const temples: TempleState = { rig: null, filters: [], time: 0 }
  watch(
    () => props.src,
    async (src) => {
      const id = ++modelLoadId
      const startedAt = performance.now()
      try {
        const { gltf, rig } = await modelCache.load(src)
        if (id === modelLoadId) {
          emit.timing(performance.now() - startedAt)
          // A cached frame keeps its last opening: start from the GLB's own.
          for (const temple of rig?.temples ?? []) temple.pivot.rotation.z = 0
          temples.rig = rig
          temples.filters = []
          model.value = gltf
          modelCache.setActive(src)
          emit.loaded(localBounds(gltf.scene).getSize(new Vector3()).x)
        }
      } catch (err) {
        if (id === modelLoadId) emit.error(`${src}: ${errorMessage(err)}`)
      }
    },
    { immediate: true }
  )

  return { model, temples }
}
