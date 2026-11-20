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

## Lens measurements (product photos)

Measured 2026-11-20 from the front product photo of each variation (CMS
`thumbnail`, 1152 px, white background). The lens over white shows its
transmitted colour, so the photo gives the lens's transmittance directly:
15 bands down the left lens, linear light, median over columns 22–32 % of
the width (drops the temple arm seen through the lens).

Every lens is a gradient (CMS `colors.isGradient`). Columns: photo colour
at the top → bottom of the lens; luminous transmittance τv there (ISO
12312-1 category); and the best `lens` calibration for **the current
renderer**, fitted by minimising CIEDE2000 between the renderer's blend over
white (`density·tint + (1 − density)`, smoothstep gradient) and the photo.

| Model | Photo top → bottom | τv top → bottom | `tint` | `gradient` top / bottom | ΔE rms / max |
| --- | --- | --- | --- | --- | --- |
| iris-bronze | `#4e2e21` → `#ebe3df` | 0.04 (cat. 4) → 0.78 (cat. 1) | `#572000` | 1.00 / 0.56 | 9.0 / 12.0 |
| iris-jade | `#a7cfc4` → `#f1f3f2` | 0.57 (cat. 1) → 0.89 (cat. 0) | `#81bfae` | 0.83 / 0.15 | 1.3 / 2.0 |
| iris-moss | `#383f20` → `#e3e9df` | 0.05 (cat. 4) → 0.80 (cat. 1) | `#2a4800` | 1.00 / 0.54 | 9.9 / 11.4 |
| kairos-amber | `#56362a` → `#ebe3df` | 0.05 (cat. 4) → 0.78 (cat. 1) | `#5c2606` | 1.00 / 0.54 | 7.7 / 10.9 |
| kairos-crystal | `#82b4cc` → `#edf1f2` | 0.42 (cat. 2) → 0.88 (cat. 0) | `#5aa4c3` | 0.90 / 0.20 | 1.5 / 2.3 |
| nous-navy | `#354161` → `#e1e5eb` | 0.05 (cat. 4) → 0.78 (cat. 1) | `#00356d` | 1.00 / 0.49 | 6.9 / 9.1 |
| nous-obsidian | `#433d4a` → `#e0e0e3` | 0.05 (cat. 4) → 0.75 (cat. 1) | `#160131` | 0.98 / 0.50 | 6.6 / 9.1 |
| pteron-azure | `#81b0c7` → `#eaedee` | 0.40 (cat. 2) → 0.84 (cat. 0) | `#67a4bf` | 0.95 / 0.24 | 1.6 / 2.0 |
| pteron-charcoal | `#433e49` → `#e5e5e7` | 0.05 (cat. 4) → 0.78 (cat. 1) | `#2a223c` | 0.99 / 0.50 | 6.8 / 9.9 |
| pteron-hunter | `#3a4121` → `#e4e9e2` | 0.05 (cat. 4) → 0.80 (cat. 0) | `#284500` | 1.00 / 0.51 | 9.2 / 10.8 |

**The light lenses fit** (jade, crystal, azure: ΔE ≤ 2.3). **The dark
gradients do not** (ΔE 7–10). Two limits of the renderer's lens model, both
measured on the same photos:

1. *Gradient shape.* A real gradient lens fades in optical density (log
   τv: dye concentration), so it stays dark further down. The renderer
   fades opacity with a smoothstep. Interpolating log τ with the same
   smoothstep instead roughly halves the error (bronze 9.0 → 4.4, charcoal
   6.9 → 2.1).
2. *Colour along the gradient.* A tinted lens is a per-channel filter: each
   channel's transmittance falls on its own, so the hue changes as the lens
   darkens. A per-channel filter (`T_c(t) = T_c,top ^ k(t)`) fits every dark
   lens at ΔE 1.2–3.0. Alpha blending one tint over the video can't do
   this; it needs the lens composited as a multiply against the camera
   image (as `tintedLensShadow` already does for its shadow).

Caveats: the lens is lit in the scene (environment, Fresnel, key light), so
the rendered colour is not exactly the blend above. Confirm the values in
`colour.spec.ts` before tuning further. The product photos may themselves be
renders; they are what the shopper compares against.

## Still needed

- A decision on the renderer: log-density gradient (small, pure-math
  change in `tryon-lens.ts` + the gradient shader) and/or a multiply lens
  (larger: camera texture, tier-gated) for the dark gradients.
- Sample boxes for `colour-swatches.json` on the `?view=scene` render, so
  the photo colours above become the colour gate.
