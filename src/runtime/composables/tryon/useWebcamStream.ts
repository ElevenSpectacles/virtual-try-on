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

  async function start() {
    if (!import.meta.client || isActive.value || isStarting.value) return
    error.value = null
    errorDetail.value = null

    if (!navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }

    isStarting.value = true
    try {
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
      isActive.value = true

      if (videoRef.value) {
        videoRef.value.srcObject = media
        await videoRef.value.play().catch(() => {})
      }
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
    stop
  }
}
