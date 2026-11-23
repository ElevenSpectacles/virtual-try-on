# 0011. Fit temples at load and at render without editing GLBs

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

Rigid catalog temples float off or cut into heads of other widths.

## Decision

The shared temple mesh is split at load onto hinge pivots. Both arms open equally toward the head, with an optional shader bend behind the ear.

## Consequences

The fit depends on the catalog node layout. Other GLBs keep their authored temples.

## Known problems in these files

- [#150](https://github.com/ElevenSpectacles/virtual-try-on/issues/150): Refactor: give material patches a single owner
- [#153](https://github.com/ElevenSpectacles/virtual-try-on/issues/153): Testing: GLSL mirrors and shader string patches are unverified

## Detailed records

### `src/runtime/composables/tryon/scene/useTempleFit.ts`

#### `TEMPLE_FILTER`

Temple fit (utils/tryon-temples): the face-mesh occluder's oval points at
temple height, the surface the arms pass, are taken into the GLB's frame
through the inverse of the frame group's transform and the recentring
offset, and the arms open or close on their hinges to clear them. The
occluder's shape follows the raw landmarks, so the angle is smoothed;
head width does not change while someone wears a frame, so it is slow.

#### `earBendMaterials`

Ear bend (opt-in): each arm gets its own clone of the frame material with
a vertex-shader bend past the ear (`EAR_BEND_UNIFORMS`), since the arms
share their material with the frame front. The bend line follows the
head's oval point at temple height, smoothed like the opening angle.
Declared before the temple-fit watcher that drives it; its own watchers
still register after that one.

> Known problem: [#150](https://github.com/ElevenSpectacles/virtual-try-on/issues/150). This records why the code is as it is; it does not endorse it.

#### `authoredCompile`

clone() copies userData but not onBeforeCompile: chain the authored
patches (camera match), or the clone keeps their "patched" flag
without their shader code and the arms lose grain and light wrap.

> Known problem: [#150](https://github.com/ElevenSpectacles/virtual-try-on/issues/150). This records why the code is as it is; it does not endorse it.

#### `ear`

One bend line for both arms (the ears are level on a head in a frame);
the further-back oval point, so neither tip drops in front of its ear.

### `src/runtime/utils/tryon-temples.ts`

#### `TEMPLE_NODE_NAME`

Temple arms that open at the hinge to meet the side of the head (issue
#83). A real frame front is rigid; on a wide head the temples flex open at
the hinge, on a narrow one they close in. Without that they either float
off the head or run into it, where the face-mesh occluder hides them.

Every catalog GLB holds both temples in one mesh, `pt2`, mirrored across
its local Y (the frame's width axis): local X runs from the hinge
(≈ 0.018 m) back toward the ear, local Z is up. `rigTemples` splits it by
the side of each triangle into two meshes, each on a pivot at its own
hinge, at load time — the GLBs themselves are not changed. A GLB without
that layout keeps its temples as authored.

The opening angle comes from where the side of the head is: the tracked
face-oval point at temple height (`EAR_LEVEL_RIGHT`/`EAR_LEVEL_LEFT`) of
the face-mesh occluder, in the temple's own frame. MediaPipe has no ear
landmarks; the oval point is the furthest back point of the face that is
tracked, and behind it the occluder's collar hides the arm anyway.

#### `MAX_TEMPLE_OPENING_RADIANS`

Widest the temples open or close, each way. An acetate or metal temple
flexes a few degrees at the hinge before it binds; beyond that, the
tracked oval point is noise (a strongly turned head), not head width.

#### `TEMPLE_CLEARANCE_METERS`

Gap kept between the temple's inner face and the side of the head, so the
occluder (the same surface) does not cut into the arm where it passes.

#### `MIN_TEMPLE_REACH_METERS`

Below this reach from the hinge to the oval point (GLB metres), a small
lateral error would swing the arm far, so the temple stays as authored.

#### `TempleProfile`

One temple arm, in the temple node's local frame (GLB metres).

#### `pivot`

Hinge pivot: the arm's front end, on its outer face, at mid height.

#### `templeOpeningAngle`

Rotation of the arm about local +Z at its pivot (radians) that puts its
inner face `clearance` outside the head point `head` (the temple node's
frame): positive on the +Y arm and negative on the −Y arm both open it.
Zero when the point is on the other side, or too close to the hinge;
clamped to ±`max`.

#### `rigTemples`

Split the GLB's temple node into one mesh per arm, each under a pivot
group at its hinge. Both meshes share the original vertex buffers (only
the index is split) and the material. Null, with the scene untouched,
when the node is missing or not two mirrored arms.

#### `templeAngles`

Opening angle of each rigged temple (in `rig.temples` order) for points on
the side of the head, given in the GLB scene root's frame.

Both arms get the same opening: the front is rigid and centres itself on
the nose, so the arms spread as far as the wider side needs. Per-side
angles would follow noise instead — the far side's oval point slides
inward on a turned head (it is the visible silhouette, not the side of
the skull), and a frame a few millimetres off-centre would show one arm
open and the other shut on a frontal face.

#### `EAR_REST_OFFSET_METERS`

Ear bend (issue #83, optional): an optician bends the temple tips down
behind the ear. The catalog GLBs have straight (trimmed) tips, so past the
ear the arm runs on level behind the head, which shows on a profile view.
The bend rotates everything past the ear's resting point down about a
line across the arm, with the angle easing in over `EAR_BEND_RAMP_METERS`
so the arm curves instead of kinking. It is a vertex-shader deformation
(`patchEarBendShader`); `earBendPoint` is the same maths for tests.
/

#### `EAR_REST_OFFSET_METERS`

How far behind the tracked oval point at temple height (234/454) the
temple rests on the ear, in GLB metres. The oval point is the furthest
back tracked point of the face, at the front of the ear; the helix root
the temple rests on is about 1.5 cm behind it.

#### `EAR_BEND_RADIANS`

Down-bend of the tip past the ear: a typical fitted temple drops 25–40°.

#### `angle`

Full bend angle, radians (0: no bend).

#### `earBendPoint`

A temple-node point bent down by `bend` (identity in front of the ear).
Mirrors `earBendShaderChunk`.

> Known problem: [#153](https://github.com/ElevenSpectacles/virtual-try-on/issues/153). This records why the code is as it is; it does not endorse it.

#### `EAR_BEND_UNIFORMS`

GLSL for the bend, applied to `transformed` (and `objectNormal`) in the
mesh's own frame. A rigged arm's geometry is in the temple node's frame
(the mesh is only offset by `-pivot`), so `uEarBend` = (start, z, angle,
ramp) is in temple-node units.
