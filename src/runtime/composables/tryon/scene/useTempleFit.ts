import { onUnmounted, watch, type ComputedRef, type ShallowRef } from 'vue'
import { Matrix4, Mesh, Quaternion, Vector3, Vector4, type Euler, type Material } from 'three'
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
  patchEarBendShader,
  templeAngles,
  templeFramePoints,
  type TempleRig
} from '../../../utils/tryon-temples'
import type { TempleState } from './useSceneModel'

/**
 * The rigged temple arms meet the tracked head: they open on their hinges
 * to clear it (`templeFit`) and, opt-in, bend down behind the ear
 * (`templeEarBend`).
 */
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
  }
) {
  // Temple fit (utils/tryon-temples): the face-mesh occluder's oval points at
  // temple height, the surface the arms pass, are taken into the GLB's frame
  // through the inverse of the frame group's transform and the recentring
  // offset, and the arms open or close on their hinges to clear them. The
  // occluder's shape follows the raw landmarks, so the angle is smoothed;
  // head width does not change while someone wears a frame, so it is slow.
  const TEMPLE_FILTER = { minCutoff: 0.5, beta: 1 }
  const groupMatrix = new Matrix4()
  const groupQuaternion = new Quaternion()
  const earPoint = new Vector3()

  // Ear bend (opt-in): each arm gets its own clone of the frame material with
  // a vertex-shader bend past the ear (`EAR_BEND_UNIFORMS`), since the arms
  // share their material with the frame front. The bend line follows the
  // head's oval point at temple height, smoothed like the opening angle.
  // Declared before the temple-fit watcher that drives it; its own watchers
  // still register after that one.
  const earBendMaterials = new Map<Mesh, { material: Material; uniform: { value: Vector4 } }>()
  let earBendFilter: OneEuroState | null = null

  function clearEarBend() {
    for (const [mesh, { material }] of earBendMaterials) {
      mesh.material = mesh.userData.tryOnTempleMaterial ?? mesh.material
      material.dispose()
    }
    earBendMaterials.clear()
    earBendFilter = null
  }

  function bendMaterial(mesh: Mesh) {
    const existing = earBendMaterials.get(mesh)
    if (existing) {
      // A lens-material rebuild re-assigns the authored materials: put ours back.
      if (mesh.material !== existing.material) mesh.material = existing.material
      return existing
    }
    const authored = mesh.material as Material
    mesh.userData.tryOnTempleMaterial = authored
    const material = authored.clone()
    const uniform = { value: new Vector4(0, 0, 0, EAR_BEND_RAMP_METERS) }
    // clone() copies userData but not onBeforeCompile: chain the authored
    // patches (camera match), or the clone keeps their "patched" flag
    // without their shader code and the arms lose grain and light wrap.
    const authoredCompile = authored.onBeforeCompile.bind(authored)
    material.onBeforeCompile = (shader, renderer) => {
      authoredCompile(shader, renderer)
      shader.uniforms.uEarBend = uniform
      shader.vertexShader = patchEarBendShader(shader.vertexShader)
    }
    material.customProgramCacheKey = () => `tryon-ear-bend-${authored.customProgramCacheKey()}`
    mesh.material = material
    const entry = { material, uniform }
    earBendMaterials.set(mesh, entry)
    return entry
  }

  function updateEarBend(
    rig: TempleRig,
    scenePoints: { x: number; y: number; z: number }[],
    dt: number
  ) {
    if (!props.templeEarBend) {
      if (earBendMaterials.size) clearEarBend()
      return
    }
    const local = templeFramePoints(rig, scenePoints)
    // One bend line for both arms (the ears are level on a head in a frame);
    // the further-back oval point, so neither tip drops in front of its ear.
    const ear = Math.max(...local.map((p) => p.x))
    const state = oneEuroFilter(earBendFilter, ear, dt, TEMPLE_FILTER)
    earBendFilter = state
    for (const temple of rig.temples) {
      const mesh = temple.pivot.children[0]
      if (!(mesh instanceof Mesh)) continue
      const bend = earBendFor(temple.profile, { x: state.value })
      bendMaterial(mesh).uniform.value.set(bend.start, bend.z, bend.angle, EAR_BEND_RAMP_METERS)
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

  // A new GLB has its own arms; turning the bend off restores the authored material.
  watch(model, clearEarBend)
  watch(
    () => props.templeEarBend,
    (enabled) => {
      if (!enabled) clearEarBend()
    }
  )

  onUnmounted(clearEarBend)

  return { earBendMaterials }
}
