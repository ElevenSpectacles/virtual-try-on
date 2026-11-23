import { describe, expect, it } from 'vitest'
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace, Texture } from 'three'
import { buildLens } from '../../../../../src/runtime/composables/tryon/scene/useLensMaterials'
import { NO_LENS_OVERRIDE, resolveLens } from '../../../../../src/runtime/utils/tryon-lens'

function authoredLens() {
  return new MeshStandardMaterial({ name: 'glass', map: new Texture(), color: 0xffc8d1, opacity: 0.62, transparent: true })
}

describe('buildLens', () => {
  it('keeps the authored colour and texture without an override', () => {
    const authored = authoredLens()
    for (const physical of [true, false]) {
      const lens = buildLens(authored, physical, NO_LENS_OVERRIDE) as MeshStandardMaterial
      expect(lens.map).toBe(authored.map)
      expect(lens.color.getHex()).toBe(authored.color.getHex())
      expect(lens.opacity).toBeCloseTo(0.62, 9)
    }
  })

  it('replaces the authored texture with a calibration tint, so the tint is the colour shown', () => {
    const lens = resolveLens({ tint: '#7dbcab', density: 0.4 })
    for (const physical of [true, false]) {
      const material = buildLens(authoredLens(), physical, lens) as MeshStandardMaterial
      expect(material.map).toBeNull()
      expect(material.color.getHexString(SRGBColorSpace)).toBe('7dbcab')
      expect(material.color.r).toBeCloseTo(new Color().setRGB(...lens.tint!, SRGBColorSpace).r, 9)
      expect(material.opacity).toBeCloseTo(0.4, 9)
    }
  })

  it('keeps the authored texture when only the darkness is overridden', () => {
    const authored = authoredLens()
    const material = buildLens(authored, true, resolveLens({ category: 3 })) as MeshPhysicalMaterial
    expect(material.map).toBe(authored.map)
  })
})
