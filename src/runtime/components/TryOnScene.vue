<script setup lang="ts">
import { computed } from 'vue'
import { Vector3, Euler, Color, DoubleSide } from 'three'
import { TRYON_CAMERA, type EnvPreset } from '../utils/tryon'
import { lightingColor } from '../utils/tryon-lighting'
import { aimLight } from '../utils/tryon-room'
import { NO_LENS_OVERRIDE } from '../utils/tryon-lens'
import { CONTACT_SHADOW_STRENGTH } from '../utils/tryon-contact-shadow'
import type { TryOnSceneProps } from '../types/tryon-scene-props'
import { useSceneModel } from '../composables/tryon/scene/useSceneModel'
import { useSceneSnapshot } from '../composables/tryon/scene/useSceneSnapshot'
import { useSceneEnvironment } from '../composables/tryon/scene/useSceneEnvironment'
import { useLensMaterials } from '../composables/tryon/scene/useLensMaterials'
import { useCameraMatch } from '../composables/tryon/scene/useCameraMatch'
import { useBoundingBoxHelper } from '../composables/tryon/scene/useBoundingBoxHelper'
import { useHairOccluder } from '../composables/tryon/scene/useHairOccluder'
import { useTempleFit } from '../composables/tryon/scene/useTempleFit'
import { useFaceMeshOccluder } from '../composables/tryon/scene/useFaceMeshOccluder'
import { useContactShadow } from '../composables/tryon/scene/useContactShadow'

const props = withDefaults(defineProps<TryOnSceneProps>(), {
  position: () => ({ x: 0, y: 0, z: 0 }),
  scale: 6,
  rotationY: 0,
  // 'city' reads as neutral architectural reflections rather than a
  // photo-studio product shot — at low intensity it lifts color/specular
  // accuracy without visibly compositing a studio backdrop over the feed.
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

// Load failures go to the parent, which reports them through `track` —
// the module itself never logs.
const emit = defineEmits<{
  error: [source: 'model' | 'environment', message: string]
  /** The loaded GLB's width (bounding-box x extent), in GLB metres. */
  loaded: [widthMeters: number]
  /**
   * Once at setup: renders the scene now and returns the canvas, for
   * `capture()`. Read the canvas in the same task (before the browser
   * composites), so no `preserveDrawingBuffer` is needed.
   */
  snapshot: [render: () => HTMLCanvasElement | null]
  /** How long an asset took to load and become usable, ms (metrics). */
  timing: [asset: 'model' | 'environment', ms: number]
}>()

// The scene's parts live in composables/tryon/scene/ (not auto-imported),
// called in the order their watchers, hooks and render callback must
// register: the camera-match patch and the contact shadow read the lens
// materials the lens watcher has just rebuilt, and the temple fit reads the
// rig the model load sets.
const { model, temples } = useSceneModel(props, {
  timing: (ms) => emit('timing', 'model', ms),
  loaded: (width) => emit('loaded', width),
  error: (message) => emit('error', 'model', message)
})

// Image-based lighting from the Tresjs/assets preset HDRs (the files cientos'
// `<Environment :preset>` used), loaded by `useSceneEnvironment` unless
// `environmentUrl` self-hosts one. utils/tryon-preconnect preconnects to
// this origin; its test reads it here.
const ENV_PRESET_ROOT =
  'https://raw.githubusercontent.com/Tresjs/assets/main/textures/hdr/'
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
useLensMaterials(model, props)
useCameraMatch(model, props)
const boundingBoxHelper = useBoundingBoxHelper(model, props)
const { hairMaskTexture, hairMaterial, hairPlaneGeometry, hairPlanePosition } =
  useHairOccluder(props)

// Tres catch-all components type vector props as raw three.js instances, so we
// hand them Vector3 / Euler objects (fresh instances keep them reactive).
const cameraPosition = new Vector3(0, 0, TRYON_CAMERA.distance)
const cameraTarget = new Vector3(0, 0, 0)
// Dimmer fill light opposite the key light — without it, colored
// acetate/metal reads duller/darker on the unlit side of the frame.
const KEY_LIGHT_POSITION = { x: 2, y: 3, z: 4 }
const KEY_LIGHT_DISTANCE = Math.hypot(2, 3, 4)
// The key light leans toward the room's light when its direction is known.
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
    return new Euler(props.rotation.x, props.rotation.y, props.rotation.z)
  }
  return new Euler(0, props.rotationY, 0)
})

const modelOffsetVec = computed(
  () =>
    new Vector3(props.modelOffset.x, props.modelOffset.y, props.modelOffset.z)
)

useTempleFit(model, temples, props, {
  groupPosition,
  groupRotation,
  groupScale,
  modelOffsetVec
})

const occluderPositionVec = computed(
  () =>
    new Vector3(
      props.occluderPosition.x,
      props.occluderPosition.y,
      props.occluderPosition.z ?? 0
    )
)

const occluderMeshGeometry = useFaceMeshOccluder(props)
const { shadowLight, shadowColor: SHADOW_COLOR } = useContactShadow(model, props)

// Lights follow the room: intensity scales with the estimated luma, colour
// takes on the room's cast. Neutral props keep the original studio values.
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
const occluderRotationVec = computed(
  () =>
    new Euler(
      props.occluderRotation.x,
      props.occluderRotation.y,
      props.occluderRotation.z
    )
)
</script>

<template>
  <!-- Camera must match TRYON_CAMERA so the DOM overlay and WebGL scene agree
       on how normalized landmarks map to world space. -->
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
  <!-- Shadow-only light, framed on the frame each update; its target must
       be in the scene graph. -->
  <primitive :object="shadowLight" />
  <primitive :object="shadowLight.target" />
  <TresDirectionalLight
    :position="fillLightPosition"
    :intensity="fillIntensity"
    :color="lightColor"
  />

  <!-- Depth-only head proxy: writes depth but not color, so geometry behind
       it (temple arms tucking behind the ear) is hidden by the depth test
       without needing named anchor nodes in the GLBs. Must render before the
       glasses group so its depth is already in the buffer when they draw.

       The landmark-built face mesh (real tracked surface with its true
       curvature) is the accurate occluder; the ellipsoid is the fallback for
       pointer/idle mode where no face is tracked. -->
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
  <!-- Contact shadow receiver: the same tracked skin, drawing only the
       shadow the frame casts on it. Transparent and depth-tested without
       depth writes, so the frame in front (drawn opaque) covers it. -->
  <TresMesh
    v-if="occluderEnabled && visible && contactShadow && occluderMeshGeometry"
    :geometry="occluderMeshGeometry"
    :frustum-culled="false"
    :receive-shadow="true"
  >
    <TresShadowMaterial
      :color="SHADOW_COLOR"
      :opacity="contactShadowStrength"
      :transparent="true"
      :depth-write="false"
      :side="DoubleSide"
    />
  </TresMesh>
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
    <!-- Inner group: recentring offset in GLB-local metres, so it inherits
         the outer group's rotation and scale (pivots with the head). -->
    <!-- Hair occluder: depth-only head-space plane behind the temple
         roots (see the notes in the script), drawn before the frame. -->
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
