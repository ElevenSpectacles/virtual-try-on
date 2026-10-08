import { Euler, Quaternion, Vector3 } from 'three'
import {
  landmarkToWorld,
  worldPlaneWidth,
  type NormalizedLandmark
} from './tryon'
import { FACE_MESH_TRIANGLE_INDEX, FACE_MESH_VERTEX_COUNT } from './face-mesh-triangles'

/**
 * Depth-only face-mesh occluder built per frame from the tracked landmarks —
 * the same technique as MediaPipe's own effect renderer (and the paid try-on
 * SDKs): render the runtime face mesh into the depth buffer first, then every
 * fragment of the glasses that falls behind the face surface fails the depth
 * test.
 *
 * Why a mesh instead of an extruded silhouette scoop
 * --------------------------------------------------
 * The scoop (a flat cap over the face oval, extruded backward) cannot tell
 * "rim side curving back over the cheek" (must stay visible) from "temple
 * arm running behind the head" (must be hidden) — both occupy the same depth
 * near the silhouette, so the cap either bit into the frame's curved sides
 * (floating-hinge artifact) or leaked the temples. The real face surface
 * makes the distinction for free: cheeks curve back, the nose protrudes, the
 * eye sockets recess — the frame rests ON that surface, so what is in front
 * of the skin wins and what is behind it loses.
 *
 * Landmark depth
 * --------------
 * MediaPipe's landmark `z` is relative depth scaled like the `x` coordinate
 * (weak perspective), negative toward the camera, origin near the face's
 * centre of gravity. Converted to world units with the visible plane width
 * it reconstructs the face's true curvature — no tuned depth constants.
 *
 * Riding the smoothed transform
 * -----------------------------
 * Raw landmarks jitter a pixel or two per frame; an occluder placed directly
 * from them would shimmer at the edges exactly where it meets the (smoothed)
 * glasses. Instead the mesh is extracted into the *raw* pose's local frame
 * and re-placed with the *smoothed* anchor/euler — the same transform the
 * glasses render with — so occluder and frame move as one rigid body and
 * inherit all One-Euro smoothing / latency prediction for free. Only the
 * mesh's *shape* tracks the raw landmarks, and shape jitter is invisible on
 * a depth-only surface.
 *
 * The collar
 * ----------
 * The tracked mesh only covers the face surface itself — MediaPipe has no
 * landmarks over the ears or into the hairline, so a temple arm's run from
 * the hinge back to the ear has no tracked geometry behind it and floats
 * unoccluded. A "collar" wall, extruded straight back from the face-oval
 * boundary (`FACE_OVAL_INDICES`), closes that gap: it doesn't need the
 * mesh's curvature — by the time a temple reaches the ear it is already
 * side-on to the camera, so a simple depth wall is enough to hide it.
 *
 * Only the two lateral arcs of the oval get a collar — roughly eye-to-jaw
 * height on each side, where a temple arm actually runs to the ear. The
 * forehead and chin arcs are deliberately excluded: walling those off too
 * (closing the loop all the way around) put a depth surface straight
 * through the browline, clipping the top rim of the frame on near-frontal
 * views for no benefit — nothing needs hiding above/below the temple's
 * height band.
 */

/**
 * MediaPipe's ordered 36-point face-oval loop (canonical order, closes on
 * itself): forehead → right temple/cheek → jaw → chin → left temple/cheek →
 * forehead. The collar extrudes backward only from the two temple/cheek
 * arcs (see `COLLAR_RANGES`).
 */
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109
] as const

/**
 * Inclusive [start, end] slot ranges into `FACE_OVAL_INDICES` that get a
 * collar wall — the right (454, slot 8) and left (234, slot 28) temple/cheek
 * arcs, each padded a few points toward the jaw and toward the brow without
 * reaching the forehead-top (slot 0) or chin (slot 18) points.
 */
const COLLAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [4, 12],
  [24, 32]
]

interface CollarPoint {
  landmarkIndex: number
  backSlot: number
}

const COLLAR_POINTS: CollarPoint[] = []
for (const [start, end] of COLLAR_RANGES) {
  for (let slot = start; slot <= end; slot++) {
    COLLAR_POINTS.push({
      landmarkIndex: FACE_OVAL_INDICES[slot]!,
      backSlot: COLLAR_POINTS.length
    })
  }
}

const OVAL_SLOT = new Map(
  COLLAR_POINTS.map(({ landmarkIndex, backSlot }) => [landmarkIndex, backSlot])
)

/** Tracked mesh vertices, plus one collar back-vertex per collar boundary point. */
export const FACE_MESH_OCCLUDER_VERTEX_COUNT =
  FACE_MESH_VERTEX_COUNT + COLLAR_POINTS.length

