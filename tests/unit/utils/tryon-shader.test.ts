import { describe, expect, it } from 'vitest'
import { ShaderLib } from 'three'
import { patchShader } from '../../../src/runtime/utils/tryon-shader'
import { GRAIN_HASH, grainHash, patchCameraMatchShader } from '../../../src/runtime/utils/tryon-camera-match'
import { patchLensFresnelShader, patchLensGradientShader } from '../../../src/runtime/utils/tryon-lens'
import { patchEarBendShader } from '../../../src/runtime/utils/tryon-temples'
import { patchContactReceiverShader } from '../../../src/runtime/utils/tryon-contact-occlusion'

const shader = (name: 'standard' | 'physical' | 'shadow') => ({
  vertexShader: ShaderLib[name].vertexShader,
  fragmentShader: ShaderLib[name].fragmentShader
})

describe('patchShader', () => {
  it('replaces the first occurrence of its target', () => {
    expect(patchShader('a X b X', 'X', 'Y')).toBe('a Y b X')
  })

  it('keeps $ patterns in the replacement literal', () => {
    expect(patchShader('a X', 'X', '$&$&')).toBe('a $&$&')
  })

  it('throws when the target is missing', () => {
    expect(() => patchShader('void main() {}', '#include <gone>', '')).toThrow(
      'shader patch target not found: #include <gone>'
    )
  })
})

describe('shader patches against the installed three.js', () => {
  it.each(['standard', 'physical'] as const)('camera match patches the %s fragment shader', (name) => {
    const out = patchCameraMatchShader(shader(name).fragmentShader)
    expect(out).toContain('uniform float uCameraGrain;')
    expect(out).toContain('cameraRim')
  })

  it.each(['standard', 'physical'] as const)('lens gradient patches the %s shaders', (name) => {
    const s = shader(name)
    patchLensGradientShader(s)
    expect(s.vertexShader).toContain('vLensHeight = ')
    expect(s.fragmentShader).toContain('uLensGradient')
  })

  it('lens Fresnel patches the physical fragment shader', () => {
    const out = patchLensFresnelShader(shader('physical').fragmentShader)
    expect(out).toContain('lensGrazing')
    expect(out).not.toContain('#include <premultiplied_alpha_fragment>')
  })

  it.each(['standard', 'physical'] as const)('ear bend patches the %s vertex shader', (name) => {
    const out = patchEarBendShader(shader(name).vertexShader)
    expect(out).toContain('tryOnEarBend(transformed')
  })

  it('contact occlusion patches the shadow material shaders', () => {
    const s = shader('shadow')
    patchContactReceiverShader(s)
    expect(s.vertexShader).toContain('vTintClip = gl_Position;')
    expect(s.fragmentShader).toContain('contactOcclusion(vAoPosition, aoNormal)')
    expect(s.fragmentShader).not.toContain('#include <colorspace_fragment>')
  })
})

describe('GLSL constants generated from TS', () => {
  it('builds the grain hash from the constants the TS mirror uses', () => {
    const out = patchCameraMatchShader(shader('standard').fragmentShader)
    expect(out).toContain(`vec2( ${GRAIN_HASH.x}, ${GRAIN_HASH.y} )`)
    expect(out).toContain(`* ${GRAIN_HASH.scale} )`)
    const v = Math.sin(3 * GRAIN_HASH.x + 4 * GRAIN_HASH.y + 0.5) * GRAIN_HASH.scale
    expect(grainHash(3, 4, 0.5)).toBe(v - Math.floor(v))
  })
})
