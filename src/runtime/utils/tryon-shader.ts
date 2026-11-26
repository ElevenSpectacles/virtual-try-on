export function patchShader(source: string, target: string, replacement: string): string {
  const at = source.indexOf(target)
  if (at < 0) throw new Error(`shader patch target not found: ${target}`)
  return source.slice(0, at) + replacement + source.slice(at + target.length)
}
