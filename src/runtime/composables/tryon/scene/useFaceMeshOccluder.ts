import { onUnmounted, shallowRef, watch } from 'vue'
import { BufferAttribute, BufferGeometry } from 'three'
import { FACE_MESH_OCCLUDER_INDEX } from '../../../utils/tryon-occluder'

/** The face-mesh occluder's geometry, updated in place per detection. */
export function useFaceMeshOccluder(props: {
  occluderPositions: Float32Array | null
  contactShadow: boolean
}) {
  // Face-mesh occluder: one persistent BufferGeometry whose positions are
  // re-uploaded per frame from `occluderPositions`. Fixed layout (468 tracked
  // landmark vertices plus the collar ring, FACE_MESH_OCCLUDER_INDEX
  // triangles) so no re-allocation happens per detection. Frustum culling is
  // disabled — recomputing a bounding sphere every frame costs more than the
  // depth-only draw it would save.
  const occluderMeshGeometry = shallowRef<BufferGeometry | null>(null)

  watch(
    () => props.occluderPositions,
    (positions) => {
      if (!positions) {
        // Tres only fires `Object3D.dispose()` on the unmounted mesh — a
        // geometry passed in as a prop is ours to free, else every lost-face
        // cycle leaks its GPU buffers.
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
      // The contact-occlusion receiver needs the skin's normals (468 vertices:
      // cheap); the depth-only occluder ignores them.
      if (props.contactShadow) geometry.computeVertexNormals()
    },
    { immediate: true }
  )

  onUnmounted(() => occluderMeshGeometry.value?.dispose())

  return occluderMeshGeometry
}
