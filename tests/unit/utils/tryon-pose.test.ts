import { describe, it, expect } from 'vitest'
import {
  matrixToFacePose,
  faceEulerToThree
} from '../../utils/tryon-pose'

describe('try-on pose helpers', () => {
  describe('matrixToFacePose', () => {
    it('rejects non-16-element matrices', () => {
      expect(() => matrixToFacePose([1, 0, 0, 0])).toThrow(
        'Expected 16 matrix elements, received 4'
      )
    })

    it('extracts identity pose from the identity matrix', () => {
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      const pose = matrixToFacePose(identity)

      expect(pose.position).toEqual({ x: 0, y: 0, z: 0 })
      expect(pose.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 })
      expect(pose.euler.yaw).toBeCloseTo(0)
      expect(pose.euler.pitch).toBeCloseTo(0)
      expect(pose.euler.roll).toBeCloseTo(0)
      expect(pose.scale).toBeCloseTo(1)
    })

    it('extracts translation from the last column', () => {
      const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, -0.3, 1.5, 1]
      const pose = matrixToFacePose(matrix)

      expect(pose.position).toEqual({ x: 0.2, y: -0.3, z: 1.5 })
    })

    it('extracts uniform scale', () => {
      const matrix = [1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 1]
      const pose = matrixToFacePose(matrix)

      expect(pose.scale).toBeCloseTo(1.2)
    })

    it('extracts yaw rotation around the y-axis', () => {
      // 30° yaw: cos ≈ 0.866, sin ≈ 0.5
      // Matrix is column-major because Three.js Matrix4.fromArray expects it.
      const yaw = Math.PI / 6
      const matrix = [
        Math.cos(yaw),
        0,
        -Math.sin(yaw),
        0,
        0,
        1,
        0,
        0,
        Math.sin(yaw),
        0,
        Math.cos(yaw),
        0,
        0,
        0,
        0,
        1
      ]
      const pose = matrixToFacePose(matrix)

      expect(pose.euler.yaw).toBeCloseTo(yaw)
      expect(pose.euler.pitch).toBeCloseTo(0)
      expect(pose.euler.roll).toBeCloseTo(0)
    })
  })

  describe('faceEulerToThree', () => {
    it('flips yaw/roll to match Three.js handedness', () => {
      const euler = {
        yaw: Math.PI / 4,
        pitch: Math.PI / 6,
        roll: Math.PI / 3
      }
      const three = faceEulerToThree(euler)

      expect(three.x).toBeCloseTo(euler.pitch)
      expect(three.y).toBeCloseTo(-euler.yaw)
      expect(three.z).toBeCloseTo(-euler.roll)
      expect(three.order).toBe('YXZ')
    })
  })
})
