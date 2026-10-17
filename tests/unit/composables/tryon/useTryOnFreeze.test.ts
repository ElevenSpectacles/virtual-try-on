import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  useTryOnFreeze,
  type FreezableVideo
} from '../../../../src/runtime/composables/tryon/useTryOnFreeze'

function fakeVideo() {
  const video = {
    paused: false,
    pause: vi.fn(() => {
      video.paused = true
    }),
    play: vi.fn(async () => {
      video.paused = false
    })
  }
  return video
}

function setup(detectHeld: () => Promise<void> = async () => {}) {
  const video = fakeVideo()
  const active = ref(true)
  const scope = effectScope()
  const freeze = scope.run(() =>
    useTryOnFreeze(ref<FreezableVideo | null>(video), { active, detectHeld })
  )!
  return { video, active, ...freeze, scope }
}

describe('useTryOnFreeze', () => {
  it('pauses the video and detects the held frame before reporting frozen', async () => {
    let resolveDetect!: () => void
    const detectHeld = vi.fn(() => new Promise<void>((resolve) => (resolveDetect = resolve)))
    const { video, frozen, freeze } = setup(detectHeld)
    const pending = freeze()
    expect(video.pause).toHaveBeenCalledOnce()
    expect(detectHeld).toHaveBeenCalledOnce()
    // The pose isn't the held frame's until its detection is in.
    expect(frozen.value).toBe(false)
    resolveDetect()
    await pending
    expect(frozen.value).toBe(true)
  })

  it('plays the video again on unfreeze', async () => {
    const { video, frozen, freeze, unfreeze } = setup()
    await freeze()
    await unfreeze()
    expect(video.play).toHaveBeenCalledOnce()
    expect(video.paused).toBe(false)
    expect(frozen.value).toBe(false)
  })

  it('lets an unfreeze during the held detection win', async () => {
    let resolveDetect!: () => void
    const { video, frozen, freeze, unfreeze } = setup(
      () => new Promise<void>((resolve) => (resolveDetect = resolve))
    )
    const pending = freeze()
    await unfreeze()
    resolveDetect()
    await pending
    expect(frozen.value).toBe(false)
    expect(video.paused).toBe(false)
  })

  it('does nothing while the camera is off', async () => {
    const { video, active, frozen, freeze } = setup()
    active.value = false
    await freeze()
    expect(video.pause).not.toHaveBeenCalled()
    expect(frozen.value).toBe(false)
  })

  it('clears the freeze when the camera stops', async () => {
    const { active, frozen, freeze } = setup()
    await freeze()
    active.value = false
    await nextTick()
    expect(frozen.value).toBe(false)
  })

  it('ignores a second freeze', async () => {
    const detectHeld = vi.fn(async () => {})
    const { freeze } = setup(detectHeld)
    await freeze()
    await freeze()
    expect(detectHeld).toHaveBeenCalledOnce()
  })
})
