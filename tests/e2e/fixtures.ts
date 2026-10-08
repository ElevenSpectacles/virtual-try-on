import { execFileSync } from 'node:child_process'
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
 */

export const FACE_FIXTURES = ['iris-moss', 'pteron-azure'] as const
export type FaceFixture = (typeof FACE_FIXTURES)[number]
export type ClipKind = 'still' | 'motion'

const FACES_DIR = fileURLToPath(new URL('../fixtures/faces', import.meta.url))
const CLIPS_DIR = join(tmpdir(), 'virtual-try-on-face-clips')

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
  ].join(',')
}
const DURATION_S: Record<ClipKind, number> = { still: 4, motion: 6 }

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

/** Absolute path of the rendered Y4M clip, rendering it if stale. */
export function faceClip(face: FaceFixture, kind: ClipKind): string {
  const source = join(FACES_DIR, `${face}.jpg`)
  const clip = join(CLIPS_DIR, `${face}-${kind}.y4m`)
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
