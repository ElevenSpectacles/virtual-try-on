export function patchShader(source: string, target: string, replacement: string): string {
  const at = source.indexOf(target)
  if (at < 0) throw new Error(`shader patch target not found: ${target}`)
  return source.slice(0, at) + replacement + source.slice(at + target.length)
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

export function glslFloat(value: number): string {
  const literal = String(value)
  return /[.e]/.test(literal) ? literal : `${literal}.0`
}
