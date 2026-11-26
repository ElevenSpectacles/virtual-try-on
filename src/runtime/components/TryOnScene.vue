<script setup lang="ts">
import { computed } from 'vue'
import { Vector3, Euler, Color, DoubleSide } from 'three'
import { TRYON_CAMERA, type EnvPreset } from '../utils/tryon'
import { headEuler } from '../utils/tryon-pose'
import { lightingColor } from '../utils/tryon-lighting'
import { aimLight } from '../utils/tryon-room'
import { NO_LENS_OVERRIDE } from '../utils/tryon-lens'
import { CONTACT_SHADOW_STRENGTH } from '../utils/tryon-contact-shadow'
import type { TryOnSceneProps } from '../types/tryon-scene-props'
import { useSceneModel } from '../composables/tryon/scene/useSceneModel'
import { useSceneSnapshot } from '../composables/tryon/scene/useSceneSnapshot'
import { useSceneEnvironment } from '../composables/tryon/scene/useSceneEnvironment'
import { useFrameMaterials } from '../composables/tryon/scene/useFrameMaterials'
import { useCameraMatch } from '../composables/tryon/scene/useCameraMatch'
import { useBoundingBoxHelper } from '../composables/tryon/scene/useBoundingBoxHelper'
import { useHairOccluder } from '../composables/tryon/scene/useHairOccluder'
import { useTempleFit } from '../composables/tryon/scene/useTempleFit'
import { useFaceMeshOccluder } from '../composables/tryon/scene/useFaceMeshOccluder'
import { useContactShadow } from '../composables/tryon/scene/useContactShadow'
import { useContactOcclusion } from '../composables/tryon/scene/useContactOcclusion'

const props = withDefaults(defineProps<TryOnSceneProps>(), {
  position: () => ({ x: 0, y: 0, z: 0 }),
  scale: 6,
  rotationY: 0,
  envPreset: 'city',
  envIntensity: 0.35,
  useEnvironment: true,
  environmentUrl: undefined,
  proceduralEnvironment: false,
  occluderEnabled: false,
  occluderPositions: null,
  templeFit: true,
  templeEarBend: false,
  occluderPosition: () => ({ x: 0, y: 0, z: 0 }),
  occluderRadius: () => ({ radiusX: 0.1, radiusY: 0.13, radiusZ: 0.12 }),
  occluderRotation: () => ({ x: 0, y: 0, z: 0 }),
  occluderDebugVisible: false,
  lightGain: 1,
  lightTint: () => [1, 1, 1],
  roomSample: null,
  lightDirection: null,
  cameraMatch: false,
  roomLuma: null,
  grainSeed: undefined,
  contactShadow: false,
  contactShadowStrength: CONTACT_SHADOW_STRENGTH,
  tintedLensShadow: false,
  videoElement: null,
  showBoundingBox: false,
  modelOffset: () => ({ x: 0, y: 0, z: 0 }),
  visible: true,
  draco: true,
  modelCache: undefined,
  physicalLens: false,
  lens: () => NO_LENS_OVERRIDE,
  hairMask: null,
  mediaWindow: () => ({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 })
})

const emit = defineEmits<{
  error: [source: 'model' | 'environment', message: string]
  loaded: [widthMeters: number]
  snapshot: [render: () => HTMLCanvasElement | null]
  timing: [asset: 'model' | 'environment', ms: number]
}>()

const { model, temples } = useSceneModel(props, {
  timing: (ms) => emit('timing', 'model', ms),
  loaded: (width) => emit('loaded', width),
  error: (message) => emit('error', 'model', message)
})

const ENV_PRESET_ROOT =
  'https://cdn.jsdelivr.net/gh/Tresjs/assets@2e771aed0124c3af8fb2449a4c59b4ad08d0cc5f/textures/hdr/'
const ENV_PRESET_FILES: Record<EnvPreset, string> = {
  studio: 'studio/poly_haven_studio_1k.hdr',
  city: 'city/canary_wharf_1k.hdr',
  sunset: 'venice/venice_sunset_1k.hdr',
  dawn: 'kiara/kiara_1_dawn_1k.hdr',
  forest: 'outdoor/mossy_forest_1k.hdr',
  night: 'outdoor/satara_night_1k.hdr',
  snow: 'outdoor/snowy_forest_path_01_1k.hdr'
}

useSceneSnapshot((render) => emit('snapshot', render))
useSceneEnvironment(props, {
  presetUrl: (preset) => `${ENV_PRESET_ROOT}${ENV_PRESET_FILES[preset]}`,
  timing: (ms) => emit('timing', 'environment', ms),
  error: (message) => emit('error', 'environment', message)
})
const materials = useFrameMaterials(model, props, useCameraMatch(props))
const boundingBoxHelper = useBoundingBoxHelper(model, props)
const { hairMaskTexture, hairMaterial, hairPlaneGeometry, hairPlanePosition } =
  useHairOccluder(props)

