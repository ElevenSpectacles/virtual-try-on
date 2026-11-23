# 0021. Run hermetic CI and publish only through release-please

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

CI has no host catalog, and npm publishing should not depend on a stored token.

## Decision

CI runs unit, type, lint and build checks. A merged release PR publishes through npm OIDC.

## Consequences

Conventional commits define releases. Local browser checks remain a pre-release responsibility.

## Known problems in these files

- [#158](https://github.com/ElevenSpectacles/virtual-try-on/issues/158): CI: pin npm in the publish job instead of installing npm@latest

## Detailed records

### `.github/workflows/ci.yml`

#### `- run: npm run verify:unit`

The playground smoke test (verify:playground) skips itself without the
host GLB catalog, so CI runs the unit suite + typecheck — the full
CI-runnable surface.

#### `- run: npm run build`

Proves the publishable dist/ (module-builder + worker URL rewrite in
build.config.ts) still builds.

#### `- run: npx vite-doctor . --format text`

Blocking: --format text exits non-zero on any diagnostic. The root run
covers the module source (worker constraint: no imports means it is
analyzed as plain Vite); the playground run applies Nuxt-app rules.

### `.github/workflows/release-please.yml`

#### `on`

On every push to main, release-please opens/updates a release PR that bumps
package.json + package-lock.json and prepends CHANGELOG.md from the
conventional commits since the last release (feat → minor, fix → patch,
`!` / BREAKING CHANGE → major). Merging that PR tags vX.Y.Z and creates the
GitHub Release; the publish job then ships that version to npm.

#### `id-token: write`

npm trusted publishing (OIDC) — no NPM_TOKEN

#### `- run: npm publish`

prepack runs `nuxt-module-build build`. Auth is OIDC via the npm
Trusted Publisher configured for this workflow file; npm attaches a
provenance attestation automatically (public repo + public package).