function buildCollarIndex(): Uint16Array {
  const triangles: number[] = []
  let cursor = 0
  for (const [start, end] of COLLAR_RANGES) {
    const count = end - start + 1
    for (let i = 0; i < count - 1; i++) {
      const frontA = FACE_OVAL_INDICES[start + i]!
      const frontB = FACE_OVAL_INDICES[start + i + 1]!
      const backA = FACE_MESH_VERTEX_COUNT + cursor + i
      const backB = FACE_MESH_VERTEX_COUNT + cursor + i + 1
      triangles.push(frontA, backA, frontB, frontB, backA, backB)
    }
    cursor += count
  }
  return Uint16Array.from(triangles)
}

/** Static triangle index (shared — never changes between frames): the tracked mesh plus the collar side walls. */
export const FACE_MESH_OCCLUDER_INDEX = (() => {
  const collar = buildCollarIndex()
  const combined = new Uint16Array(FACE_MESH_TRIANGLE_INDEX.length + collar.length)
  combined.set(FACE_MESH_TRIANGLE_INDEX, 0)
  combined.set(collar, FACE_MESH_TRIANGLE_INDEX.length)
  return combined
})()

export interface FaceMeshOccluderOptions {
  /** Cover-corrected, raw (unsmoothed) landmark array (≥ 468 points). */
  landmarks: NormalizedLandmark[]
  aspect: number
  /** Front-camera mirror, same convention as `landmarkToWorld`. */
  mirror?: boolean
  /** Raw anchor centroid (cover-corrected, pre-smoothing). */
  rawAnchor: NormalizedLandmark
  /** Raw head Euler (pre-smoothing, Three.js space — same target the glasses smooth toward). */
  rawEuler: { x: number; y: number; z: number }
  /** Smoothed anchor the glasses render with. */
  smoothedAnchor: NormalizedLandmark
  /** Smoothed Euler the glasses render with. */
  smoothedEuler: { x: number; y: number; z: number }
  /** Smoothed metric scale (world units per real metre) — converts the metre constants below to world units. */
  scale: number
  /**
   * Pushes the whole mesh slightly AWAY from the camera, in metres, so frame
   * parts resting on the skin (bridge, nose pads) win the depth test instead
   * of z-fighting the face surface. Keep small: every mm of setback also
   * loosens the silhouette's grip on the temple arms (see `inflate`).
   */
  skinSetbackMeters?: number
  /**
   * Outward multiplier on x/y about the anchor. Temples rest ON the skin; a
   * mesh sitting exactly on the tracked surface would z-fight them at the
   * grazing silhouette. 1.04 keeps what is truly behind the head hidden
   * while sparing contact rests.
   */
  inflate?: number
  /**
   * How far the collar (see file header) extends behind the face-oval
   * boundary, in metres — roughly a skull depth, so it reaches the ear and
   * beyond regardless of head rotation.
   */
  collarDepthMeters?: number
  /**
   * Outward multiplier on the collar's back vertices only (x/y about the
   * anchor), on top of `inflate`. The face oval runs along the cheek line —
   * real ears sit further out sideways than that line. A collar wall
   * extruded straight backward from the oval stays inboard of the ear, so a
   * temple resting on the ear pokes past the wall laterally and shows
   * through. Flaring the back vertices outward widens the wall's footprint
   * to actually reach past the ear instead of just behind the cheek.
   */
  collarFlare?: number
  /**
   * Extra push-back, in metres, for the side of the head turned toward the
   * camera (see `nearSideWeight`). There the temple arm runs along the
   * visible side of the head, millimetres off the skin — `inflate` and
   * `collarFlare` would wrap the occluder over it and cut it off behind the
   * hinge. Nothing of the frame is truly behind the near cheek, so that side
   * drops both (its collar collapses onto the oval) and steps back; the far
   * side keeps them to hide its temple.
   */
  nearSideSetbackMeters?: number
}

/**
 * 0 → 1 weight for how much a head-local vertex sits on the camera-facing
 * side of the head: zero near the midline (nose, bridge — must keep
 * occluding the far lens) and on a frontal head, one on the outer cheek of a
 * head turned ≳ 20°. `camLocalX` is the x component of the unit
 * camera direction in head-local space (≈ sin(yaw)).
 */
