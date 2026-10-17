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
    hairOcclusion: boolean
    mediapipeBasePath?: string | undefined
    mediapipeHairModelAssetPath?: string | undefined
  }
  /** The device tier (`useCapabilityTier`). */
  capability: { allows: (feature: TryOnFeature) => boolean }
  /** The module's `occluder` option (runtime config). */
  moduleOccluder: () => boolean | undefined
  /** The camera (`useWebcamStream`). */
  camera: { videoRef: Ref<HTMLVideoElement | null>; isActive: Ref<boolean> }
  /** The held face and the room light (`useTryOnTracking`). */
  tracking: { hasFace: Ref<boolean>; lightGain: Ref<number> }
}

/**
 * Which optional features run. Each runs only when the host opted in AND the
 * device tier allows it (`useCapabilityTier`); the occluder's opt-in comes
 * from the prop, then the module option, then `true`. Room reflections
 * (`roomReflections`) ride on the lighting: useTryOnLighting keeps the room
 * sample only while the lighting runs. Also owns the hair segmenter (opt-in,
 * high tier) with its read-only state (`hair`), the contact shadow's
 * strength, and the `features` block of the `metrics` report (`snapshot`).
 */
export function useTryOnFeatures(options: UseTryOnFeaturesOptions) {
  const { props, capability } = options
  const { videoRef, isActive } = options.camera
  const { hasFace } = options.tracking

  const occluderEnabled = computed(
    () =>
      (props.occluder ?? options.moduleOccluder() ?? true) &&
      capability.allows('occluder')
  )

  // Room lighting (adaptive, mid tier): the face-landmarker worker returns a
  // small downsample of some detection frames, turned into a light gain/tint.
  const lightingEnabled = computed(
    () => props.adaptiveLighting && capability.allows('lightingEstimate')
  )

  // Hair occlusion (opt-in, high tier). The segmenter starts on the first
  // tracked face so it never delays the first try-on, and pauses while no face
  // is tracked.
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

  // Contact shadow under the bridge and lenses, on the tracked skin only (the
  // occluder mesh is the skin). Its ellipse follows the face width, and its
  // strength follows the room light.
  const contactShadowEnabled = computed(
    () => props.contactShadow && capability.allows('contactShadow')
  )
  const cameraMatchEnabled = computed(
    () => props.cameraMatch && capability.allows('cameraMatch')
  )
  const physicalLensEnabled = computed(
    () => props.physicalLens && capability.allows('physicalLens')
  )

  // Shadow opacity follows the room light: a bright room casts a stronger shadow.
  const contactShadowStrength = computed(
    () => CONTACT_SHADOW_STRENGTH * options.tracking.lightGain.value
  )

  // Hair-occlusion state, read-only on the ref: whether it runs, the share of
  // the frame the current mask calls hair, the worker's mean time per
  // segmentation, masks received, and why it stopped (budget, load error).
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

  /** The `features` block of the `metrics` report. */
  function snapshot(): TryOnSessionMetrics['features'] {
    return {
      occluder: occluderEnabled.value,
      contactShadow: contactShadowEnabled.value,
      adaptiveLighting: lightingEnabled.value,
      physicalLens: physicalLensEnabled.value,
      hairOcclusion: hairActive.value,
      cameraMatch: cameraMatchEnabled.value
    }
  }

  return {
    occluderEnabled,
    lightingEnabled,
    contactShadowEnabled,
    cameraMatchEnabled,
    physicalLensEnabled,
    contactShadowStrength,
    hairSegmenter,
    hairActive,
    hair,
    snapshot
  }
}
