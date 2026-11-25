export const MEDIAPIPE_WASM_ORIGIN = 'https://cdn.jsdelivr.net'
export const MEDIAPIPE_MODEL_ORIGIN = 'https://storage.googleapis.com'
export const DRACO_DECODER_ORIGIN = 'https://www.gstatic.com'
export const ENVIRONMENT_ORIGIN = 'https://cdn.jsdelivr.net'

export interface PreconnectOptions {
  mediapipeBasePath?: string | undefined
  mediapipeModelAssetPath?: string | undefined
  hairOcclusion?: boolean
  mediapipeHairModelAssetPath?: string | undefined
  draco?: boolean
  dracoDecoderPath?: string | undefined
  presetEnvironment?: boolean
}

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
