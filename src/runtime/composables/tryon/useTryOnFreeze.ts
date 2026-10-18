import { ref, watch, type Ref } from 'vue'

/** The parts of an `HTMLVideoElement` freezing needs (fakeable in tests). */
export interface FreezableVideo {
  pause(): void
  play(): Promise<void> | void
  readonly paused: boolean
}

export interface UseTryOnFreezeOptions {
  /** Camera stream is on. Turning it off clears the freeze. */
  active: Ref<boolean>
  /** Detect the held frame and apply its landmarks (`useFaceLandmarker().detectHeld`). */
  detectHeld: () => Promise<void>
}

/**
 * Freeze / unfreeze (issue #97): hold the camera frame and the pose, so
 * frames can be compared on the same face.
 *
 * Freezing pauses the `<video>`: the preview keeps showing that frame, and
 * the detect loop (and the hair segmenter) stop on their own, since both
 * schedule on delivered video frames and skip a paused video — the worker
 * sits idle. Before the freeze takes effect, the held frame itself is
 * detected once, so the pose the frame renders with belongs to the frame
 * on screen, not to the one before it. While frozen the landmarks don't
 * change, so a model switch renders the new frame exactly where the old one
 * sat (the occluder and shadow keep the held face too). Unfreezing plays the
 * video; detection resumes on its next frame.
 */
export function useTryOnFreeze(
  videoRef: Ref<FreezableVideo | null>,
  options: UseTryOnFreezeOptions
) {
  const frozen = ref(false)
  let generation = 0

  async function freeze(): Promise<void> {
    const video = videoRef.value
    if (!video || !options.active.value || frozen.value) return
    const id = ++generation
    video.pause()
    await options.detectHeld()
    // An unfreeze (or camera stop) while the held frame was detected wins.
    if (id === generation && video.paused) frozen.value = true
  }

  async function unfreeze(): Promise<void> {
    generation++
    const video = videoRef.value
    const wasFrozen = frozen.value
    frozen.value = false
    if (video?.paused && (wasFrozen || options.active.value)) {
      try {
        await video.play()
      } catch {
        // Autoplay policy can refuse; the camera stream is still live and
        // the host can retry `start()`.
      }
    }
  }

  watch(options.active, (active) => {
    if (!active) {
      generation++
      frozen.value = false
    }
  })

  return { frozen, freeze, unfreeze }
}
