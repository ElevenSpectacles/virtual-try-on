# 0013. Rebuild lenses as dielectrics in physical units

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Authored lens materials are metallic placeholders that read incorrectly over video.

## Decision

Named lens materials are rebuilt with calibrated tint and transmittance, density-space gradients and, on capable devices, Fresnel and coating reflections.

## Consequences

Material names are part of the asset contract. Lens changes require golden and colour review.

## Detailed records

### `src/runtime/composables/tryon/scene/useFrameMaterials.ts`

#### `useFrameMaterials`

The one owner of the materials shown on a loaded GLB (#150). Each mesh's
material is derived from its authored one (`userData.tryOnAuthoredMaterial`)
and the current feature set in `deriveMaterial`: the lens rebuild
(`buildLens`), then the camera-match and ear-bend patches, chained in one
`onBeforeCompile` with one cache key (`withPatches`). The authored
materials, shared through the model cache, are never mutated. A feature
change re-derives every mesh, an ear bend only the arms, and a model change
or unmount puts the authored materials back and disposes the derived ones,
so the result never depends on which feature was turned on first.

#### `bakeLensHeight`

A lens mesh's own height, 0 at its bottom … 1 at its top in the GLB's
frame (up is +y there), as a vertex attribute for the gradient tint. Baked
once per geometry: the node transforms are fixed.

#### `applyLensGradient`

Gradient tint (`lens.gradient`): the lens's base opacity follows its
height, dark to light top to bottom, fading in optical density like a dyed
lens (`gradientDensityAt`). Composes with the Fresnel patch, which reads the
opacity after this.

#### `LENS_MATERIAL_NAME`

The catalog's lens materials are authored as metalness ≈ 0.7 with
alpha-blend transparency — physically wrong for a dielectric: metalness
tints and darkens instead of transmitting, and the metallic Fresnel kills
the see-through read against the face. Lenses are rebuilt as a true
dielectric (metalness 0) that does not write depth, so frame geometry
behind the lens is not clipped by the lens surface. Name-scoped — every
catalog GLB names its lens material "glass".

Further touches sell "real sunglass glass" in the composite:
- roughness ≈ 0: lenses are polished; any roughness blurs the reflections
  into a plastic-looking haze.
- envMapIntensity above 1: a real lens is a curved mirror — it catches
  bright, sharp speculars from the room. Boosting the IBL contribution on
  lenses only (frame acetate keeps its authored response) gives that glint
  that reads as glass over a video feed.
- physicalLens (mid tier and up, see utils/tryon-lens.ts): opacity rises
  with the Fresnel term toward grazing angles, so the lens rim reads as
  glass instead of a flat tinted cut-out; reflections are added on top of
  what the lens transmits instead of being scaled down by its opacity (a
light lens still mirrors the room); a clearcoat and a thin-film
iridescence give the faint green/violet sheen of an AR coating.

#### `applyLensFresnel`

Opacity follows the normalized Schlick term, `lensOpacityAt` in
utils/tryon-lens.ts. Output is premultiplied by hand: only the body
colour is scaled by coverage, reflections add on top.

#### `buildLens`

The lens material for an authored one. A calibration `tint` replaces the
authored colour, texture included: three multiplies `color` by `map`, and
the catalog's lens textures carry the old colour (often one image shared
across colourways), so keeping the map would darken and shift every tint.
Exported for the unit test.

#### `if (lens.tint) material.color.setRGB(...lens.tint, SRGBColorSpace)`

`#rrggbb` is sRGB; three's working space is linear.

#### `if (lens.gradient) applyLensGradient(material, lens.gradient)`

After the Fresnel patch, so it wraps it: the gradient sets the base
opacity the Fresnel term then raises toward grazing angles.

#### `builtLenses`

Lens materials we built, so a rebuild (model, tier or override change)
can free the previous ones. The GLB's authored materials are kept on each
mesh so every rebuild starts from them.

### `src/runtime/utils/tryon-lens.ts`

#### File overview

Lens look (issue #10): per-model tint resolution and the Fresnel term the
physical lens material uses. Pure math, no three.js.

The catalog's lenses are plano sunglass lenses: they bend the background by
a fraction of a pixel, so screen-space refraction would cost a video
texture pass for nothing visible. What sells glass over a video feed is how
the lens reflects: stronger and more opaque toward grazing angles
(Fresnel), a faint thin-film sheen from the anti-reflective coating, and
sharp highlights from a polished surface. That is what the material does.

#### `TryOnLensCategory`

ISO 12312-1 filter category of a sunglass lens, from its luminous
transmittance τv: 0 (80–100 %), 1 (43–80 %), 2 (18–43 %), 3 (8–18 %),
4 (3–8 %). Printed on every sunglass product sheet.

#### `LENS_CATEGORY_TRANSMITTANCE`

Mid-range transmittance of each category (the arithmetic middle of its
band), used when only the category is known.

#### `densityFromTransmittance`

Lens density (0 clear … 1 opaque, what the renderer uses as opacity at
normal incidence) from a luminous transmittance τv: density = 1 − τv.

#### `density`

How dark the lens is, 0 (clear) … 1 (opaque), at normal incidence;
replaces the authored opacity. Prefer the physical `transmittance` or
`category` from the product sheet; `density` wins when several are set.

#### `transmittance`

Luminous transmittance τv, 0 … 1, from the product sheet (density = 1 − τv).

#### `gradient`

Gradient lens: density at the top and bottom of the lens (0 … 1), dark
to light top to bottom for the usual gradient. Replaces the single
density. Use `densityFromCategory` for categories.

#### `TryOnLens`

A resolved lens override: null fields keep the GLB's authored value.

#### `resolveLens`

Validate a calibration lens entry. Malformed fields fall back to the
authored value. Density comes from `density`, else `transmittance`, else
`category`.

#### `LENS_MIN_TRANSMITTANCE`

Lowest transmittance a gradient end can have (density 1 → τv 0.1 %), so
its logarithm stays finite. Darker than any ISO 12312-1 category (cat. 4
starts at 3 %), so it never changes how a real lens looks.

#### `gradientDensityAt`

Density across a gradient lens at height `t` (0 bottom … 1 top). A gradient
lens is dyed with a concentration that falls from top to bottom, so its
optical density (−log τ) follows that fall, not its opacity: it stays dark
further down than a linear fade, as on the real lenses (measured on the
catalog's product photos, docs/research/model-asset-audit.md). The fall is
a smoothstep, for the soft ends of a dyed gradient. Its GLSL twin is
`tryOnGradientAlpha` in `LENS_GLSL`; `tests/glsl/shader-parity.spec.ts` checks they agree.

#### `LENS_F0`

Reflectance of uncoated crown glass / polycarbonate at normal incidence (IOR ≈ 1.5).

#### `lensOpacityAt`

Lens opacity at an angle: the authored opacity at normal incidence, rising
toward 1 at grazing angles as more light is reflected than transmitted.
Takes |cos θ|: the lens is double-sided, and its back faces show the same
rim. Its GLSL twin is `tryOnLensOpacity` in `LENS_GLSL`; `tests/glsl/shader-parity.spec.ts` checks they agree.

#### `reflected`

Fresnel above its head-on value, normalized to 0…1.
