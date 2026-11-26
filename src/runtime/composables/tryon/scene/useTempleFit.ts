import { onUnmounted, watch, type ComputedRef, type ShallowRef } from 'vue'
import { Matrix4, Mesh, Quaternion, Vector3, type Euler, type Vector4 } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  EAR_LEVEL_LEFT,
  EAR_LEVEL_RIGHT,
  oneEuroFilter,
  type OneEuroState
} from '../../../utils/tryon'
import {
  EAR_BEND_RAMP_METERS,
  earBendFor,
  templeAngles,
  templeFramePoints,
  type TempleRig
} from '../../../utils/tryon-temples'
import type { TempleState } from './useSceneModel'
import type { EarBendMaterials } from './useFrameMaterials'

export function useTempleFit(
  model: ShallowRef<GLTF | null>,
  temples: TempleState,
  props: {
    occluderPositions: Float32Array | null
    templeFit: boolean
    templeEarBend: boolean
  },
  group: {
    groupPosition: ComputedRef<Vector3>
    groupRotation: ComputedRef<Euler>
    groupScale: ComputedRef<Vector3>
    modelOffsetVec: ComputedRef<Vector3>
  },
  materials: {
    earBend: (mesh: Mesh) => { value: Vector4 }
    clearEarBend: () => void
    earBendMaterials: EarBendMaterials
  }
) {
  const TEMPLE_FILTER = { minCutoff: 0.5, beta: 1 }
  const groupMatrix = new Matrix4()
  const groupQuaternion = new Quaternion()
  const earPoint = new Vector3()

  let earBendFilter: OneEuroState | null = null

  function clearEarBend() {
    materials.clearEarBend()
    earBendFilter = null
  }

  function updateEarBend(
    rig: TempleRig,
    scenePoints: { x: number; y: number; z: number }[],
    dt: number
  ) {
    if (!props.templeEarBend) {
      if (materials.earBendMaterials.size) clearEarBend()
      return
    }
    const local = templeFramePoints(rig, scenePoints)
    const ear = Math.max(...local.map((p) => p.x))
    const state = oneEuroFilter(earBendFilter, ear, dt, TEMPLE_FILTER)
    earBendFilter = state
    for (const temple of rig.temples) {
      const mesh = temple.pivot.children[0]
      if (!(mesh instanceof Mesh)) continue
      const bend = earBendFor(temple.profile, { x: state.value })
      materials.earBend(mesh).value.set(bend.start, bend.z, bend.angle, EAR_BEND_RAMP_METERS)
    }
  }

  const { groupPosition, groupRotation, groupScale, modelOffsetVec } = group
  watch(
    [
      () => props.occluderPositions,
      () => props.templeFit,
      groupPosition,
      groupRotation,
      groupScale,
      modelOffsetVec,
      model
    ],
    ([positions, enabled, position, rotation, scale, offset, gltf]) => {
      const rig = temples.rig
      if (!rig || !gltf) return
      if (!enabled) {
        for (const temple of rig.temples) temple.pivot.rotation.z = 0
        temples.filters = []
        return
      }
      if (!positions) return
      groupMatrix
        .compose(position, groupQuaternion.setFromEuler(rotation), scale)
        .invert()
      const sceneInverse = gltf.scene.matrix.clone().invert()
      const points = [EAR_LEVEL_RIGHT, EAR_LEVEL_LEFT].map((i) => {
        earPoint
          .fromArray(positions, i * 3)
          .applyMatrix4(groupMatrix)
          .sub(offset)
          .applyMatrix4(sceneInverse)
        return { x: earPoint.x, y: earPoint.y, z: earPoint.z }
      })
      const now = performance.now()
      const dt = temples.time ? (now - temples.time) / 1000 : 0
      temples.time = now
      templeAngles(rig, points).forEach((angle, i) => {
        const state = oneEuroFilter(temples.filters[i] ?? null, angle, dt, TEMPLE_FILTER)
        temples.filters[i] = state
        rig.temples[i]!.pivot.rotation.z = state.value
      })
      updateEarBend(rig, points, dt)
    },
    { immediate: true }
  )

  watch(model, clearEarBend)
  watch(
    () => props.templeEarBend,
    (enabled) => {
      if (!enabled) clearEarBend()
    }
  )

  onUnmounted(clearEarBend)

}
