<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import {
  Vector3,
  Euler,
  Box3,
  Box3Helper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EquirectangularReflectionMapping,
  Matrix4,
  Mesh,
  type Material,
  type MeshStandardMaterial,
  type Texture
} from 'three'
// three's own loaders instead of @tresjs/cientos: cientos ships as one
// non-tree-shakeable file, so `useGLTF` + `Environment` pulled the whole
// library (plus three-stdlib and camera-controls) into the host bundle.
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { useTres } from '@tresjs/core'
import {
  TRYON_CAMERA,
  type EnvPreset,
  type HeadOccluderGeometry
} from '../utils/tryon'
import { FACE_MESH_OCCLUDER_INDEX } from '../utils/tryon-occluder'
import { lightingColor } from '../utils/tryon-lighting'

const props = withDefaults(
  defineProps<{
    /** Path to the GLB frame model, e.g. `/models/kairos-crystal.glb`. */
    src: string
    /** World-space position of the frame on the camera plane. */
    position?: { x: number; y: number; z?: number }
    /** Uniform scale (GLBs are modelled in metres). */
    scale?: number
    /**
     * Horizontal-only multiplier on top of `scale`, widening/narrowing
     * temple reach without inflating lens height/depth.
     */
    scaleXBoost?: number
    /** Yaw (radians) so the lenses can be faced at the camera. */
    rotationY?: number
    /** Full Euler rotation (radians). Overrides rotationY when provided. */
    rotation?: { x: number; y: number; z: number } | undefined
    /** IBL preset eyeballed against the video's white balance. */
    envPreset?: EnvPreset
    /** IBL strength — the main knob for matching scene light to the feed. */
    envIntensity?: number
    /** Toggle the environment map (isolates the CDN dependency in demos). */
    useEnvironment?: boolean
    /** Depth-only head proxy that hides geometry behind it (temple arms). */
    occluderEnabled?: boolean
    /**
     * Per-frame world-space vertices of the landmark-built face mesh (see
     * `buildFaceMeshOccluderPositions`). When present this replaces the
     * ellipsoid proxy — the mesh hugs the tracked face surface, so temple
     * arms are occluded exactly where the real head would occlude them.
     */
    occluderPositions?: Float32Array | null
    occluderPosition?: { x: number; y: number; z?: number }
    occluderRadius?: HeadOccluderGeometry
    occluderRotation?: { x: number; y: number; z: number }
    /** Render the occluder with color so it can be visually tuned. */
    occluderDebugVisible?: boolean
    /**
     * Multiplier on the key, fill and ambient lights, from the room's
     * estimated luma. 1 keeps the fixed studio lighting.
     */
    lightGain?: number
    /** Colour cast of the room, each channel 0…1. White keeps the lights neutral. */
    lightTint?: [number, number, number]
    /**
     * Per-vertex RGBA of the contact shadow, one entry per occluder vertex
     * (see `computeContactShadowColors`). Null hides the shadow.
     */
    contactShadowColors?: Float32Array | null
    /** Wireframe box around the model's bbox — the calibration reference. */
    showBoundingBox?: boolean
    /**
     * Calibration recentring offset in the GLB's own (pre-scale) metre
     * space. Applied INSIDE the rotated group so it pivots with the head.
     */
    modelOffset?: { x: number; y: number; z: number }
    /**
     * Hide the frame (and occluder) without unmounting — used when face
     * tracking momentarily loses the face so the glasses don't freeze mid-air.
     */
    visible?: boolean
    /**
     * Whether the loader wires up Draco decompression support. Harmless to
     * leave on for uncompressed GLBs — GLTFLoader only invokes the decoder
     * when a mesh actually carries the `KHR_draco_mesh_compression`
     * extension.
     */
    draco?: boolean
    /** Draco decoder path override — omit to use the gstatic CDN default. */
    dracoDecoderPath?: string | undefined
  }>(),
  {
    position: () => ({ x: 0, y: 0, z: 0 }),
    scale: 6,
    scaleXBoost: 1,
    rotationY: 0,
    // 'city' reads as neutral architectural reflections rather than a
    // photo-studio product shot — at low intensity it lifts color/specular
    // accuracy without visibly compositing a studio backdrop over the feed.
    envPreset: 'city',
    envIntensity: 0.35,
    useEnvironment: true,
    occluderEnabled: false,
    occluderPositions: null,
    occluderPosition: () => ({ x: 0, y: 0, z: 0 }),
    occluderRadius: () => ({ radiusX: 0.1, radiusY: 0.13, radiusZ: 0.12 }),
    occluderRotation: () => ({ x: 0, y: 0, z: 0 }),
    occluderDebugVisible: false,
    lightGain: 1,
    lightTint: () => [1, 1, 1],
    contactShadowColors: null,
    showBoundingBox: false,
    modelOffset: () => ({ x: 0, y: 0, z: 0 }),
    visible: true,
    draco: true
  }
)

