import type { Camera, Object3D } from 'three'
import { useTres } from '@tresjs/core'

/**
 * Hands the parent, once at setup, a function that renders the scene now
 * and returns the canvas, for `capture()`.
 */
export function useSceneSnapshot(onSnapshot: (render: () => HTMLCanvasElement | null) => void) {
  const { scene, renderer, camera } = useTres()

  // Render on demand for `capture()`: the drawing buffer is cleared after the
  // browser composites a frame, so a capture renders the current pose itself
  // and the caller copies the canvas before returning to the event loop.
  onSnapshot(() => {
    const active = camera.value
    if (!active) return null
    const target = renderer as unknown as {
      render: (scene: Object3D, camera: Camera) => void
      domElement: HTMLCanvasElement
    }
    target.render(scene.value, active)
    return target.domElement
  })
}
