import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Face fixtures for the fake-camera harness. Each committed portrait under
 * `tests/fixtures/faces/<model>.jpg` shows a person wearing that catalog
 * frame, so its file name doubles as the model to render on it.
 *
 * Chromium's fake capture device only reads Y4M, which is ~0.5 MB per frame
 * at 480×640 — far too big to commit — so the clips are rendered from the
 * JPEGs with ffmpeg into the OS temp dir and reused while the source is
 * unchanged:
 * - `still`  — the portrait held for 4 s: tracker noise floor (jitter).
 * - `motion` — slow pan, lean in/out and ±4.5° roll for 6 s: detection rate
 *   under movement. Yaw/pitch can't be synthesised from one photo.
 * - `dim` / `bright` — the portrait held for 6 s with the exposure pulled
 *   down or up: the room-lighting estimate (#5) must follow it.
 * - `dark` — much darker than `dim` (a lamp-lit room at night): the guide's
 *   `tooDark` hint must fire (#99).
 * - `backlit` — midtones pulled down and the edges blown out, as in front of
 *   a window (#99).
 * - `occluded` — a skin-toned block over the lower half of one side of the
 *   face from 2 s to 4 s, a hand passing (#99).
 * - `dropout` — 200 ms of black frames at 3 s: the tracker loses the face
 *   for less than the hold, and the frame must not vanish or pop (#99).
 * A yaw sweep can't be made from one photo; it runs on real footage
 * (`TRYON_VIDEO_CLIP`, see `npm run fetch-footage`).
 */

export const FACE_FIXTURES = ['iris-moss', 'pteron-azure', 'kairos-amber'] as const
export type FaceFixture = (typeof FACE_FIXTURES)[number]
export type ClipKind =
  | 'still'
  | 'motion'
  | 'dim'
  | 'bright'
  | 'dark'
  | 'backlit'
  | 'occluded'
  | 'dropout'

const FACES_DIR = fileURLToPath(new URL('../fixtures/faces', import.meta.url))
const CLIPS_DIR = join(tmpdir(), 'virtual-try-on-face-clips')

/**
 * Optional real-footage clip (a Y4M file, e.g. converted from a stock video)
 * run through the same tracking path. Not committed: set `TRYON_VIDEO_CLIP`
 * to its absolute path.
 */
export const VIDEO_CLIP = process.env.TRYON_VIDEO_CLIP ?? ''

export const MODELS_DIR =
  process.env.TRYON_MODELS_DIR ??
  fileURLToPath(
    new URL('../../../nuxt/public/models/virtual-try-on', import.meta.url)
  )

const FILTERS: Record<ClipKind, string> = {
  still: 'scale=480:640',
  motion: [
    "scale=w='520+60*sin(2*PI*t/6)':h=-2:eval=frame",
    "rotate='0.08*sin(2*PI*t/3)':fillcolor=black",
    "crop=480:640:'(iw-480)/2+18*sin(2*PI*t/5)':'(ih-640)/2+8*sin(2*PI*t/4)'"
  ].join(','),
  dim: 'scale=480:640,eq=brightness=-0.25:saturation=0.85',
  bright: 'scale=480:640,eq=brightness=0.12',
  // Room luma 0.012–0.096 on the three fixtures in Chromium (dim:
  // 0.24–0.40), under the guide's 0.12 tooDark threshold. -0.55 left the
  // bright iris-moss portrait at 0.153.
  dark: 'scale=480:640,eq=brightness=-0.65:saturation=0.7',
  // Face at half exposure, brightening to white toward the edges: a window
  // behind the shopper.
  backlit:
    "scale=480:640,format=yuv420p,geq=lum='clip(lum(X\\,Y)*0.5+255*pow(hypot(X-W/2\\,(Y-H*0.42)*0.8)/(W*0.62)\\,3)\\,0\\,255)':cb='cb(X\\,Y)':cr='cr(X\\,Y)'",
  occluded:
    "scale=480:640,drawbox=x=40:y=330:w=200:h=280:color=0xb5836a@1:t=fill:enable='between(t,2,4)'",
  dropout: "scale=480:640,drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill:enable='between(t,3,3.2)'"
}
const DURATION_S: Record<ClipKind, number> = {
  still: 4,
  motion: 6,
  dim: 6,
  bright: 6,
  dark: 6,
  backlit: 6,
  occluded: 6,
  dropout: 6
}

/** Why the harness can't run here, or null when it can. */
export function missingPrerequisite(): string | null {
  if (!existsSync(MODELS_DIR)) {
    return `models directory not found at ${MODELS_DIR} (set TRYON_MODELS_DIR)`
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    return 'ffmpeg not found on PATH'
  }
  return null
}

/**
 * Absolute path of the rendered Y4M clip, rendering it if stale. The name
 * carries a hash of the filter and duration, so editing a clip kind renders
 * a new clip instead of reusing the old one.
 */
export function faceClip(face: FaceFixture, kind: ClipKind): string {
  const source = join(FACES_DIR, `${face}.jpg`)
  const recipe = createHash('sha256')
    .update(`${FILTERS[kind]}|${DURATION_S[kind]}`)
    .digest('hex')
    .slice(0, 8)
  const clip = join(CLIPS_DIR, `${face}-${kind}-${recipe}.y4m`)
  if (existsSync(clip) && statSync(clip).mtimeMs >= statSync(source).mtimeMs) {
    return clip
  }
  mkdirSync(CLIPS_DIR, { recursive: true })
  // Fixed rate and pixel format keep the clip byte-identical across runs.
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-loop', '1', '-i', source,
    '-t', String(DURATION_S[kind]), '-r', '15',
    '-vf', FILTERS[kind],
    '-pix_fmt', 'yuv420p', clip
  ])
  return clip
}

/**
 * Chromium flags that feed `clip` as the camera. `swiftshader` pins WebGL to
 * software rendering — identical pixels on every machine, so goldens are
 * stable — but MediaPipe's GPU delegate takes seconds per frame on it, so
 * tracking tests run on the real GPU (`hardware`).
 */
export function fakeCameraArgs(
  clip: string,
  gl: 'hardware' | 'swiftshader'
): string[] {
  return [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${clip}`,
    ...(gl === 'swiftshader'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--enable-gpu', '--ignore-gpu-blocklist'])
  ]
}
