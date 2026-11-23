import { shallowRef, watch } from 'vue'
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OneEuroState } from '../../../utils/tryon'
import type { TempleRig } from '../../../utils/tryon-temples'
import { useTryOnModelCache, type TryOnModelCache } from '../useTryOnModelCache'

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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

export interface TempleState {
  rig: TempleRig | null
  filters: (OneEuroState | null)[]
  time: number
}

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
  const modelCache =
    props.modelCache ??
    useTryOnModelCache({
      draco: props.draco,
      dracoDecoderPath: props.dracoDecoderPath,
      capacity: 2
    })

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