// Load failures go to the parent, which reports them through `track` —
// the module itself never logs.
const emit = defineEmits<{
  error: [source: 'model' | 'environment', message: string]
}>()

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Same decoder build cientos defaulted to, so self-hosting paths carry over.
const DEFAULT_DRACO_DECODER_PATH =
  'https://www.gstatic.com/draco/versioned/decoders/1.5.6/'

// GLTFLoader only invokes the decoder for meshes carrying
// KHR_draco_mesh_compression, so wiring it up is harmless otherwise.
const gltfLoader = new GLTFLoader()
const dracoLoader = props.draco
  ? new DRACOLoader().setDecoderPath(
      props.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH
    )
  : null
if (dracoLoader) gltfLoader.setDRACOLoader(dracoLoader)

// Non-blocking loader: `model` is null until the first GLB resolves, so a
// heavy frame download never stalls the whole scene graph. On a model switch
// the previous frame stays up until the next one arrives; responses for a
// superseded `src` are dropped.
const model = shallowRef<GLTF | null>(null)
let modelLoadId = 0
watch(
  () => props.src,
  async (src) => {
    const id = ++modelLoadId
    try {
      const gltf = await gltfLoader.loadAsync(src)
      if (id === modelLoadId) model.value = gltf
    } catch (err) {
      if (id === modelLoadId) emit('error', 'model', `${src}: ${errorMessage(err)}`)
    }
  },
  { immediate: true }
)

// Image-based lighting from the Tresjs/assets preset HDRs (the files cientos'
// `<Environment :preset>` used), set as scene.environment — the renderer
// PMREM-filters equirect environments itself. If the HDR fails to load only
// reflections are lost; the ambient/directional lights still light the frame.
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

const { scene } = useTres()
let envTexture: Texture | null = null
let envLoadId = 0

function clearEnvironment() {
  if (scene.value.environment === envTexture) scene.value.environment = null
  envTexture?.dispose()
  envTexture = null
}

watch(
  [() => props.useEnvironment, () => props.envPreset],
  async ([enabled, preset]) => {
    const id = ++envLoadId
    clearEnvironment()
    if (!enabled) return
    try {
      const texture = await new HDRLoader()
        .setPath(ENV_PRESET_ROOT)
        .loadAsync(ENV_PRESET_FILES[preset])
      if (id !== envLoadId) {
        texture.dispose()
        return
      }
      texture.mapping = EquirectangularReflectionMapping
      envTexture = texture
      scene.value.environment = texture
    } catch (err) {
      if (id === envLoadId) emit('error', 'environment', errorMessage(err))
    }
  },
  { immediate: true }
)

watch(
  () => props.envIntensity,
  (intensity) => {
    scene.value.environmentIntensity = intensity
  },
  { immediate: true }
)

// The catalog's lens materials are authored as metalness ≈ 0.7 with
// alpha-blend transparency — physically wrong for a dielectric: metalness
// tints and darkens instead of transmitting, and the metallic Fresnel kills
// the see-through read against the face. Normalize lenses to a true
// dielectric (metalness 0) and stop them writing depth, so frame geometry
// behind the lens is not clipped by the lens surface. Name-scoped — every
// catalog GLB names its lens material "glass".
//
// Two further touches sell "real sunglass glass" in the composite:
// - roughness ≈ 0: lenses are polished; any roughness blurs the reflections
//   into a plastic-looking haze.
// - envMapIntensity above 1: a real lens is a curved mirror — it catches
//   bright, sharp speculars from the room. Boosting the IBL contribution on
//   lenses only (frame acetate keeps its authored response) gives that glint
//   that reads as glass over a video feed.
const LENS_MATERIAL_NAME = /glass|lens/i

watch(
  model,
  (gltf) => {
    const seen = new Set<Material>()
    gltf?.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material]
      for (const material of materials) {
        if (seen.has(material) || !LENS_MATERIAL_NAME.test(material.name))
          continue
        seen.add(material)
        const lens = material as MeshStandardMaterial
        lens.metalness = 0
        lens.roughness = 0.05
        lens.envMapIntensity = 1.6
        material.depthWrite = false
      }
    })
  },
  { immediate: true }
)

