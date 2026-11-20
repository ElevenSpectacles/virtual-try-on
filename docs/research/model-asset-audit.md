# Catalog GLB asset audit — realism and true colour

Measured 2026-11-19 on the 10 catalog GLBs in
`nuxt/public/models/virtual-try-on` with `@gltf-transform` + `sharp`
(material factors, texture hashes, channel stats, metalness histogram).
Complements `realism-shadows-fit-temples-color.md`, which covers the render
side; most of that is already built. The biggest remaining gaps are in the
assets and calibration data, not the renderer.

## Findings

1. **Four colourways render as chrome.** Every frame is titanium, and the
   product name is the coating colour. The frame base-colour textures of
   `iris-jade`, `kairos-crystal`, `pteron-azure` and `pteron-charcoal` are
   pure white on the UV islands (mean 217/217/217 incl. grey padding), and
   their roughness on the islands is 0.01 (mirror polish; `nous-navy` is
   0.30). On a metal, white base colour + zero roughness is polished chrome:
   all four render as the same mirror frame instead of jade, crystal, azure
   or charcoal coated titanium. `iris-bronze`, `kairos-amber`,
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

1. **Fix the four chrome colourways at source**: re-export with the
   coating colour in the base colour and the real finish's roughness
   (satin coated titanium is roughly 0.2–0.4). As a stopgap, a per-model
   `frame` calibration block (`tint`, `roughness`) applied like the lens
   overrides; a tint multiplies the whole texture, including the printed
   temple text.
2. **Fill `lens` calibration per SKU** from product sheets: `category` or
   `transmittance`, `tint`, `gradient`. Then the shared lens textures stop
   deciding the colour.
3. **Turn on the colour gate**: sample frame/lens hex from neutral-light
   product photos into `colour-swatches.json`, run `colour.spec.ts`, fix to
   ΔE2000 ≤ 3.
4. **KTX2 textures** (`gltf-transform uastc`/`etc1s`, `KTX2Loader` in the
   model cache) and run `prepare-model` on every GLB.

## Still needed

The coating colours themselves. The storefront only has approximate swatch
classes (`TRYON_COLOR_SWATCH` in `nuxt/app/composables/useTryOnCatalog.ts`:
jade `bg-emerald-600`, azure `bg-sky-600`, charcoal `bg-neutral-700`,
crystal `bg-slate-300`); sample the real hex from neutral-light product
photos or take it from the 3D source files.
