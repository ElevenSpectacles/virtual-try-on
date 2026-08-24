/**
 * Playground smoke test: builds the playground, boots the production server,
 * and asserts the page, calibration manifest, and GLB assets actually serve.
 *
 * Run via `npm run verify:playground` or directly:
 *   node scripts/verify-playground.mjs
 *
 * Requires the host models checkout (or TRYON_MODELS_DIR) — see
 * playground/nuxt.config.ts. That checkout isn't available in CI (this repo
 * is consumed as source by a separate host app), so this script is excluded
 * from `verify:unit` / CI and is local-only. If the models directory isn't
 * found, it exits 0 with a notice rather than failing the run.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const PORT = 3299
const BASE = `http://localhost:${PORT}`
const STARTUP_TIMEOUT_MS = 30_000
const MODELS_DIR =
  process.env.TRYON_MODELS_DIR ??
  fileURLToPath(new URL('../../nuxt/public/models', import.meta.url))

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    )
  })
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Server did not start within ${STARTUP_TIMEOUT_MS / 1000}s`)
}

const failures = []

function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

async function main() {
  if (!existsSync(MODELS_DIR)) {
    console.log(
      `▸ Skipping playground smoke test — models directory not found at ${MODELS_DIR}\n` +
        '  Set TRYON_MODELS_DIR or check out the host repo alongside this one to run it.'
    )
    return
  }

  console.log('▸ Building playground…')
  await run('npx', ['nuxt', 'build', 'playground'])

  console.log('▸ Booting production server…')
  const server = spawn(process.execPath, ['playground/.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(PORT) }
  })
  let serverLog = ''
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))

  try {
    await waitForServer()

    const page = await fetch(BASE)
    const html = await page.text()
    check('page serves', page.status === 200, `HTTP ${page.status}`)
    check(
      'playground renders',
      html.includes('Virtual Try-On · Playground')
    )

    const calibrationRes = await fetch(`${BASE}/models/calibration.json`)
    const calibration = await calibrationRes.json().catch(() => null)
    const modelIds = calibration ? Object.keys(calibration.models ?? {}) : []
    check(
      'calibration.json serves',
      calibrationRes.status === 200 && modelIds.length > 0,
      `${modelIds.length} models`
    )

    if (modelIds.length > 0) {
      const glb = await fetch(`${BASE}/models/${modelIds[0]}.glb`)
      const size = Number(glb.headers.get('content-length') ?? 0)
      check(
        `GLB serves (${modelIds[0]})`,
        glb.status === 200 && size > 100_000,
        `${(size / 1e6).toFixed(1)} MB`
      )
    }

    check('icons render without errors', !serverLog.includes('failed to load icon'))
  } finally {
    server.kill()
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\n✓ Playground smoke test passed')
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
})
