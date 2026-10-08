---
name: release-smoke
description: Prove a publish-affecting change works from npm — pack the module, install the tarball into a throwaway bare Nuxt host, build it and check the component server-renders. Use before opening a PR that touches package.json dependencies/peers, src/module.ts, build.config.ts, the worker URL, or anything that could differ between the source checkout and dist/.
---

# Release smoke test

The playground loads `src/module.ts` from source. Hosts load `dist/` from
npm. Those differ (transpiled `.js` runtime, nested `node_modules`,
`moduleDependencies` resolution), so publish-affecting changes need a real
tarball install. `AGENTS.md` requires it.

## Run

```bash
node .agents/skills/release-smoke/scripts/release-smoke.mjs
node .agents/skills/release-smoke/scripts/release-smoke.mjs --with-tres
```

What it does:
1. `npm run build` and `npm pack` in the repo.
2. Creates a fresh `os.tmpdir()/vto-release-smoke-*` host whose only
   module is `@eleven.spectacles/virtual-try-on` (plus `@tresjs/nuxt` with
   `--with-tres`) and whose only deps are the peers: `nuxt`, `vue`,
   `@vueuse/core`.
3. Installs, `nuxt build`s, serves on :3311 and requires HTTP 200 plus the
   component's `vto-stage` class in the SSR HTML.

Both variants must pass. ~2 min each.

## Rules

- Never hand-roll this with `mktemp` + `cd $DIR` in one shell line: if the
  temp dir step fails, `cd ""` lands in `$HOME` or the commands run in the
  repo and overwrite `package.json`. The script refuses any host dir outside
  `os.tmpdir()`.
- It never publishes. Releases go only through release-please (see
  `AGENTS.md`); the commit type (`feat:` / `fix:`) decides the version.
- Kill stray servers first if :3311 is busy: `lsof -ti :3311 | xargs kill`.
- SSR can't prove WebGL or the camera — for that, use `npm run verify:e2e`.

## Report

Paste both result lines (`✓ HTTP 200 …`) into the PR's verification section.
