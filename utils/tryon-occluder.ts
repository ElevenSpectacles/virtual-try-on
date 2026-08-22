import { Euler, Quaternion, Vector3 } from 'three'
import {
  landmarkToWorld,
  type NormalizedLandmark
} from './tryon'

/**
 * Depth-only "head shell" occluder built per-frame from the tracked face
 * oval — the replacement for the single-ellipsoid head proxy.
 *
 * Why a shell instead of a tuned ellipsoid
 * ----------------------------------------
 * The glasses' temple arms run from the hinges back over the ears, and bow
 * slightly outward beyond the skull. No ellipsoid matches that: too wide and
 * it eats the near temple on profile views, too narrow and both temples
 * escape it on frontal views. The correct occluder is the head itself, which
 * we already track — MediaPipe's face-oval landmarks trace the visible face
 * silhouette every frame.
 *
 * The shell is a closed "scoop": a front ring hugging the face oval,
 * extruded straight back along the head's backward axis by roughly a skull
 * depth, with end caps. Rendered depth-only before the glasses, every GLB
 * fragment that falls inside the head volume fails the depth test:
 *
 * - Front view: both temples lie inside the shell → hidden. Only the hinge
 *   stubs that bow wider than the silhouette peek out — which is what real
 *   frames look like from the front.
 * - Profile view: the far temple is inside the head volume → hidden; the
 *   near temple runs outside the silhouette → visible. 3/4 angles, pitch and
 *   roll all fall out of the depth test continuously, with no thresholds.
 *
 * Riding the smoothed transform
 * -----------------------------
 * Raw oval landmarks jitter a pixel or two per frame; an occluder built
 * directly from them would shimmer at the edges exactly where it meets the
 * (smoothed) glasses. Instead the oval is extracted into the *raw* pose's
 * local frame and re-placed with the *smoothed* anchor/euler — the same
 * transform the glasses render with — so occluder and frame move as one
 * rigid body and inherit all One-Euro smoothing / latency prediction for
 * free. Only the shell's *shape* tracks the raw landmarks, and shape jitter
 * is invisible on a depth-only surface.
 *
 * Depth convention
 * ----------------
 * The calibration manifest anchors each GLB's FRONT face at the anchor plane
 * (z=0): the frame extends backward from it, toward the temples. The shell's
 * front cap must therefore sit slightly BEHIND that plane (see
 * `surfaceOffsetMeters`) — it plays the role of the skin surface the frame
 * rests on. A cap at or in front of the anchor plane would depth-hide the
 * entire frame inside the face silhouette.
 */

/**
 * MediaPipe's ordered 36-point face-oval loop (canonical order, closes on
 * itself). Runs forehead → right temple → jaw → chin → left temple →
 * forehead in the subject's own frame.
 */
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109
] as const

/** Number of vertices: front ring + back ring. */
export const HEAD_OCCLUDER_VERTEX_COUNT = FACE_OVAL_INDICES.length * 2

/**
 * Static triangle index for the shell: side wall quads between the rings,
 * plus a front-cap and back-cap fan so the volume is closed (grazing angles
 * would otherwise let far-side geometry show through the open tube).
 * Depth-only rendering doesn't care about winding, so no normals are built.
 */
export function buildHeadOccluderIndex(): Uint16Array {
  const n = FACE_OVAL_INDICES.length
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    // Side wall quad: (i, next, next+n) + (i, next+n, i+n)
    indices.push(i, next, next + n, i, next + n, i + n)
  }
  // Front cap fan around vertex 0.
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1)
  }
  // Back cap fan around vertex n (winding irrelevant, kept opposite anyway).
  for (let i = 1; i < n - 1; i++) {
    indices.push(n, n + i + 1, n + i)
  }
  return new Uint16Array(indices)
}

/** Shared instance — the index never changes between frames or frames. */
export const HEAD_OCCLUDER_INDEX = buildHeadOccluderIndex()

export interface HeadOccluderOptions {
  /** Cover-corrected, raw (unsmoothed) 478-point landmark array. */
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
  /** Smoothed metric scale (world units per GLB metre) — converts the metre constants below to world units. */
  scale: number
  /**
   * How far the shell extends behind the face, in metres. The calibration
   * anchors each frame's FRONT face at the anchor plane, so the temple arms
   * run the full frame depth back from there (~15.5cm for the catalog GLBs);
   * the shell must reach the tips or they escape it at frontal/profile views.
   */
  depthMeters?: number
  /**
   * Outward multiplier on the front ring. Real temples rest ON the skin; a
   * ring sitting exactly on the face surface would z-fight with them at the
   * silhouette. 1.04 hides what is truly behind while sparing contact rests.
   */
  inflate?: number
  /**
   * Offsets the whole shell along the head axis, in metres (positive = toward
   * the camera). Must stay NEGATIVE: calibration places the frame's front
   * face AT the anchor plane, so a cap at/above it depth-hides the entire
   * frame inside the face silhouette ("glasses behind the face"). The default
   * parks the cap 2mm behind the frame front — the skin surface the frame
   * rests on — so the frame always wins the depth test where it touches the
   * face, and only what lies behind the skin (temple arms) is hidden.
   */
  surfaceOffsetMeters?: number
}

const tmpVec = new Vector3()

/**
 * Build the shell's world-space vertex positions for this frame, or `null`
 * when the oval landmarks are missing (callers fall back to the ellipsoid
 * proxy — e.g. pointer/idle mode without a tracked face).
 *
 * Layout: front ring in `FACE_OVAL_INDICES` order, then the back ring in the
 * same order. Index via `HEAD_OCCLUDER_INDEX`.
 */
export function buildHeadOccluderPositions(
  options: HeadOccluderOptions
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
    depthMeters = 0.16,
    inflate = 1.04,
    surfaceOffsetMeters = -0.002
  } = options

  if (scale <= 0) return null

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

  // In the head's local frame +Z faces the camera, so the backward vector
  // and the skin-clearance offset both ride the smoothed orientation.
  const backward = new Vector3(0, 0, -1).applyQuaternion(qSmooth)
  const extrude = backward.clone().multiplyScalar(depthMeters * scale)
  const surfacePush = backward.clone().multiplyScalar(-surfaceOffsetMeters * scale)

  const positions = new Float32Array(HEAD_OCCLUDER_VERTEX_COUNT * 3)

  for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
    const landmark = landmarks[FACE_OVAL_INDICES[i]!]
    if (!landmark) return null

    const world = landmarkToWorld(landmark, aspect, { mirror })

    // Raw-pose local frame: strips global motion, keeps the face's shape.
    tmpVec.set(world.x - rawAnchorWorld.x, world.y - rawAnchorWorld.y, 0)
    tmpVec.applyQuaternion(qRawInv)
    tmpVec.x *= inflate
    tmpVec.y *= inflate

    // Re-place with the smoothed transform — same rigid motion as the frame.
    tmpVec.applyQuaternion(qSmooth)
    tmpVec.x += smoothedAnchorWorld.x + surfacePush.x
    tmpVec.y += smoothedAnchorWorld.y + surfacePush.y
    tmpVec.z += surfacePush.z

    positions[i * 3] = tmpVec.x
    positions[i * 3 + 1] = tmpVec.y
    positions[i * 3 + 2] = tmpVec.z

    const back = (i + FACE_OVAL_INDICES.length) * 3
    positions[back] = tmpVec.x + extrude.x
    positions[back + 1] = tmpVec.y + extrude.y
    positions[back + 2] = tmpVec.z + extrude.z
  }

  return positions
}
