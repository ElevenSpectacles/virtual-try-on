import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { TRACKING_HOLD_MS } from '../../utils/tryon-guide'
import type { NormalizedLandmark } from '../../utils/tryon'
import type { FacePose } from '../../utils/tryon-pose'

export interface TrackingSource {
  landmarks: Ref<NormalizedLandmark[]>
  pose: Ref<FacePose | null>
  blinkScore: Ref<number | null>
  anchor: Ref<NormalizedLandmark | null>
}

export function useTryOnTrackingHold(
  source: TrackingSource,
  { holdMs = TRACKING_HOLD_MS }: { holdMs?: number } = {}
) {
  const landmarks = shallowRef<NormalizedLandmark[]>(source.landmarks.value)
  const pose = shallowRef<FacePose | null>(source.pose.value)
  const blinkScore = ref<number | null>(source.blinkScore.value)
  const anchor = shallowRef<NormalizedLandmark | null>(source.anchor.value)
  const lastYaw = ref<number | null>(source.pose.value?.euler.yaw ?? null)
  const holding = ref(false)
  let release: ReturnType<typeof setTimeout> | null = null

  function cancelRelease() {
    if (release !== null) clearTimeout(release)
    release = null
  }

  function scheduleRelease() {
    holding.value = true
    release = setTimeout(() => {
      release = null
      holding.value = false
      landmarks.value = []
      pose.value = null
      blinkScore.value = null
      anchor.value = null
    }, holdMs)
  }

  watch(source.landmarks, (list) => {
    if (list.length) {
      cancelRelease()
      holding.value = false
      landmarks.value = list
      pose.value = source.pose.value
      blinkScore.value = source.blinkScore.value
      anchor.value = source.anchor.value
      if (source.pose.value) lastYaw.value = source.pose.value.euler.yaw
      return
    }
    if (!landmarks.value.length || release !== null) return
    scheduleRelease()
  })

  onScopeDispose(cancelRelease)

  const hasFace = computed(() => landmarks.value.length > 0)

  return { landmarks, pose, blinkScore, anchor, hasFace, holding, lastYaw }
}