export function nearSideWeight(
  localX: number,
  camLocalX: number,
  midlineHalfWidth: number
): number {
  const facing = Math.sign(localX) * camLocalX
  const turn = smoothstep(0.1, 0.35, facing)
  const lateral = smoothstep(midlineHalfWidth, midlineHalfWidth * 2.5, Math.abs(localX))
  return turn * lateral
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const tmpVec = new Vector3()
const backVec = new Vector3()

/**
 * Build the face mesh's world-space vertex positions for this frame, or
 * `null` when landmarks are missing (callers fall back to the ellipsoid
 * proxy — e.g. pointer/idle mode without a tracked face).
 *
 * Layout: `FACE_MESH_VERTEX_COUNT` tracked-mesh vertices in landmark order,
 * followed by one collar back-vertex per `COLLAR_POINTS` entry (total
 * `FACE_MESH_OCCLUDER_VERTEX_COUNT`); index via `FACE_MESH_OCCLUDER_INDEX`.
 */
export function buildFaceMeshOccluderPositions(
  options: FaceMeshOccluderOptions
): Float32Array | null {
  const {
    landmarks,
    aspect,
    mirror = true,
    rawAnchor,
    rawEuler,
    smoothedAnchor,
    smoothedEuler,
    scale,
    skinSetbackMeters = 0.006,
    inflate = 1.04,
    collarDepthMeters = 0.2,
    collarFlare = 1.35,
    nearSideSetbackMeters = 0.03
  } = options

  if (scale <= 0 || landmarks.length < FACE_MESH_VERTEX_COUNT) return null

  const qRaw = new Quaternion().setFromEuler(
    new Euler(rawEuler.x, rawEuler.y, rawEuler.z, 'YXZ')
  )
  const qRawInv = qRaw.clone().invert()
  const qSmooth = new Quaternion().setFromEuler(
    new Euler(smoothedEuler.x, smoothedEuler.y, smoothedEuler.z, 'YXZ')
  )
  const rawAnchorWorld = landmarkToWorld(rawAnchor, aspect, { mirror })
  const smoothedAnchorWorld = landmarkToWorld(smoothedAnchor, aspect, {
    mirror
  })

  // Landmark z is scaled like the x coordinate: one normalized unit spans
  // the visible plane width in world units. MediaPipe's z grows away from
  // the camera; world +z faces the camera — hence the sign flip. Measured
  // relative to the anchor's z so the mesh's nose ridge lands on the same
  // plane the frame is anchored at.
  const zWorldPerNorm = worldPlaneWidth(aspect)
  const anchorZ = rawAnchor.z ?? 0

  // In the head's local frame +Z faces the camera, so the skin setback rides
  // the smoothed orientation backward.
  const setback = new Vector3(0, 0, -skinSetbackMeters * scale).applyQuaternion(
    qSmooth
  )

  // Camera direction in the raw head-local frame, and the half-width of the
  // midline band (nose, bridge) that always keeps occluding — 2 cm.
  const camLocalX = new Vector3(0, 0, 1).applyQuaternion(qRawInv).x
  const midlineHalfWidth = 0.02 * scale

  const positions = new Float32Array(FACE_MESH_OCCLUDER_VERTEX_COUNT * 3)

  for (let i = 0; i < FACE_MESH_VERTEX_COUNT; i++) {
    const landmark = landmarks[i]!
    const world = landmarkToWorld(landmark, aspect, { mirror })

    // Raw-pose local frame: strips global motion, keeps the face's shape
    // (now including its true depth curvature). In this canonical
    // orientation +Z is the front of the face, so "backward" (the collar's
    // direction) is -Z.
    tmpVec.set(
      world.x - rawAnchorWorld.x,
      world.y - rawAnchorWorld.y,
      -((landmark.z ?? 0) - anchorZ) * zWorldPerNorm
    )
    tmpVec.applyQuaternion(qRawInv)
    const near = nearSideWeight(tmpVec.x, camLocalX, midlineHalfWidth)
    const vertexInflate = inflate + (1 - inflate) * near
    tmpVec.x *= vertexInflate
    tmpVec.y *= vertexInflate
    tmpVec.z -= near * nearSideSetbackMeters * scale

    const ovalSlot = OVAL_SLOT.get(i)
    if (ovalSlot !== undefined) {
      // The near side's collar collapses onto the oval: from the camera's
      // side of the head it would only wall off the visible temple.
      backVec.copy(tmpVec)
      backVec.x *= collarFlare
      backVec.y *= collarFlare
      backVec.z -= collarDepthMeters * scale
      backVec.lerp(tmpVec, near)
      backVec.applyQuaternion(qSmooth)
      backVec.x += smoothedAnchorWorld.x + setback.x
      backVec.y += smoothedAnchorWorld.y + setback.y
      backVec.z += setback.z
      const backIndex = (FACE_MESH_VERTEX_COUNT + ovalSlot) * 3
      positions[backIndex] = backVec.x
      positions[backIndex + 1] = backVec.y
      positions[backIndex + 2] = backVec.z
    }

    // Re-place with the smoothed transform — same rigid motion as the frame.
    tmpVec.applyQuaternion(qSmooth)
    tmpVec.x += smoothedAnchorWorld.x + setback.x
    tmpVec.y += smoothedAnchorWorld.y + setback.y
    tmpVec.z += setback.z

    positions[i * 3] = tmpVec.x
    positions[i * 3 + 1] = tmpVec.y
    positions[i * 3 + 2] = tmpVec.z
  }

  return positions
}
