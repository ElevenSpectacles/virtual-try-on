/**
 * Real-footage clips for the opt-in e2e specs (`video-clip.spec.ts`,
 * `metrics.spec.ts`): downloads a few stock portrait videos and converts them
 * to the 480×640 Y4M Chromium's fake camera reads.
 *
 *   npm run fetch-footage
 *   TRYON_VIDEO_CLIP=<printed path> npx playwright test tests/e2e/video-clip.spec.ts
 *
 * The clips come from Mixkit (https://mixkit.co, Mixkit Stock Video Free
 * License: free to use, not to redistribute). They are downloaded at run time
 * into the OS temp dir and never committed: footage stays out of git (see
 * AGENTS.md). Downloads land in their own directory and are only read by
 * ffmpeg.
 *
 * Measured 2026-10-12 (real GPU): detection 99.3–100%, still jitter
 * 0.78–1.02 px, latency 18–22 ms.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Frontal portraits that keep the whole face in a 3:4 centre crop. */
const CLIPS = [
  { id: 4756, label: 'frontal studio portrait, fair skin, long hair' },
  { id: 4535, label: 'frontal, smiling and talking, dark skin, beard' },
  { id: 4689, label: 'backlit outdoor portrait, red hair over the ears' }
]

/** Seconds kept from each clip: long enough for the specs' sampling windows. */
const SECONDS = 8

const ROOT = join(tmpdir(), 'virtual-try-on-footage')
const DOWNLOADS = join(ROOT, 'downloads')
const CLIPS_DIR = join(ROOT, 'clips')

function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function download(id) {
  const file = join(DOWNLOADS, `mixkit-${id}.mp4`)
  if (existsSync(file) && statSync(file).size > 0) return file
  const url = `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  return file
}

function convert(id, source) {
  const clip = join(CLIPS_DIR, `mixkit-${id}.y4m`)
  if (existsSync(clip) && statSync(clip).mtimeMs >= statSync(source).mtimeMs) return clip
  // Centre 3:4 crop of the 16:9 frame, scaled to the fake camera's 480×640.
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-i', source,
    '-t', String(SECONDS),
    '-vf', 'crop=ih*3/4:ih:(iw-ih*3/4)/2:0,scale=480:640,fps=30',
    '-pix_fmt', 'yuv420p',
    clip
  ])
  return clip
}

if (!ffmpegAvailable()) {
  console.log('▸ ffmpeg not found on PATH: install it to convert the clips.')
  process.exit(1)
}

mkdirSync(DOWNLOADS, { recursive: true })
mkdirSync(CLIPS_DIR, { recursive: true })

for (const { id, label } of CLIPS) {
  const clip = convert(id, await download(id))
  console.log(`✓ ${label}\n  TRYON_VIDEO_CLIP=${clip}`)
}
