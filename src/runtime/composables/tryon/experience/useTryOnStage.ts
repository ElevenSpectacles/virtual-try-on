import { computed, ref, type Ref } from 'vue'
import { objectCoverWindow } from '../../../utils/tryon'
import { useTryOnElementSize } from '../useTryOnElementSize'

/**
 * The stage element's size and aspect, and the video's visible crop. Bind
 * `stageRef` to the stage and `onVideoLoadedMetadata` to the video.
 */
export function useTryOnStage(videoRef: Ref<HTMLVideoElement | null>) {
  const stageRef = ref<HTMLElement | null>(null)
  const { width, height } = useTryOnElementSize(stageRef)

  const aspect = computed(() =>
    height.value > 0 ? width.value / height.value : 3 / 4
  )

  // MediaPipe runs on the raw media frame, but the video is displayed
  // with object-fit: cover inside the fixed-aspect stage. Remap landmarks into
  // the visible cropped window so positioning matches what the user sees.
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
