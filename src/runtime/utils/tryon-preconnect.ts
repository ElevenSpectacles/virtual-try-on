/**
 * Time to first frame (issue #95): which third-party origins the try-on will
 * fetch from, so the component can open their connections early with
 * `<link rel="preconnect">`. Pure, no Nuxt.
 *
 * First load pulls the MediaPipe Wasm (jsDelivr), the face model (Google
 * Storage), the Draco decoder (gstatic) and the environment HDR (GitHub raw).
 * A cold TLS handshake to each costs one to three round trips; preconnecting
 * while the shopper reads the consent screen takes that off the critical
 * path. An origin a host self-hosts (its path option is set) is left out.
 *
 * The defaults live in the workers, the model cache and the scene; a unit
 * test keeps these origins in step with them.
 */

export const MEDIAPIPE_WASM_ORIGIN = 'https://cdn.jsdelivr.net'
export const MEDIAPIPE_MODEL_ORIGIN = 'https://storage.googleapis.com'
export const DRACO_DECODER_ORIGIN = 'https://www.gstatic.com'
export const ENVIRONMENT_ORIGIN = 'https://raw.githubusercontent.com'

export interface PreconnectOptions {
  mediapipeBasePath?: string | undefined
  mediapipeModelAssetPath?: string | undefined
  /** Hair occlusion is on (its model loads from Google Storage too). */
  hairOcclusion?: boolean
  mediapipeHairModelAssetPath?: string | undefined
  draco?: boolean
  dracoDecoderPath?: string | undefined
  /** The scene loads the preset HDR (not self-hosted, not procedural). */
  presetEnvironment?: boolean
}

/** Default CDN origins the try-on will fetch from, in fetch order, deduplicated. */
export function preconnectOrigins(options: PreconnectOptions): string[] {
  const origins: string[] = []
  if (options.mediapipeBasePath === undefined) origins.push(MEDIAPIPE_WASM_ORIGIN)
  if (
    options.mediapipeModelAssetPath === undefined ||
    (options.hairOcclusion && options.mediapipeHairModelAssetPath === undefined)
  ) {
    origins.push(MEDIAPIPE_MODEL_ORIGIN)
  }
  if ((options.draco ?? true) && options.dracoDecoderPath === undefined) {
    origins.push(DRACO_DECODER_ORIGIN)
  }
  if (options.presetEnvironment ?? true) origins.push(ENVIRONMENT_ORIGIN)
  return [...new Set(origins)]
}
