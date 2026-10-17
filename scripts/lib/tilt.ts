/**
 * Pantoscopic tilt audit (issue #87). Tooling only.
 *
 * A worn frame's front tilts forward at the bottom by 7–12° (ZEISS
 * dispensing guide: default 9°) so the lenses follow the cheekbones and the
 * eye's downward gaze. On the try-on, a model's effective tilt is its lens
 * plane's own tilt in the GLB plus the calibration `rotation.x`. This fits
 * the lens plane to the lens vertices (least squares over depth = a·x + b·y
 * + c, the front of a lens being nearly flat), reads the tilt from its slope
 * in y, and suggests the `rotation.x` that brings the model to the target.
 *
 * Conventions: GLB y up, z toward the viewer (glTF). A positive tilt has the
 * lens bottom closer to the face (further from the viewer) than its top.
 */

export const PANTOSCOPIC_TARGET_DEG = 9
export const PANTOSCOPIC_RANGE_DEG = { min: 7, max: 12 } as const

/** Least-squares plane z = a·x + b·y + c through xyz triples. */
export function fitDepthPlane(points: ArrayLike<number>): { a: number; b: number; c: number } | null {
  let n = 0
  let sx = 0
  let sy = 0
  let sz = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  let sxz = 0
  let syz = 0
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i]!
    const y = points[i + 1]!
    const z = points[i + 2]!
    n++
    sx += x
    sy += y
    sz += z
    sxx += x * x
    syy += y * y
    sxy += x * y
    sxz += x * z
    syz += y * z
  }
  if (n < 3) return null
  // Normal equations, solved by Cramer's rule on the centred system.
  const mx = sx / n
  const my = sy / n
  const mz = sz / n
  const cxx = sxx / n - mx * mx
  const cyy = syy / n - my * my
  const cxy = sxy / n - mx * my
  const cxz = sxz / n - mx * mz
  const cyz = syz / n - my * mz
  const det = cxx * cyy - cxy * cxy
  if (Math.abs(det) < 1e-18) return null
  const a = (cxz * cyy - cyz * cxy) / det
  const b = (cyz * cxx - cxz * cxy) / det
  return { a, b, c: mz - a * mx - b * my }
}

/**
 * Pantoscopic tilt of a lens plane in degrees: the forward lean of its
 * bottom. With depth z = a·x + b·y + c, going up by 1 moves the surface
 * toward the viewer by b, so the bottom sits back by the angle atan(b).
 */
export function pantoscopicTiltDeg(plane: { b: number }): number {
  return (Math.atan(plane.b) * 180) / Math.PI
}

export interface TiltAudit {
  model: string
  /** Tilt of the lens plane in the GLB, degrees. */
  authoredDeg: number
  /** With the calibration's rotation.x applied, degrees. */
  effectiveDeg: number
  /** Within PANTOSCOPIC_RANGE_DEG. */
  ok: boolean
  /** rotation.x (radians) that gives PANTOSCOPIC_TARGET_DEG. */
  suggestedRotationX: number
}

/**
 * Audit one model: lens vertices in the GLB frame and its calibration
 * `rotation.x` (radians; three.js rotation about x, positive tips the top
 * toward the viewer, which adds tilt).
 */
export function auditTilt(model: string, lensPoints: ArrayLike<number>, rotationX: number): TiltAudit | null {
  const plane = fitDepthPlane(lensPoints)
  if (!plane) return null
  const authoredDeg = pantoscopicTiltDeg(plane)
  const effectiveDeg = authoredDeg + (rotationX * 180) / Math.PI
  return {
    model,
    authoredDeg,
    effectiveDeg,
    ok: effectiveDeg >= PANTOSCOPIC_RANGE_DEG.min && effectiveDeg <= PANTOSCOPIC_RANGE_DEG.max,
    suggestedRotationX: ((PANTOSCOPIC_TARGET_DEG - authoredDeg) * Math.PI) / 180
  }
}
