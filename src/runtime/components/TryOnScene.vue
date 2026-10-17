<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import {
  Vector3,
  Vector4,
  Euler,
  Box3,
  Box3Helper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  DataUtils,
  HalfFloatType,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  type WebGLRenderer,
  type WebGLRenderTarget,
  LinearFilter,
  Matrix4,
  Quaternion,
  DirectionalLight,
  Mesh,
  MeshDepthMaterial,
  SRGBColorSpace,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  type Camera,
  type Material,
  type Object3D,
  type MeshStandardMaterial,
  type Texture
} from 'three'
// three's own loaders instead of @tresjs/cientos: cientos ships as one
// non-tree-shakeable file, so `useGLTF` + `Environment` pulled the whole
// library (plus three-stdlib and camera-controls) into the host bundle. The
// GLTF/Draco loaders live in the model cache.
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useTres } from '@tresjs/core'
import {
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  TRYON_CAMERA,
  oneEuroFilter,
  type EnvPreset,
  type HeadOccluderGeometry,
  type OneEuroState
} from '../utils/tryon'
import {
  EAR_BEND_RAMP_METERS,
  earBendFor,
  patchEarBendShader,
  templeAngles,
  templeFramePoints,
  type TempleRig
} from '../utils/tryon-temples'
import {
  useTryOnModelCache,
  type TryOnModelCache
} from '../composables/tryon/useTryOnModelCache'
import { FACE_MESH_OCCLUDER_INDEX } from '../utils/tryon-occluder'
import { lightingColor } from '../utils/tryon-lighting'
import {
  CAMERA_ENV_HEIGHT,
  CAMERA_ENV_WIDTH,
  aimLight,
  cameraEnvironment,
  downsampleEquirect,
  type LightDirection
} from '../utils/tryon-room'
import type { RoomSample } from '../composables/tryon/useTryOnLighting'
import {
  LENS_HEIGHT_ATTRIBUTE,
  NO_LENS_OVERRIDE,
  patchLensGradientShader,
  type TryOnLens
} from '../utils/tryon-lens'

// A lens mesh's own height, 0 at its bottom … 1 at its top in the GLB's
// frame (up is +y there), as a vertex attribute for the gradient tint. Baked
// once per geometry: the node transforms are fixed.
function bakeLensHeight(mesh: Mesh, root: Object3D) {
  const geometry = mesh.geometry as BufferGeometry
  if (geometry.getAttribute(LENS_HEIGHT_ATTRIBUTE)) return
  const position = geometry.getAttribute('position')
  if (!position) return
  root.updateMatrixWorld(true)
  const toFrame = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
  const point = new Vector3()
  const heights = new Float32Array(position.count)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < position.count; i++) {
    const y = point.fromBufferAttribute(position, i).applyMatrix4(toFrame).y
    heights[i] = y
    min = Math.min(min, y)
    max = Math.max(max, y)
  }
  const span = max - min || 1
  for (let i = 0; i < heights.length; i++) heights[i] = (heights[i]! - min) / span
  geometry.setAttribute(LENS_HEIGHT_ATTRIBUTE, new BufferAttribute(heights, 1))
}

/**
 * Gradient tint (`lens.gradient`): the lens's base opacity follows its
 * height, dark to light top to bottom with a smooth middle
 * (`gradientDensityAt`). Composes with the Fresnel patch, which reads the
 * opacity after this.
 */
function applyLensGradient(material: Material, gradient: { top: number; bottom: number }) {
  const previous = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    shader.uniforms.uLensGradient = { value: [gradient.bottom, gradient.top] }
    patchLensGradientShader(shader)
  }
  material.customProgramCacheKey = () => `${previousKey()}|tryon-lens-gradient`
}
import {
  CONTACT_SHADOW_STRENGTH,
  SHADOW_LIGHT_DIRECTION,
  contactShadowLight
} from '../utils/tryon-contact-shadow'
import {
  HAIR_PLANE_SETBACK_METERS,
  HAIR_PLANE_SIZE_METERS,
  type MediaWindow
} from '../utils/tryon-hair'
import type { HairMask } from '../composables/tryon/useHairSegmenter'