// Debug helper: the GLB's local-space bounding box. Calibration y-centers the
// bbox on the tracked anchor and places the frame's FRONT face on it in z
// (the frame extends backward toward the temples), so this box shows exactly
// what the calibration anchors against. The box is accumulated relative to
// the GLB scene root (not via `setFromObject`, which measures in world space
// and would double-apply the group transform once the scene is mounted).
const boundingBoxHelper = computed(() => {
  if (!props.showBoundingBox || !model.value) return null
  const root = model.value.scene
  root.updateMatrixWorld(true)
  const sceneInverse = new Matrix4().copy(root.matrixWorld).invert()
  const box = new Box3()
  const meshBox = new Box3()
  const relative = new Matrix4()
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return
    obj.geometry.computeBoundingBox()
    relative.multiplyMatrices(sceneInverse, obj.matrixWorld)
    meshBox.copy(obj.geometry.boundingBox!).applyMatrix4(relative)
    box.union(meshBox)
  })
  return new Box3Helper(box, new Color('yellow'))
})
// `<primitive>` objects are never disposed by Tres, so free the previous
// helper's geometry/material whenever it is rebuilt or toggled off.
watch(boundingBoxHelper, (_helper, previous) => previous?.dispose())

onUnmounted(() => {
  envLoadId++
  clearEnvironment()
  dracoLoader?.dispose()
  occluderMeshGeometry.value?.dispose()
  contactShadowGeometry.value?.dispose()
  boundingBoxHelper.value?.dispose()
})

// Tres catch-all components type vector props as raw three.js instances, so we
// hand them Vector3 / Euler objects (fresh instances keep them reactive).
const cameraPosition = new Vector3(0, 0, TRYON_CAMERA.distance)
const cameraTarget = new Vector3(0, 0, 0)
const lightPosition = new Vector3(2, 3, 4)
// Dimmer fill light opposite the key light — without it, colored
// acetate/metal reads duller/darker on the unlit side of the frame.
const fillLightPosition = new Vector3(-2, 3, 4)

const groupPosition = computed(
  () => new Vector3(props.position.x, props.position.y, props.position.z ?? 0)
)
const groupScale = computed(
  () => new Vector3(props.scale * props.scaleXBoost, props.scale, props.scale)
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

const occluderPositionVec = computed(
  () =>
    new Vector3(
      props.occluderPosition.x,
      props.occluderPosition.y,
      props.occluderPosition.z ?? 0
    )
)

const contactShadowGeometry = shallowRef<BufferGeometry | null>(null)

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
      syncContactShadow()
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
    syncContactShadow()
  },
  { immediate: true }
)

// Contact shadow: a second mesh over the same tracked skin, with the
// per-vertex alpha from `contactShadowColors` (see syncContactShadow). It
// shares the occluder's position buffer, so the shadow lies exactly on the
// skin the occluder already depth-tests against. Drawn transparent and
// depth-tested without depth writes, so the frame in front (drawn opaque)
// covers it.
function syncContactShadow() {
  const occluder = occluderMeshGeometry.value
  const colors = props.contactShadowColors
  if (!occluder || !colors) {
    contactShadowGeometry.value?.dispose()
    contactShadowGeometry.value = null
    return
  }
  let geometry = contactShadowGeometry.value
  if (!geometry) {
    geometry = new BufferGeometry()
    geometry.setAttribute('position', occluder.getAttribute('position'))
    geometry.setIndex(new BufferAttribute(FACE_MESH_OCCLUDER_INDEX, 1))
    contactShadowGeometry.value = geometry
  }
  const existing = geometry.getAttribute('color') as BufferAttribute | undefined
  if (existing && existing.array.length === colors.length) {
    ;(existing.array as Float32Array).set(colors)
    existing.needsUpdate = true
  } else {
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
  }
}

watch(() => props.contactShadowColors, syncContactShadow, { immediate: true })

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
  <TresMesh
    v-if="occluderEnabled && visible && contactShadowGeometry"
    :geometry="contactShadowGeometry"
    :frustum-culled="false"
  >
    <TresMeshBasicMaterial
      :vertex-colors="true"
      :transparent="true"
      :depth-write="false"
      :side="DoubleSide"
    />
  </TresMesh>
  <TresMesh
    v-else-if="occluderEnabled && visible"
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
    <TresGroup :position="modelOffsetVec">
      <primitive :object="model.scene" />
      <primitive v-if="boundingBoxHelper" :object="boundingBoxHelper" />
    </TresGroup>
  </TresGroup>
</template>
