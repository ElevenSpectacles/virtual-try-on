/**
 * Stages the demo's static assets in demo/public/, so the deployed page loads
 * everything from its own origin: no jsDelivr, Google Storage, gstatic or
 * GitHub raw at runtime (issue #104).
 *
 * - MediaPipe Wasm fileset: copied from the pinned `@mediapipe/tasks-vision`.
 * - Draco decoder: copied from `three`.
 * - `face_landmarker.task` and the environment HDR: downloaded at build time
 *   and checked against pinned SHA-256 sums. A file already in place with the
 *   right sum is kept, so local rebuilds work offline.
 * - Frames: the GLBs named in `DEMO_MODELS` (default: every frame in the
 *   manifest) from `DEMO_MODELS_DIR`, with `calibration.json` cut down to
 *   them and a `models.json` the page builds its picker from. Catalog frames
 *   are licensed and not in this repo: publish only frames cleared for it.
 *
 * Usage: DEMO_MODELS_DIR=<dir> [DEMO_MODELS=iris-moss,pteron-azure] node demo/scripts/prepare.mjs
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PUBLIC = join(ROOT, 'demo/public')
const VTO = join(PUBLIC, 'vto')
const MODELS_OUT = join(PUBLIC, 'models/virtual-try-on')

const DOWNLOADS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    file: 'face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
  },
  {
    // The component's default environment (Poly Haven, CC0).
    url: 'https://raw.githubusercontent.com/Tresjs/assets/main/textures/hdr/city/canary_wharf_1k.hdr',
    file: 'canary_wharf_1k.hdr',
    sha256: 'df5a95eaa0dc7764e0adb7affe4cc4382c79508cb672d0fd47fc104310f20aaa'
  }
]

// DRACOLoader fetches the wrapper + Wasm, or the JS decoder without Wasm.
const DRACO_FILES = ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js']

function fail(message) {
  console.error(`demo/prepare: ${message}`)
  process.exit(1)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function copyDir(from, to, names = readdirSync(from)) {
  mkdirSync(to, { recursive: true })
  for (const name of names) copyFileSync(join(from, name), join(to, name))
}

async function download({ url, file, sha256: expected }) {
  const target = join(VTO, file)
  if (existsSync(target) && sha256(target) === expected) return
  const response = await fetch(url)
  if (!response.ok) fail(`${url}: HTTP ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(body).digest('hex')
  if (actual !== expected) fail(`${url}: SHA-256 ${actual}, expected ${expected}`)
  writeFileSync(target, body)
}

/** `iris-moss` → family `iris`, colour `Moss`, label `Iris · Moss`. */
function catalogEntry(file) {
  const [family = file, ...rest] = file.split('-')
  const title = (word) => word.charAt(0).toUpperCase() + word.slice(1)
  const color = rest.map(title).join(' ')
  return {
    label: color ? `${title(family)} · ${color}` : title(family),
    file,
    family,
    color,
    colorClass: ''
  }
}

function stageModels() {
  const dir = process.env.DEMO_MODELS_DIR
  if (!dir) fail('set DEMO_MODELS_DIR to a directory with calibration.json and the GLBs')
  const manifestPath = join(dir, 'calibration.json')
  if (!existsSync(manifestPath)) fail(`${manifestPath} not found`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const wanted = process.env.DEMO_MODELS
    ? process.env.DEMO_MODELS.split(',').map((name) => name.trim()).filter(Boolean)
    : Object.keys(manifest.models ?? {})
  if (wanted.length === 0) fail('no frames to publish')

  rmSync(MODELS_OUT, { recursive: true, force: true })
  mkdirSync(MODELS_OUT, { recursive: true })
  const models = {}
  for (const name of wanted) {
    if (!manifest.models?.[name]) fail(`${name} is not in ${manifestPath}`)
    const glb = join(dir, `${name}.glb`)
    if (!existsSync(glb)) fail(`${glb} not found`)
    copyFileSync(glb, join(MODELS_OUT, `${name}.glb`))
    models[name] = manifest.models[name]
  }
  writeFileSync(join(MODELS_OUT, 'calibration.json'), `${JSON.stringify({ ...manifest, models }, null, 2)}\n`)
  writeFileSync(join(MODELS_OUT, 'models.json'), `${JSON.stringify(wanted.map(catalogEntry), null, 2)}\n`)
  return wanted
}

mkdirSync(VTO, { recursive: true })
copyDir(join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm'), join(VTO, 'wasm'))
copyDir(join(ROOT, 'node_modules/three/examples/jsm/libs/draco'), join(VTO, 'draco'), DRACO_FILES)
for (const asset of DOWNLOADS) await download(asset)
const frames = stageModels()
console.log(`demo/prepare: staged ${frames.join(', ')} and the self-hosted assets in ${dirname(VTO)}`)
