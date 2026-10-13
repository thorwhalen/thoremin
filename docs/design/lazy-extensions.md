# Lazy extensions: a plugin's code loads when the player asks for it

> Status: **accepted** (2026-10-13), agreed between the ASL owner and the thoremin owner before any core code was written, then built in one PR with its guards. Tracking issue [#302](https://github.com/thorwhalen/thoremin/issues/302). Builds on [`instruments-as-graphs-and-extensions.md`](instruments-as-graphs-and-extensions.md) (the `Extension` manifest, `extensions.json`, seam 3 of its §6 table, which this ADR builds) and [`lazy-loading.md`](lazy-loading.md) (the rule and the `LoadStatus` vocabulary it reuses). ASL is the first lazy extension; this is the pattern every later optional feature follows.

## The rule

The maintainer's rule from `lazy-loading.md`, applied to whole extensions: *"We don't want to load everything at once, but only what is needed when it's needed."* An optional capability (an extension: ASL today) costs a player who never uses it nothing beyond a few kilobytes of declarations. Its node code, its libraries, its model weights and its React panels are fetched with a dynamic `import()` the first time the player picks one of its instruments, enables its dial, or opens its settings section, and the instrument that is playing keeps playing while they load.

## Before

Every extension listed in `extensions.json` was imported statically by the two virtual list modules `vite.extensions.ts` generates, so all of it was in the entry chunk. Measured on main at 86cd79f: the ASL model weights were already lazy (two JSON chunks, 120 kB), but all of the ASL code (the recogniser, the two nodes, the panel, the status store: about 48 kB of source) was in the 1.29 MB entry chunk, pulled in by the manifest's node imports and by `dials.ts` importing the node module for its schema.

## Decision

### 1. A lazy extension is declared in `extensions.json`, and only the host writes `import()`

An entry may carry `"lazy": { "module": "...", "ui": "..." }`. Its `module` and `ui` are then small **eager stubs**; `lazy.module` and `lazy.ui` are the **deferred halves**. The Vite plugin emits the stub statically and gives the list element a `load` that is a dynamic `import()` of the deferred half:

```js
import e1 from "@thoremin/ext-asl";
export default [e0, { ...e1, load: () => import("@thoremin/ext-asl/lazy").then((m) => m.default) }];
```

So which extensions are lazy is data the build reads, the deferred chunk is split off in exactly one place, and an extension never decides how the host loads it. An entry without `lazy` is eager, exactly as before: the air extension is unchanged and can opt in later by splitting its files and adding the key.

### 2. What stays eager is declarations, and they stay small

| Eager (the stub) | Deferred |
|---|---|
| `id`, the dial slices (Zod schemas: settings typing, hydration, palette, per-dial commands), the branches as data, the instrument seeds, `derive`, `transient`, `training`, and `provides`: the node types the deferred half defines | the node definitions and every library they import (for ASL: its recogniser library, and through it the weights, a further lazy hop) |
| the React stub: `{ id, panels: [{ instrumentId, section }] }`, data only (`ExtensionUiStub`) | the React half (`ExtensionUi`): the panels' components, the status hooks, the mount effects |

The stub must not import anything the deferred half needs. For ASL that meant moving the `asl` dial's Zod schema out of the node module into `schema.ts`. Measured: the ASL stubs put 4.6 kB in the initial chunks, and its deferred code is five chunks of 152 kB, weights included.

### 3. The registry knows a lazy type before it has it

`NodeRegistry.declareLazy(types, load)` declares node types whose definitions arrive later; `has()` is true for them at once (the composer may name them), `get()` throws a clear error until `ensure(types)` has loaded them. One load per group is shared by every caller, a loader must provide exactly the declared types, and a failed load is forgotten so the next `ensure` retries. The engine itself never awaits: a host loads what a spec names before it plans (`pending(types)` says what).

The app keeps one page-wide cache of each lazy extension's loaded nodes (`loadExtensionNodes` in `src/extensions`), so `createAppRegistry()` built after the load (a new engine) registers them synchronously instead of declaring them again. `loadedAppRegistry()` loads every lazy extension first, for the scripts that list or run every node (the catalog, the demo takes).

### 4. One trigger, with nothing extension-specific in it

Core loads an extension when a composed graph names one of its pending node types. That covers every way a player asks for it: picking ASL Viewer or ASL Chords writes `asl.enabled`, the dial, a command, a gesture or the AI assistant write the same dial, `derive` then names the `asl-signs` branch, and the composed spec names `asl-signs`. There is no "on instrument open" hook to keep in step with the other paths.

The rule lives in `src/app/lazyApply.ts`, pure and tested without React or an engine, and `useEngine` binds it:

1. **Nothing pending: commit at once**, synchronously, as before lazy extensions existed.
2. **Only the latest request commits.** Two instrument switches during one fetch: the older request's continuation is dropped, and the graph composed *after* the load (the settings may have moved on) is the one committed. Meanwhile the running graph keeps playing, the rule `applyGraph` already follows while a model prepares.
3. **A failed load never stops the instrument.** The graph is committed without the branches that name the missing types (and the branches that require those, `branchIdsWithout` in `src/app/graph.ts`), a toast says the add-on could not load, and its `LoadStatus` is `error`, which the readout under the instrument's row shows with a **Reload** button. Not an in-page retry: a browser keeps a failed `import()` of a URL in its module map and never fetches it again in that page (verified in Chromium by the smoke test), so a Retry would be a lie. The settings persist, so the reload comes back on the same instrument and loads it at boot. (The registry and the applier still forget a failed load and retry it on the next request, which is what a host without a module map, such as a test, gets.)

The first engine build composes through the same path, so a restored session whose instrument is lazy loads it before the engine is built, and a failure there starts the app without it rather than not at all. Its fetch starts as soon as the registry exists, beside the camera and the hand model, so it adds no waiting of its own.

A slot URL that names a lazy type that is not loaded (`?slot.source=asl-signs`) falls back to the slot's default with a warning, like any other unfit candidate: a slot never waits for a download, and a stale URL never breaks the boot.

### 5. Panels are placeholders until their section opens

A lazy extension's panels are host placeholders (`src/app/extensions/lazyPanel.tsx`). Rendered inside a closed `<details>` (a collapsed `TopSection`), a placeholder waits for it to open, so opening the instrument editor fetches nothing until the player opens that section. It shows the shared `LoadStatusReadout` while loading and the real component once loaded; a failed load says so with a Reload and never throws into the shell. The readout under the chosen instrument's row shows the extension's own load: "Loading Sign language…" while its code is fetched, and the failure with a Reload (even when its React half did load: the player needs to know why nothing is read). Status hooks join the engine's sinks when the React half arrives (`makeExtensionSinks` builds a hook's sink the first tick it sees it), so a mid-session load gets its readout. The React half's mount effects run when it loads.

The load state of each lazy extension is a `LoadStatus` per id in `useExtensionLoad` (`src/app/extensionLoadStatus.ts`): `loading`, `ready`, `error`.

### 6. A tool-only extension, and an extension's shell tools (#330)

An extension may contribute **shell tools** (the Tools launcher's rows), not only editor sections. The eager UI stub declares each as data (`tools: [{ id, label, description, group, defaultPinned }]`, the React-free `ExtensionToolDecl` of `@thoremin/sdk-ui/tools`). The deferred `ExtensionUi` adds each tool's `Panel`. The shell folds them into its tool list after its own (`src/app/shellTools.ts`: validated against the same `ToolSchema`, always `kind: 'panel'`, an id clash fails at load). It draws the frame for the open one (`src/app/ExtensionToolPanels.tsx`), so an extension writes only the content. A lazy extension's tool content is a placeholder (`lazyToolPanel`) that loads the deferred half the first time the tool opens. A cold load fetches none of it, and a failed load says so with a Reload.

Opening a tool is the second trigger, beside a graph naming a node type, and the only one a tool needs. A lazy extension may therefore provide **no node at all**: `provides: []` and a deferred node half of `{ nodes: [] }`. The face categorizer session (`@thoremin/ext-faces`) is the first. Its stubs are about 0.5 kB.

## Guards

- **`npm run check:lazy`** (CI, the `gate` job): builds the app and reads the module graph from the bundle. For every lazy entry, the deferred halves are in no initial chunk (the entry and its static imports); no module of a package the extension *owns* is initial except its stubs' own closure (a package is owned when every importer of it the build reaches is the extension: its package, and a library only it uses, such as the recogniser and its weights; the SDK and Zod are shared); the stubs stay under 16 kB; and no node the deferred half defines is in an initial chunk, found by its own description (which catches a stub that imports a node directly, a module the closure rule would count as stub). Generic: it reads `extensions.json` and names no extension. Deliberate leaks fail it: the stub importing `asl-signs` (names the recogniser's modules), the stub importing `sign-chord` (names the node).
- **The boundary test** (`test/extensions_boundary.test.ts`): core imports, of thoremin's own packages, only the SDK and the pure leaves. A core import of an extension's library (the recogniser) would otherwise make it look shared to `check:lazy` and put it in the main chunk unnoticed.
- **`smoke/tests/lazy_extension.smoke.ts`** (Playwright, the built bundle): a cold load fetches no script carrying the ASL node's code and runs no sign reader; picking ASL Viewer fetches it and the reader's output appears in the running graph. And the failure path, for real: the chunk's fetch is aborted, the instrument plays on, the row shows the error with Reload, and the reload comes back on ASL Viewer and reads signs. The code is recognised by content, not by hashed chunk names.
- **`test/lazy_extensions.test.ts`** and **`test/lazy_extensions_ui.test.tsx`**: the registry (declared, pending, shared load, retry, wrong types refused), the app registry (declared until loaded, a rebuilt registry synchronous, a slot naming an unloaded type falls back, a raw stub without its loader refused), the applier (synchronous commit, two rapid switches, a switch away, a failed load and its retry, a loader that never registers, a composition error reported), the load status, the panel placeholder (loading then the component, a failure with Reload, nothing fetched while its section is closed, the row readout's loading and failure), the generated list module.
- **`test/setup/lazy_extensions.ts`** preloads the shipped lazy extensions in every test file, so the many tests that build the full production graph stay synchronous; the lazy path itself is tested with its own extensions.
- The existing guards are unchanged in what they assert: `npm run test:core` (no extension at all), the boundary test (core reaches extensions only through the lists, from the fold points; `src/app/extensionLoad.ts` is a new fold point), the catalog (it lists the ASL nodes as before, through `loadedAppRegistry`).

## Making an extension lazy

1. Split its manifest: a stub module (dials, branches, seeds, `derive`, `provides: [its node types]`, no node import) and a deferred module default-exporting `{ nodes }`. Move any schema a dial needs out of the node modules.
2. Split its React half: a stub default-exporting `{ id, panels: [{ instrumentId, section }] }` and the deferred `ExtensionUi`.
3. Add both deferred halves to its `package.json` `exports` and a `lazy` key to its `extensions.json` entry; run `npm run extensions`.
4. `npm run check:lazy` says whether anything of it is still in the initial chunks.

## The plugin repository

> **As built (2026-10-13, PR B):** ASL lives in its own public repository, [`thorwhalen/thoremin-asl`](https://github.com/thorwhalen/thoremin-asl), split from this one with its history.

- **One root package**, `@thoremin/ext-asl`: an npm git dependency cannot install a sub-directory, so the recogniser is folded in as the extension's library (`src/lib/recognizer`, exported as `@thoremin/ext-asl/recognizer`, its weights beside it) and the training pipeline is `training/`. The SDK packages, `react`, `zod` and `zustand` are peer dependencies the host provides.
- **Pinned by commit**: `package.json` names `github:thorwhalen/thoremin-asl#<sha>` and the lockfile pins it. The repository is public, so `npm ci` fetches it with no token and no SSH key (verified with SSH disabled and an empty cache), on the deploy host and in CI. A new plugin version reaches players only through a thoremin PR that moves the sha (`npm install github:thorwhalen/thoremin-asl#<sha>`) and passes this repository's gates; the plugin's README says how.
- **Host settings for TypeScript source in `node_modules`**, all derived from `extensions.json` by the extensions Vite plugin, so a second external extension needs none of them by name: the shared packages resolve from the host (`resolve.dedupe`: one `@thoremin/sdk-ui`, one React), extension packages are never pre-bundled (`optimizeDeps.exclude`) and are compiled in tests (`test.server.deps.inline`). Three lines per external extension remain by hand, all naming `node_modules/<package>/src`: Tailwind's `@source` in `src/index.css` (it does not scan `node_modules`), and the `include` entries of `tsconfig.dag.json` (with its `.tsx` exclude) and `tsconfig.react.json`. A missed tsconfig line leaves the extension untypechecked, so add all three together.
- **The guards follow the plugin**: `test/helpers/extensions.ts` finds an installed extension's source the way Node does, so the write-path, layering, command-firewall and boundary guards scan the plugin in `node_modules`; `test/packages_purity.test.ts` holds it to the packages it declares (its peer dependencies), like a workspace package; the strict typecheck (its pure `.ts`) and the React type ratchet (all of it; `tsconfig.react.json` empties the default `node_modules` exclude for that) include it; `check_core_bundle` flags `node_modules/@thoremin/ext-*`. The boundary guard now allows `.json` data under an extension's pure paths (the recogniser's weights). `check:lazy` keeps a stub's allowed closure to the root of the extension's `src/` (every sub-directory, `nodes/`, `lib/`, `app/`, `panels/`, is the deferred side), so the folded-in recogniser and the React half stay deferred-only (a stub importing one fails, not just the byte budget). The core theory the plugin builds on (`letterDegree`, `keyName`) keeps its own core test (`test/music_letter_degree.test.ts`).
- **Tests**: the recogniser's parity and replay tests and the chord node's moved with it. The tests that need the host app (`test/asl/instruments.test.ts`, the overlay's `category_overlay.test.ts`) stay here. The plugin's CI runs inside a real thoremin (its commit in place of the pinned one, its tests added to the suite, thoremin's typecheck, suite, build and `check:lazy`).
- **Recovery after a failed load is a page reload**, as above: a browser never refetches a failed `import()` in the same page. That holds for the plugin's chunks exactly as it did in the monorepo.

## Alternatives considered

- **The extension writes its own `import()`** in its stub. Simpler by one indirection, but then whether an extension is lazy is the extension's code, not the build's data, and a third-party stub could make the host fetch anything at boot. Rejected: the manifest is the contract.
- **`React.lazy` for the panels.** It caches a rejected import forever (no retry) and throws into the nearest error boundary, which in this shell is the whole app. The placeholder is about the same size and fails soft.
- **Load on instrument selection** (a hook in the Instruments view). Misses the dial, the palette, the gestures and the assistant, which all reach the same dial. The graph is the one place every path converges.
- **Runtime plugin discovery** (a URL or a registry fetched at run time). No second provider exists; the build-time manifest already makes the set of extensions data. Named, not built (§6 row 4 of the extensions ADR stays the injection point).

## Seams

| # | Seam | Default | Replacement it points at |
|---|---|---|---|
| 1 | where an extension's list entry comes from | `extensions.json`, eager unless `lazy` | the same file naming registry or git packages (ASL since PR B; then any extension) |
| 2 | when a lazy extension loads | when a composed graph names a pending node type | none needed: every request path reaches the graph |
| 3 | how its node code arrives | `registry.declareLazy` + the build's `import()` | the same, for any extension that opts in |

NOT seams: the stub byte budget (a constant in the check), the toast wording, the panel placeholder's look (the shared `LoadStatusReadout`).
