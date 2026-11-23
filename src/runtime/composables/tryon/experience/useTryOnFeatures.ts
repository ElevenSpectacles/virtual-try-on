import { computed, type Ref } from 'vue'
import { useHairSegmenter } from '../useHairSegmenter'
import { CONTACT_SHADOW_STRENGTH } from '../../../utils/tryon-contact-shadow'
import { maskCoverage } from '../../../utils/tryon-hair'
import type { TryOnFeature } from '../../../utils/tryon-capability'
import type { TryOnSessionMetrics } from '../../../utils/tryon-metrics'

export interface UseTryOnFeaturesOptions {
  props: {
    occluder?: boolean | undefined
    adaptiveLighting: boolean
    contactShadow: boolean
    physicalLens: boolean
    cameraMatch: boolean
    tintedLensShadow: boolean
    hairOcclusion: boolean
    mediapipeBasePath?: string | undefined
    mediapipeHairModelAssetPath?: string | undefined
  }
  capability: { allows: (feature: TryOnFeature) => boolean }
  moduleOccluder: () => boolean | undefined
  camera: { videoRef: Ref<HTMLVideoElement | null>; isActive: Ref<boolean> }
  tracking: { hasFace: Ref<boolean>; lightGain: Ref<number> }
}

export function useTryOnFeatures(options: UseTryOnFeaturesOptions) {
  const { props, capability } = options
  const { videoRef, isActive } = options.camera
  const { hasFace } = options.tracking

  const occluderEnabled = computed(
    () =>
      (props.occluder ?? options.moduleOccluder() ?? true) &&
      capability.allows('occluder')
  )

  const lightingEnabled = computed(
    () => props.adaptiveLighting && capability.allows('lightingEstimate')
  )

  const hairOcclusionAllowed = computed(
    () =>
      props.hairOcclusion &&
      occluderEnabled.value &&
      capability.allows('segmentationOccluder')
  )
  const hairSegmenter = useHairSegmenter(videoRef, {
    enabled: () => hairOcclusionAllowed.value && isActive.value && hasFace.value,
    mediapipeBasePath: props.mediapipeBasePath,
    modelAssetPath: props.mediapipeHairModelAssetPath
  })
  const hairActive = computed(
    () =>
      hairOcclusionAllowed.value &&
      !hairSegmenter.overBudget.value &&
      !hairSegmenter.error.value
  )

  const contactShadowEnabled = computed(
    () => props.contactShadow && capability.allows('contactShadow')
  )
  const tintedLensShadowEnabled = computed(
    () =>
      props.tintedLensShadow &&
      contactShadowEnabled.value &&
      capability.allows('tintedLensShadow')
  )
  const cameraMatchEnabled = computed(
    () => props.cameraMatch && capability.allows('cameraMatch')
  )
  const physicalLensEnabled = computed(
    () => props.physicalLens && capability.allows('physicalLens')
  )

  const contactShadowStrength = computed(
    () => CONTACT_SHADOW_STRENGTH * options.tracking.lightGain.value
  )

  const hair = computed(() => ({
    active: hairActive.value,
    coverage: hairSegmenter.mask.value
      ? maskCoverage(hairSegmenter.mask.value.data)
      : null,
    segmentMs: hairSegmenter.segmentMs.value,
    masks: hairSegmenter.masks.value,
    overBudget: hairSegmenter.overBudget.value,
    error: hairSegmenter.error.value
  }))

  function snapshot(): TryOnSessionMetrics['features'] {
    return {
      occluder: occluderEnabled.value,
      contactShadow: contactShadowEnabled.value,
      adaptiveLighting: lightingEnabled.value,
      physicalLens: physicalLensEnabled.value,
      hairOcclusion: hairActive.value,
      tintedLensShadow: tintedLensShadowEnabled.value,
      cameraMatch: cameraMatchEnabled.value
    }
  }

  return {
    occluderEnabled,
    lightingEnabled,
    contactShadowEnabled,
    tintedLensShadowEnabled,
    cameraMatchEnabled,
    physicalLensEnabled,
    contactShadowStrength,
    hairSegmenter,
    hairActive,
    hair,
    snapshot
  }
}
