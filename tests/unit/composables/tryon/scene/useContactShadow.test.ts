import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  type Light
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useFrameMaterials } from '../../../../../src/runtime/composables/tryon/scene/useFrameMaterials'
import { useContactShadow } from '../../../../../src/runtime/composables/tryon/scene/useContactShadow'
import { NO_LENS_OVERRIDE, resolveLens } from '../../../../../src/runtime/utils/tryon-lens'
import { lensTransmission } from '../../../../../src/runtime/utils/tryon-lens-shadow'

function setup() {
  const root = new Group()
  const lens = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'glass', color: 0xffffff, opacity: 0.5, transparent: true }))
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'acetate' })), lens)
  const model = shallowRef<GLTF | null>({ scene: root } as unknown as GLTF)
  const props = reactive({
    physicalLens: false,
    lens: NO_LENS_OVERRIDE,
    cameraMatch: false,
    contactShadow: true,
    tintedLensShadow: true,
    videoElement: {} as HTMLVideoElement,
    position: { x: 0, y: 0, z: 0 },
    scale: 1,
    lightDirection: null
  })
  const uniforms = {
    uCameraGrain: { value: 0 },
    uCameraGrainSeed: { value: 0 },
    uCameraWrap: { value: 0 },
    uCameraWrapColor: { value: { r: 0.5, g: 0.5, b: 0.5 } }
  }
  const scope = effectScope()
  const shadow = scope.run(() => useContactShadow(model, props, useFrameMaterials(model, props, uniforms)))!
  return { props, shadow, lens }
}

describe('useContactShadow', () => {
  it('colours the lens shadow from the calibrated lens the frame shows', async () => {
    const { props, shadow, lens } = setup()
    props.lens = resolveLens({ tint: '#3366cc', density: 0.5 })
    await nextTick()
    const shown = (lens.material as MeshStandardMaterial).color
    const expected = lensTransmission([shown.r, shown.g, shown.b])
    expect(shadow.receiverUniforms.uLensTransmission.value.toArray()).toEqual(expected)
    expect(expected[0]).not.toBeCloseTo(expected[2], 2)
  })

  it('keeps the lens shadow light right after the frame shadow light, as the receiver shader indexes them', () => {
    const { shadow } = setup()
    const scene = new Scene()
    scene.add(new DirectionalLight(), shadow.shadowLight, new DirectionalLight())
    const casters: Light[] = []
    scene.traverse((obj) => {
      if (obj instanceof DirectionalLight && obj.castShadow) casters.push(obj)
    })
    expect(casters).toEqual([shadow.shadowLight, shadow.lensShadowLight])
  })
})
