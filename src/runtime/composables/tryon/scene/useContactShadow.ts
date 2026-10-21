import { computed, onUnmounted, watch, type ShallowRef } from 'vue'
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
import type { TryOnLens } from '../../../utils/tryon-lens'
import { aimLight, type LightDirection } from '../../../utils/tryon-room'
import { LENS_MATERIAL_NAME } from './useLensMaterials'

/**
 * A contact-occlusion sphere in the local space of the mesh it was fitted
 * to, so it moves with that mesh: the temple arms turn at their hinges
 * every frame (utils/tryon-temples) and may bend behind the ears.
 */
export interface MeshOccluderSphere extends OccluderSphere {
  mesh: Mesh
}

/** The receiver's uniforms, shared with `useContactOcclusion`. */
export type ContactReceiverUniforms = ReturnType<typeof useContactShadow>['receiverUniforms']

/**
 * The contact shadow's casting side: the shadow-only light framed on the
 * frame (aimed by the room's light direction when known) and, for the
 * tinted lens shadow, a second light the lenses cast into; what casts into
 * their maps; the contact-occlusion spheres fitted to the frame; and the
 * receiver's uniforms and shadow colour, which `useContactOcclusion` draws
 * with.
 */
export function useContactShadow(
  model: ShallowRef<GLTF | null>,
  props: {
    contactShadow: boolean
    tintedLensShadow: boolean
    videoElement: HTMLVideoElement | null
    position: { x: number; y: number; z?: number }
    scale: number
    lightDirection: LightDirection | null
    lens: TryOnLens
  }
) {
  // Contact shadow (utils/tryon-contact-shadow): a shadow-only light (no
  // intensity, so it changes no shading) renders a small
  // shadow map of the frame, framed tightly on it, and a ShadowMaterial copy
  // of the face mesh shows that shadow on the skin. Only the opaque parts
  // (rims, bridge, pads, temples) cast into it. A lens shadow needs the
  // lens's colour, which a black multiply can't give: a brown lens's light
  // stays warm, but black turns its shadow into a grey patch on the cheek,
  // the more visible the paler the skin there. So lenses cast only with the
  // tinted lens shadow (below), which colours their shadow against the
  // camera pixels. The host canvas uses VSM:
  // its blur pass keeps the edge soft, as from a room light rather than a
  // spotlight, without PCF's speckle at a wide radius.
  //
  // The shadow is black, which makes it a multiply: the canvas is transparent
  // over the DOM <video> and the browser composites it premultiplied, so a
  // black texel of alpha a leaves `video × (1 − a)`. A shadow removes light in
  // proportion, so dark skin barely changes and the skin keeps its own hue (the
  // reddish cast of real skin shadows comes from the skin itself). A coloured
  // shadow would add `colour × a` on top instead, which shows as a brown stain
  // on dark skin. A tinted multiply (warm shadow, tinted lens shadow) would
  // need the video pixels in the shader, a follow-up to issue #88.
  const SHADOW_COLOR = new Color(0, 0, 0)
  const SHADOW_MAP_SIZE = 512
  const SHADOW_RADIUS = 8
  /** Share of light a lens blocks in the shadow, per unit of lens opacity. */
  const LENS_SHADOW_DENSITY = 0.6

  // Receiver uniforms: contact occlusion and the tinted lens shadow (below).
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
  // Tinted lens shadow (opt-in): the lenses cast into a second, identical
  // shadow map of their own (`shadowCasterFilter` keeps each part out of the
  // other light's map), so the receiver can colour their shadow. Directional
  // shadows are indexed in scene order, so this light must come after
  // `shadowLight` (template).
  const lensShadowLight = makeShadowLight()
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

  // Frame the shadow camera on the frame. The light is directional and has
  // no intensity, so moving it changes only what the shadow map covers.
  watch(
    [() => props.position, () => props.scale, () => props.lightDirection],
    ([position, scale, direction]) => {
      const light = contactShadowLight(position, scale, aimLight(SHADOW_LIGHT_DIRECTION, direction))
      for (const target of [shadowLight, lensShadowLight]) {
        target.position.set(light.position.x, light.position.y, light.position.z)
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

  // Every frame mesh casts; lens meshes only into the tinted lens shadow's
  // map. The receiver never casts.
  /** Contact-occlusion spheres of the current frame (see below). */
  let occluderSpheres: MeshOccluderSphere[] = []

  watch(
    [model, () => props.contactShadow, () => props.lens, tinted],
    ([gltf, enabled, , tint]) => {
      let lensDensity = 0
      let lensColor: [number, number, number] | null = null
      gltf?.scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        const current = Array.isArray(obj.material) ? obj.material : [obj.material]
        const lens = current.find((m: Material) => LENS_MATERIAL_NAME.test(m.name))
        obj.castShadow = enabled && (!lens || tint)
        // Tinted: each part casts into its own light's map only.
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

  // Contact occlusion (utils/tryon-contact-occlusion): the soft darkening where
  // the frame lies on or close to the skin (pads, bridge, temples), which a
  // one-light shadow map does not produce. Spheres fitted to the frame's own
  // vertices, in GLB-local metres, are moved into world space every render and
  // the receiver darkens each skin point by the solid angle they cover. Lenses
  // count by their density, like their shadow. The spheres are refitted with
  // the lens depth materials above (`occluderSpheres`).

  function frameOccluderSpheres(root: Object3D): MeshOccluderSphere[] {
    root.updateMatrixWorld(true)
    const sceneInverse = new Matrix4().copy(root.matrixWorld).invert()
    const relative = new Matrix4()
    const point = new Vector3()
    const parts: OccluderPart[] = []
    // Per part: its mesh and the GLB-root → mesh-local transform. The cells are
    // fitted in root space (one grid for the whole frame), then each sphere is
    // kept in its own mesh's space.
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
    /** Contact-occlusion spheres of the current frame. */
    occluderSpheres: () => occluderSpheres
  }
}
