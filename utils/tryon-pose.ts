import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

/**
 * 6-DoF head pose extracted from a MediaPipe FaceLandmarker transformation
 * matrix.
 *
 * MediaPipe returns a 4×4 column-major matrix that maps the canonical face
 * model to the detected face in camera space. We decompose it into position,
 * quaternion, and Euler angles so the TresJS scene can apply the same pose to
 * the glasses model.
 */
export interface FacePose {
  /** Metric translation from the camera origin (MediaPipe camera space). */
  position: { x: number; y: number; z: number }
  /** Rotation as a quaternion. */
  quaternion: { x: number; y: number; z: number; w: number }
  /** Rotation as Euler angles in radians (YXZ order → yaw/pitch/roll). */
  euler: {
    /** Left/right head turn (radians). */
    yaw: number
    /** Up/down head nod (radians). */
    pitch: number
    /** Head tilt toward the shoulders (radians). */
    roll: number
  }
  /** Scale factor the matrix applies to the canonical face. */
  scale: number
}

/**
 * Decompose a 4×4 column-major transformation matrix into a `FacePose`.
 *
 * MediaPipe's matrix is column-major with 16 floats (rows=4, columns=4). The
 * decomposed values are returned in Three.js / TresJS world conventions so the
 * pose can be applied directly to a `<TresGroup>`.
 */
export function matrixToFacePose(matrixData: number[]): FacePose {
  if (matrixData.length !== 16) {
    throw new Error(
      `Expected 16 matrix elements, received ${matrixData.length}`
    )
  }

  const matrix = new Matrix4().fromArray(matrixData)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)

  // YXZ order gives intuitive yaw/pitch/roll for a head looking at a camera.
  const euler = new Euler().setFromQuaternion(quaternion, 'YXZ')

  return {
    position: { x: position.x, y: position.y, z: position.z },
    quaternion: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w
    },
    euler: {
      yaw: euler.y,
      pitch: euler.x,
      roll: euler.z
    },
    scale: (scale.x + scale.y + scale.z) / 3
  }
}

/**
 * Convert MediaPipe camera-space yaw/pitch/roll into a Three.js Euler usable
 * by `<TresGroup :rotation>`. MediaPipe's camera space has +x right, +y up,
 * +z away from the camera; Three.js has +z toward the camera, so we flip the
 * sign of the yaw/roll axes that depend on z handedness.
 */
export function faceEulerToThree(euler: FacePose['euler']): Euler {
  return new Euler(euler.pitch, -euler.yaw, -euler.roll, 'YXZ')
}
