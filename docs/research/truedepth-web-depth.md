# Research: a web path to TrueDepth / real metric depth? (issue #19)

Timeboxed spike, 2026-10-12. Question: can the try-on get per-frame depth, or a
better metric scale than the current IPD/ear-width assumption, on the devices
our traffic uses, from a normal web page?

**Recommendation: no-go** on depth sensors. No browser exposes front-camera
depth to a web page, and the one depth API that exists (WebXR) is for the
rear/world camera inside an immersive AR session. What is left is
calibration, not sensors (see "What to do instead").

## Our traffic (PostHog, last 90 days, `$pageview`, production host)

| OS / browser | Visitors | Share |
| --- | --- | --- |
| iOS (Mobile Safari 448, Chrome iOS 74, in-app 6) | 528 | ~44% |
| Android (Chrome 325, Samsung Internet 30, Firefox 5) | 360 | ~30% |
| Desktop (Windows, macOS, Linux) | ~230 | ~19% |
| Unknown | 70 | ~6% |

iOS is the largest segment, and every iOS browser is WebKit, so what Safari
exposes sets the ceiling on any payoff.

## Findings

### 1. WebXR Depth Sensing: not usable for a selfie try-on
- The W3C Depth Sensing Module is still a Working Draft (latest dated
  25 Aug 2026). [W3C](https://www.w3.org/TR/webxr-depth-sensing-1/)
- Support: Chromium on Android (ARCore Depth API, supported devices only),
  Android XR, and Meta Quest Browser (experimental). Babylon.js documents it as
  experimental, Chromium 139+.
  [Babylon.js](https://doc.babylonjs.com/features/featuresDeepDive/webXR/webXRARFeatures),
  [Android XR](https://developer.android.com/develop/xr/web),
  [Meta release notes](https://developers.meta.com/horizon/release-notes/web/)
- It is only reachable from an `immersive-ar` session, which uses the
  world-facing camera. Neither the spec nor the implementations cover the
  front (user-facing) camera, and a try-on needs the front camera.
- Safari has no WebXR AR sessions on iPhone at all.

### 2. TrueDepth from Safari: not exposed
- On iOS, TrueDepth depth is reachable only natively, through AVFoundation
  (`builtInTrueDepthCamera`, `AVDepthData`).
  [WWDC22 session 110429](https://developer.apple.com/videos/play/wwdc2022/110429/)
- The W3C "Media Capture Depth Stream Extension" (`{ depth: true }` in
  `getUserMedia`) never got past a wiki requirements page; no browser ships it.
  [W3C wiki](https://www.w3.org/wiki/Media_Capture_Depth_Stream_Extension)
- No WebKit feature flag or release note exposes depth to the web. Warby
  Parker's depth-based fitting is a native iOS app feature: on iPhone, the app
  is the only route to TrueDepth.

### 3. Shape Detection `FaceDetector`: no gain
- Returns bounding boxes and, on some platforms, a few landmarks; no depth,
  no pose. Chrome documents it behind platform support checks; it is not a
  Safari API. [Chrome docs](https://developer.chrome.com/docs/capabilities/shape-detection)
- MediaPipe already gives us 478 landmarks, pose and blendshapes, so it adds
  nothing.

### 4. MediaPipe's transformation matrix as an absolute distance
- The facial transformation matrix maps a canonical face into a *virtual*
  perspective camera that MediaPipe assumes captured the frame (the 63° FOV
  `TRYON_CAMERA` also uses). Its translation is only metric if the real
  camera matches that virtual camera.
  [MediaPipe face geometry docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md)
- Recovering metric translation needs the camera intrinsics (focal length),
  which browsers do not expose. WebEyeTrack solves for translation against an
  assumed intrinsics matrix and an assumed 60 cm starting depth.
  [arXiv 2508.19544](https://arxiv.org/pdf/2508.19544)
- So its depth carries the same kind of unknown as our approach: an assumed
  size (the canonical face) instead of an assumed IPD. The adult IPD spread
  (SD ~3 mm on 63 mm, ~5%) is tighter than face-size variation, so IPD scaling
  stays the better ruler.

## What to do instead (follow-ups, if wanted)
1. **Known-size calibration, opt-in.** "Hold a card to your forehead" (ISO/IEC
   7810 ID-1, 85.60 mm wide) gives a per-user mm/px at the face's depth. This
   is how web PD tools measure, and it would make the fit verdict (#12) metric
   instead of IPD-relative. About 1–2 days, plus UX copy in the host.
2. **Per-device FOV table.** The front-camera FOV of popular iPhones and
   Pixels is known and stable. Feeding it into `TRYON_CAMERA` would make
   perspective (near/far lens size) match the real camera better than the
   fixed 63°. Needs a webcam clip per device to verify (see the
   fixture-photo caveat in `.claude/skills/fit-check`).
3. **Native app**, only if fitting accuracy becomes the product: TrueDepth
   via AVFoundation, the Warby Parker route. Out of scope for this module.

No implementation issue is opened from this spike. Item 1 is the candidate
if the fit verdict turns out to move conversion (`TRY_ON_FIT` events).
