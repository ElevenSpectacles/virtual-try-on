import { onUnmounted, shallowRef, watch } from 'vue'
import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4
} from 'three'
import {
  HAIR_PLANE_SETBACK_METERS,
  HAIR_PLANE_SIZE_METERS,
  type MediaWindow
} from '../../../utils/tryon-hair'
import type { HairMask } from '../useHairSegmenter'

const HAIR_VERTEX = /* glsl */ `
varying vec4 vClip;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vClip = gl_Position;
}
`
const HAIR_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform vec4 uWindow;
varying vec4 vClip;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  vec2 screen = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  vec2 media = vec2(
    uWindow.x + (1.0 - screen.x) * (uWindow.y - uWindow.x),
    uWindow.z + screen.y * (uWindow.w - uWindow.z)
  );
  if (texture2D(uMask, media).r < 0.5) discard;
  gl_FragColor = vec4(0.0);
}
`

export function useHairOccluder(props: { hairMask: HairMask | null; mediaWindow: MediaWindow }) {
  const hairMaskTexture = shallowRef<DataTexture | null>(null)

  watch(
    () => props.hairMask,
    (mask) => {
      if (!mask) {
        hairMaskTexture.value?.dispose()
        hairMaskTexture.value = null
        return
      }
      const current = hairMaskTexture.value
      if (current && current.image.width === mask.width && current.image.height === mask.height) {
        ;(current.image.data as Uint8Array).set(mask.data)
        current.needsUpdate = true
        return
      }
      current?.dispose()
      const texture = new DataTexture(
        new Uint8Array(mask.data),
        mask.width,
        mask.height,
        RedFormat,
        UnsignedByteType
      )
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.flipY = false
      texture.needsUpdate = true
      hairMaskTexture.value = texture
    },
    { immediate: true }
  )

  const hairUniforms = {
    uMask: { value: null as DataTexture | null },
    uWindow: { value: new Vector4(0, 1, 0, 1) }
  }

  const hairMaterial = new ShaderMaterial({
    vertexShader: HAIR_VERTEX,
    fragmentShader: HAIR_FRAGMENT,
    uniforms: hairUniforms,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: DoubleSide
  })
  const hairPlaneGeometry = new PlaneGeometry(HAIR_PLANE_SIZE_METERS, HAIR_PLANE_SIZE_METERS)
  const hairPlanePosition = new Vector3(0, 0, -HAIR_PLANE_SETBACK_METERS)

  watch(
    [hairMaskTexture, () => props.mediaWindow],
    ([mask, window]) => {
      hairUniforms.uMask.value = mask
      hairUniforms.uWindow.value.set(window.xMin, window.xMax, window.yMin, window.yMax)
    },
    { immediate: true }
  )

  onUnmounted(() => {
    hairMaskTexture.value?.dispose()
    hairMaterial.dispose()
    hairPlaneGeometry.dispose()
  })

  return { hairMaskTexture, hairMaterial, hairPlaneGeometry, hairPlanePosition }
}
