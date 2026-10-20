import { computed, onUnmounted, watch, type ShallowRef } from 'vue'
import { Box3Helper, Color } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { localBounds } from './useSceneModel'

/**
 * Wireframe box around the GLB's local bounds (`localBounds`), the
 * calibration reference, while `showBoundingBox` is on.
 */
export function useBoundingBoxHelper(
  model: ShallowRef<GLTF | null>,
  props: { showBoundingBox: boolean }
) {
  const boundingBoxHelper = computed(() => {
    if (!props.showBoundingBox || !model.value) return null
    return new Box3Helper(localBounds(model.value.scene), new Color('yellow'))
  })
  // `<primitive>` objects are never disposed by Tres, so free the previous
  // helper's geometry/material whenever it is rebuilt or toggled off.
  watch(boundingBoxHelper, (_helper, previous) => previous?.dispose())

  onUnmounted(() => boundingBoxHelper.value?.dispose())

  return boundingBoxHelper
}
