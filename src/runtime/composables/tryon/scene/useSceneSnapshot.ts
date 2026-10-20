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
    // `useTres().renderer` is the renderer instance itself (WebGL or WebGPU);
    // both draw with render(scene, camera) into their domElement.
    renderer.render(scene.value, active)
    return renderer.domElement
  })
}