const props = withDefaults(
  defineProps<{
    /** Path to the GLB frame model, e.g. `/models/kairos-crystal.glb`. */
    src: string
    /** World-space position of the frame on the camera plane. */
    position?: { x: number; y: number; z?: number }
    /** Uniform scale (GLBs are modelled in metres). */
    scale?: number
    /**
     * Horizontal-only multiplier on top of `scale` (the deprecated
     * `templeWidthBoost`). It stretches the lenses too; `templeFit` opens
     * the arms at the hinge instead.
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
    /**
     * URL of an equirect `.hdr` to use instead of the `envPreset` file, to
     * self-host it. Ignored with `proceduralEnvironment`.
     */
    environmentUrl?: string | undefined
    /**
     * Use three's procedural `RoomEnvironment` (generated on the GPU, no
     * download) instead of an HDR file. For low-tier devices, where the
     * 1.6 MB preset costs more first-load time than its reflections are worth.
     */
    proceduralEnvironment?: boolean
    /** Depth-only head proxy that hides geometry behind it (temple arms). */
    occluderEnabled?: boolean
    /**
     * Per-frame world-space vertices of the landmark-built face mesh (see
     * `buildFaceMeshOccluderPositions`). When present this replaces the
     * ellipsoid proxy — the mesh hugs the tracked face surface, so temple
     * arms are occluded exactly where the real head would occlude them.
     */
    occluderPositions?: Float32Array | null
    /**
     * Open the temple arms at the hinge to meet the side of the tracked head
     * (utils/tryon-temples). Needs `occluderPositions`; off keeps them as
     * authored.
     */
    templeFit?: boolean
    /**
     * Bend the temple tips down behind the ear, as an optician fits them
     * (utils/tryon-temples, `earBendPoint`). Shows on profile views. Needs
     * `templeFit`; off keeps the straight authored tips.
     */
    templeEarBend?: boolean
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
     * Smoothed 16×16 room sample (utils/tryon-room): reflections from the
     * camera, blended with the studio environment. Null keeps the studio map.
     */
    roomSample?: RoomSample | null
    /** Where the room's light comes from; aims the key and shadow lights. */
    lightDirection?: LightDirection | null
    /**
     * Soft shadow of the frame on the tracked face mesh (shadow map from the
     * key light, see utils/tryon-contact-shadow). Needs `occluderPositions`;
     * the host canvas must have shadows enabled.
     */
    contactShadow?: boolean
    /** Shadow opacity on skin, 0…1. */
    contactShadowStrength?: number
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
    /**
     * Parsed-GLB cache shared with the parent (instant switching, prefetch).
     * Omit for a cache of this scene's own (`draco` and `dracoDecoderPath`
     * apply to it; a passed cache brings its own).
     */
    modelCache?: TryOnModelCache | undefined
    /**
     * Physically-based lens: Fresnel opacity, additive reflections, a
     * clearcoat and the anti-reflective coating's thin-film sheen. Off keeps
     * the cheaper standard lens.
     */
    physicalLens?: boolean
    /** Per-model lens tint/density override (from calibration). */
    lens?: TryOnLens
    /**
     * Hair confidence of the camera frame (see `useHairSegmenter`): temple
     * arm parts behind the temple roots are not drawn where it says hair,
     * so the camera's hair shows in front of them. Null turns it off.
     */
    hairMask?: HairMask | null
    /** `object-fit: cover` window of the camera frame in the preview. */
    mediaWindow?: MediaWindow
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
  }
)

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Parsed GLBs come from the cache: a switch back to a frame (or to a
// prefetched one) mounts it at once instead of fetching and parsing again.
const modelCache =
  props.modelCache ??
  useTryOnModelCache({
    draco: props.draco,
    dracoDecoderPath: props.dracoDecoderPath,
    capacity: 2
  })

// Non-blocking loader: `model` is null until the first GLB resolves, so a
// heavy frame download never stalls the whole scene graph. On a model switch
// the previous frame stays up until the next one arrives; responses for a
// superseded `src` are dropped.
const model = shallowRef<GLTF | null>(null)
let modelLoadId = 0
// The shown GLB's temples on hinge pivots (null: kept as authored), and
// the One-Euro state of each arm's opening angle.
let templeRig: TempleRig | null = null
let templeFilters: (OneEuroState | null)[] = []
let templeFilterTime = 0
watch(
  () => props.src,
  async (src) => {
    const id = ++modelLoadId
    const startedAt = performance.now()
    try {
      const { gltf, rig } = await modelCache.load(src)
      if (id === modelLoadId) {
        emit('timing', 'model', performance.now() - startedAt)
        // A cached frame keeps its last opening: start from the GLB's own.
        for (const temple of rig?.temples ?? []) temple.pivot.rotation.z = 0
        templeRig = rig
        templeFilters = []
        model.value = gltf
        modelCache.setActive(src)
        emit('loaded', localBounds(gltf.scene).getSize(new Vector3()).x)
      }
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

const { scene, renderer, camera } = useTres()
let envTexture: Texture | null = null

// Render on demand for `capture()`: the drawing buffer is cleared after the
// browser composites a frame, so a capture renders the current pose itself
// and the caller copies the canvas before returning to the event loop.
emit('snapshot', () => {
  const active = camera.value
  if (!active) return null
  const target = renderer as unknown as {
    render: (scene: Object3D, camera: Camera) => void
    domElement: HTMLCanvasElement
  }
  target.render(scene.value, active)
  return target.domElement
})
// The studio map downsampled to the camera environment's size, for blending.
let studioGrid: Float32Array | null = null
let envLoadId = 0

function clearEnvironment() {
  if (scene.value.environment === envTexture) scene.value.environment = null
  envTexture?.dispose()
  envTexture = null
  studioGrid = null
}

// Procedural room: three's RoomEnvironment PMREM-filtered once on the GPU.
// No download, a few ms of GPU time; neutral soft-box reflections.
function roomEnvironment(): Texture | null {
  const target = renderer as unknown as WebGLRenderer
  if (typeof target?.getContext !== 'function') return null
  const generator = new PMREMGenerator(target)
  const room = new RoomEnvironment()
  const texture = generator.fromScene(room, 0.04).texture
  room.dispose()
  generator.dispose()
  return texture
}

// Camera reflections (issue #84): the room sample becomes a 128×64 equirect
// (utils/tryon-room `cameraEnvironment`, blended with the studio map),
// PMREM-filtered at most every CAMERA_ENV_INTERVAL_MS (the sample is
// smoothed anyway; ~0.3 ms per update on a laptop GPU). Without a sample
// the studio map stays.
const CAMERA_ENV_INTERVAL_MS = 500
let pmrem: PMREMGenerator | null = null
let cameraEnvTarget: WebGLRenderTarget | null = null
let cameraEnvUpdatedAt = -Infinity

function clearCameraEnvironment() {
  if (cameraEnvTarget && scene.value.environment === cameraEnvTarget.texture) {
    scene.value.environment = envTexture
  }
  cameraEnvTarget?.dispose()
  cameraEnvTarget = null
}

watch(
  () => props.roomSample,
  (sample) => {
    if (!sample || !props.useEnvironment) {
      clearCameraEnvironment()
      return
    }
    const now = performance.now()
    if (now - cameraEnvUpdatedAt < CAMERA_ENV_INTERVAL_MS) return
    const target = renderer as unknown as WebGLRenderer
    if (typeof target?.getContext !== 'function') return
    cameraEnvUpdatedAt = now
    // Half float: linear filtering of full floats is an extension
    // (OES_texture_float_linear) some GPUs lack; half floats always filter.
    const radiance = cameraEnvironment(sample.pixels, sample.width, sample.height, {
      studio: studioGrid
    })
    const half = new Uint16Array(radiance.length)
    for (let i = 0; i < radiance.length; i++) half[i] = DataUtils.toHalfFloat(radiance[i]!)
    const equirect = new DataTexture(
      half,
      CAMERA_ENV_WIDTH,
      CAMERA_ENV_HEIGHT,
      RGBAFormat,
      HalfFloatType
    )
    equirect.mapping = EquirectangularReflectionMapping
    equirect.colorSpace = LinearSRGBColorSpace
    equirect.magFilter = LinearFilter
    equirect.minFilter = LinearFilter
    equirect.needsUpdate = true
    pmrem ??= new PMREMGenerator(target)
    const next = pmrem.fromEquirectangular(equirect)
    equirect.dispose()
    cameraEnvTarget?.dispose()
    cameraEnvTarget = next
    scene.value.environment = next.texture
  }
)

watch(
  [
    () => props.useEnvironment,
    () => props.envPreset,
    () => props.environmentUrl,
    () => props.proceduralEnvironment
  ],
  async ([enabled, preset, url, procedural]) => {
    const id = ++envLoadId
    clearEnvironment()
    if (!enabled) return
    const startedAt = performance.now()
    if (procedural) {
      envTexture = roomEnvironment()
      if (envTexture) {
        scene.value.environment = envTexture
        emit('timing', 'environment', performance.now() - startedAt)
      }
      return
    }
    try {
      const texture = await new HDRLoader().loadAsync(
        url ?? `${ENV_PRESET_ROOT}${ENV_PRESET_FILES[preset]}`
      )
      if (id !== envLoadId) {
        texture.dispose()
        return
      }
      texture.mapping = EquirectangularReflectionMapping
      envTexture = texture
      const image = texture.image as { data: ArrayLike<number>; width: number; height: number }
      studioGrid = downsampleEquirect(
        image.data,
        image.width,
        image.height,
        4,
        CAMERA_ENV_WIDTH,
        CAMERA_ENV_HEIGHT,
        texture.type === HalfFloatType ? DataUtils.fromHalfFloat : (v) => v
      )
      if (!cameraEnvTarget) scene.value.environment = texture
      emit('timing', 'environment', performance.now() - startedAt)
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
// the see-through read against the face. Lenses are rebuilt as a true
// dielectric (metalness 0) that does not write depth, so frame geometry
// behind the lens is not clipped by the lens surface. Name-scoped — every
// catalog GLB names its lens material "glass".
//
// Further touches sell "real sunglass glass" in the composite:
// - roughness ≈ 0: lenses are polished; any roughness blurs the reflections
//   into a plastic-looking haze.
// - envMapIntensity above 1: a real lens is a curved mirror — it catches
//   bright, sharp speculars from the room. Boosting the IBL contribution on
//   lenses only (frame acetate keeps its authored response) gives that glint
//   that reads as glass over a video feed.
// - physicalLens (mid tier and up, see utils/tryon-lens.ts): opacity rises
//   with the Fresnel term toward grazing angles, so the lens rim reads as
//   glass instead of a flat tinted cut-out; reflections are added on top of
//   what the lens transmits instead of being scaled down by its opacity (a
//   light lens still mirrors the room); a clearcoat and a thin-film
//   iridescence give the faint green/violet sheen of an AR coating.
const LENS_MATERIAL_NAME = /glass|lens/i

/**
 * Opacity follows the normalized Schlick term, `lensOpacityAt` in
 * utils/tryon-lens.ts. Output is premultiplied by hand: only the body
 * colour is scaled by coverage, reflections add on top.
 */
function applyLensFresnel(material: MeshPhysicalMaterial) {
  material.premultipliedAlpha = true
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <opaque_fragment>',
        `float lensGrazing = pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 5.0 );
        diffuseColor.a = diffuseColor.a + ( 1.0 - diffuseColor.a ) * lensGrazing;
        vec3 lensReflected = max( outgoingLight - totalDiffuse, vec3( 0.0 ) );
        gl_FragColor = vec4( totalDiffuse * diffuseColor.a + lensReflected, diffuseColor.a );`
      )
      .replace('#include <premultiplied_alpha_fragment>', '')
  }
  material.customProgramCacheKey = () => 'tryon-lens-fresnel'
}

function buildLens(
  authored: MeshStandardMaterial,
  physical: boolean,
  lens: TryOnLens
): Material {
  const base = {
    name: authored.name,
    map: authored.map,
    alphaMap: authored.alphaMap,
    color: authored.color.clone(),
    opacity: authored.opacity,
    side: authored.side,
    transparent: true,
    depthWrite: false,
    metalness: 0,
    roughness: physical ? 0.02 : 0.05,
    envMapIntensity: 1.6
  }
  const material = physical
    ? new MeshPhysicalMaterial({
        ...base,
        ior: 1.5,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        iridescence: 0.35,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [260, 420]
      })
    : Object.assign(authored.clone(), base)
  if (lens.tint) material.color.setRGB(...lens.tint)
  if (lens.density !== null) material.opacity = lens.density
  if (material instanceof MeshPhysicalMaterial) applyLensFresnel(material)
  // After the Fresnel patch, so it wraps it: the gradient sets the base
  // opacity the Fresnel term then raises toward grazing angles.
  if (lens.gradient) applyLensGradient(material, lens.gradient)
  return material
}

// Lens materials we built, so a rebuild (model, tier or override change)
// can free the previous ones. The GLB's authored materials are kept on each
// mesh so every rebuild starts from them.
let builtLenses: Material[] = []

watch(
  [model, () => props.physicalLens, () => props.lens],
  ([gltf, physical, lens]) => {
    const previous = builtLenses
    builtLenses = []
    const built = new Map<Material, Material>()
    gltf?.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const authored: Material | Material[] =
        obj.userData.tryOnAuthoredMaterial ?? obj.material
      obj.userData.tryOnAuthoredMaterial = authored
      const swap = (material: Material) => {
        if (!LENS_MATERIAL_NAME.test(material.name)) return material
        if (lens.gradient && gltf) bakeLensHeight(obj, gltf.scene)
        let lensMaterial = built.get(material)
        if (!lensMaterial) {
          lensMaterial = buildLens(material as MeshStandardMaterial, physical, lens)
          built.set(material, lensMaterial)
          builtLenses.push(lensMaterial)
        }
        return lensMaterial
      }
      obj.material = Array.isArray(authored) ? authored.map(swap) : swap(authored)
    })
    for (const material of previous) material.dispose()
  },
  { immediate: true }
)

// The GLB's local-space bounding box: the debug helper below, and the frame
// width the fit verdict compares with the face. Calibration y-centers the
// bbox on the tracked anchor and places the frame's FRONT face on it in z
// (the frame extends backward toward the temples), so this box shows exactly
// what the calibration anchors against. The box is accumulated relative to
// the GLB scene root (not via `setFromObject`, which measures in world space
// and would double-apply the group transform once the scene is mounted).
function localBounds(root: Object3D): Box3 {
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
  return box
}

const boundingBoxHelper = computed(() => {
  if (!props.showBoundingBox || !model.value) return null
  return new Box3Helper(localBounds(model.value.scene), new Color('yellow'))
})
// `<primitive>` objects are never disposed by Tres, so free the previous
// helper's geometry/material whenever it is rebuilt or toggled off.
watch(boundingBoxHelper, (_helper, previous) => previous?.dispose())

onUnmounted(() => {
  hairMaskTexture.value?.dispose()
  hairMaterial.dispose()
  hairPlaneGeometry.dispose()
  envLoadId++
  clearCameraEnvironment()
  pmrem?.dispose()
  clearEnvironment()
  for (const material of builtLenses) material.dispose()
  shadowLight.dispose()
  clearEarBend()
  for (const material of lensDepthMaterials) material.dispose()
  occluderMeshGeometry.value?.dispose()
  boundingBoxHelper.value?.dispose()
})

// Hair occluder (utils/tryon-hair.ts): a depth-only plane in head space,
// HAIR_PLANE_SETBACK_METERS behind the frame front, drawn before the frame
// and kept only where the hair mask says hair. Arm parts behind the plane
// fail the depth test there and are not drawn, so the live camera's own hair
// shows through the empty canvas; lenses, rims and hinges are in front of the
// plane and stay. Like the face-mesh occluder, no colour is written.
//
// The shader maps each fragment back to the camera frame exactly as the
// preview shows it: mirrored `<video>`, `object-fit: cover` window
// (`screenToMedia`). The mask is bilinear-sampled and cut at half
// confidence, which gives a smooth hair contour from a 96-px-wide mask.
//
// (Redrawing the camera's pixels over the arm instead, for soft edges, was
// tried: at antialiased arm edges the redraw is weighted by coverage twice
// and leaves a dark outline, and it costs a camera-texture upload per frame.)
const HAIR_VERTEX = /* glsl */ `
varying vec4 vClip;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vClip = gl_Position;
}
`
const HAIR_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform vec4 uWindow; // xMin, xMax, yMin, yMax of the raw camera frame
varying vec4 vClip;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  vec2 screen = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  vec2 media = vec2(
    uWindow.x + (1.0 - screen.x) * (uWindow.y - uWindow.x),
    uWindow.z + screen.y * (uWindow.w - uWindow.z)
  );
  // Mask rows are uploaded top first (flipY off).
  if (texture2D(uMask, media).r < 0.5) discard;
  gl_FragColor = vec4(0.0);
}
`

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

// Temple fit (utils/tryon-temples): the face-mesh occluder's oval points at
// temple height, the surface the arms pass, are taken into the GLB's frame
// through the inverse of the frame group's transform and the recentring
// offset, and the arms open or close on their hinges to clear them. The
// occluder's shape follows the raw landmarks, so the angle is smoothed;
// head width does not change while someone wears a frame, so it is slow.
const TEMPLE_FILTER = { minCutoff: 0.5, beta: 1 }
const groupMatrix = new Matrix4()
const groupQuaternion = new Quaternion()
const earPoint = new Vector3()

watch(
  [
    () => props.occluderPositions,
    () => props.templeFit,
    groupPosition,
    groupRotation,
    groupScale,
    modelOffsetVec,
    model
  ],
  ([positions, enabled, position, rotation, scale, offset, gltf]) => {
    const rig = templeRig
    if (!rig || !gltf) return
    if (!enabled) {
      for (const temple of rig.temples) temple.pivot.rotation.z = 0
      templeFilters = []
      return
    }
    if (!positions) return
    groupMatrix
      .compose(position, groupQuaternion.setFromEuler(rotation), scale)
      .invert()
    const sceneInverse = gltf.scene.matrix.clone().invert()
    const points = [EAR_LEVEL_RIGHT, EAR_LEVEL_LEFT].map((i) => {
      earPoint
        .fromArray(positions, i * 3)
        .applyMatrix4(groupMatrix)
        .sub(offset)
        .applyMatrix4(sceneInverse)
      return { x: earPoint.x, y: earPoint.y, z: earPoint.z }
    })
    const now = performance.now()
    const dt = templeFilterTime ? (now - templeFilterTime) / 1000 : 0
    templeFilterTime = now
    templeAngles(rig, points).forEach((angle, i) => {
      const state = oneEuroFilter(templeFilters[i] ?? null, angle, dt, TEMPLE_FILTER)
      templeFilters[i] = state
      rig.temples[i]!.pivot.rotation.z = state.value
    })
    updateEarBend(rig, points, dt)
  },
  { immediate: true }
)

// Ear bend (opt-in): each arm gets its own clone of the frame material with
// a vertex-shader bend past the ear (`EAR_BEND_UNIFORMS`), since the arms
// share their material with the frame front. The bend line follows the
// head's oval point at temple height, smoothed like the opening angle.
const earBendMaterials = new Map<Mesh, { material: Material; uniform: { value: Vector4 } }>()
let earBendFilter: OneEuroState | null = null

function clearEarBend() {
  for (const [mesh, { material }] of earBendMaterials) {
    mesh.material = mesh.userData.tryOnTempleMaterial ?? mesh.material
    material.dispose()
  }
  earBendMaterials.clear()
  earBendFilter = null
}

function bendMaterial(mesh: Mesh) {
  const existing = earBendMaterials.get(mesh)
  if (existing) {
    // A lens-material rebuild re-assigns the authored materials: put ours back.
    if (mesh.material !== existing.material) mesh.material = existing.material
    return existing
  }
  const authored = mesh.material as Material
  mesh.userData.tryOnTempleMaterial = authored
  const material = authored.clone()
  const uniform = { value: new Vector4(0, 0, 0, EAR_BEND_RAMP_METERS) }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEarBend = uniform
    shader.vertexShader = patchEarBendShader(shader.vertexShader)
  }
  material.customProgramCacheKey = () => `tryon-ear-bend-${authored.customProgramCacheKey()}`
  mesh.material = material
  const entry = { material, uniform }
  earBendMaterials.set(mesh, entry)
  return entry
}

function updateEarBend(
  rig: TempleRig,
  scenePoints: { x: number; y: number; z: number }[],
  dt: number
) {
  if (!props.templeEarBend) {
    if (earBendMaterials.size) clearEarBend()
    return
  }
  const local = templeFramePoints(rig, scenePoints)
  // One bend line for both arms (the ears are level on a head in a frame);
  // the further-back oval point, so neither tip drops in front of its ear.
  const ear = Math.max(...local.map((p) => p.x))
  const state = oneEuroFilter(earBendFilter, ear, dt, TEMPLE_FILTER)
  earBendFilter = state
  for (const temple of rig.temples) {
    const mesh = temple.pivot.children[0]
    if (!(mesh instanceof Mesh)) continue
    const bend = earBendFor(temple.profile, { x: state.value })
    bendMaterial(mesh).uniform.value.set(bend.start, bend.z, bend.angle, EAR_BEND_RAMP_METERS)
  }
}

// A new GLB has its own arms; turning the bend off restores the authored material.
watch(model, clearEarBend)
watch(
  () => props.templeEarBend,
  (enabled) => {
    if (!enabled) clearEarBend()
  }
)

const occluderPositionVec = computed(
  () =>
    new Vector3(
      props.occluderPosition.x,
      props.occluderPosition.y,
      props.occluderPosition.z ?? 0
    )
)


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
  },
  { immediate: true }
)

// Contact shadow (utils/tryon-contact-shadow): a shadow-only light (no
// intensity, so it changes no shading) renders a small
// shadow map of the frame, framed tightly on it, and a ShadowMaterial copy
// of the face mesh shows that shadow on the skin. The catalog is mostly
// rimless, so most of a real pair's shadow comes from its tinted lenses: a
// shadow map has no partial transparency, so lenses cast through an
// alpha-hashed depth material (a random share of texels, by lens density)
// that the blur turns into an even half-shadow. The host canvas uses VSM:
// its blur pass keeps the edge soft, as from a room light rather than a
// spotlight, without PCF's speckle at a wide radius.
//
// The shadow colour is a warm dark brown, not black: light scattering under
// skin keeps real shadows on skin reddish, and black at low opacity reads
// as a grey smudge.
const SHADOW_COLOR = new Color().setRGB(0.16, 0.05, 0.03, SRGBColorSpace)
const SHADOW_MAP_SIZE = 512
const SHADOW_RADIUS = 8
/** Share of light a lens blocks in the shadow, per unit of lens opacity. */
const LENS_SHADOW_DENSITY = 0.6

const shadowLight = new DirectionalLight(0xffffff, 0)
shadowLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
shadowLight.shadow.radius = SHADOW_RADIUS
shadowLight.shadow.blurSamples = 12
shadowLight.shadow.bias = -0.0005

watch(
  () => props.contactShadow,
  (enabled) => {
    shadowLight.castShadow = enabled
  },
  { immediate: true }
)

// Frame the shadow camera on the frame. The light is directional and has
// no intensity, so moving it changes only what the shadow map covers.
watch(
  [() => props.position, () => props.scale, () => props.lightDirection],
  ([position, scale, direction]) => {
    const light = contactShadowLight(position, scale, aimLight(SHADOW_LIGHT_DIRECTION, direction))
    shadowLight.position.set(light.position.x, light.position.y, light.position.z)
    shadowLight.target.position.set(light.target.x, light.target.y, light.target.z)
    shadowLight.target.updateMatrixWorld()
    const camera = shadowLight.shadow.camera
    camera.left = -light.halfExtent
    camera.right = light.halfExtent
    camera.top = light.halfExtent
    camera.bottom = -light.halfExtent
    camera.near = light.near
    camera.far = light.far
    camera.updateProjectionMatrix()
  },
  { immediate: true }
)

// Every frame mesh casts; lens meshes through a partial (alpha-hashed)
// depth material. The receiver never casts.
let lensDepthMaterials: MeshDepthMaterial[] = []

watch(
  [model, () => props.contactShadow, () => props.lens],
  ([gltf, enabled]) => {
    for (const material of lensDepthMaterials) material.dispose()
    lensDepthMaterials = []
    gltf?.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      obj.castShadow = enabled
      const current = Array.isArray(obj.material) ? obj.material : [obj.material]
      const lens = current.find((m: Material) => LENS_MATERIAL_NAME.test(m.name))
      if (!enabled || !lens) {
        obj.customDepthMaterial = undefined
        return
      }
      const depth = new MeshDepthMaterial({
        alphaHash: true,
        opacity: Math.min(lens.opacity * LENS_SHADOW_DENSITY, 1)
      })
      lensDepthMaterials.push(depth)
      obj.customDepthMaterial = depth
    })
  },
  { immediate: true }
)

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
