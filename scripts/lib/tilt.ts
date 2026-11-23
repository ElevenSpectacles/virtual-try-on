export const PANTOSCOPIC_TARGET_DEG = 9
export const PANTOSCOPIC_RANGE_DEG = { min: 7, max: 12 } as const

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

export function pantoscopicTiltDeg(plane: { b: number }): number {
  return (Math.atan(plane.b) * 180) / Math.PI
}

export interface TiltAudit {
  model: string
  authoredDeg: number
  effectiveDeg: number
  ok: boolean
  suggestedRotationX: number
}

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
