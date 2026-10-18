/**
 * Catalog model lint (issue #103): what the runtime needs from a GLB, and
 * what silently produces a bad try-on. Pure over a gltf-transform Document.
 *
 * Errors fail `scripts/lint-models.ts`; warnings are listed.
 */
import { getBounds, type Document } from '@gltf-transform/core'
import { TEMPLE_NODE_NAME, preparedSteps } from './model-prep'

export interface LintFinding {
  rule: string
  severity: 'error' | 'warning'
  message: string
}

/** Lens materials are found by name (TryOnScene's LENS_MATERIAL_NAME). */
export const LENS_MATERIAL_NAME = /glass|lens/i

/**
 * Lens base colours shared across the catalog as placeholders (issue #85):
 * a lens that still has one renders the wrong colour.
 */
export const PLACEHOLDER_LENS_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.78, 0.82]
]

/** Plausible frame size, metres (GLBs are authored in metres). */
export const FRAME_WIDTH_RANGE = { min: 0.1, max: 0.17 } as const
export const FRAME_HEIGHT_RANGE = { min: 0.02, max: 0.075 } as const

/** File size budget, bytes: warn above, fail far above. */
export const FILE_SIZE_BUDGET = { warn: 1.5e6, error: 5e6 } as const

/** Texture side above which KTX2 (or a smaller texture) is worth it. */
export const MAX_TEXTURE_SIDE = 1024

const close = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) < 0.005)

export function lintModel(document: Document, { fileSize = 0 }: { fileSize?: number } = {}): LintFinding[] {
  const findings: LintFinding[] = []
  const add = (rule: string, severity: LintFinding['severity'], message: string) =>
    findings.push({ rule, severity, message })
  const root = document.getRoot()

  const temple = root.listNodes().find((n) => n.getName() === TEMPLE_NODE_NAME)
  if (!temple?.getMesh()) {
    add('temple-node', 'warning', `no "${TEMPLE_NODE_NAME}" mesh: the temple arms won't open at the hinge`)
  }

  const lensMaterials = root.listMaterials().filter((m) => LENS_MATERIAL_NAME.test(m.getName()))
  if (lensMaterials.length === 0) {
    add('lens-material', 'error', 'no lens material (name containing "glass" or "lens"): lenses render as opaque frame')
  }
  for (const material of lensMaterials) {
    const [r, g, b, a] = material.getBaseColorFactor()
    if (PLACEHOLDER_LENS_COLOURS.some((p) => close([r, g, b], p))) {
      add(
        'lens-colour',
        'warning',
        `lens "${material.getName()}" has the placeholder base colour; set lens.tint and lens.category in calibration.json`
      )
    }
    if (material.getAlphaMode() === 'OPAQUE' && a >= 1) {
      add('lens-alpha', 'warning', `lens "${material.getName()}" is opaque in the GLB; set lens.category or density`)
    }
  }

  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (!scene) {
    add('scene', 'error', 'no scene')
  } else {
    const { min, max } = getBounds(scene)
    const width = max[0] - min[0]
    const height = max[1] - min[1]
    if (!(width >= FRAME_WIDTH_RANGE.min && width <= FRAME_WIDTH_RANGE.max)) {
      add('bounds', 'error', `frame width ${(width * 1000).toFixed(1)} mm is not a frame (wrong units or extra geometry?)`)
    }
    if (!(height >= FRAME_HEIGHT_RANGE.min && height <= FRAME_HEIGHT_RANGE.max)) {
      add('bounds', 'error', `frame height ${(height * 1000).toFixed(1)} mm is not a frame`)
    }
  }

  if (fileSize > FILE_SIZE_BUDGET.error) {
    add('size', 'error', `${(fileSize / 1e6).toFixed(1)} MB, over the ${FILE_SIZE_BUDGET.error / 1e6} MB limit`)
  } else if (fileSize > FILE_SIZE_BUDGET.warn) {
    add('size', 'warning', `${(fileSize / 1e6).toFixed(1)} MB, over the ${FILE_SIZE_BUDGET.warn / 1e6} MB budget`)
  }

  let textureBytes = 0
  for (const texture of root.listTextures()) {
    const size = texture.getSize()
    textureBytes += texture.getImage()?.byteLength ?? 0
    if (size && Math.max(size[0], size[1]) > MAX_TEXTURE_SIDE) {
      add('texture-size', 'warning', `texture "${texture.getName() || texture.getURI()}" is ${size[0]}×${size[1]}; consider ${MAX_TEXTURE_SIDE} px or KTX2`)
    }
  }
  if (fileSize > 0 && textureBytes / fileSize > 0.6) {
    add('texture-share', 'warning', `textures are ${Math.round((textureBytes / fileSize) * 100)} % of the file; KTX2 would shrink it`)
  }

  if (!preparedSteps(document).includes('compressed')) {
    add('compressed', 'warning', 'not Draco-compressed by prepare-model')
  }
  return findings
}
