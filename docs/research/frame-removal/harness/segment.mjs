/**
 * Frame-removal spike (#100), step 1: landmarks + multiclass segmentation of
 * the committed glasses-wearing fixtures, in headless Chromium.
 *
 *   node docs/research/frame-removal/harness/segment.mjs <models-dir> <out.json>
 *
 * <models-dir> holds face_landmarker.task and selfie_multiclass_256x256.tflite
 * (https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite).
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const [modelsDir, outFile] = process.argv.slice(2)
if (!modelsDir || !outFile) {
  console.error('usage: segment.mjs <models-dir> <out.json>')
  process.exit(1)
}

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))
const MEDIAPIPE = join(ROOT, 'node_modules/@mediapipe/tasks-vision')
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' }

function resolve(url) {
  if (url === '/') return join(HERE, 'index.html')
  if (url === '/vision_bundle.mjs' || url.startsWith('/wasm/')) return join(MEDIAPIPE, url)
  if (url.startsWith('/models/')) return join(modelsDir, url.slice('/models/'.length))
  if (url.startsWith('/faces/')) return join(ROOT, 'tests/fixtures', url)
  return null
}

const server = createServer((req, res) => {
  const file = resolve(decodeURIComponent(req.url.split('?')[0]))
  if (!file || !existsSync(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(4179)

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
)
const page = await browser.newPage()
await page.goto('http://localhost:4179/')
await page.waitForFunction(() => window.ready)
const out = await page.evaluate((names) => window.run(names), ['iris-moss', 'pteron-azure', 'kairos-amber'])
writeFileSync(outFile, JSON.stringify(out))
await browser.close()
server.close()
