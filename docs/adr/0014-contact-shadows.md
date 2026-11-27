# 0014. Ground the frame with multiply shadows and analytic contact occlusion

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

A canvas over DOM video cannot read or multiply the pixels behind it, and one shadow map does not show contact.

## Decision

Black alpha provides the neutral multiply, fitted spheres the contact darkening. A coloured lens shadow opts in to a second map and a video sample.

## Consequences

The receiver works in display space. The coloured path costs GPU time and runs on the high tier only.

## Detailed records

### `src/runtime/composables/tryon/scene/useContactOcclusion.ts`

#### `shadowReceiverMaterial`

ShadowMaterial with the occlusion folded into its alpha, mirroring
`contactShadowAlpha`: shadow and occlusion darken independently, so their
visibilities multiply. The skin normal is turned toward the camera, since
the mesh is drawn double-sided, and the occlusion fades out toward the
mesh's silhouette (`silhouetteFade`).

#### `.replace('#include <tonemapping_fragment>', '')`

The receiver composes in the display's (sRGB) space, against the DOM
video: no tone mapping or colour-space encode on its output. (The
untinted output is black, which neither changes.)

#### `watch(`

The camera as a texture, only while the tinted lens shadow runs (one
upload per video frame). Raw sRGB values: the receiver works in display
space.

#### `sphereCentre`