const cameraPosition = new Vector3(0, 0, TRYON_CAMERA.distance)
const cameraTarget = new Vector3(0, 0, 0)
const KEY_LIGHT_POSITION = { x: 2, y: 3, z: 4 }
const KEY_LIGHT_DISTANCE = Math.hypot(2, 3, 4)
const lightPosition = computed(() => {
  const d = aimLight(KEY_LIGHT_POSITION, props.lightDirection)
  return new Vector3(d.x, d.y, d.z).multiplyScalar(KEY_LIGHT_DISTANCE)
})
const fillLightPosition = new Vector3(-2, 3, 4)

const groupPosition = computed(
  () => new Vector3(props.position.x, props.position.y, props.position.z ?? 0)
)
const groupScale = computed(
  () => new Vector3(props.scale, props.scale, props.scale)
)
const groupRotation = computed(() => {
  if (props.rotation) {
    return headEuler(props.rotation)
  }
  return new Euler(0, props.rotationY, 0)
})

const modelOffsetVec = computed(
  () =>
    new Vector3(props.modelOffset.x, props.modelOffset.y, props.modelOffset.z)
)

useTempleFit(
  model,
  temples,
  props,
  { groupPosition, groupRotation, groupScale, modelOffsetVec },
  materials
)

const occluderPositionVec = computed(
  () =>
    new Vector3(
      props.occluderPosition.x,
      props.occluderPosition.y,
      props.occluderPosition.z ?? 0
    )
)

const occluderMeshGeometry = useFaceMeshOccluder(props)
const shadow = useContactShadow(model, props)
const { shadowLight, lensShadowLight } = shadow
const shadowReceiverMaterial = useContactOcclusion(model, props, shadow, materials.earBendMaterials)

const lightColor = computed(
  () => new Color(...lightingColor(props.lightTint))
)
const ambientIntensity = computed(() => 0.55 * props.lightGain)
const keyIntensity = computed(() => 1.1 * props.lightGain)

const fillIntensity = computed(() => 0.5 * props.lightGain)
const occluderScaleVec = computed(
  () =>
    new Vector3(
      props.occluderRadius.radiusX,
      props.occluderRadius.radiusY,
      props.occluderRadius.radiusZ
    )
)
const occluderRotationVec = computed(() => headEuler(props.occluderRotation))
</script>

<template>
  <TresPerspectiveCamera
    :position="cameraPosition"
    :fov="TRYON_CAMERA.fovDeg"
    :look-at="cameraTarget"
  />

  <TresAmbientLight :intensity="ambientIntensity" :color="lightColor" />
  <TresDirectionalLight
    :position="lightPosition"
    :intensity="keyIntensity"
    :color="lightColor"
  />
  <primitive :object="shadowLight" />
  <primitive :object="shadowLight.target" />
  <primitive :object="lensShadowLight" />
  <primitive :object="lensShadowLight.target" />
  <TresDirectionalLight
    :position="fillLightPosition"
    :intensity="fillIntensity"
    :color="lightColor"
  />

  <TresMesh
    v-if="occluderEnabled && visible && occluderMeshGeometry"
    :geometry="occluderMeshGeometry"
    :frustum-culled="false"
    :render-order="-1"
  >
    <TresMeshBasicMaterial
      :color="occluderDebugVisible ? 'red' : 'black'"
      :color-write="occluderDebugVisible"
      :depth-write="true"
      :transparent="occluderDebugVisible"
      :opacity="occluderDebugVisible ? 0.3 : 1"
      :side="DoubleSide"
    />
  </TresMesh>
  <TresMesh
    v-if="occluderEnabled && visible && contactShadow && occluderMeshGeometry"
    :geometry="occluderMeshGeometry"
    :frustum-culled="false"
    :material="shadowReceiverMaterial"
    :receive-shadow="true"
  />
  <TresMesh
    v-if="occluderEnabled && visible && !occluderMeshGeometry"
    :position="occluderPositionVec"
    :rotation="occluderRotationVec"
    :scale="occluderScaleVec"
    :render-order="-1"
  >
    <TresSphereGeometry :args="[1, 24, 16]" />
    <TresMeshBasicMaterial
      :color="occluderDebugVisible ? 'red' : 'black'"
      :color-write="occluderDebugVisible"
      :depth-write="true"
      :transparent="occluderDebugVisible"
      :opacity="occluderDebugVisible ? 0.3 : 1"
    />
  </TresMesh>

  <TresGroup
    v-if="model"
    :visible="visible"
    :position="groupPosition"
    :rotation="groupRotation"
    :scale="groupScale"
  >
    <TresMesh
      v-if="hairMaskTexture"
      :geometry="hairPlaneGeometry"
      :material="hairMaterial"
      :position="hairPlanePosition"
      :render-order="-1"
      :frustum-culled="false"
    />
    <TresGroup :position="modelOffsetVec">
      <primitive :object="model.scene" />
      <primitive v-if="boundingBoxHelper" :object="boundingBoxHelper" />
    </TresGroup>
  </TresGroup>
</template>
