import type { Ref } from 'vue'
import {
  captureLayout,
  captureQuality,
  type TryOnCaptureOptions
} from '../../../utils/tryon-capture'
import { CAMERA_BLUR_PX } from '../../../utils/tryon-camera-match'
import type { TryOnTrack } from './useTryOnTrackEvents'

/**
 * `capture()` (issue #93): the camera frame and the rendered frame
 * composited into one image. Pass `onSceneSnapshot` to the scene's
 * `snapshot`.
 */
export function useTryOnCapture(
  camera: { videoRef: Ref<HTMLVideoElement | null>; isActive: Ref<boolean> },
  stage: { width: Ref<number>; height: Ref<number> },
  /** Whether the frame shows, and whether the camera-match blur is on. */
  frame: { visible: () => boolean; cameraMatch: () => boolean },
  track: TryOnTrack
) {
  // Snapshot of the composited try-on (issue #93), set by the scene.
  let renderSnapshot: (() => HTMLCanvasElement | null) | null = null
  function onSceneSnapshot(render: () => HTMLCanvasElement | null) {
    renderSnapshot = render
  }

  /**
   * The try-on as the shopper sees it, as an image Blob: the visible
   * (`object-fit: cover`) window of the camera frame, mirrored like the
   * preview, with the frame rendered over it. Made on-device; the Blob stays in
   * the browser unless the host uploads or shares it. Rejects while the camera
   * is off.
   */
  async function capture(options: TryOnCaptureOptions = {}): Promise<Blob> {
    const video = camera.videoRef.value
    if (!camera.isActive.value || !video) throw new Error('capture: camera is not active')
    const layout = captureLayout(
      video.videoWidth,
      video.videoHeight,
      stage.width.value,
      stage.height.value,
      options.maxWidth
    )
    if (!layout) throw new Error('capture: camera frame not ready')
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('capture: 2D canvas unavailable')
    const { source } = layout
    // Mirrored once, like the preview's `scaleX(-1)`; the scene is not.
    context.save()
    context.translate(layout.width, 0)
    context.scale(-1, 1)
    context.drawImage(
      video,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      layout.width,
      layout.height
    )
    context.restore()
    // Render and copy in the same task: the drawing buffer is still intact.
    // As on screen: no frame while it is hidden (it fades out), and the
    // camera-match blur scaled from stage pixels to output pixels.
    const scene = frame.visible() ? renderSnapshot?.() : null
    if (scene && scene.width > 0 && scene.height > 0) {
      if (frame.cameraMatch() && stage.width.value > 0) {
        context.filter = `blur(${(CAMERA_BLUR_PX * layout.width) / stage.width.value}px)`
      }
      context.drawImage(scene, 0, 0, layout.width, layout.height)
      context.filter = 'none'
    }
    const type = options.type ?? 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, captureQuality(options.quality))
    )
    if (!blob) throw new Error('capture: encoding failed')
    track('TRY_ON_CAPTURE', { type: blob.type })
    return blob
  }

  return { capture, onSceneSnapshot }
}
