import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export interface FacePose {
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
  euler: {
    yaw: number
    pitch: number
    roll: number
  }
  scale: number
}

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

export const HEAD_EULER_ORDER = 'YXZ'

export interface HeadRotation {
  x: number
  y: number
  z: number
}

export function headEuler(rotation: HeadRotation): Euler {
  return new Euler(rotation.x, rotation.y, rotation.z, HEAD_EULER_ORDER)
}

export function faceEulerToThree(euler: FacePose['euler']): Euler {
  return headEuler({ x: euler.pitch, y: -euler.yaw, z: -euler.roll })
}

export function composeHeadRotation(head: Euler, offset: HeadRotation): HeadRotation {
  const rotation = new Quaternion()
    .setFromEuler(head)
    .multiply(new Quaternion().setFromEuler(headEuler(offset)))
  const { x, y, z } = new Euler().setFromQuaternion(rotation, HEAD_EULER_ORDER)
  return { x, y, z }
}
