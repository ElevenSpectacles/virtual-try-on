# 0010. Occlude with the tracked face mesh and lateral collars

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

A silhouette shell cannot distinguish rims over the cheek from temples behind the head.

## Decision

The landmark mesh writes depth only and rides the smoothed transform. Side collars cover the untracked run to the ears. An ellipsoid is the fallback.

## Consequences

Setback, inflation and collar tuning trade z-fighting against leaking temples.

## Known problems in these files

- [#144](https://github.com/ElevenSpectacles/virtual-try-on/issues/144): Bug: occluder depth is flattened by object-fit cover (42% depth on 16:9 webcams)
- [#145](https://github.com/ElevenSpectacles/virtual-try-on/issues/145): Sizing: replace the hand-tuned FRAME_FIT_SCALE_BOOST
- [#151](https://github.com/ElevenSpectacles/virtual-try-on/issues/151): Refactor: remove implicit setup, watcher and light ordering

## Detailed records

### `src/runtime/components/TryOnScene.vue`

#### `<TresMesh`

Depth-only head proxy: writes depth but not color, so geometry behind
it (temple arms tucking behind the ear) is hidden by the depth test
without needing named anchor nodes in the GLBs. Must render before the
glasses group so its depth is already in the buffer when they draw.

The landmark-built face mesh (real tracked surface with its true
curvature) is the accurate occluder; the ellipsoid is the fallback for
pointer/idle mode where no face is tracked.

### `src/runtime/composables/tryon/scene/useFaceMeshOccluder.ts`

#### `occluderMeshGeometry`

Face-mesh occluder: one persistent BufferGeometry whose positions are
re-uploaded per frame from `occluderPositions`. Fixed layout (468 tracked
landmark vertices plus the collar ring, FACE_MESH_OCCLUDER_INDEX
triangles) so no re-allocation happens per detection. Frustum culling is
disabled — recomputing a bounding sphere every frame costs more than the
depth-only draw it would save.

#### `occluderMeshGeometry.value?.dispose()`

Tres only fires `Object3D.dispose()` on the unmounted mesh — a
geometry passed in as a prop is ours to free, else every lost-face
cycle leaks its GPU buffers.

#### `if (props.contactShadow) geometry.computeVertexNormals()`

The contact-occlusion receiver needs the skin's normals (468 vertices:
cheap); the depth-only occluder ignores them.

### `src/runtime/composables/tryon/useTryOnPlacement.ts`

#### `occluderPosition`

Push-back is applied along the head's own backward axis, not the
camera's: at yaw the skull sits diagonally behind the nose bridge, and
pushing straight back along camera Z drifts the ellipsoid off the head,
exposing the far temple arm it exists to hide.

### `src/runtime/utils/face-mesh-triangles.ts`

#### File overview

Face-mesh triangulation of the MediaPipe canonical face model
(mediapipe/modules/face_geometry/data/canonical_face_model.obj — vertex
i+1 in the OBJ is landmark i). 468 vertices, 898 triangles.

Used to render the tracked face as a depth-only occluder: the same
technique as MediaPipe's own effect renderer, which draws the runtime face
mesh into the depth buffer before the virtual object.

Generated — do not edit by hand. Depth-only rendering does not care about
winding, so no normals are needed.

### `src/runtime/utils/tryon-occluder.ts`

#### `FACE_OVAL_INDICES`

Depth-only face-mesh occluder built per frame from the tracked landmarks —
the same technique as MediaPipe's own effect renderer (and the paid try-on
SDKs): render the runtime face mesh into the depth buffer first, then every
fragment of the glasses that falls behind the face surface fails the depth
test.

**Why a mesh instead of an extruded silhouette scoop**

The scoop (a flat cap over the face oval, extruded backward) cannot tell
"rim side curving back over the cheek" (must stay visible) from "temple
arm running behind the head" (must be hidden) — both occupy the same depth
near the silhouette, so the cap either bit into the frame's curved sides
(floating-hinge artifact) or leaked the temples. The real face surface
makes the distinction for free: cheeks curve back, the nose protrudes, the
eye sockets recess — the frame rests ON that surface, so what is in front
of the skin wins and what is behind it loses.

**Landmark depth**

MediaPipe's landmark `z` is relative depth scaled like the `x` coordinate
(weak perspective), negative toward the camera, origin near the face's
centre of gravity. Converted to world units with the visible plane width
it reconstructs the face's true curvature — no tuned depth constants.

**Riding the smoothed transform**

Raw landmarks jitter a pixel or two per frame; an occluder placed directly
from them would shimmer at the edges exactly where it meets the (smoothed)
glasses. Instead the mesh is extracted into the *raw* pose's local frame
and re-placed with the *smoothed* anchor/euler — the same transform the
glasses render with — so occluder and frame move as one rigid body and
inherit all One-Euro smoothing / latency prediction for free. Only the
mesh's *shape* tracks the raw landmarks, and shape jitter is invisible on
a depth-only surface.

**The collar**

The tracked mesh only covers the face surface itself — MediaPipe has no
landmarks over the ears or into the hairline, so a temple arm's run from
the hinge back to the ear has no tracked geometry behind it and floats
unoccluded. A "collar" wall, extruded straight back from the face-oval
boundary (`FACE_OVAL_INDICES`), closes that gap: it doesn't need the
mesh's curvature — by the time a temple reaches the ear it is already
side-on to the camera, so a simple depth wall is enough to hide it.

Only the two lateral arcs of the oval get a collar — roughly eye-to-jaw
height on each side, where a temple arm actually runs to the ear. The
forehead and chin arcs are deliberately excluded: walling those off too
(closing the loop all the way around) put a depth surface straight
through the browline, clipping the top rim of the frame on near-frontal
views for no benefit — nothing needs hiding above/below the temple's
height band.

#### `FACE_OVAL_INDICES`

MediaPipe's ordered 36-point face-oval loop (canonical order, closes on
itself): forehead → right temple/cheek → jaw → chin → left temple/cheek →
forehead. The collar extrudes backward only from the two temple/cheek
arcs (see `COLLAR_RANGES`).

