import { computed, onUnmounted, watch, type Ref, type ShallowRef } from 'vue'
import {
  Color,
  DirectionalLight,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  Vector4,
  type Material,
  type MeshStandardMaterial,
  type VideoTexture
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SHADOW_LIGHT_DIRECTION, contactShadowLight } from '../../../utils/tryon-contact-shadow'
import {
  FRAME_SPHERE_CELL_METERS,
  LENS_SPHERE_CELL_METERS,
  MAX_OCCLUDER_SPHERES,
  fitFrameOccludersByPart,
  type OccluderPart,
  type OccluderSphere
} from '../../../utils/tryon-contact-occlusion'
import { lensTransmission, shadowCasterFilter } from '../../../utils/tryon-lens-shadow'
import { aimLight, type LightDirection } from '../../../utils/tryon-room'
import { LENS_MATERIAL_NAME } from '../../../utils/tryon-lens'

export interface MeshOccluderSphere extends OccluderSphere {
  mesh: Mesh
}

export type ContactReceiverUniforms = ReturnType<typeof useContactShadow>['receiverUniforms']

export function useContactShadow(
  model: ShallowRef<GLTF | null>,
  props: {
    contactShadow: boolean
    tintedLensShadow: boolean
    videoElement: HTMLVideoElement | null
    position: { x: number; y: number; z?: number }
    scale: number
    lightDirection: LightDirection | null
  },
  materials: { dressed: Readonly<Ref<number>> }
) {
  const SHADOW_COLOR = new Color(0, 0, 0)
  const SHADOW_MAP_SIZE = 512
  const SHADOW_RADIUS = 8
  const LENS_SHADOW_DENSITY = 0.6

  const receiverUniforms = {
    uSpheres: {
      value: Array.from({ length: MAX_OCCLUDER_SPHERES }, () => new Vector4())
    },
    uSphereCount: { value: 0 },
    uOcclusionRange: { value: 0 },
    uOcclusionStrength: { value: 0 },
    uLensShadowDensity: { value: 0 },
    uLensTransmission: { value: new Vector3(1, 1, 1) },
    uVideo: { value: null as VideoTexture | null },
    uWindow: { value: new Vector4(0, 1, 0, 1) }
  }

  function makeShadowLight(): DirectionalLight {
    const light = new DirectionalLight(0xffffff, 0)
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    light.shadow.radius = SHADOW_RADIUS
    light.shadow.blurSamples = 12
    light.shadow.bias = -0.0005
    return light
  }
  const shadowLight = makeShadowLight()
  const lensShadowLight = makeShadowLight()
  shadowLight.add(lensShadowLight)
  const tinted = computed(
    () => props.contactShadow && props.tintedLensShadow && !!props.videoElement
  )

  watch(
    [() => props.contactShadow, tinted],
    ([enabled, tint]) => {
      shadowLight.castShadow = enabled
      lensShadowLight.castShadow = tint
    },
    { immediate: true }
  )

  watch(
    [() => props.position, () => props.scale, () => props.lightDirection],
    ([position, scale, direction]) => {
      const light = contactShadowLight(position, scale, aimLight(SHADOW_LIGHT_DIRECTION, direction))
      shadowLight.position.set(light.position.x, light.position.y, light.position.z)
      for (const target of [shadowLight, lensShadowLight]) {
        target.target.position.set(light.target.x, light.target.y, light.target.z)
        target.target.updateMatrixWorld()
        const camera = target.shadow.camera
        camera.left = -light.halfExtent
        camera.right = light.halfExtent
        camera.top = light.halfExtent
        camera.bottom = -light.halfExtent
        camera.near = light.near
        camera.far = light.far
        camera.updateProjectionMatrix()
      }
    },
    { immediate: true }
  )

  let occluderSpheres: MeshOccluderSphere[] = []

  watch(
    [materials.dressed, () => props.contactShadow, tinted],
    ([, enabled, tint]) => {
      const gltf = model.value
      let lensDensity = 0
      let lensColor: [number, number, number] | null = null
      gltf?.scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        const current = Array.isArray(obj.material) ? obj.material : [obj.material]
        const lens = current.find((m: Material) => LENS_MATERIAL_NAME.test(m.name))
        obj.castShadow = enabled && (!lens || tint)
        const filter = tint
          ? shadowCasterFilter(!!lens, () => lensShadowLight.shadow.camera)
          : null
        obj.onBeforeShadow = filter?.onBeforeShadow ?? Object3D.prototype.onBeforeShadow
        obj.onAfterShadow = filter?.onAfterShadow ?? Object3D.prototype.onAfterShadow
        if (lens) {
          lensDensity = Math.max(lensDensity, Math.min(lens.opacity * LENS_SHADOW_DENSITY, 1))
          const color = (lens as MeshStandardMaterial).color
          if (color) lensColor = [color.r, color.g, color.b]
        }
      })
      occluderSpheres = enabled && gltf ? frameOccluderSpheres(gltf.scene) : []
      receiverUniforms.uLensShadowDensity.value = lensDensity
      receiverUniforms.uLensTransmission.value.set(...lensTransmission(lensColor))
    },
    { immediate: true }
  )

  function frameOccluderSpheres(root: Object3D): MeshOccluderSphere[] {
    root.updateMatrixWorld(true)
    const sceneInverse = new Matrix4().copy(root.matrixWorld).invert()
    const relative = new Matrix4()
    const point = new Vector3()
    const parts: OccluderPart[] = []
    const owners: { mesh: Mesh; toLocal: Matrix4; scale: number }[] = []
    root.traverse((obj) => {
      if (!(obj instanceof Mesh) || !obj.geometry) return
      const position = obj.geometry.getAttribute('position')
      if (!position) return
      relative.multiplyMatrices(sceneInverse, obj.matrixWorld)
      owners.push({
        mesh: obj,
        toLocal: relative.clone().invert(),
        scale: relative.getMaxScaleOnAxis()
      })
      const points = new Float32Array(position.count * 3)
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(relative)
        points.set([point.x, point.y, point.z], i * 3)
      }
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      const lens = materials.find((m: Material) => LENS_MATERIAL_NAME.test(m.name))
      parts.push(
        lens
          ? {
              points,
              cellSize: LENS_SPHERE_CELL_METERS,
              weight: Math.min(lens.opacity * LENS_SHADOW_DENSITY, 1)
            }
          : { points, cellSize: FRAME_SPHERE_CELL_METERS, weight: 1 }
      )
    })
    return fitFrameOccludersByPart(parts).flatMap((spheres, i) => {
      const { mesh, toLocal, scale } = owners[i]!
      return spheres.map((sphere) => {
        point.set(sphere.x, sphere.y, sphere.z).applyMatrix4(toLocal)
        return { mesh, x: point.x, y: point.y, z: point.z, r: sphere.r / scale }
      })
    })
  }

  onUnmounted(() => {
    shadowLight.dispose()
    lensShadowLight.dispose()
  })

  return {
    shadowColor: SHADOW_COLOR,
    receiverUniforms,
    shadowLight,
    lensShadowLight,
    tinted,
    occluderSpheres: () => occluderSpheres
  }
}
