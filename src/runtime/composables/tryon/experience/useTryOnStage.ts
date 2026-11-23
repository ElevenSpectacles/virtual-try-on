import { computed, ref, type Ref } from 'vue'
import { objectCoverWindow } from '../../../utils/tryon'
import { useTryOnElementSize } from '../useTryOnElementSize'

export function useTryOnStage(videoRef: Ref<HTMLVideoElement | null>) {
  const stageRef = ref<HTMLElement | null>(null)
  const { width, height } = useTryOnElementSize(stageRef)

  const aspect = computed(() =>
    height.value > 0 ? width.value / height.value : 3 / 4
  )

  const mediaAspect = ref(0)
  const coverWindow = computed(() =>
    objectCoverWindow(mediaAspect.value, aspect.value)
  )

  function onVideoLoadedMetadata() {
    const video = videoRef.value
    if (video?.videoWidth && video.videoHeight) {
      mediaAspect.value = video.videoWidth / video.videoHeight
    }
  }

  return { stageRef, width, height, aspect, mediaAspect, coverWindow, onVideoLoadedMetadata }
}
