import type { Page } from '@playwright/test'

export interface GlslRun {
  functions: string
  body: string
  inputs: number[][]
}

const MAX_INPUT_TEXTURES = 4

export async function runGlsl(page: Page, run: GlslRun): Promise<number[][]> {
  const width = run.inputs.length
  const textures = Math.max(1, Math.ceil(Math.max(...run.inputs.map((row) => row.length)) / 4))
  if (textures > MAX_INPUT_TEXTURES) throw new Error(`at most ${MAX_INPUT_TEXTURES * 4} inputs per sample`)
  const declarations = Array.from({ length: textures }, (_, i) => `uniform highp sampler2D uIn${i};`).join('\n')
  const reads = Array.from(
    { length: textures },
    (_, i) => `vec4 in${i} = texelFetch(uIn${i}, ivec2(gl_FragCoord.xy), 0);`
  ).join('\n  ')
  const fragment = `#version 300 es
precision highp float;
precision highp int;
#define saturate(a) clamp(a, 0.0, 1.0)
${declarations}
out vec4 fragOut;
${run.functions}
void main() {
  ${reads}
  vec4 result = vec4(0.0);
  ${run.body}
  fragOut = result;
}`
  return page.evaluate(
    ({ fragment, inputs, width, textures }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = 1
      const gl = canvas.getContext('webgl2')
      if (!gl) throw new Error('WebGL2 unavailable')
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable')
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(`${gl.getShaderInfoLog(shader)}\n${source}`)
        }
        return shader
      }
      const program = gl.createProgram()!
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          '#version 300 es\nvoid main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }'
        )
      )
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
      gl.useProgram(program)
      for (let t = 0; t < textures; t++) {
        const data = new Float32Array(width * 4)
        inputs.forEach((row, x) => {
          for (let c = 0; c < 4; c++) data[x * 4 + c] = row[t * 4 + c] ?? 0
        })
        gl.activeTexture(gl.TEXTURE0 + t)
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.uniform1i(gl.getUniformLocation(program, `uIn${t}`), t)
      }
      const target = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + textures)
      gl.bindTexture(gl.TEXTURE_2D, target)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, null)
      const framebuffer = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
      gl.viewport(0, 0, width, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const out = new Float32Array(width * 4)
      gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, out)
      return Array.from({ length: width }, (_, x) => Array.from(out.subarray(x * 4, x * 4 + 4)))
    },
    { fragment, inputs: run.inputs, width, textures }
  )
}