#### `COLLAR_RANGES`

Inclusive [start, end] slot ranges into `FACE_OVAL_INDICES` that get a
collar wall — the right (454, slot 8) and left (234, slot 28) temple/cheek
arcs, each padded a few points toward the jaw and toward the brow without
reaching the forehead-top (slot 0) or chin (slot 18) points.

#### `landmarks`

Cover-corrected, raw (unsmoothed) landmark array (≥ 468 points).

#### `rawAnchor`

Raw anchor centroid (cover-corrected, pre-smoothing).

#### `scale`

Smoothed metric scale (world units per real metre) — converts the metre constants below to world units.

#### `skinSetbackMeters`

Pushes the whole mesh slightly AWAY from the camera, in metres, so frame
parts resting on the skin (bridge, nose pads) win the depth test instead
of z-fighting the face surface. Keep small: every mm of setback also
loosens the silhouette's grip on the temple arms (see `inflate`).

#### `inflate`

Outward multiplier on x/y about the anchor. Temples rest ON the skin; a
mesh sitting exactly on the tracked surface would z-fight them at the
grazing silhouette. 1.04 keeps what is truly behind the head hidden
while sparing contact rests.

#### `collarDepthMeters`

How far the collar (see the file overview above) extends behind the face-oval
boundary, in metres — roughly a skull depth, so it reaches the ear and
beyond regardless of head rotation.

#### `collarFlare`

Outward multiplier on the collar's back vertices only (x/y about the
anchor), on top of `inflate`. The face oval runs along the cheek line —
real ears sit further out sideways than that line. A collar wall
extruded straight backward from the oval stays inboard of the ear, so a
temple resting on the ear pokes past the wall laterally and shows
through. Flaring the back vertices outward widens the wall's footprint
to actually reach past the ear instead of just behind the cheek.

#### `nearSideSetbackMeters`

Extra push-back, in metres, for the side of the head turned toward the
camera (see `nearSideWeight`). There the temple arm runs along the
visible side of the head, millimetres off the skin — `inflate` and
`collarFlare` would wrap the occluder over it and cut it off behind the
hinge. Nothing of the frame is truly behind the near cheek, so that side
drops both (its collar collapses onto the oval) and steps back; the far
side keeps them to hide its temple.

#### `nearSideWeight`

0 → 1 weight for how much a head-local vertex sits on the camera-facing
side of the head: zero near the midline (nose, bridge — must keep
occluding the far lens) and on a frontal head, one on the outer cheek of a
head turned ≳ 20°. `camLocalX` is the x component of the unit
camera direction in head-local space (≈ sin(yaw)).

#### `buildFaceMeshOccluderPositions`

Build the face mesh's world-space vertex positions for this frame, or
`null` when landmarks are missing (callers fall back to the ellipsoid
proxy — e.g. pointer/idle mode without a tracked face).

Layout: `FACE_MESH_VERTEX_COUNT` tracked-mesh vertices in landmark order,
followed by one collar back-vertex per `COLLAR_POINTS` entry (total
`FACE_MESH_OCCLUDER_VERTEX_COUNT`); index via `FACE_MESH_OCCLUDER_INDEX`.

#### `zWorldPerNorm`

Landmark z is scaled like the x coordinate: one normalized unit spans
the visible plane width in world units. MediaPipe's z grows away from
the camera; world +z faces the camera — hence the sign flip. Measured
relative to the anchor's z so the mesh's nose ridge lands on the same
plane the frame is anchored at.

> Known problem: [#144](https://github.com/ElevenSpectacles/virtual-try-on/issues/144). This records why the code is as it is; it does not endorse it.

#### `setback`

In the head's local frame +Z faces the camera, so the skin setback rides
the smoothed orientation backward.

#### `camLocalX`

Camera direction in the raw head-local frame, and the half-width of the
midline band (nose, bridge) that always keeps occluding — 2 cm.

#### `tmpVec.set(`

Raw-pose local frame: strips global motion, keeps the face's shape
(now including its true depth curvature). In this canonical
orientation +Z is the front of the face, so "backward" (the collar's
direction) is -Z.

#### `backVec.copy(tmpVec)`

The near side's collar collapses onto the oval: from the camera's
side of the head it would only wall off the visible temple.

### `src/runtime/utils/tryon.ts`

#### `computeHeadOccluderGeometry`

Size a depth-only ellipsoid occluder from the tracked face's world-space
half-width, so temple arms and other geometry that should sit behind the
head/ear are hidden by the depth buffer rather than rendered on top.
