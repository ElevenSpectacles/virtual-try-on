# Research: try-on realism — shadows, fit, temple bending, colour

Research only, no code changes. 2026-10-16. Question: what would make the
try-on look closest to a real pair on a real face? Four complaints: shadows
look wrong, alignment could be better, temples cannot bend to the head, and
frame/lens colours do not look real.

Sources are papers, patents, standards and engine docs (listed per section).
Each section starts from what the code does today, so proposals are deltas.

## Ranked summary

| # | Change | Fixes | Effort |
| - | ------ | ----- | ------ |
| 1 | Multiply-blended shadow + analytic contact occlusion (capsules) | "shadows not good" | 0.5 day + 1–2 days |
| 2 | Split temples, rotate at the hinge per face (replace `templeWidthBoost` stretch) | temples float / clip, lenses stretched | 1–2 days |
| 3 | Reflections from the camera feed + dominant light direction | lens looks flat, shadow direction fixed | 2–3 days |
| 4 | Lens tint in physical units (ISO categories), gradient lenses, colour QA golden | "colours not realistic" | 1–2 days |
| 5 | Camera matching: grain, slight blur, light wrap | frame looks pasted on | 1 day |

Alignment (pantoscopic tilt, nose seat) comes before all of these only if
`fit-check` shows a measurable offset; see section 2.

---

## 1. Shadows

### Today
- `utils/tryon-contact-shadow.ts` + `TryOnScene.vue`: one shadow-only
  directional light at a **fixed** direction (`SHADOW_LIGHT_DIRECTION`,
  front/above/right), VSM 512² map, radius 8.
- Receiver is the tracked face mesh with a `ShadowMaterial`: the shadow is
  **alpha-blended** over the video as warm brown (`SHADOW_COLOR`) at 0.22.
- Lenses cast through an opacity copy (`LENS_SHADOW_DENSITY = 0.6`), grey.
- No contact darkening where nose pads and temples touch the skin.

### Why it looks off
1. Alpha blending adds a brown layer on top of the skin; real shadow
   **multiplies** the skin's light, so dark skin barely changes and bright
   skin darkens most. The brown layer reads as a stain.
2. One sharp-ish directional shadow, always from the same side, disagrees
   with the room's light whenever the user's key light is elsewhere.
3. Under ordinary indoor (mostly diffuse) light the dominant cue is
   **ambient occlusion**: a soft darkening right under pads, along the
   temples on the skin of the temple/cheekbone, under the bridge. A shadow map
   from one direction does not produce it.
4. A tinted lens throws a tinted shadow; ours is grey.

