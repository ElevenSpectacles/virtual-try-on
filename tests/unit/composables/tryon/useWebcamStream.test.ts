import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useWebcamStream } from '../../../../src/runtime/composables/tryon/useWebcamStream'

function fakeStream() {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
}

function fakeVideo(play: () => Promise<void>) {
  return { srcObject: null as MediaStream | null, play: vi.fn(play) }
}

function setup(play: () => Promise<void>) {
  const { track, stream } = fakeStream()
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const scope = effectScope()
  const camera = scope.run(() => useWebcamStream())!
  const video = fakeVideo(play)
  camera.videoRef.value = video as unknown as HTMLVideoElement
  return { camera, video, track, getUserMedia, scope }
}

const blocked = () => Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useWebcamStream', () => {
  it('goes active once the video plays', async () => {
    const { camera, video } = setup(async () => {})
    await camera.start()
    expect(video.srcObject).toBe(camera.stream.value)
    expect(camera.isActive.value).toBe(true)
    expect(camera.error.value).toBeNull()
  })

  it('reports a rejected play as play_failed, not active, and keeps the stream', async () => {
    const { camera, track } = setup(blocked)
    await camera.start()
    expect(camera.isActive.value).toBe(false)
    expect(camera.isStarting.value).toBe(false)
    expect(camera.error.value).toBe('play_failed')
    expect(camera.errorDetail.value).toBe('NotAllowedError')
    expect(camera.stream.value).not.toBeNull()
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('retries play on the kept stream without asking for the camera again', async () => {
    const { camera, video, getUserMedia } = setup(blocked)
    await camera.start()
    video.play.mockImplementation(async () => {})
    await camera.start()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(camera.isActive.value).toBe(true)
    expect(camera.error.value).toBeNull()
  })

  it('leaves the active state on a play failure after start', async () => {
    const { camera } = setup(async () => {})
    await camera.start()
    camera.failPlay(new DOMException('blocked', 'NotAllowedError'))
    expect(camera.isActive.value).toBe(false)
    expect(camera.error.value).toBe('play_failed')
    await camera.start()
    expect(camera.isActive.value).toBe(true)
  })

  it('stops the tracks and forgets the stream on stop', async () => {
    const { camera, video, track, getUserMedia } = setup(blocked)
    await camera.start()
    camera.stop()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
    video.play.mockImplementation(async () => {})
    await camera.start()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('maps a refused permission to denied', async () => {
    const { camera, getUserMedia } = setup(async () => {})
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    await camera.start()
    expect(camera.error.value).toBe('denied')
    expect(camera.isActive.value).toBe(false)
  })
})
