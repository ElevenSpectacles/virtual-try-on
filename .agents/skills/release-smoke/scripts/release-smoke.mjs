#!/usr/bin/env node
// Install the packed module into a throwaway bare Nuxt host and prove it
// builds and server-renders the component.
//   node release-smoke.mjs [--with-tres]
// --with-tres also lists '@tresjs/nuxt' in the host's modules (hosts that
// still register it themselves must keep working).
//
// Every path is absolute and the host dir must be a fresh child of
// os.tmpdir() — nothing here may write into the repo or $HOME.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const withTres = process.argv.includes('--with-tres')
const PORT = 3311

const host = mkdtempSync(join(tmpdir(), 'vto-release-smoke-'))
if (!host.startsWith(resolve(tmpdir()) + sep) || host.startsWith(repo)) {
  throw new Error(`refusing to use host dir ${host}`)
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

console.log(`▸ build + pack ${repo}`)
run('npm', ['run', 'build'], repo)
const tarball = run('npm', ['pack', '--silent'], repo).trim().split('\n').pop()
renameSync(join(repo, tarball), join(host, tarball))

console.log(`▸ bare host ${host}${withTres ? ' (+ @tresjs/nuxt in modules)' : ''}`)
mkdirSync(join(host, 'app'))
writeFileSync(
  join(host, 'package.json'),
  JSON.stringify(
    {
      name: 'vto-release-smoke',
      private: true,
      type: 'module',
      dependencies: {
        nuxt: '^4.5.1',
        vue: '^3.5.0',
        '@vueuse/core': '^14.4.0',
        '@eleven.spectacles/virtual-try-on': `file:./${tarball}`
      }
    },
    null,
    2
  )
)
const modules = [...(withTres ? ["'@tresjs/nuxt'"] : []), "'@eleven.spectacles/virtual-try-on'"]
writeFileSync(
  join(host, 'nuxt.config.ts'),
  `export default defineNuxtConfig({ compatibilityDate: '2026-08-01', modules: [${modules.join(', ')}] })\n`
)
writeFileSync(
  join(host, 'app', 'app.vue'),
  `<template>
  <div style="width: 400px; height: 400px">
    <VirtualTryOnExperience
      :models="[{ label: 'Iris', file: 'iris-bronze', family: 'iris', color: 'Bronze', colorClass: '' }]"
      calibration-url="/calibration.json"
    />
  </div>
</template>
`
)

run('npm', ['install', '--silent', '--no-audit', '--no-fund'], host)
run('npx', ['nuxt', 'build'], host)

const deps = readdirSync(join(host, 'node_modules', '@tresjs'))
console.log(`▸ @tresjs in host node_modules: ${deps.join(', ')}`)

const server = spawn('node', ['.output/server/index.mjs'], {
  cwd: host,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore'
})
try {
  let html = ''
  let status = 0
  for (let i = 0; i < 20 && !status; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`http://localhost:${PORT}/`)
      status = res.status
      html = await res.text()
    } catch {}
  }
  if (status !== 200 || !html.includes('vto-stage')) {
    console.error(html.slice(0, 600))
    throw new Error(`SSR check failed: HTTP ${status}, vto-stage ${html.includes('vto-stage')}`)
  }
  console.log(`✓ HTTP 200, component rendered (vto-stage) — host kept at ${host}`)
} finally {
  server.kill()
}
