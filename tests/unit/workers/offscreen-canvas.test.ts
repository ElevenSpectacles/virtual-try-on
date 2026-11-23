import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CHROME_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/158.0.8127.0 Mobile/15E148 Safari/604.1'

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number
  ) {}
}

const created: { task: string; options: Record<string, unknown> }[] = []
let failGpu = false

function createFromOptions(task: string) {
  return async (_vision: unknown, options: Record<string, unknown>) => {
    created.push({ task, options })
    if (!options.canvas) throw new ReferenceError("Can't find variable: document")
    const delegate = (options.baseOptions as { delegate: string }).delegate
    if (failGpu && delegate === 'GPU') throw new Error('WebGL2 unavailable')
    return { getLabels: () => ['background', 'hair'], close() {} }
  }
}

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: { createFromOptions: createFromOptions('face') },
  ImageSegmenter: { createFromOptions: createFromOptions('hair') }
}))

interface WorkerScope extends EventTarget {
  postMessage: ReturnType<typeof vi.fn>
}

let scope: WorkerScope

async function boot(file: string) {
  await import(`../../../src/runtime/workers/${file}`)
  scope.dispatchEvent(new MessageEvent('message', { data: { type: 'init' } }))
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalled())
  return scope.postMessage.mock.calls[0]![0] as { type: string; message?: string }
}

describe('workers without a DOM (Chrome on iOS)', () => {
  beforeEach(() => {
    vi.resetModules()
    created.length = 0
    failGpu = false
    scope = Object.assign(new EventTarget(), { postMessage: vi.fn() })
    vi.stubGlobal('self', scope)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    vi.stubGlobal('navigator', { userAgent: CHROME_IOS_UA })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('face landmarker passes its own OffscreenCanvas', async () => {
    expect(await boot('face-landmarker.worker.ts')).toEqual({ type: 'ready' })
    expect(created).toHaveLength(1)
    expect(created[0]!.options.canvas).toBeInstanceOf(FakeOffscreenCanvas)
  })

  it('face landmarker CPU fallback gets a fresh OffscreenCanvas', async () => {
    failGpu = true
    expect(await boot('face-landmarker.worker.ts')).toEqual({ type: 'ready' })
    expect(created.map((c) => (c.options.baseOptions as { delegate: string }).delegate))
      .toEqual(['GPU', 'CPU'])
    expect(created[1]!.options.canvas).toBeInstanceOf(FakeOffscreenCanvas)
    expect(created[1]!.options.canvas).not.toBe(created[0]!.options.canvas)
  })

  it('hair segmenter passes its own OffscreenCanvas', async () => {
    expect(await boot('hair-segmenter.worker.ts')).toEqual({ type: 'ready' })
    expect(created[0]!.options.canvas).toBeInstanceOf(FakeOffscreenCanvas)
  })
})
