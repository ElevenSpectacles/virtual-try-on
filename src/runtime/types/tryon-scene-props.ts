/**
 * Props of `<TryOnScene>`, the TresJS scene inside `<VirtualTryOnExperience>`
 * (and the playground's prototype). The defaults stay inline in the
 * component's `withDefaults`, so its runtime props declaration is unchanged.
 */
import type { EnvPreset, HeadOccluderGeometry } from '../utils/tryon'
import type { TryOnModelCache } from '../composables/tryon/useTryOnModelCache'
import type { LightDirection } from '../utils/tryon-room'
import type { RoomSample } from '../composables/tryon/useTryOnLighting'
import type { TryOnLens } from '../utils/tryon-lens'
import type { MediaWindow } from '../utils/tryon-hair'
import type { HairMask } from '../composables/tryon/useHairSegmenter'

export interface TryOnSceneProps {
  /** Path to the GLB frame model, e.g. `/models/kairos-crystal.glb`. */
  src: string
  /** World-space position of the frame on the camera plane. */
  position?: { x: number; y: number; z?: number }
  /** Uniform scale (GLBs are modelled in metres). */
  scale?: number
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
   * Grain and light wrap on the frame (utils/tryon-camera-match), so it
   * reads as filmed with the face. The CSS blur is the host canvas's.
   */
  cameraMatch?: boolean
  /** The room's smoothed luma (grain amount, wrap colour); null unsampled. */
  roomLuma?: number | null
  /** Fixed grain seed (goldens); omit to re-seed every frame like sensor noise. */
  grainSeed?: number | undefined
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
}
