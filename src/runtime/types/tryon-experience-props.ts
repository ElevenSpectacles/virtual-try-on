import type { TryOnModel } from '../composables/tryon/useTryOnModels'
import type { TryOnTier } from '../utils/tryon-capability'

export interface VirtualTryOnExperienceProps {
  models: TryOnModel[]
  calibrationUrl: string
  modelBaseUrl?: string | undefined
  initialModel?: string
  autoStart?: boolean
  exposure?: number
  frameScale?: number
  mediapipeBasePath?: string | undefined
  mediapipeModelAssetPath?: string | undefined
  draco?: boolean
  dracoDecoderPath?: string | undefined
  occluder?: boolean | undefined
  tier?: TryOnTier | undefined
  adaptiveLighting?: boolean
  contactShadow?: boolean
  reportMetrics?: boolean
  fitTolerance?: number
  trueToSize?: boolean
  physicalLens?: boolean
  hairOcclusion?: boolean
  mediapipeHairModelAssetPath?: string | undefined
  tintedLensShadow?: boolean
  templeEarBend?: boolean
  preload?: number | false
  environmentUrl?: string | undefined
  roomReflections?: boolean
  cameraMatch?: boolean
}
