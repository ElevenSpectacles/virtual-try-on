import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLIPS = [
  { id: 4756, label: 'frontal studio portrait, fair skin, long hair' },
  { id: 4535, label: 'frontal, smiling and talking, dark skin, beard' },
  { id: 4689, label: 'backlit outdoor portrait, red hair over the ears' }
]

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