Spheres follow their meshes: the world matrices (the frame's pose and each
arm's hinge angle) are current by the time the receiver draws. An arm with
the ear bend on bends its spheres like its vertices (`earBendPoint` is the
shader's maths).

### `src/runtime/composables/tryon/scene/useContactShadow.ts`

#### `MeshOccluderSphere`

A contact-occlusion sphere in the local space of the mesh it was fitted
to, so it moves with that mesh: the temple arms turn at their hinges
every frame (utils/tryon-temples) and may bend behind the ears.

#### `SHADOW_COLOR`

Contact shadow (utils/tryon-contact-shadow): a shadow-only light (no
intensity, so it changes no shading) renders a small
shadow map of the frame, framed tightly on it, and a ShadowMaterial copy
of the face mesh shows that shadow on the skin. Only the opaque parts
(rims, bridge, pads, temples) cast into it. A lens shadow needs the
lens's colour, which a black multiply can't give: a brown lens's light
stays warm, but black turns its shadow into a grey patch on the cheek,
the more visible the paler the skin there. So lenses cast only with the
tinted lens shadow (below), which colours their shadow against the
camera pixels. The host canvas uses VSM:
its blur pass keeps the edge soft, as from a room light rather than a
spotlight, without PCF's speckle at a wide radius.

The shadow is black, which makes it a multiply: the canvas is transparent
over the DOM &lt;video> and the browser composites it premultiplied, so a
black texel of alpha a leaves `video × (1 − a)`. A shadow removes light in
proportion, so dark skin barely changes and the skin keeps its own hue (the
reddish cast of real skin shadows comes from the skin itself). A coloured
shadow would add `colour × a` on top instead, which shows as a brown stain
on dark skin.

#### `lensShadowLight`

Tinted lens shadow (opt-in): the lenses cast into a second, identical
shadow map of their own (`shadowCasterFilter` keeps each part out of the
other light's map), so the receiver can colour their shadow. three.js
indexes shadow-casting directional lights in scene-graph order and the
receiver reads the frame's map at 0 and the lenses' at 1, so this light is a
child of `shadowLight` (at its origin): it always directly follows it,
wherever the template puts `shadowLight`. A unit test checks the order.

#### `watch(`

Frame the shadow camera on the frame. The light is directional and has
no intensity, so moving it changes only what the shadow map covers.

#### `occluderSpheres`

Every frame mesh casts; lens meshes only into the tinted lens shadow's
map. The receiver never casts.

#### `frameOccluderSpheres`

Contact occlusion (utils/tryon-contact-occlusion): the soft darkening where
the frame lies on or close to the skin (pads, bridge, temples), which a
one-light shadow map does not produce. Spheres fitted to the frame's own
vertices, in GLB-local metres, are moved into world space every render and
the receiver darkens each skin point by the solid angle they cover. Lenses
count by their density, like their shadow. The spheres are refitted with
the lens depth materials above (`occluderSpheres`).

#### `owners`

Per part: its mesh and the GLB-root → mesh-local transform. The cells are
fitted in root space (one grid for the whole frame), then each sphere is
kept in its own mesh's space.

### `src/runtime/utils/tryon-contact-occlusion.ts`

#### File overview

Contact occlusion of the frame on the face (issue #88): the soft darkening
right under the nose pads, along the temples where they lie on the skin and
under the bridge. Indoor light is mostly diffuse, so this, not the cast
shadow of one light, is what grounds a real pair on the face.

The frame is approximated by a cloud of small spheres fitted to its own
vertices (any GLB, no hand-placed proxies), and each point of the tracked
skin is darkened by the cosine-weighted solid angle those spheres cover
above it — the analytic sphere occlusion behind capsule shadows (Unreal),
without a shadow map. The receiver shader in useContactOcclusion.ts mirrors
`sphereOcclusion` and `contactShadowAlpha`.

Pure math, no three.js.
/

#### `OccluderSphere`

A sphere occluder: centre and radius in the GLB's local metres.

#### `MAX_OCCLUDER_SPHERES`

Upper bound on spheres per frame: a uniform array in the receiver shader,
well inside WebGL2's minimum of 224 fragment vec4 uniforms.

#### `FRAME_SPHERE_CELL_METERS`

Cell size for the frame's own parts (rims, bridge, pads, temples): about the
width of a temple arm, so a thin part becomes a chain of small spheres.

#### `LENS_SPHERE_CELL_METERS`

Cell size for lenses: a lens is a flat disc, so coarser spheres cover it
with far fewer occluders.

#### `MIN_SPHERE_RADIUS_METERS`

Smallest sphere radius, so a single-vertex cell still occludes a little.

#### `MAX_SPHERE_OCCLUSION`

Most light one sphere can hide, even with the skin point inside it: where a
temple tip pierces the face mesh behind the ear, full occlusion would draw a
hard black dot on the skin. Real contact is soft at this scale.

#### `OCCLUSION_RANGE_METERS`

Distance past a sphere's surface at which its occlusion has faded to zero.
Without it the 1/d² tails of all spheres add up to a faint haze over the
whole face mesh, which shows the mesh's outline on the forehead and jaw.
20 mm keeps the lenses' darkening on the cheeks below them (12–15 mm away).

#### `SILHOUETTE_FADE_START`

Cosine between skin normal and view direction below which the occlusion is
gone, and above which it is whole. The tracked mesh ends at the side of the
head, where a temple enters it; without the fade the darkening there stops
on the mesh's edge as a hard outline.

#### `CONTACT_OCCLUSION_GAIN`

Occlusion strength per unit of contact-shadow strength: the darkest
contact (pads on the nose) ends at about 0.35 at the default 0.22.

#### `fitOccluderSpheres`

Fit spheres to a point cloud (xyz triples, the GLB's local metres): bin the
points into cubic cells of `cellSize`, one sphere per occupied cell at the
points' centroid. The radius is the points' RMS distance from that centroid
(how thick the part is there), capped at half a cell and floored at
`MIN_SPHERE_RADIUS_METERS`. `weight` (0…1) scales the occluding area — a
tinted lens blocks only part of the light — by shrinking the radius by
√weight, since a sphere's occlusion grows with r².

#### `fitFrameOccludersByPart`

Fit all parts of a frame, coarsening every cell size by 25 % until the total
fits in `max` spheres. One list per part, in part order, so each sphere can
follow the mesh it came from (the temple arms turn at their hinges).

#### `sphereOcclusion`

Share of the light a sphere hides from a skin point `p` with unit normal
`n`: the cosine-weighted solid angle `cos · r²/|d|²` (`d` from `p` to the
centre), faded by `(1 − (|d| − r)/range)²` to zero at `range` past the
surface, capped at `MAX_SPHERE_OCCLUSION`. Its GLSL twin is
`tryOnSphereOcclusion` in `CONTACT_OCCLUSION_GLSL` (with `tryOnSilhouetteFade`
for `silhouetteFade`); `tests/glsl/shader-parity.spec.ts` checks they agree.

`cos = (n·d + r)/(|d| + r)` instead of `n·d̂`: it counts the part of a
sphere that sticks up through the skin's horizon, and it is continuous
across the sphere's surface (inside, `|d|` is held at `r`). With `n·d̂`
and a constant inside, a sphere that sits mostly below the skin (a temple
tip entering the head) leaves a hard-edged disc.

#### `contactShadowAlpha`

Alpha of the shadow-only receiver, which the browser composites as
`video × (1 − alpha)`: the cast shadow (0 lit … 1 fully shadowed) and the
contact occlusion darken independently, so their visibilities multiply.

### `src/runtime/utils/tryon-contact-shadow.ts`

#### File overview

Contact shadow of the frame on the face (issue #6): a shadow-only light
casts a soft shadow map from the frame's opaque parts (rims, bridge,
temples) onto the tracked face mesh, drawn with a shadow-only material.

The receiver is the per-frame face-mesh occluder, so the shadow follows
the head's yaw and pitch, lands only on skin and stops at the face
silhouette. Because the frame stands off the face
(FRAME_BRIDGE_STANDOFF_METERS), the shadow falls a few millimetres below
and beside each rim, which is what grounds a real pair of glasses: a thin
band under the lenses on the cheeks, and under the pads beside the nose.

This file holds the pure framing math for the shadow camera (no three.js).
/

#### `CONTACT_SHADOW_STRENGTH`

Peak opacity of the shadow on skin. Kept subtle: a cue, not a hard shadow.

#### `SHADOW_LIGHT_DIRECTION`

Direction the shadow light shines from (unnormalized, world space): mostly
from the front, a little above and to the right. Its own light, with no
intensity, so the frame's shading keeps the studio key light. Steep light
throws the shadow of a lens 2–3 cm onto the cheek, which reads as a dark
patch; with this angle it lands about a centimetre below the rims, where
a real pair's shadow sits under ordinary room light.

#### `SHADOW_HALF_EXTENT_METERS`

Half-size of the shadow camera's square frustum per unit of frame scale.
A frame is about 0.14 m wide; 0.16 m each way also covers the temples and
the shadow below the frame, so the shadow never ends on the frustum edge.

### `src/runtime/utils/tryon-lens-shadow.ts`

#### File overview

Tinted lens shadow (issue #88, step 3). Pure math, no three.js.

Light through a tinted lens takes the lens's colour, so a brown lens
throws a warm shadow and a green one a green shadow (the HSV step in
Ditto's US10403036B2). The contact shadow is a multiply (PR #89): a black
canvas texel of alpha a leaves `video × (1 − a)`, which can only darken
all channels alike. A per-channel multiply needs the camera pixel itself,
so the tinted path samples the video in the shader. To stay robust to the
texture being a frame behind the DOM video, only the *colour* of the
shadow comes from that sample: the alpha does the darkening every channel
shares (`1 − min(multiply)`), against the real video, exactly as before,
and the colour residual is added on top (`tintedShadowComposite`).

#### `lensTransmission`

Per-channel transmission of a lens colour, normalized so its brightest
channel passes everything: the colour's *hue* tints the shadow, its
darkness is the lens density's job. White (or no tint) is neutral.

#### `tintedShadowMultiply`

The per-channel multiply on the skin: frame shadow and contact occlusion
(neutral, `frameLit` and `occluded` are the light they leave, 0…1) times
the lens shadow, which removes `lensBlock` (0…1) of the light the lens
does not transmit.

#### `tintedShadowComposite`

What the receiver writes, as the canvas premultiplies it over the video:
alpha darkens all channels by the smallest multiply, the colour carries
the rest from the video sample. Composited, `rgb·α_premultiplied + video ×
(1 − α)` equals `video × multiply` when the sample matches the video.
Returns the straight (non-premultiplied) colour the shader outputs.

#### `shadowCasterFilter`

Shadow-pass hooks that make a mesh cast into only one of two shadow maps:
the lens light's (`lens` true) or the frame light's. three.js renders
every caster into every shadow map (its layer test uses the *viewing*
camera's layers, not the shadow camera's), so the hook turns the depth
material's writes off for the other light's draw and back on after it.
`lensCamera` is the lens light's shadow camera, compared by identity.

#### `TINTED_SHADOW_FRAGMENT`

Fragment GLSL for the tinted path, placed where the receiver writes
`gl_FragColor`; expects `occluded` (contact occlusion's remaining light)
in scope. Directional shadow 0 is the frame's light, 1 the lens light
(see `lensShadowLight`). Its maths is `TINTED_SHADOW_GLSL`, the twin of
`tintedShadowMultiply` and `tintedShadowComposite`; `tests/glsl/shader-parity.spec.ts` checks they agree.
