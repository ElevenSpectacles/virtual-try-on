# Catalog GLB asset audit — realism and true colour

Measured 2026-11-19 on the 10 catalog GLBs in
`nuxt/public/models/virtual-try-on` with `@gltf-transform` + `sharp`
(material factors, texture hashes, channel stats, metalness histogram).
Complements `realism-shadows-fit-temples-color.md`, which covers the render
side; most of that is already built. The biggest remaining gaps are in the
assets and calibration data, not the renderer.

## Findings

1. **Four colourways have no colour.** The frame base-colour textures of
   `iris-jade`, `kairos-crystal`, `pteron-azure` and `pteron-charcoal` are
   pure white on the UV islands (mean 217/217/217 incl. grey padding). With
   `baseColorFactor` 1,1,1 they all render as the same silver/white frame,
   whatever the product colour. `iris-bronze`, `kairos-amber`,
   `pteron-hunter`, `nous-navy`, `nous-obsidian` carry real colour.
2. **Lens textures are shared across colourways.** One brown lens image
   (`c4f47a87`) serves bronze, moss, amber and hunter; one blue-grey
   (`fc226c61`) serves crystal and azure. The lens tint is a texture, not
   product data.
3. **No lens calibration.** `lens` is unset for every model in
   `calibration.json`, so tint, category (ISO 12312-1), transmittance and
   gradient all fall back to the GLB. `tests/fixtures/colour-swatches.json`
   has no models, so the ΔE2000 colour gate (`tests/e2e/colour.spec.ts`)
   skips.
4. **No material extensions.** No `KHR_materials_clearcoat`, `_ior`,
   `_specular`, `_transmission` or `_volume`. Polished acetate reads as
   plastic without a clearcoat; a "crystal" (clear acetate) frame cannot
   look clear without transmission.
5. **Materials are otherwise sane.** Packed ORM texture (AO = R, rough = G,
   metal = B), metalness mostly binary (52 % at 0, 41 % at 1, ~7 % between,
   mostly edge filtering) — consistent with titanium parts + non-metal parts.
   The lens material's `metalness 0.7` is overridden at runtime
   (`useLensMaterials` rebuilds lenses as dielectric).
6. **Size.** Four 2048² textures per frame, textures ~71 % of the file;
   none of the files were compressed by `prepare-model` (lint warning).
   KTX2/Basis would cut download and GPU memory with no visible loss at
   try-on scale.

## Recommendations, by impact

1. **Fix the four white colourways at source** (re-export with the real
   finish), or, as a stopgap, add a per-model `frame` calibration block
   (`tint`, `roughness`, `metalness`, `clearcoat`) applied like the lens
   overrides. Source fix preferred: a tint multiplies the whole texture,
   including logo/print areas.
2. **Fill `lens` calibration per SKU** from product sheets: `category` or
   `transmittance`, `tint`, `gradient`. Then the shared lens textures stop
   deciding the colour.
3. **Turn on the colour gate**: sample frame/lens hex from neutral-light
   product photos into `colour-swatches.json`, run `colour.spec.ts`, fix to
   ΔE2000 ≤ 3.
4. **Add clearcoat to acetate parts** (gltf-transform `KHR_materials_clearcoat`
   in `prepare-model`, or a calibration flag) and transmission + IOR 1.49
   for clear acetate (`kairos-crystal`); tier-gate transmission (extra
   render pass).
5. **KTX2 textures** (`gltf-transform uastc`/`etc1s`, `KTX2Loader` in the
   model cache) and run `prepare-model` on every GLB.

## Open question

Product reference for jade / crystal / azure / charcoal: are these coated
titanium (metal base colour = coating colour) or acetate fronts? This
decides metalness and whether clearcoat or transmission applies.
