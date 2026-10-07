import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import type { WebcamError } from '../../types/tryon-experience'
import { useTryOnLogger } from './useTryOnLogger'

export type { WebcamError }

/**
 * Front-camera stream lifecycle for the virtual try-on.
 *
 * Requests `facingMode: 'user'` (the front camera — the UX is judged on a
 * phone in portrait, not a desktop webcam) and hands back a `videoRef` to bind
 * to the mirrored `<video>` element. Cleans the stream up on unmount so the
 * camera light is never left on.
 *
 * Mirroring is a *display* concern handled in CSS on the video element; this
 * composable deals only with acquiring the raw stream.
 */
export function useWebcamStream() {
  const videoRef = ref<HTMLVideoElement | null>(null)
  const stream = shallowRef<MediaStream | null>(null)
  const isActive = ref(false)
  const isStarting = ref(false)
  const error: Ref<WebcamError | null> = ref(null)
  const logger = useTryOnLogger()

  async function start() {
    if (!import.meta.client || isActive.value || isStarting.value) return
    error.value = null

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
          // Tracking latency is bounded below by the camera frame interval —
          // at the default 30fps every pose update is up to 33ms stale before
          // detection even starts. `ideal` (not `exact`) so devices without a
          // 60fps front-camera mode silently keep their native rate.
          frameRate: { ideal: 60 }
        },
        audio: false
      })
      stream.value = media
      isActive.value = true

      if (videoRef.value) {
        videoRef.value.srcObject = media
        // Autoplay policies need muted + playsinline (set on the element too).
        await videoRef.value.play().catch(() => {})
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      error.value =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : 'unavailable'
      logger.warn('[useWebcamStream] getUserMedia failed', { name })
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

  return { videoRef, stream, isActive, isStarting, error, start, stop }
}
