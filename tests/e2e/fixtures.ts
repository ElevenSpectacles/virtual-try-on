import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  | 'landscape'

const FACES_DIR = fileURLToPath(new URL('../fixtures/faces', import.meta.url))
const CLIPS_DIR = join(tmpdir(), 'virtual-try-on-face-clips')

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
  dark: 'scale=480:640,eq=brightness=-0.65:saturation=0.7',
  backlit:
    "scale=480:640,format=yuv420p,geq=lum='clip(lum(X\\,Y)*0.5+255*pow(hypot(X-W/2\\,(Y-H*0.42)*0.8)/(W*0.62)\\,3)\\,0\\,255)':cb='cb(X\\,Y)':cr='cr(X\\,Y)'",
  occluded:
    "scale=480:640,drawbox=x=40:y=330:w=200:h=280:color=0xb5836a@1:t=fill:enable='between(t,2,4)'",
  dropout: "scale=480:640,drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill:enable='between(t,3,3.2)'",
  landscape: 'scale=480:640,pad=1138:640:(ow-iw)/2:0:color=0xe8e4de'
}
const DURATION_S: Record<ClipKind, number> = {
  still: 4,
  motion: 6,
  dim: 6,
  bright: 6,
  dark: 6,
  backlit: 6,
  occluded: 6,
  dropout: 6,
  landscape: 4
}

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
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-loop', '1', '-i', source,
    '-t', String(DURATION_S[kind]), '-r', '15',
    '-vf', FILTERS[kind],
    '-pix_fmt', 'yuv420p', clip
  ])
  return clip
}

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
