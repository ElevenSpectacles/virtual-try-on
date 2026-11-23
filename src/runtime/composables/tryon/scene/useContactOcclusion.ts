import { onUnmounted, watch, type ComputedRef, type ShallowRef } from 'vue'
import {
  DoubleSide,
  LinearFilter,
  Mesh,
  NoColorSpace,
  ShadowMaterial,
  Vector3,
  VideoTexture,
  type Color,
  type Material,
  type Vector4
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  CONTACT_OCCLUSION_GAIN,
  MAX_OCCLUDER_SPHERES,
  MAX_SPHERE_OCCLUSION,
  OCCLUSION_RANGE_METERS,
  SILHOUETTE_FADE_END,
  SILHOUETTE_FADE_START
} from '../../../utils/tryon-contact-occlusion'
import { TINTED_SHADOW_FRAGMENT } from '../../../utils/tryon-lens-shadow'
import { earBendPoint } from '../../../utils/tryon-temples'
import type { ContactReceiverUniforms, MeshOccluderSphere } from './useContactShadow'

export function useContactOcclusion(
  model: ShallowRef<GLTF | null>,
  props: {
    contactShadowStrength: number
    videoElement: HTMLVideoElement | null
    mediaWindow: { xMin: number; xMax: number; yMin: number; yMax: number }
  },
  shadow: {
    shadowColor: Color
    receiverUniforms: ContactReceiverUniforms
    tinted: ComputedRef<boolean>
    occluderSpheres: () => MeshOccluderSphere[]
  },
  earBendMaterials: Map<Mesh, { material: Material; uniform: { value: Vector4 } }>
) {
  const { shadowColor: SHADOW_COLOR, receiverUniforms, tinted } = shadow

  const shadowReceiverMaterial = new ShadowMaterial({
    color: SHADOW_COLOR,
    transparent: true,
    depthWrite: false,
    side: DoubleSide
  })
  shadowReceiverMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, receiverUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vAoPosition;\nvarying vec3 vAoNormal;'
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
  vAoPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vAoNormal = mat3(modelMatrix) * objectNormal;
  vTintClip = gl_Position;`
      )
      .replace('#include <common>', '#include <common>\nvarying vec4 vTintClip;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAoPosition;
varying vec3 vAoNormal;
uniform vec4 uSpheres[${MAX_OCCLUDER_SPHERES}];
uniform int uSphereCount;
uniform float uOcclusionRange;
uniform float uOcclusionStrength;
uniform float uLensShadowDensity;
uniform vec3 uLensTransmission;
uniform sampler2D uVideo;
uniform vec4 uWindow;
varying vec4 vTintClip;

float contactOcclusion(vec3 p, vec3 n) {
  float visible = 1.0;
  for (int i = 0; i < ${MAX_OCCLUDER_SPHERES}; i++) {
    if (i >= uSphereCount) break;
    vec3 d = uSpheres[i].xyz - p;
    float r = uSpheres[i].w;
    float d2 = max(dot(d, d), r * r);
    float dist = sqrt(d2);
    float fade = max(1.0 - (dist - r) / uOcclusionRange, 0.0);
    float cosine = clamp((dot(n, d) + r) / (dist + r), 0.0, 1.0);
    float occlusion = min(cosine * r * r / d2 * fade * fade, ${MAX_SPHERE_OCCLUSION.toFixed(2)});
    visible *= 1.0 - occlusion;
  }
  return 1.0 - visible;
}`
      )
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `vec3 aoNormal = dot(vAoNormal, vAoNormal) > 0.0 ? normalize(vAoNormal) : vec3(0.0, 0.0, 1.0);
  vec3 aoView = normalize(cameraPosition - vAoPosition);
  if (dot(aoNormal, aoView) < 0.0) aoNormal = -aoNormal;
  float aoFacing = smoothstep(${SILHOUETTE_FADE_START.toFixed(2)}, ${SILHOUETTE_FADE_END.toFixed(2)}, dot(aoNormal, aoView));
  float occluded = 1.0 - uOcclusionStrength * aoFacing * contactOcclusion(vAoPosition, aoNormal);
#if defined( TINTED_LENS_SHADOW ) && NUM_DIR_LIGHT_SHADOWS > 1
${TINTED_SHADOW_FRAGMENT}
#else
  float shadowed = 1.0 - opacity * (1.0 - getShadowMask());
  gl_FragColor = vec4(color, 1.0 - shadowed * occluded);
#endif`
      )
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '')
  }

  watch(
    tinted,
    (tint) => {
      if (tint) shadowReceiverMaterial.defines = { TINTED_LENS_SHADOW: '' }
      else delete shadowReceiverMaterial.defines?.TINTED_LENS_SHADOW
      shadowReceiverMaterial.needsUpdate = true
    },
    { immediate: true }
  )

  watch(
    [tinted, () => props.videoElement],
    ([tint, video]) => {
      receiverUniforms.uVideo.value?.dispose()
      receiverUniforms.uVideo.value = null
      if (!tint || !video) return
      const texture = new VideoTexture(video)
      texture.colorSpace = NoColorSpace
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      receiverUniforms.uVideo.value = texture
    },
    { immediate: true }
  )
  watch(
    () => props.mediaWindow,
    (window) => receiverUniforms.uWindow.value.set(window.xMin, window.xMax, window.yMin, window.yMax),
    { immediate: true }
  )

  const sphereCentre = new Vector3()
  shadowReceiverMaterial.onBeforeRender = () => {
    const root = model.value?.scene
      const spheres = root ? shadow.occluderSpheres() : []
    const scale = root ? root.matrixWorld.getMaxScaleOnAxis() : 0
    spheres.forEach((sphere, i) => {
      const bend = earBendMaterials.get(sphere.mesh)?.uniform.value
      const local = bend
        ? earBendPoint(sphere, { start: bend.x, z: bend.y, angle: bend.z }, bend.w)
        : sphere
      sphereCentre.set(local.x, local.y, local.z).applyMatrix4(sphere.mesh.matrixWorld)
      receiverUniforms.uSpheres.value[i]!.set(
        sphereCentre.x,
        sphereCentre.y,
        sphereCentre.z,
        sphere.r * sphere.mesh.matrixWorld.getMaxScaleOnAxis()
      )
    })
    receiverUniforms.uSphereCount.value = spheres.length
    receiverUniforms.uOcclusionRange.value = OCCLUSION_RANGE_METERS * scale
  }

  watch(
    () => props.contactShadowStrength,
    (strength) => {
      shadowReceiverMaterial.opacity = strength
      receiverUniforms.uOcclusionStrength.value = Math.min(
        strength * CONTACT_OCCLUSION_GAIN,
        1
      )
    },
    { immediate: true }
  )

  onUnmounted(() => {
    receiverUniforms.uVideo.value?.dispose()
    shadowReceiverMaterial.dispose()
  })

  return shadowReceiverMaterial
}