### Findings
- Zhang, Guo, Laffont, Martin, Gross, *A Virtual Try-on System for
  Prescription Eyeglasses* (IEEE CG&A 2017): shading of each face point is
  integrated twice, once with only the face and once with the frame added;
  the **ratio** `S_glasses / S_noGlasses` is multiplied onto the input image.
  This keeps the skin detail of the video and only removes light. Lighting is
  an environment map (captured, or a pre-captured default).
  [PDF](https://qianzhanginfo.github.io/assets/pubs/virtualtryon.pdf)
- Ditto Technologies, US10403036B2 *Rendering glasses shadows*: same idea in
  2D. Render the posed face with and without glasses, take the difference,
  blur it, adjust contrast and **HSV for lens colour**, then multiply it
  channel-by-channel with the camera image.
  [Google Patents](https://patents.google.com/patent/US10403036B2/en)
- Capsule shadows (Unreal; The Last of Us Part II per community write-ups):
  approximate the caster with a few capsules and compute soft occlusion
  analytically, no shadow map. Built for "soft area shadowing in indirectly
  lit areas" — exactly the indoor case.
  [Unreal docs](https://dev.epicgames.com/documentation/unreal-engine/capsule-shadows-overview-in-unreal-engine)

### Proposals
1. **Multiply, don't overlay** (~half a day). Render the receiver with
   multiplicative output, `video × (1 − k·occlusion·(1 − shadowTint))`,
   e.g. `MultiplyBlending` or a premultiplied custom `ShadowMaterial`
   chunk. Keep the warm tint as the colour the shadow multiplies toward, not
   as paint. Update the `shadow` rendering golden.
2. **Analytic contact occlusion** (1–2 days). Per model, fit ~10–20
   capsules (rims, bridge, pads, each temple) from the GLB at load (or in
   `generate-calibration`). In the face-mesh receiver's fragment shader sum
   capsule occlusion (cone/solid-angle approximation, clamp). Pure capsule
   math goes in a `utils/` file with unit tests. This gives the dark line
   under pads and along the temples that sells "resting on skin".
3. **Tint the lens shadow** (~1 hour). Multiply the lens part of the shadow
   by the lens tint (Ditto's HSV step); a brown lens throws a warm shadow.
4. **Light direction from the frame sample** (see section 3): aim the
   shadow light where the room light comes from instead of a constant.

---

## 2. Alignment / fit

### Today
- Anchor = centroid of nose ridge + inner eye corners (`TRYON_ANCHOR_INDICES`
  168, 6, 197, 5, 133, 362), frame front 12 mm in front of it
  (`FRAME_BRIDGE_STANDOFF_METERS`). Scale from ear width over IPD. Rotation
  from the MediaPipe matrix, plus per-model `rotation` in calibration.
- Memory note: on fixtures the frame size is already within ~2 %; fixture
  photos are long-lens and not usable for scale tuning — a webcam clip is.

### Findings — how a real frame sits
- Optician defaults: **pantoscopic tilt** 7–12° (ZEISS uses 9° when none is
  given, Varilux 8°); **vertex distance** 12–14 mm; **wrap** ~5° for
  ordinary frames, 12–18° for sunwear.
  [ZEISS fitting guide](https://www.zeiss.com/content/dam/Vision/Vision/en_us/PDF/ECP/ZI2_FitDisp_Guide_051012FNLAppd.pdf),
  [20/20 Mag: vertex, tilt and wrap](https://2020mag.com/ce/the-real-details-of-vertex-5E16F)
- ZEISS patent US11221504B2 (virtual frame fitting): place on a nose-bridge
  resting point, **bend the temples open to the ears**, rotate about the
  ear axis, make each temple's resting point coincide with the ear base, then
  fine-position to maximise nose-pad contact. Rigid "aesthetic" parameters
  (scale, tilt) are fitted first, anatomical ones (bridge, temple length)
  second.
  [Google Patents](https://patents.google.com/patent/US11221504B2/en)

### Proposals
1. Run `fit-check` on a webcam clip before tuning anything (memory:
   fixture photos mislead on scale).
2. Check every catalog `rotation.x` gives an effective 8–9° pantoscopic
   tilt relative to the face plane; a frame with 0° looks "stuck on".
3. **Per-face nose seat**: the frame front is placed from a fixed standoff.
   Instead, store each model's pad contact points (from the GLB, in
   calibration) and slide the frame along the nose ridge (landmarks 6→197)
   until the pads meet the ridge width. Deep-set vs flat nose bridges then
   sit differently, like a real pair. ~1–2 days.
4. **Two-point pose constraint** (later): fit the frame to three points —
   nose seat + both ear points — rather than the anchor + rotation matrix,
   which also removes residual roll/yaw jitter. Builds on section 3's temple
   pivots.

---

## 3. Temple bending

### Today
- Catalog GLBs have **both temples in one mesh** (`pt2`; for
  `iris-bronze.glb` it spans y −0.070…0.070 m and 0.018…0.105 m in depth),
  no hinge pivot, no skin. Hinge parts are separate small meshes
  (`pt1`, `placeholder`).
- `templeWidthBoost` becomes `scaleXBoost`, which scales the **whole frame**
  on X (`TryOnScene.vue:554`): lenses and bridge widen with the temples, and
  the value is per model, not per face.

### What a real pair does
The front is rigid; temples flex outward at the hinge for a wide head and
the optician bends the tips down behind the ear. So the fix is a rotation at
the hinge (per face) plus an optional bend near the ear — never a stretch.

No vendor (Fittingbox, Warby Parker, Perfect Corp, Banuba) documents its
temple method publicly; the ZEISS patent above is the clearest description
("earpieces bent open to the ears").

### Proposals
1. **Split + pivot** (1 day). New script `scripts/split-temples.ts`
   (gltf-transform, like `compress-models`): split `pt2` by connected
   component / sign of the width axis into `temple_l`, `temple_r`, each
   parented to a pivot node at its hinge (the `pt1`/`placeholder` position).
   Keep the runtime tolerant of old GLBs (no pivots → current behaviour).
2. **Per-face opening angle** (0.5–1 day). Each frame:
   `angle = atan((earHalfWidth − hingeHalfWidth) / hingeToEarDistance)`,
   clamped to about ±8°, smoothed with the existing One-Euro filter.
   `earHalfWidth` comes from the face-oval points at temple height the
   placement code already uses for ear width (234/454 area). MediaPipe's
   mesh has no ear landmarks, so the ear point is that oval point plus a
   fixed backward offset; the occluder and hair occluder already hide the
   rest. Pure math in `utils/`, unit-tested. Then `templeWidthBoost` can be
   retired.
3. **Ear bend** (+1 day, optional). In the temple material's vertex shader
   (`onBeforeCompile`), rotate vertices past the ear point down and inward
   by an angle growing with distance — the optician's bend. Or add a
   two-bone skin per temple in the script. Only worth it if side views show
   tips sticking out; `trim-temple-tips.ts` already shortened them.

---

## 4. Colour and materials

### Today
- `NeutralToneMapping` (Khronos PBR Neutral) — the right choice: it was
  designed so PBR base colours show faithfully, for e-commerce. Its own
  author notes hue is exact only under **greyscale** lighting.
  [Khronos](https://www.khronos.org/news/permalink/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products)
- IBL = static HDR presets "eyeballed against the video's white balance",
  plus a global gain/tint from the 16×16 frame sample.
- Lens: dielectric with Fresnel opacity, clearcoat, iridescence; calibration
  can override tint (`#rrggbb`) and density (0…1, unitless).
- GLB lens base colours are shared and arbitrary (e.g. `[1, 0.78, 0.82,
  0.62]` on both `iris-bronze` and `kairos-amber`).

### Findings
- **Sunglass categories** (ISO 12312-1, luminous transmittance τv): cat 0
  80–100 %, cat 1 43–80 %, cat 2 18–43 %, cat 3 8–18 %, cat 4 3–8 %.
  [College of Optometrists](https://www.college-optometrists.org/clinical-guidance/guidance/knowledge,-skills-and-performance/examining-patients-who-drive/tints-and-driving),
  [BioMed Eng. Online table](https://biomedical-engineering-online.biomedcentral.com/articles/10.1186/s12938-021-00881-9/tables/1)
- So a cat 3 lens (τv 8–18 %) is density ≈ 0.85, cat 2 ≈ 0.7; a lens
  that shows the eyes clearly is cat 1–2. Real lens colour is a transmission
  spectrum, which `KHR_materials_volume` models as attenuation colour ×
  distance — tint deepens where the lens is thicker.
  [Khronos KHR_materials_volume](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md),
  [Don McCurdy on volume](https://www.donmccurdy.com/2021/11/11/writing-volumetric-refraction-gltf/)
- Warby Parker's try-on (ARKit) markets "how light filters through acetate"
  as the realism cue — acetate is translucent, not opaque plastic.
  [Retail Dive](https://www.retaildive.com/news/warby-parker-launches-ar-tool-for-virtual-try-on/547673)

### Proposals
1. **Density in physical units** (~2 hours). Calibration gets
   `lens.category` (0–4) or `lens.transmittance`; density = 1 − τv.
   Set it per model from the product sheet instead of guessing.
2. **Gradient lenses** (~half a day). Many sunglass lenses fade dark→light
   top to bottom. Add `lens.gradient` (top/bottom density) applied in the
   existing lens shader chunk along the lens's vertical axis.
3. **Colour QA golden** (~1 day). Render each model on `?view=scene` under a
   neutral grey environment (where PBR Neutral is exact), sample frame and
   lens swatches, and compare with a swatch from the product photo
   (ΔE2000 < ~3 as target). Fix base-colour textures / calibration tints
   where they fail. This turns "colours look wrong" into numbers.
4. **Acetate translucency** (1–2 days, mid/high tier only). Full
   `transmission` costs an extra scene pass; a cheaper fake: a thickness-
   weighted back-light term (light through thin edges glows the acetate
   colour). Test on `kairos-crystal` first — clear acetate shows it most.
5. **Mirror coatings** (later): metalness-free, high-`specularIntensity`
   or iridescence-thickness preset per model, if the catalog has mirrored
   lenses.

---

## 5. Lighting and reflections from the real room

### Findings
- In Zhang et al.'s user study, **reflections mattered most**: videos with
  lens reflections were preferred 86.7–89.2 % of the time (p < 0.005); for
  plano lenses refraction does not apply.
- Snap Lens Studio's PBR material has **Camera Reflections**: the live
  camera feed is the environment map, blurred by roughness; its front-camera
  ML mode builds a full env map from the face.
  [Snap docs](https://developers.snap.com/lens-studio/features/graphics/ml-environment-matching)
- Knorr & Kurz, *Real-Time Illumination Estimation from Faces for Coherent
  Rendering* (ISMAR 2014): lighting recovered as spherical harmonics from the
  face itself in real time.
  [ISMAR 2014](https://ismar2014.ismar.net/ismar/2014/paper/real-time-illumination-estimation-faces-coherent-rendering.html)

### Proposals
1. **Camera-fed environment** (1–2 days). The worker already returns a 16×16
   RGBA sample. Build a small equirect texture from it (mirrored camera
   frame as the front hemisphere, its blurred average as the back), feed
   `PMREMGenerator` a few times a second, blend with the studio HDR. Lenses
   then reflect the user's actual room colours. No imagery leaves the device,
   so the privacy promise holds.
2. **Dominant light direction** (~1 day). From the face region of the same
   sample, compare left/right and top/bottom luma of the face (or fit
   order-1 SH à la Knorr & Kurz) → direction for the key light and the
   shadow light of section 1. Pure math in `utils/tryon-lighting.ts`.

---

## 6. Matching the camera (compositing)

The render is clean and sharp; a webcam frame is noisy and soft, so the frame
looks pasted on.

- ARKit exposes a camera-grain texture so custom renderers add the stream's
  own noise to virtual content.
  [Apple](https://developer.apple.com/documentation/arkit/arframe/cameragraintexture)
- Patent US11308652 *Rendering objects to match camera noise*.
  [Google Patents](https://patents.google.com/patent/US11308652)

Proposals (~1 day total, low tier off): fine noise on the rendered layer
scaled by the estimated luma (more grain in dim rooms — the lighting estimate
already knows), a 0.5–1 px blur to match webcam sharpness, and a faint light
wrap (video colour bleeding onto frame edges).

---

## Not recommended

- Lens refraction: catalog lenses are plano (see `utils/tryon-lens.ts`
  header); refraction only matters for prescription lenses.
- Depth sensors / TrueDepth: no web path (`truedepth-web-depth.md`).

## Open questions

- Which catalog lenses are cat 2 vs cat 3, and are any gradient or mirrored?
  Needs the product sheets.
- Is the temple split clean on every GLB (`pt2` one mesh with two disjoint
  halves on all models)? Checked on `iris-bronze` only.
