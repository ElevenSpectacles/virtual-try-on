import { ref, watch, type Ref } from 'vue'

export interface FreezableVideo {
  pause(): void
  play(): Promise<void> | void
  readonly paused: boolean
}

export interface UseTryOnFreezeOptions {
  active: Ref<boolean>
  detectHeld: () => Promise<void>
  onPlayError?: (err: unknown) => void
}

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
      } catch (err) {
        options.onPlayError?.(err)
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
