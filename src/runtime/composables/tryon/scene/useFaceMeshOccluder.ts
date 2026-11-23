import { onUnmounted, shallowRef, watch } from 'vue'
import { BufferAttribute, BufferGeometry } from 'three'
import { FACE_MESH_OCCLUDER_INDEX } from '../../../utils/tryon-occluder'

export function useFaceMeshOccluder(props: {
  occluderPositions: Float32Array | null
  contactShadow: boolean
}) {
  const occluderMeshGeometry = shallowRef<BufferGeometry | null>(null)

  watch(
    () => props.occluderPositions,
    (positions) => {
      if (!positions) {
        occluderMeshGeometry.value?.dispose()
        occluderMeshGeometry.value = null
        return
      }
      let geometry = occluderMeshGeometry.value
      if (!geometry) {
        geometry = new BufferGeometry()
        geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(positions.length), 3)
        )
        geometry.setIndex(new BufferAttribute(FACE_MESH_OCCLUDER_INDEX, 1))
        occluderMeshGeometry.value = geometry
      }
      const attribute = geometry.getAttribute('position') as BufferAttribute
      ;(attribute.array as Float32Array).set(positions)
      attribute.needsUpdate = true
      if (props.contactShadow) geometry.computeVertexNormals()
    },
    { immediate: true }
  )

  onUnmounted(() => occluderMeshGeometry.value?.dispose())

  return occluderMeshGeometry
}
