import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import type { WebcamError } from '../../types/tryon-experience'

export type { WebcamError }

export function useWebcamStream() {
  const videoRef = ref<HTMLVideoElement | null>(null)
  const stream = shallowRef<MediaStream | null>(null)
  const isActive = ref(false)
  const isStarting = ref(false)
  const error: Ref<WebcamError | null> = ref(null)
  const errorDetail = ref<string | null>(null)

  function failPlay(err: unknown) {
    isActive.value = false
    error.value = 'play_failed'
    errorDetail.value = err instanceof DOMException ? err.name : String(err)
  }

  async function play(): Promise<boolean> {
    const video = videoRef.value
    if (!video) return true
    try {
      await video.play()
      return true
    } catch (err) {
      failPlay(err)
      return false
    }
  }

  async function start() {
    if (!import.meta.client || isActive.value || isStarting.value) return
    error.value = null
    errorDetail.value = null

    if (!stream.value && !navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }

    isStarting.value = true
    try {
      if (!stream.value) {
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 1280 },
            frameRate: { ideal: 60 }
          },
          audio: false
        })
        stream.value = media
        if (videoRef.value) videoRef.value.srcObject = media
      }
      if (await play()) isActive.value = true
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      error.value =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : 'unavailable'
      errorDetail.value = name || String(err)
    } finally {
      isStarting.value = false
    }
  }

  function stop() {
    stream.value?.getTracks().forEach((track) => track.stop())
    stream.value = null
    isActive.value = false
    if (videoRef.value) videoRef.value.srcObject = null
  }

  onBeforeUnmount(stop)

  return {
    videoRef,
    stream,
    isActive,
    isStarting,
    error,
    errorDetail,
    start,
    stop,
    failPlay
  }
}
