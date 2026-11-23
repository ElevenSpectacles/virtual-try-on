# 0001. Ship a self-registering Nuxt module that works from source and from dist

- Status: accepted
- Recorded: 2026-11-22, from decisions previously kept in code comments

## Context

The module is consumed both as a sibling checkout and as an npm package, by hosts with their own Vue, three and auto-import settings.

## Decision

One `modules` entry registers everything. Runtime paths resolve through `createResolver`, shared peers are deduplicated, and the build rewrites worker URLs.

## Consequences

Both layouts must be tested after a packaging change. Some Vite configuration exists only to protect worker URLs and dependency resolution.

## Detailed records

### `build.config.ts`

#### `WORKERS`

mkdist transpiles the workers to `.js`, but leaves the
`new URL('…worker.ts', import.meta.url)` string in the composables that
start them untouched — point each built composable at its emitted `.js`
worker. Fails the build loudly if a reference ever moves, instead of
shipping a 404.

### `src/module.ts`

#### `occluder`

Hide the parts of the frame the head would hide (the far temple behind
the face) with the tracked face-mesh occluder. On by default; the
component's `occluder` prop overrides it per instance.

#### `export default defineNuxtModule<ModuleOptions>({`

Nuxt module wrapper around the virtual try-on experience.

Registers everything a host previously had to wire by hand in its
`nuxt.config.ts`:

- `@tresjs/nuxt` (a dependency, installed via `moduleDependencies`)
- `runtimeConfig.public.virtualTryOn` from the module options
- `components/` (unprefixed auto-imported component names)
- `composables/` + `utils/` auto-imports
- Vite dev-server `fs.allow` so the classic face-landmarker worker can
  be served from outside the host project root

Built with `@nuxt/module-builder`: the published package ships
`dist/module.mjs` + transpiled `dist/runtime/`, while local-path consumers
(the playground, a sibling host checkout) load this source file directly
and resolve `./runtime` against `src/` — both layouts must keep working.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
modules: ['@eleven.spectacles/virtual-try-on']
})
```

#### `moduleDependencies`

TresJS (and three) ship with this module: Nuxt installs @tresjs/nuxt
before setup, so hosts add only this module. A host that also lists
@tresjs/nuxt itself still gets a single installation.

#### `nuxt.options.runtimeConfig.public.virtualTryOn = {`

Global defaults the component reads at runtime (also overridable with
NUXT_PUBLIC_VIRTUAL_TRY_ON_OCCLUDER).

#### `addImportsDir([`

addImportsDir scans only the top level of each dir, and the
composables live in composables/tryon/ — register it explicitly.

#### `nuxt.options.vite.optimizeDeps ??= {}`

The classic worker is referenced via `new URL(…, import.meta.url)`;
esbuild dep pre-bundling would relocate the runtime and break that URL
when the package is consumed from node_modules.

#### `nuxt.options.vite.optimizeDeps.include ??= []`

MediaPipe is a dependency of this module, reachable only through the
worker's dynamic import(), which Vite's dep scanner never crawls —
pre-bundle it up front so the first try-on doesn't trigger a dev
re-optimisation + full reload. Installed from npm it may sit nested
under this package, hence the `parent > dep` form; local checkouts
resolve it from their own node_modules.

#### `nuxt.options.vite.resolve ??= {}`

Peers must resolve to the host's single copy: a sibling checkout with
its own node_modules would otherwise bundle a second vue/three
(duplicate renderer state, broken reactivity, ~600 KB extra).

#### `DRACO_ASSET`

three's DRACOLoader references its bundled decoder via
`new URL(…, import.meta.url)`, so Vite emits ~1.3 MB of decoder files
and Nuxt preloads/prefetches them wherever the try-on chunk renders.
The loader is pointed at `dracoDecoderPath` (gstatic by default) and
never requests them — drop them from the resource hints.

#### `nuxt.options.vite.server ??= {}`

Dev server must be allowed to serve this module's classic worker and
component sources from outside the host project root.
