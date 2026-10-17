/**
 * Props of `<VirtualTryOnExperience>`. Exported so hosts can type a wrapper
 * or a config object; the component's defaults are listed in the README.
 */
import type { TryOnModel } from '../composables/tryon/useTryOnModels'
import type { TryOnTier } from '../utils/tryon-capability'

export interface VirtualTryOnExperienceProps {
  models: TryOnModel[]
  calibrationUrl: string
  modelBaseUrl?: string | undefined
  initialModel?: string
  /**
   * Start the camera as soon as the component mounts. Use when the host
   * already collected consent (e.g. its own privacy step); otherwise call
   * the exposed `start()` from the host's consent UI.
   */
  autoStart?: boolean
  /** Renderer tone-mapping exposure. */
  exposure?: number
  /** Multiplier on the computed frame scale. */
  frameScale?: number
  /**
   * Directory the MediaPipe Wasm fileset is served from. Omit to use the
   * built-in jsDelivr CDN default; pass a same-origin path (e.g.
   * `/mediapipe/wasm`) to self-host and drop the CDN dependency.
   */
  mediapipeBasePath?: string | undefined
  /** URL/path to the `face_landmarker.task` model asset. */
  mediapipeModelAssetPath?: string | undefined
  /** Whether the GLB loader wires up Draco decompression support. */
  draco?: boolean
  /** Draco decoder path override — omit to use the gstatic CDN default. */
  dracoDecoderPath?: string | undefined
  /**
   * Hide frame parts behind the head (the far temple) with the face-mesh
   * occluder. Omit to use the module option `virtualTryOn.occluder`
   * (default `true`).
   */
  occluder?: boolean | undefined
  /**
   * Pin the device capability tier (`low` | `mid` | `high`). Omit to
   * classify the device and step down under sustained frame-time load.
   * Forcing a tier disables the step-down, so tests and goldens stay
   * deterministic.
   */
  tier?: TryOnTier | undefined
  /**
   * Light the frame from the room the camera sees (estimated luma and
   * colour cast). Off keeps the fixed studio lighting. Also needs the
   * `mid` tier or higher.
   */
  adaptiveLighting?: boolean
  /**
   * Soft shadow of the frame on the tracked skin under the bridge and
   * lenses. Needs the face-mesh occluder and the `mid` tier or higher.
   */
  contactShadow?: boolean
  /**
   * Emit `metrics` events (aggregated session numbers, no image data): every
   * 30 s while the camera is on, and once more when it stops. Read once at
   * setup. Off by default, so nothing is measured or emitted.
   */
  reportMetrics?: boolean
  /**
   * Half-width of the "good fit" band of the fit verdict, as a fraction of
   * the ideal frame width for the tracked face (default 0.06). Until the
   * PD is measured the face estimate assumes an average IPD (about ±5%),
   * so tighter bands mostly add noise.
   */
  fitTolerance?: number
  /**
   * Show the frame at its real size: measure the shopper's PD against the
   * iris (on-device, over the first seconds of frontal tracking) and size
   * the frame and the fit verdict from it instead of population averages.
   * Off keeps the average-face sizing.
   */
  trueToSize?: boolean
  /**
   * Physically-based lenses: Fresnel opacity, reflections that add on top
   * of the tint, an AR-coating sheen. Off keeps the cheaper standard lens.
   * Also needs the `mid` tier or higher.
   */
  physicalLens?: boolean
  /**
   * Hide the temple arms behind hair that hangs over them: a hair
   * segmenter (its own worker, ~0.8 MB model, loaded on the first tracked
   * face) masks the arms where the camera sees hair, so the real hair
   * shows in front. Opt-in, because a 2D mask can't tell hair over an arm
   * from hair under it, and arms usually rest on top of hair. Needs the
   * occluder and the `high` tier, and switches itself off for the session
   * if segmentation is too slow.
   */
  hairOcclusion?: boolean
  /** URL/path of `hair_segmenter.tflite`, to self-host it. */
  mediapipeHairModelAssetPath?: string | undefined
  /**
   * Bend the temple tips down behind the ears, as an optician fits a
   * frame. Visible when the shopper turns to see the temples. Off keeps
   * the straight authored tips.
   */
  templeEarBend?: boolean
  /**
   * Frames to prefetch on each side of the active one in `models` (its
   * neighbouring colourways), in idle time once a face is tracked, so
   * switching to them is instant. `false` or 0 turns it off. The low tier
   * never prefetches.
   */
  preload?: number | false
  /**
   * URL of the equirect `.hdr` environment map, to self-host it. Omit for
   * the built-in preset (GitHub raw CDN). The `low` tier uses a procedural
   * environment instead and downloads nothing.
   */
  environmentUrl?: string | undefined
  /**
   * Reflect the shopper's own room in the lenses (the camera's view,
   * blended with the studio environment) and aim the key light and the
   * contact shadow at where the room's light comes from. Needs
   * `adaptiveLighting` (and so the `mid` tier). On-device: it uses the
   * 16×16 room sample the lighting already takes.
   */
  roomReflections?: boolean
  /**
   * Make the frame look filmed with the face: grain that grows in dim
   * rooms, a sub-pixel blur, and light wrap at its edges. Needs the `mid`
   * tier or higher.
   */
  cameraMatch?: boolean
}
