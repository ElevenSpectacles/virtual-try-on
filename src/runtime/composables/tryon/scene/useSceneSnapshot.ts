import { useTres } from '@tresjs/core'

export function useSceneSnapshot(onSnapshot: (render: () => HTMLCanvasElement | null) => void) {
  const { scene, renderer, camera } = useTres()

  onSnapshot(() => {
    const active = camera.value
    if (!active) return null
    renderer.render(scene.value, active)
    return renderer.domElement
  })
}
