import type { EnvPreset, HeadOccluderGeometry } from '../utils/tryon'
import type { TryOnModelCache } from '../composables/tryon/useTryOnModelCache'
import type { LightDirection } from '../utils/tryon-room'
import type { RoomSample } from '../composables/tryon/useTryOnLighting'
import type { TryOnLens } from '../utils/tryon-lens'
import type { MediaWindow } from '../utils/tryon-hair'
import type { HairMask } from '../composables/tryon/useHairSegmenter'

export interface TryOnSceneProps {
  src: string
  position?: { x: number; y: number; z?: number }
  scale?: number
  rotationY?: number
  rotation?: { x: number; y: number; z: number } | undefined
  envPreset?: EnvPreset
  envIntensity?: number
  useEnvironment?: boolean
  environmentUrl?: string | undefined
  proceduralEnvironment?: boolean
  occluderEnabled?: boolean
  occluderPositions?: Float32Array | null
  templeFit?: boolean
  templeEarBend?: boolean
  occluderPosition?: { x: number; y: number; z?: number }
  occluderRadius?: HeadOccluderGeometry
  occluderRotation?: { x: number; y: number; z: number }
  occluderDebugVisible?: boolean
  lightGain?: number
  lightTint?: [number, number, number]
  roomSample?: RoomSample | null
  lightDirection?: LightDirection | null
  cameraMatch?: boolean
  roomLuma?: number | null
  grainSeed?: number | undefined
  contactShadow?: boolean
  contactShadowStrength?: number
  tintedLensShadow?: boolean
  videoElement?: HTMLVideoElement | null
  showBoundingBox?: boolean
  modelOffset?: { x: number; y: number; z: number }
  visible?: boolean
  draco?: boolean
  dracoDecoderPath?: string | undefined
  modelCache?: TryOnModelCache | undefined
  physicalLens?: boolean
  lens?: TryOnLens
  hairMask?: HairMask | null
  mediaWindow?: MediaWindow
}
