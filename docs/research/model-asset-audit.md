# Catalog GLB asset audit — realism and true colour

Measured 2026-11-19 on the 10 catalog GLBs in
`nuxt/public/models/virtual-try-on` with `@gltf-transform` + `sharp`
(material factors, texture hashes, channel stats, metalness histogram).
Complements `realism-shadows-fit-temples-color.md`, which covers the render
side; most of that is already built. The biggest remaining gaps are in the
assets and calibration data, not the renderer.

## Findings

1. **Frame colours match the catalog.** Every frame is titanium. The CMS
   (`product-variations.colors`) lists the frame, lens and decoration
   colour per variation, and the colour in the product name is the
   **lens** colour, not the frame's: jade, crystal, azure and charcoal are
   silver frames, so their white base colour is correct. Metal-part base
   colour and roughness per model:

   | Model | CMS frame / lens | Metal base | Roughness (median) |
   | --- | --- | --- | --- |
   | iris-bronze | Gold / Brown | `#f3d1ab` | 0.00 |
   | iris-moss | Gold / Green | `#f3d1ab` | 0.00 |
   | iris-jade | Silver / Green | `#ffffff` | 0.00 |
   | kairos-crystal | Silver / Blue | `#ffffff` | 0.00 |
   | pteron-azure | Silver / Blue | `#ffffff` | 0.00 |
   | pteron-charcoal | Silver / Grey | `#ffffff` | 0.00 |
   | kairos-amber | Brown / Brown | `#675139` | 0.40 |
   | pteron-hunter | Brown / Green | `#7b674e` | 0.40 |
   | nous-navy | Blue / Blue | `#243046` | 0.40 |
   | nous-obsidian | Black / Grey | `#525252` | 0.40 |

   Gold and silver are polished, the coated colours satin, as the real
   frames are (confirmed 2026-11-20). Frame colour and finish need no work.
2. **Lens textures are shared across colourways.** One brown lens image
   (`c4f47a87`) serves bronze, moss, amber and hunter; one blue-grey
   (`fc226c61`) serves crystal and azure. The lens tint is a texture, not
   product data.
3. **No lens calibration.** `lens` is unset for every model in
   `calibration.json`, so tint, category (ISO 12312-1), transmittance and
   gradient all fall back to the GLB. `tests/fixtures/colour-swatches.json`
   has no models, so the ΔE2000 colour gate (`tests/e2e/colour.spec.ts`)
   skips.
4. **No material extensions.** No `KHR_materials_*`. None are needed for
   coated titanium: the coating colour is the metal's base colour.
5. **Metalness is right.** Packed ORM texture (AO = R, rough = G,
   metal = B). On the frame's UV islands ~90 % is metalness 1 and ~0 % is
   0, as titanium should be (the 52 % at 0 over the whole texture is the
   grey padding). The lens material's `metalness 0.7` is overridden at
   runtime (`useLensMaterials` rebuilds lenses as dielectric).
6. **Size.** Four 2048² textures per frame, textures ~71 % of the file;
   none of the files were compressed by `prepare-model` (lint warning).
   KTX2/Basis would cut download and GPU memory with no visible loss at
   try-on scale.

## Recommendations, by impact

1. **Fill `lens` calibration per SKU** from product sheets: `category` or
   `transmittance`, `tint`, `gradient`. Then the shared lens textures stop
   deciding the colour.
2. **Turn on the colour gate**: sample frame/lens hex from neutral-light
   product photos into `colour-swatches.json`, run `colour.spec.ts`, fix to
   ΔE2000 ≤ 3.
3. **KTX2 textures** (`gltf-transform uastc`/`etc1s`, `KTX2Loader` in the
   model cache) and run `prepare-model` on every GLB.

## Still needed

- Lens data: every variation is a gradient lens (`colors.isGradient`), and
  the CMS gives only the lens colour name. Tint hex, category or τv and
  the gradient top/bottom come from the product sheet.
