# thoremin architecture review: vertical slices and one extension contract

2026-10-19 · reviewed at `main` 18b742d (read-only) · for the owner and the workers who will execute the plan · tracked by the epic #600

## 0. Summary

thoremin already has an extension system, and a better one than most hobby hosts: a pure manifest plus a React manifest, a build-time `extensions.json`, a "core alone" build that must work with zero extensions, lazy extensions loaded the moment a graph names their nodes, and test-enforced import boundaries. The air instruments, the face categorizers and the external ASL plugin all go through it. The packages layer is clean: no workspace package imports `src/` (0 hits), and the dependency graph between packages is acyclic.

What remains is mostly about the core, not the extensions:

1. **The overlay is closed.** `src/nodes/output/canvas_overlay.ts` (2,300 lines) is one node with 31 fixed input ports and 23 built-in drawing elements. Some of those ports and elements belong to extensions: `airDrumConfig`, `drumHits`, `airFluteStatus`, four categorizer ports, the drum pads, the breath cue. An extension can ask for an existing element to be drawn, but it cannot provide a new one. The chord-layout instrument that is being built right now needs to draw a grid, so it will hit this first.
2. **Built-in features are not slices, and they use a second, hand-wired mechanism.** The conductor's code is in 58 files across 12 directories, the body's in 74, the song's in 32. Extensions contribute status hooks, dial slices and generated `store-controls` ports. The core features do the same jobs by hand: 8 status reporters listed by name in `src/app/useEngine.ts`, 42 hand-written `store-controls` ports, a 14-branch core branch table, 14 dials panels and 8 tools in fixed lists. So adding a core feature costs a walk through every layer, and a core feature cannot be lazy or left out of a build.
3. **Contracts live inside implementations, and several registries are still closed lists in core.** 23 non-node modules make 48 value imports of node implementation files to get a Zod schema or a default. `src/settings/schema.ts` imports the 2,300-line overlay and the 922-line conductor just for their schemas. Separately, the instrument classes, the library's instrument table (`AIR_INSTRUMENTS`, which includes ASL), the carve modalities, the carve commands and the chord selector's three inputs are all fixed lists in core. Adding ASL meant editing core to add the `sign` class.

The target (section 3) is five vertical layers (kernel, contracts, shared domain libraries, feature slices, app shell). Every feature, built-in or external, sits in one slice and contributes through one contract. The contract is the existing `Extension` / `ExtensionUi` pair with nine new contribution points: overlay elements, chord producers, classes, catalog entries, modalities, commands, keybindings, per-slice migrations and declared stores. The pair also gets one host-side contribution registry, so there is a single place where contributions are folded in.

The plan (section 4) has **20 PR-sized steps** in six phases. Guard tests come first, then the seams the in-flight chord instrument needs, then contract/implementation separation (which includes finishing #557), then the remaining contribution points, then moving the built-in features into slices one at a time, then pure tidying moves. Four steps touch stored data (S9 to S12) and follow expand → migrate → contract. Four steps get an independent review (S5, S9, S10, S12).

## 1. Terms used below (for a Python reader)

- **Module**: one `.ts` file; its `import`/`export` lines are its dependencies, as in Python. A **barrel** is an `index.ts` that re-exports many modules, like a package `__init__.py` that imports everything; importing from it loads them all.
- **Type-only import** (`import type {...}`): erased at compile time, like an `if TYPE_CHECKING:` import. It costs nothing at runtime, but it still says which way the concepts depend.
- **Zod schema**: a runtime-validated type, the role pydantic plays in Python. Here it is the single source of truth for settings and node params.
- **React component / hook**: a component is a function that returns UI (written in JSX, HTML-like syntax inside TS). A hook (`useX`) is a function that only runs inside a component and gives it state or effects.
- **zustand store**: a small global state container (think one module-level object with subscribe/notify), here the hot store the graph reads every tick. Its `persist` middleware saves part of it to localStorage under a version number, with a `migrate(blob, version)` function, which is the same idea as an Alembic migration chain.
- **Vite virtual module / dynamic `import()` / chunk**: the bundler can generate a module at build time (here, the extension list from `extensions.json`). `import()` loads a module on demand from a separate file (a **chunk**), which is how lazy extensions arrive. It is close to `importlib.import_module` on first use.
- **Workspace package**: a directory under `packages/` with its own `package.json`, linked into `node_modules` the way `pip install -e` links a local package.
- **jsdom**: a simulated browser DOM in Node, for testing components without a browser.

## 2. What mature plugin hosts do (research)

### 2.1 Seven hosts, one pattern

| Host | How an extension says what it contributes | How the host stays ignorant | When code runs | Lesson for thoremin |
|---|---|---|---|---|
| VS Code [1][2][3] | `package.json` `contributes`: about 30 typed contribution points (commands, menus, keybindings, views, settings, languages...) as **static data** | the workbench reads the manifests and renders menus, palettes and settings from data alone; extension code runs in a separate host process | **activation events** (`onCommand:x`, `onLanguage:y`, `onView:z`); declared commands show up before the code is loaded | declare everything as data; load code only when it is used; even a lazy extension's commands are listed |
| Obsidian [4][5][6] | imperative: a `Plugin` subclass calls `addCommand`, `registerView`, `addSettingTab`, `registerEvent` in `onload()` | the API (`obsidian.d.ts`) is the only surface; each `register*` call returns something the host disposes on `onunload` (`Component` lifecycle) | at startup, or deferred | cleanup belongs to registration (a disposer), not to the plugin remembering what to undo |
| Figma [7][8] | `manifest.json`: `editorType`, `capabilities`, `permissions`, `networkAccess` | plugin code runs in a sandbox with a narrow API; UI runs in an iframe and talks to it by messages | on user invocation | a narrow, versioned host API is what lets the host evolve without breaking plugins |
| Grafana [9][10][11] | plugin types (panel, datasource, app); **UI extensions**: a host or plugin exposes named *extension points*, and others add links, components or functions to them. Every one must also be listed in `plugin.json` ("components that are not listed here won't work") | the extension point is a string id plus a typed context; the host renders whatever registered against it | lazy, by app plugin preload settings | an extension point is an id plus a typed context; requiring declarations means the host can list and check them without running code |
| webpack / tapable [12][13] | `plugin.apply(compiler)` taps named hooks (`SyncHook`, `SyncWaterfallHook`, `AsyncSeriesHook`) | the compiler only calls `hooks.x.call(...)`; it never knows who tapped | build time | hooks with typed signatures and a combination rule (waterfall, bail, parallel) are the right model when contributions must **combine** |
| Backstage [14][15][16] | new frontend system: an *extension* has an id, an **attachment point** (`{ id: parent, input: name }`), typed inputs and outputs; *blueprints* are reusable kinds; the app config can enable, disable or re-attach any extension | "an extension will only have access to the data that it has explicitly requested from each input"; attaching to an input that needs data the extension does not output is an error | app assembly | typed fan-in: a parent declares an input, children attach to it, the host checks the types. This is exactly what thoremin's overlay and chord selector lack |
| Eclipse / OSGi [17][18] | `plugin.xml` declares *extension points* (with a schema) and *extensions* to other plugins' points; OSGi bundles declare `Import-Package` / `Export-Package` | the extension registry is data; bundles see only what other bundles export | lazy activation on first class load | the extension point owner publishes a schema; dependencies between plugins are declared, not discovered by import |

Python has the same two halves: **entry points** in package metadata [19] (declaration as data, discovered without importing) and **pluggy** hookspecs/hookimpls [20] (pytest's plugin system: typed hooks, with combination rules such as `firstresult`). thoremin's `extensions.json` is the entry-point half; what it lacks is pluggy's idea of typed combination at every place contributions meet.

Six rules these hosts share:

1. **Contributions are declared as data, and declaration is separate from code.** The host can list, validate, search and lay out contributions without running extension code.
2. **The host owns activation.** It decides when code loads, triggered by a declared event. thoremin does this already: a graph names a node type, or a tool opens.
3. **Every meeting point is a named, typed extension point with a combination rule**: list (menus), keyed map (settings), ordered waterfall (tapable), first result wins (pluggy), typed input with attachment (Backstage).
4. **Ids are namespaced and the host checks clashes once**, in one registry, not at every fold.
5. **The built-in features use the same contract.** VS Code's own git, markdown and TypeScript support are extensions in its `extensions/` directory [21]. If the core uses a private back door, the public contract falls behind.
6. **Extensions depend on a narrow host API and on each other by declaration** (OSGi imports, Grafana `dependencies.extensions`), never by importing the host's internals.

### 2.2 Vertical slices versus horizontal layers

Horizontal layering puts all presentation in one tier, all domain logic in the next and all data access below [22]. It keeps the direction of dependencies clear. Its cost is that one feature is spread across every tier, so a change to that feature touches every tier. Vertical slice architecture [23] cuts the other way: each feature owns its code from UI to storage and couples to other features as little as possible. Feature-Sliced Design [24] combines the two for frontends: layers (`app` > `pages` > `widgets` > `features` > `entities` > `shared`) with the rule that a module imports only from layers below it, and slices inside each layer that do not import each other. Clean Architecture's dependency rule [25] says the same thing at the centre: source dependencies point inward, toward the policy, never toward the delivery mechanism. Parnas [26] gives the reason underneath all of these: decompose by the decisions that are likely to change, and hide each decision in one module. In thoremin, "which instruments and modalities exist" is the decision that changes most often.

The synthesis for thoremin: **layers between slices, slices within the feature layer.** The kernel, the contracts and the shell are horizontal layers with a strict downward rule. Every feature (conductor, body, air, chords...) is a vertical slice in the feature layer, owns its nodes, branches, settings, panels, commands and overlay elements, and reaches other slices only through declared contracts. A Python analogue would be a project where `core/` defines protocols and abstract base classes, each feature is a separate distribution registering through entry points, and `app/` is the composition root that imports them all.

## 3. The current architecture, with evidence

### 3.1 Layers as built

```
packages (all TS source, linked as workspaces)          src/ (the app)
---------------------------------------------           ------------------------------------------
dag     (0 internal deps)    stats (0)   lazy (0)        nodes/{sources,features,mapping,music,output}
taglog  (0)                  ictus -> stats              music/, features/, instruments/, score/, latency/, keys/
sdk     -> dag, lazy, stats  (pure: contracts + shared   settings/  (core settings schema + dials)
                              domain libs, 68 files)     extensions/ (the list module, a fold point)
sdk-ui  -> dag, sdk          (React half + host seams)   app/  (76 entries: shell + every feature's UI)
ext-air   -> dag, ictus, sdk, sdk-ui, stats              plugins/assistant (live), plugins/ai-dj (frozen)
ext-faces -> dag, sdk, sdk-ui, stats                     App.tsx, components/, hooks/ (frozen legacy)
ext-asl  (git dependency, pinned by sha; lazy)
```

Sizes: `src/` 321 files and 48.9k lines; `packages/sdk` 17.0k; `ext-air` 8.8k; `ext-faces` 8.5k; `ictus` 7.7k; `dag` 2.0k.

What is already enforced, and should be kept: `test/packages_purity.test.ts` (a package imports only itself and its declared dependencies), `test/layering.test.ts` (dag, nodes, music, settings, keys and extension nodes never import `@/app` or `@/plugins`), `test/commands_firewall.test.ts` (commands never reach the DAG or hot store), `test/extensions_boundary.test.ts` (core reaches extensions only through the list, from 15 named fold points), `test/dials_write_path.test.ts`, `npm run test:core` (core alone), `npm run check:lazy` (deferred halves are not in the initial chunks), and the React type ratchet. This is unusually strong guarding. The plan adds to it and loosens nothing.

### 3.2 Violations, ranked by harm

Harm means how much each one costs the owner's goal: a new instrument or modality added without touching core.

| # | Finding | Evidence | Harm |
|---|---|---|---|
| V1 | **The overlay is a closed node.** Extensions can name elements but not provide them; extension-specific ports and drawing live in core. | `canvas_overlay.ts`: 2,300 lines, 31 input ports including `airDrumConfig`, `drumHits`, `airFluteStatus`, `categories`, `categoryCaptions`, `learnedCategories`, `chordCategories`, `categorizerChord`, `categoryDegrees`, `conductorTime`; 23 elements including `drumPads` (29 drum references), `mouthCue` (the flute's breath cue), `categoryBars`, `categoryLabel`, `conductorHud`. `GraphBranch.overlay` only names element ids that core already defines. The element show flags (`overlay.drumPads.show`, `overlay.mouthCue`) are saved inside every instrument. | **High.** Every visual instrument edits core. The chord-layout worker will hit this today. |
| V2 | **Built-in features are spread horizontally and use a private mechanism.** | Files mentioning each feature, outside tests: conductor 58 files in 12 directories (`src/app` 20, `nodes/features` 7, `app/commands` 6, `nodes/output` 5, `app/dials` 5, `nodes/music` 4, ...); body 74 in 16; song 32 in 11; orchestra 24. `useEngine.ts` hand-imports 8 status reporters (face, midi, generative, timing, conductor, orchestra, song, gesture) next to the generic `extensionStatusHooks`. `store_controls.ts` has 42 hand-written ports next to the generated extension ports. `src/instruments/branches.ts` has 14 core branches (`conductor`, `song-pace`, `body-route`, `generative`, `midi-out`, ...). There are 14 dials panels and 8 tools in fixed lists. | **High.** A core feature costs a pass through every layer, cannot be lazy, and cannot be left out of a build. It also means the extension contract is never exercised by the code the team writes most. |
| V3 | **Contracts are inside implementations.** To get a schema you import the node. | 48 value imports from 23 non-node modules into node implementation files. The most imported are `body_map`, `indirect_map`, `hand_map`, `canvas_overlay` and `conductor` (5 each) and `face_controls` (4). `src/settings/schema.ts` imports `canvas_overlay.ts` (2,300 lines), `conductor.ts` (922) and `orchestra.ts` for schemas. `src/app/store.ts` imports the `@/nodes` barrel (the whole core node library) for `FACE_MAPPINGS`, which is already in the SDK. The lazy-extensions ADR hit the same thing for ASL: it had to move the `asl` dial schema out of the node module. | **Medium-high.** It blocks lazy core features, drags drawing code into anything that reads settings, and hides the real contracts. |
| V4 | **Closed registries in core.** | `src/instruments/classes.ts` `INSTRUMENT_CLASSES` (`field`, `air`, `sign`; `sign` was added in core for the external ASL plugin). `src/app/library/category.ts` `AIR_INSTRUMENTS` (labels, emoji, `usesScale`, the dial each reads), with the ASL row hard-coded. `packages/sdk/src/features/modalities/index.ts` `CARVE_MODALITIES` (face, hand, body). `src/app/commands/carve.ts` and `carveHost.ts` (the faces extension's commands, in core). `chord-select` has three fixed inputs `a`, `b`, `c`, and the overlay's comment says "the selector's three inputs are taken". `synth-merge` pools are fixed at 8 instrument plus 2 score voices. | **Medium-high.** Each one means a core PR for every new instrument or modality. |
| V5 | **Fold points are scattered.** | `FOLD_POINTS` in `test/extensions_boundary.test.ts` lists 15 files in 4 directories (`src/nodes/browser.ts`, `src/settings/{schema,dials}.ts`, `src/app/graph.ts`, `useEngine.ts`, `App.tsx`, `DialsControlsPanel.tsx`, `InstrumentsPanel.tsx`, `shellTools.ts`, ...). Each re-does "iterate extensions, merge, check for id clashes". | **Medium.** Every new contribution point becomes another ad hoc fold. |
| V6 | **Directory-level dependency cycle: nodes and settings, and the node library knows the composition root.** | `src/nodes/sources/store_controls.ts` imports `@/settings/schema`, which imports `nodes/{mapping,features,output}`. `src/nodes/browser.ts` imports `@/extensions` (the list). `store-controls` is a host adapter (store to graph), not a domain node. | **Medium.** It is the reason the schema problem (V3) cannot be fixed piece by piece; it is also why `layering.test.ts` has to list `src/settings` as "core". |
| V7 | **The hot store holds several concerns; extensions have no migration hook.** | `src/app/store.ts`: 904 lines. `ControlState` mixes preset dials (saved in instruments), per-device prefs (`audioPrefs`, `songPrefs`, `conductorPrefs`, `gestures`, `featureLab`, `trainerHud`) and session state (`muted`, hush claims, transient models). It also holds a 26-version migration chain and the heal rules. Extension dials are healed by a fold, but a dial slice has no versioned transform: an extension that renames a field must edit core's `CONTROLS_MIGRATIONS`. There are about 37 storage keys with two naming styles (`thoremin-x`, `thoremin.x`) and no registry, and extensions pick their own provider (`localStorageCollectionProvider` in `ext-faces`). | **Medium.** This is where refactors can lose a player's data. |
| V8 | **Giant files.** | `canvas_overlay.ts` 2,300; `ext-faces/src/app/sessionStore.ts` 1,779; `ext-air/src/nodes/air_drum.ts` 1,307; `nodes/features/conductor.ts` 922 (`make()` is still about 490 lines after #593 and #594); `app/store.ts` 904; `app/dials/InstrumentsPanel.tsx` 849; `app/TrainerPanel.tsx` 758 (28 store reads and writes inside one component, so UI and orchestration are mixed). | **Medium per file**; most dissolve once V1, V2 and V7 are fixed. |
| V9 | **A flat `src/app`.** | 76 entries mixing the shell (`App`, `ToolsBar`, `Toaster`, `shellLayout`) with every feature's panels, status stores and hosts (`ConductorPanel`, `conductorLead`, `conductorLeadHost`, `conductorStatus`, `SongPanel`, `songStatus`, `TrainerPanel`, `GesturesPanel`, `gestureDispatch`, ...). `src/app/dials` imports `src/app` root 37 times. | **Low-medium.** It makes the code hard to navigate, and it is what slicing (V2) fixes. |
| V10 | **File-level import cycles.** | `madge --circular` finds 10. Seven are type-only (harmless at runtime, but each one is a type defined in the wrong module): conductor with `conductor_hands` and `conductor_shaping`, orchestra with `orchestra_engine`, `song_player` with both stretchers, `webcam_hands` with `hand_runner`. Three are runtime value cycles: `lyria_engine` and `lyria` (`LYRIA_KEY_PROVIDER`), `midi_engine` and `midi_out` (`webMidiSupported`), sdk-ui `dials` and `host`. A fourth is in the frozen legacy `PluginProvider`. madge treats `@thoremin/*` as external, so it cannot see cross-package cycles; the `packages_purity` test covers those. | **Low.** |
| V11 | **Two "plugin" vocabularies.** | `src/plugins/` holds the frozen legacy `PluginProvider` and AI-DJ, and also the **live** AI assistant, which imports `@/app/commands`, `@/app/toolsStore` and `@/app/dials/settingsStore`. Meanwhile "extension" is the real plugin system. | **Low.** It confuses newcomers, and the assistant is a live feature filed under a frozen directory. |
| V12 | **Odd edges from domain nodes.** | `nodes/output/lyria*.ts` import `src/keys/providerKeys` (the API-key store) directly. `canvas_overlay.ts` imports `src/enroll/hud` and `src/features/lab{Meters,Correlation,Config}`. | **Low.** Each should be a resource the host injects. |

What is **not** a problem: the packages layer (0 imports of `src/`, acyclic); the command write path (one write path, enforced); lazy loading (well designed, guarded by `check:lazy` and a smoke test that aborts the chunk download on purpose); the frozen legacy app, which is fenced and correctly left alone.

### 3.3 The extension interface today

| Contribution | Supported? | Declared in | Folded at |
|---|---|---|---|
| Node types (eager or lazy) | yes | `Extension.nodes` / `provides` + `load` | `src/nodes/browser.ts` `createAppRegistry` |
| Graph branches and their derivation from settings | yes | `Extension.branches`, `derive` | `src/app/graph.ts` |
| Settings (whole-object dials, typed into `Settings`) | yes | `Extension.dials` (`DialSlice`) | `src/settings/{schema,dials}.ts`, the store |
| Transient hot-store fields as graph inputs | yes | `Extension.transient` | `store-controls` (generated ports) |
| Shipped instruments (settings patches) | yes | `Extension.instruments` | `src/app/dials/instruments.ts` |
| Training routes | yes | `Extension.training` | `src/app/training/routes.ts` |
| Editor sections per instrument | yes | `ExtensionUi.panels` (lazy: `ExtensionPanelDecl`) | `DialsControlsPanel.tsx`, `InstrumentsPanel.tsx` |
| Status hooks (node output to React store) | yes | `ExtensionUi.statusHooks` | `useEngine.ts` |
| Mount effects | yes | `ExtensionUi.onMount` | `App.tsx` |
| Shell tools and entry points between tools | yes | `ExtensionUi.tools`, `entryPoints` | `shellTools.ts`, `ExtensionToolPanels.tsx` |
| Per-dial commands, palette, AI tools | yes, for free | generated from the dial schemas | the command registry |
| **Overlay elements and their input ports** | **no** | | core `canvas_overlay.ts` |
| **Chord producers (fan-in into `chord-select`)** | **no** (3 fixed inputs) | | core `chord_select.ts` |
| **Voice pool size** | fixed 8 + 2 | `GraphBranch.voices` allocates within it | core `synth_merge.ts` |
| **Instrument classes** | **no** (`classes?` was in the ADR sketch, never built) | | core `classes.ts` |
| **Library catalog rows** (label, emoji, scale use, which dial means "on") | **no** | | core `AIR_INSTRUMENTS` |
| **Carve modalities** | **no** | | sdk `CARVE_MODALITIES` |
| **Named commands, keybindings** | **no** (only per-dial ones) | | core `app/commands/*`, `keyboardShortcuts.ts` |
| **Versioned settings migrations per slice** | **no** (heal only) | | core `CONTROLS_MIGRATIONS` |
| **Per-device prefs** | **no** (core fields only) | | core `ControlState` |
| **Named stores (collections) with a host-chosen provider** | partial (sdk-ui facades; the extension picks the provider) | | each extension |
| **Host resources** (`ctx.resources` keys a node reads) | **no** | | `useEngine.ts` by hand |

Names of extensions that still appear in core code (outside tests): air 149 lines in 28 files (top: `app/library/category.ts` 14, `canvas_overlay.ts` 10, `app/enroll/realVsAirCues.ts` 9, `TrainerPanel.tsx` 7, `app/enroll/store.ts` 6, `app/store.ts` 5, mostly in comments); faces/categorizer/carve about 195 lines in 48 files (top: `app/enroll/categoryBinding.ts` 38, `app/commands/carve.ts` 22, `app/enroll/boundSets.ts` 17, `commands/carveHost.ts` 17, `canvas_overlay.ts` 15); ASL 27 lines in 8 files (`category.ts` row, `classes.ts` `sign`, `chord_select.ts` input `c`, the overlay's category cues, plus `src/index.css` `@source` and the tsconfig includes the lazy ADR lists as hand-kept).

## 4. Target architecture

### 4.1 Five layers, slices in the fourth

```
L4  APP SHELL (composition root)      src/app/shell, src/app/host
    the engine host (useEngine), the contribution registry, the store and persistence host,
    the shell layout and its frames, the command registry host. Knows the LIST of slices,
    never a slice by name.
        |  imports L0..L3 through the registry only
L3  FEATURE SLICES (vertical)         src/slices/<id>/ (in-tree, built-in)  or  packages/ext-<id> / git
    field (core instrument: trunk-adjacent voice mapping), face, body, conductor, song+orchestra,
    generative, midi, trainer, lab, recording/tagging   |   air, faces (carve), asl, chords ...
    each = one Extension + one ExtensionUi; imports L0..L2 and other slices' declared contracts only
        |
L2  SHARED DOMAIN LIBRARIES (pure)    @thoremin/sdk/{music,features,enroll,score,timing}, ictus, taglog
        |
L1  CONTRACTS                         @thoremin/sdk (pure: port kinds, schemas, Extension, GraphBranch,
                                      contribution types)   @thoremin/sdk-ui (React contribution types,
                                      host seams, panel primitives)
        |
L0  KERNEL                            @thoremin/dag, stats, lazy
```

UI is not a separate layer. Each slice's React half sits in the slice and depends only on `sdk-ui`. The shell's UI is the frame: the layout, the tools bar, the tool frames and the editor's section container.

The dependency rule: a module may import only from its own slice and from lower layers. A slice may use another slice's **contract module** only if it declares that slice in `requires` (as an OSGi `Import-Package` does). For example, the conductor reads the body slice's `body-frame` port kind, which lives in L1, and so needs no import of the body slice at all. Built-in slices use exactly the same contract as external ones (rule 5 of §2.1). `npm run test:core` then proves that the shell plus the trunk run with no slice. The trunk stays in the shell's own minimal slice: `webcam-hands`, `hand-features`, `store-controls` (moved from `src/nodes` to `src/app/host`), `synth-merge`, `webaudio-synth`, `canvas-overlay` and `field` voices.

### 4.2 One contract with contribution points

Additive changes to the two existing interfaces. The names stay, so this is an expand and not a rewrite. The two halves stay too, for the reasons the lazy ADR gives: the strict typecheck must not read React, and a lazy extension's eager stub must stay data only.

```ts
// @thoremin/sdk/instruments/extension.ts (PURE half). NEW marks additions.
export interface Extension<D extends readonly DialSlice[] = readonly DialSlice[],
                           Tr extends readonly TransientPort[] = readonly TransientPort[]> {
  id: string;                                     // also the namespace for new ids: `${id}/${name}`
  apiVersion?: 1;                                 // NEW: the contract version; the host refuses a newer one
  requires?: readonly string[];                   // NEW: slices this one builds on (ordering + core-alone check)

  // graph (unchanged)
  nodes?: readonly NodeDef<unknown>[];
  provides?: readonly string[];
  load?: () => Promise<ExtensionNodes>;           // ExtensionNodes gains overlayElements (below)
  branches: readonly GraphBranch[];               // GraphBranch gains `chords` (below)
  derive: (settings: ExtensionDerivationSettings) => readonly string[];

  // settings and state
  dials: D;                                       // DialSlice gains version + migrations (below)
  prefs?: readonly PrefSlice[];                   // NEW: per-device prefs, never saved in an instrument
  transient?: Tr;
  stores?: readonly StoreDecl[];                  // NEW: collections the HOST provides (provider injected)

  // library
  instruments?: readonly ExtensionInstrument[];
  classes?: readonly InstrumentClass[];           // NEW: replaces core's closed INSTRUMENT_CLASSES rows
  catalog?: readonly CatalogEntry[];              // NEW: replaces AIR_INSTRUMENTS rows
  training?: ExtensionTraining;

  // modalities and overlay (declarations only: drawing code is in the node half)
  modalities?: readonly CarveModality[];          // NEW: folds into CARVE_MODALITIES
  overlay?: readonly OverlayElementDecl[];        // NEW: names, categories, input ports, config schema

  // actions (declared as data so a lazy extension's commands are listed before it loads)
  commandDecls?: readonly CommandDecl[];          // NEW: id, title, params schema; executing loads the slice
  keybindings?: readonly KeybindingDecl[];        // NEW
}

export interface DialSlice<K extends string = string, S extends z.ZodTypeAny = z.ZodTypeAny> {
  key: K; schema: S; kind: string; meta: { facets: string[]; title: string; description: string };
  version?: number;                               // NEW: this slice's own schema version (default 1)
  migrations?: Readonly<Record<number, (old: unknown) => unknown>>; // NEW: [n] takes v(n) -> v(n+1)
  legacyKeys?: readonly string[];                 // NEW: settings keys this slice adopts on read (expand step)
}

export interface OverlayElementDecl {
  name: string;                                   // unique per extension; the host namespaces it
  category: 'input' | 'output' | 'guide' | 'backdrop';
  cue?: boolean;                                  // a HUD cue (laid out at an edge) vs an in-scene drawing
  inputs: readonly { name: string; kind: string }[]; // become generated overlay ports: `${ext}.${element}.${name}`
  config?: { dialKey: string };                   // which of the extension's dial slices holds its show/options
}

export interface ExtensionNodes {
  nodes: readonly NodeDef<unknown>[];
  overlayElements?: readonly OverlayElementImpl[]; // NEW: drawing code, loaded with the nodes
}

export interface OverlayElementImpl {
  name: string;                                   // matches a declared OverlayElementDecl
  /** Sees ONLY its declared inputs, its config and the frame geometry (Backstage's rule). */
  draw(g: CanvasRenderingContext2D, view: OverlayFrame, inputs: Readonly<Record<string, unknown>>, config: unknown): void;
  measure?(view: OverlayFrame, inputs: Readonly<Record<string, unknown>>, config: unknown): { w: number; h: number } | null;
}

// GraphBranch (Zod, sdk/instruments/branch.ts) gains a second fan-in pool beside `voices`:
//   chords: [{ from: PortRef, priority: number }]
// The composer allocates `chord-select` inputs by priority, as it allocates voices into synth-merge.

export interface CatalogEntry {                   // a row of the Instruments view, derived, never stored
  id: string; label: string; emoji: string; class: string; usesScale: boolean;
  on: (settings: ExtensionDerivationSettings) => boolean;
}
export interface PrefSlice { key: string; schema: z.ZodTypeAny; version?: number;
  migrations?: Readonly<Record<number, (old: unknown) => unknown>> }
export interface StoreDecl { name: string; schema: z.ZodTypeAny; legacyKey?: string } // host key: thoremin.ext.<id>.<name>
export interface CommandDecl { id: string; title: string; description: string; category: string; params: z.ZodTypeAny }
export interface KeybindingDecl { key: string; command: string; when?: string }
```

```ts
// @thoremin/sdk-ui/types.ts (React half). NEW marks additions.
export interface ExtensionUi {
  id: string;
  panels: readonly ExtensionPanel[];
  statusHooks: readonly StatusHook[];
  onMount: readonly (() => void | (() => void))[];   // each returns its disposer (Obsidian's rule), unchanged
  tools?: readonly ExtensionTool[];
  entryPoints?: readonly ToolEntryPointDecl[];
  commands?: readonly AnyCommand[];                // NEW: the acture command implementations for commandDecls
  resources?: readonly ResourceProvider[];         // NEW: ctx.resources entries the host installs (trainer HUD, tag overlay...)
}
```

On the host side, one module, `src/app/host/contributions.ts`, folds every contribution once, in a fixed order (core first, then extensions in `extensions.json` order, then `requires` order). It namespaces ids, refuses clashes with an error that names both extensions, and exposes typed read-only views: `registry.nodes`, `.branches`, `.dialSlices`, `.overlay`, `.commands`, and so on. Every other module reads from it. This is the single fold in Grafana's or VS Code's sense, and `FOLD_POINTS` shrinks to it plus the React list.

The combination rules, explicit for each point: nodes, branches, classes, catalog rows, modalities, commands and keybindings are **keyed maps** (a clash is an error). Instruments, tools and panels are **ordered lists**. Overlay elements are an **ordered list by category**, where list order is the z-order, as today. Voices and chords are **pools** allocated by the composer. A dial's migrations form a **chain** for that slice.

Two seams that are not new, written down so nobody rebuilds them: activation (lazy load when a graph names a type or a tool opens, `docs/design/lazy-extensions.md`), and the build-time list (`extensions.json`). A runtime plugin URL loader is still not a seam, for the reason the lazy ADR gives: there is no second provider.

### 4.3 Worked example: a chord-grid instrument with no core edit

Once phases B to D have landed, `@thoremin/ext-chords` (or the chord-layout worker's package) is one directory:

- `src/stub.ts` (eager): `dials: [dialSlice({ key: 'chordGrid', schema: ChordGridSchema, ... })]`, `branches: [chordGridBranch]` with `voices: [{ from: {node:'grid', port:'voices'}, role:'instrument' }]` and `chords: [{ from: {node:'grid', port:'chord'}, priority: 40 }]`, `overlay: [{ name: 'grid', category: 'guide', inputs: [{ name: 'layout', kind: 'chord-grid-layout' }, { name: 'pointer', kind: 'grid-pointer' }], config: { dialKey: 'chordGrid' } }]`, `catalog: [{ id: 'chord-grid', label: 'Chord grid', emoji: '...', class: 'field', usesScale: true, on: s => s.chordGrid?.enabled === true }]`, `instruments: [...]`, `commandDecls: [{ id: 'chords/key.next', ... }]`, `keybindings: [{ key: 'k', command: 'chords/key.next', when: 'instrument:chord-grid' }]`, `provides: ['chord-grid']`.
- `src/lazy.ts` (deferred): `nodes: [chordGridNode]`, `overlayElements: [gridElement]`.
- `src/ui.ts` / `src/lazy_ui.ts`: the editor section, a status hook, the command implementations.
- One line in `extensions.json`.

The core grows no port, element, class row, catalog row, command or key. The chord display (`chordName`, `chordGuide`) highlights the grid's chord because `chord-select` received it from the pool. `test:core` stays green and `check:lazy` proves the grid code is deferred.

Today, the same instrument needs core edits for the drawing (V1), a fourth `chord-select` input (V4), possibly a class, a catalog row (V4) and any named command (V4).

## 5. The refactor plan

Twenty PR-sized steps in six phases. They are ranked: an earlier step either unblocks a later one or protects it. Every step leaves `npm run typecheck`, `npm test`, `npm run build`, `npm run test:core`, `npm run check:lazy` and the React ratchet green, and regenerates the catalog when a node or port changes. "Golden" means the existing `test/fixtures/graph/default_graph.*.json` and `test/conductor_golden.test.ts`.

Stored data is touched by S9, S10, S11 and S12. Those follow expand → migrate → contract and name each phase explicitly. Independent review (per the standing rule: only where data, deletion or the hot path is at stake) is required for S5, S9, S10 and S12.

### Phase A: guards first (tests only)

**S1. Architecture fitness ratchet and a probe extension.**
Scope: `test/architecture_ratchet.test.ts` and a committed baseline (`test/architecture.baseline.json`); `test/fixtures/ext-probe/` (a test-only extension that uses every contribution point that exists today: an eager node, a lazy node, a branch with a voice, a dial slice, a transient port, a seed, a panel, a status hook, a tool, an entry point); `test/ext_probe.test.tsx`.
The ratchet counts: value imports from non-node modules into node implementation files (48 today); core files that name a shipped extension's identifiers (air 28, faces 48, asl 8); hand-written `store-controls` ports (42); hand-wired reporters in `useEngine.ts` (8); `FOLD_POINTS` (15); madge cycles outside the frozen legacy (9); lines in the five largest files. Like the React type ratchet, a number may only go down, and the PR that lowers one updates the baseline.
Acceptance: the ratchet is green at today's numbers. The probe composes into a graph headlessly, its panel renders in jsdom, and its status hook receives ticks. A probe built with `THOREMIN_EXTENSIONS` naming only it passes `test:core`'s bundle check.
Missing higher-level test this writes: no test today proves that an extension **from outside the shipped list** reaches every contribution point. The probe is that test, and each later step adds its new point to the probe first, so each new point is tested before core relies on it.
Risk: low. Review: no. Conflicts: none.

**S2. Golden persisted state.**
Scope: `test/fixtures/persisted/controls.v{1..26}.json` (one representative blob per historical version, built from the documented history in `store.ts`; v14 to v20 include the air keys), a saved-instruments library blob and a tagged library blob; `test/persisted_golden.test.ts`. Each blob goes through the real `persist` rehydrate path (`migrateControls` then `mergeControls` and the heal rules) and the instruments seeder, and the test snapshots the resulting `ControlState` and resolved instruments.
Acceptance: a snapshot for every version, committed. Any later change to what a returning player gets fails the test loudly.
Missing higher-level test this writes: today each migration step is tested on its own (`app_store`, `store_heal_rules`, `conductor_prior_migration`, `instrument_hush`, `feature_lab_config`), but no test runs a real old blob through the whole chain plus heal plus seeding. Phases C to E move state between modules, so this must exist first.
Risk: low. Review: no. Conflicts: none (it reads the store and does not edit it).

### Phase B: the seams the in-flight chord instrument needs

**S3. One contribution registry.**
Scope: new `src/app/host/contributions.ts`. The 15 fold points read from it: `src/nodes/browser.ts`, `src/settings/{schema,dials}.ts`, `src/app/graph.ts`, `src/app/dials/instruments.ts`, `DialsControlsPanel.tsx`, `InstrumentsPanel.tsx`, `src/app/training/routes.ts`, `useEngine.ts`, `App.tsx`, `extensionLoad.ts`, `shellTools.ts`, `ExtensionToolPanels.tsx`, `entryPoints.ts`. Namespacing and clash detection move here and are tested once. `extensions_boundary.test.ts` `FOLD_POINTS` becomes the registry plus the React list.
Acceptance: `FOLD_POINTS` has at most 2 entries; golden graphs, the catalog and the core-alone bundle check are unchanged byte for byte; a clash test (two probe extensions declaring the same dial key or node type) fails with both ids in the message.
Tests that protect it: `extensions_boundary`, `extensions_manifest_checks`, `lazy_extensions*`, `app_graph`, `tools_shell`, `app_shell`, S1's probe.
Risk: medium (many files, but mechanical). Review: no. Conflicts: the chord worker probably edits `extensions.json` and maybe a fold point, so land S3 quickly or rebase it after the chord PR. #570 may touch `useEngine.ts` resource wiring; rebase whichever lands second.

**S4. Chord producers as a pool; voice pools sized from contributions.**
Scope: `GraphBranch.chords` (sdk `branch.ts`); `src/instruments/compose.ts` allocates `chord-select` inputs `chord1..N` by priority, the same way it allocates voices; `src/nodes/mapping/chord_select.ts` becomes `makeChordSelectNode(n)` with ports generated at registry build; `synth-merge` pool sizes become the maximum the contributions can compose (at least today's 8 plus 2). The face, pose and ASL chord branches declare `chords` instead of wiring `a`, `b`, `c`; the ASL change is a `thoremin-asl` PR plus a sha bump, and until then core keeps accepting the edge to `c` as an alias of the lowest priority.
Acceptance: golden graphs equal today's with chord inputs compared by role, the method PR 1 of the instruments ADR used for the merge; the probe adds a fourth chord producer with no core edit; `chord_select` and `synth_merge` tests are unchanged in what they assert.
Risk: medium (the composer). Review: no (golden-protected). Stored data: none (graphs are composed, not saved). Conflicts: the chord-layout worker needs exactly this. Tell it to declare `chords` once S4 lands, or to keep any temporary `chord-select` edit in one commit that S4 replaces.

**S5. Overlay elements as a contribution point (expand).**
Scope: `OverlayElementDecl` (sdk) and `OverlayElementImpl` (with `ExtensionNodes`); `canvas_overlay.ts` becomes `makeCanvasOverlayNode(elements)`, whose ports are core ports plus `${ext}.${element}.${input}` for each declared element. An element receives only its declared inputs and its config, read from the extension's own dial slice. Lazy elements arrive with the deferred node half, so a frame before the load simply does not draw them. Branches name the generated ports in their edges and the element in `overlay`.
Acceptance: the probe draws an element from a new input port, checked in a headless test with a recording 2D context (the pattern of `overlay_elements.test.ts`); `test:core`'s overlay has no extension port; `overlay_elements`, `feature_lab_overlay` and `tag_hud_overlay` tests are unchanged; the per-frame cost of an absent element is one map lookup (assert it is not called).
Risk: medium-high. This is the per-frame drawing path, and lazy timing interacts with it. **Review: yes.** Stored data: none yet (core elements keep their keys). Conflicts: this is the seam the chord-layout worker needs most. If its PR lands first with a core port, S6 migrates that port like the air ones.

### Phase C: contracts importable without implementations

**S6. Contract modules beside nodes; `store-controls` moves to the host.**
Scope: for each node whose schema or defaults are imported outside `src/nodes` (`canvas_overlay`, `hand_map`, `body_map`, `indirect_map`, `face_controls`, `orchestra`, `song_player`'s `SongHandle` type, `keyboard`; the conductor is done in S7), add `<node>.schema.ts` with the Zod schema, defaults and types. The node imports its schema, and nothing outside imports the node. `src/nodes/sources/store_controls.ts` moves to `src/app/host/storeControls.ts`, which breaks the nodes and settings cycle (V6). `store.ts` imports `FACE_MAPPINGS` from the SDK instead of the `@/nodes` barrel. The three runtime cycles of V10 are cut by moving the shared constant into the lower module.
Acceptance: the ratchet's "imports of node implementations from outside" falls from 48 to 0, apart from the conductor which S7 handles; `layering.test.ts` gains the rule "src/settings imports no node implementation" and drops `src/settings` from the core list once it no longer needs to be there; main-chunk size equal or smaller (`check:lazy` prints it); madge cycles go from 9 to at most 6 (the type-only conductor ones are left for S7).
Risk: low (mechanical moves). Review: no. Conflicts: the chord worker if it edits `canvas_overlay.ts`; #570 does not touch these files.

**S7. Finish #557: conductor follower core and conductor contract.**
Scope: `src/nodes/features/conductor.ts`. #593 moved the expression, score-document and fermata state out of `make()`, and #594 moved the dance lead and transport. What is left in `make()` is the follower core (`coreKey`, `levelBpb`, the speed envelope, `prepareFollower`, `feedBody`, `markRatio`, `barBeat`, `bodySeed`, `emit`, `idleTick`). Move it into `conductor_follower.ts`, which returns its steps, so `make()` is only wiring. Then create `conductor.schema.ts` (`ConductorDialSchema`, `LeadOffsetsSchema`, `ConductorHand`, `ConductorDialParams`), which removes the two type-only cycles with `conductor_hands` and `conductor_shaping`.
Acceptance: `test/conductor_golden.test.ts` byte-identical; `make()` at most about 150 lines; every factory has a unit test; settings imports only `conductor.schema.ts`; closes #557.
Risk: medium (timing a player hears). Review: only if the golden had to be regenerated (it must not be). Conflicts: none (the other workers' briefs keep them off #557).

### Phase D: the remaining contribution points

**S8. Classes and catalog rows as contributions.**
Scope: `Extension.classes` and `Extension.catalog`; `src/app/library/category.ts` folds them (core keeps the `field` class and its own rows); the air extension declares its four rows and the `air` class; ASL declares `sign` and its row (a `thoremin-asl` PR plus a sha bump). Expand: core keeps the `sign` class and ASL row as a fallback that is used only while no listed extension declares them. Contract: remove them after the sha bump.
Acceptance: `rg AIR_INSTRUMENTS src` returns 0; `library_category`, `library_emoji`, `library_systemtags`, `library_summarize` and `air_instruments_view` tests unchanged; core-alone has one class, `field`.
Stored data: none (categories and system tags are derived, never stored, per the instrument-library ADR). Risk: low. Review: no. Conflicts: the chord worker may add a catalog row in core; S8 moves it.

**S9. Per-slice versioned migrations, prefs separate from presets.**
Scope: `DialSlice.version`, `migrations` and `legacyKeys`; `PrefSlice`. The persisted blob gains a `sliceVersions` map beside zustand's global `version`. The host runs each slice's chain on rehydrate before healing. `ControlState` is declared as three typed groups (preset dials, device prefs, session), and `partialize` (which fields are saved) is computed from those declarations instead of being hand-kept. The core features' migrations (v18 trainer HUD, v21 conductor prior) move into their slices' chains when their slices are cut in phase E; here they stay in core.
Expand: write `sliceVersions` (absent means version 1), keep the global version at 26 and every core step as it is. Migrate: the air slices declare `version: 1` with no transforms, which proves the path. Contract: none needed; the global chain stays for core fields.
Acceptance: S2's goldens are unchanged for every historical blob; a new probe slice migration (v1 to v2 renames a field) runs exactly once and survives a reload; an extension removed from the list keeps its stored slice untouched (the `mergeControls` behaviour today; assert it).
Risk: **high (player data)**. **Review: yes.** Conflicts: E10 of #385 drops legacy categorizer keys in the faces extension and `src/app/enroll/boundSets.ts`; it does not touch `store.ts`, but land S9 after E10 to keep each rollback clean.

**S10. Move the extension overlay elements out of core (migrate and contract S5).**
Scope: the drum pads (`drumPads`, `airDrumConfig`, `drumHits`) and the breath cue (`mouthCue`, `airFluteStatus`) move into `ext-air`'s node half; the category cues (`categoryLabel`, `categoryBars`, and the `categories`, `categoryCaptions`, `learnedCategories`, `chordCategories`, `categorizerChord`, `categoryDegrees` ports) become one generic **core** element fed by a `category-scores` contribution pool, the same mechanism as S4. Several extensions (ASL, faces, a future body categorizer) produce category readings, so the drawing is shared and the producers are pooled.
Stored data: `overlay.drumPads` and `overlay.mouthCue` are saved inside every instrument. Expand: the air slice's element reads its config through `legacyKeys: ['overlay.drumPads']` and writes the new key, while core's `OverlayDialSchema` still accepts the old one. Migrate: a slice migration copies `overlay.drumPads` and `overlay.mouthCue` into the air slice's dial, and the instruments seeder applies the same move to saved instruments (one test per blob in S2). Contract, one release later: remove the keys from `OverlayDialSchema`, keeping a one-shot reader for blobs that never loaded in between, as #385 E10 does.
Acceptance: core overlay ports fall from 31 to about 22; `rg -c 'airDrum|airFlute' src/nodes` returns 0; S2's goldens show the same visible state for every historical instrument; `test:core`'s overlay has no air port.
Risk: medium-high (saved instruments). **Review: yes.** Conflicts: the category ports overlap the faces extension's work; land after E10 of #385.

**S11. Commands, keybindings and modalities as contributions.**
Scope: `CommandDecl` and `ExtensionUi.commands` (a lazy extension's declared command loads the extension when invoked, like VS Code's `onCommand`); `KeybindingDecl` folded into `keyboardShortcuts.ts`; `Extension.modalities` folded into `CARVE_MODALITIES` (core keeps face, hand and body until the body slice, S17). The carve commands and `carveHost.ts` move from `src/app/commands` into `ext-faces`.
Stored data: category and gesture bindings save **command ids** (`carve.capture.toggle`, `carve.burst.begin`). Expand: ids stay exactly as they are (existing ids are exempt from the new namespacing rule, and only new commands are namespaced). Migrate: none. Contract: none.
Acceptance: `rg -l carve src/app/commands` returns 0; `commands_*` tests, `category_bindings_*` tests and `keyboard_shortcuts` pass unchanged; `commands_firewall` extends to extension command modules; the palette lists a lazy extension's commands before it loads.
Risk: medium. Review: no. Conflicts: #385 E10 and the carve backlog (#445, #452, #453); run after the backlog worker leaves the carve files.

**S12. Host-provided stores and a storage-key registry.**
Scope: `Extension.stores` (`StoreDecl`). The host gives each extension `host.storage.collection(name)` backed by the app's chosen `DataProvider`, so the provider is picked once, in the shell. All about 37 keys are listed in one registry with an owner, and a test fails on an unlisted `localStorage` or IndexedDB key.
Stored data: Expand: `legacyKey` maps each declared store to the key it uses today, verbatim, so nothing moves and no data is copied. Migrate and contract are deferred: renaming keys to `thoremin.ext.<id>.<name>` is optional and not scheduled, because it buys nothing a player sees.
Acceptance: `rg localStorageCollectionProvider packages/ext-*` returns 0; the key registry test passes; nothing about what is stored changes (S2 goldens plus the ext-faces store tests).
Risk: medium (a provider change that misses a key would look like data loss). **Review: yes.** Conflicts: E10 of #385 (legacy categorizer keys) must land first.

### Phase E: built-in features become slices (one PR each)

Each slice moves to `src/slices/<id>/` as one `Extension` plus `ExtensionUi` and is listed in `extensions.json`, so `test:core` proves the shell no longer names it. Dial keys keep their current names, so no stored data moves. A slice's core migration steps move into its chain (S9), and S2 proves the result is unchanged. Tests move with their code, keep their assertions, and are marked `runIf(<slice>)` for the core-alone run. Each PR's acceptance: the ratchet's per-feature file spread for that feature drops to one directory plus contract modules; reachability tests (`*_shell.test.tsx`, `tools_shell`, `app_shell`) unchanged; catalog regenerated and identical apart from paths.

**Two dial shapes (decided in S13).** An extension's dial slice has one of two layouts, and the choice is not free:

- **Object** (`layout: 'object'`, the default): one dial whose value is the whole object (`airDrum`). A saved instrument stores it under that one key, and its fields are reached by path (`dial.setIn`, `airDrum.enabled`). Every new extension uses this shape.
- **Flat** (`layout: 'flat'`): each top-level field is its own dial (`midi.enabled`, `midi.port`), with its own metadata, its own per-dial command (`dial.midi.enabled.set`), its own entry in a saved instrument, and a field-by-field heal. It exists only for the built-in features that become slices in Phase E and already had flat keys in core, so that a saved instrument and a bound command keep theirs, and no stored data moves. The host refuses `layout: 'flat'` for any key not listed in `FLAT_SLICES` (`src/host/slices.ts`), and from any extension but that feature's own; each Phase E slice adds its key and its id when it moves. A field whose core key was not `key.field` keeps its key (`flatKeys: { config: 'steerConfig' }`, for S14's `steer`), and its value may be an object (a structured dial). A slice needing its own heal (S14's `steer` completes its config) adds that hook when it moves. A flat slice carries no migration chain or legacy keys, because a saved instrument keeps its fields as separate keys that a whole-object step could not reach.

Two more seams came with S13 and every later slice may use them: a dial slice may derive `store-controls` ports (`DialSlice.ports`, such as `midiEnabled` read from the dial), so a node whose live inputs predate the slice keeps its graph and its catalog entry; and `ExtensionUi.stillSounding` names, on the shell's muted badge, an output that keeps sounding while the player has muted. A slice's id should name what it does rather than repeat a domain word that core also uses (the MIDI slice is `midi-output`: `midi` is also core's word for a note number, and `midi-out` is its node type and branch id, which the core bundle may never carry while the flat-slice table names the slice). The architecture ratchet counts a flat slice in core by its member keys and derived ports, not its bare key, and treats `src/slices/` as extension code.

**What S14 (the generative layer) added for the slices after it.** A derived port may read the host's state besides its dial (`DialPort.read(dial, host)`, `host.claimed`: a tool holding the room quiets the generative level). A flat slice may complete a partial field the same way in the hot store and in a saved instrument (`DialSlice.complete`), so the two halves of the dirty compare never differ. A transient field may declare its initial value (`transientPort(field, kind, initial)`: the transport starts `false`, as it did in core). A slice's command that writes a dial says so (`writesDials`: the risk map then treats it as a write rather than a query, as it did core's `steer.*` prefix; the undo history records any layer change regardless) and writes through the SDK's non-dispatching `applyDial` (reading with `dialValue`), and its panel dispatches its own domain commands with `dispatchCommand`. State that is deliberately not a command (a transport: nothing but a human press may start a paid stream) is bound to a key with a `run` action instead of a command, and a keybinding may carry its `help` line for the editor's Keyboard list. An AI provider's key is read through `@thoremin/sdk-ui/keys` (V12), and the load-status readout and reporter are shared primitives (`@thoremin/sdk-ui/loadStatus`, `@thoremin/lazy/status`'s `makeLoadStatusReporter`). A slice's node never imports its browser engine: the slice's React half installs the factory (`provideMidiSinkFactory`, `provideGenerativeEngineFactory`).

**S13. `midi` slice** (smallest; it proves the path). `midi_out.ts`, `midi_engine.ts`, the midi panel, `midiStatus.ts`, the `midi` dial, the `midi-out` branch. Risk low; no review; no conflicts.

**What S15a added for the song slice (and the slices after it).** The song is not an instrument's: it plays under any instrument, its player sits in the trunk today, and a recording led by the conductor lives in another tool's panel. So four seams, each exercised by the probe extension first. `Extension.toolDerive(settings, composed)` names the branches a TOOL's need implies (a per-device pref, a loaded song), never the instrument's dials, and is unioned into an instrument's explicit branch set too, as the Lab's and a feature claim's needs are; it runs last on either path and sees the ids implied so far (a recording led by a composed conductor), and it may name a core branch it needs beside its own. A device pref may derive `store-controls` ports as a dial slice does (`PrefSlice.ports`: the song's level and rate, read field by field by its node). An extension's tool that keeps working with its panel closed says so (`ExtensionTool.detached`: `useRunning`, `stop`, `hint`), and the bar marks it running and carries its stop control, as it did for core's song. A section may be contributed to another tool's panel (`ExtensionUi.toolSections`: `from`, `when` over the host panel's context, a `Section` component, and the panel's events, raised synchronously inside the click that caused them so a section may unlock media playback there); the Conductor panel shows them and raises `start` and `stop`.

**S14. `generative` slice.** `lyria*.ts`, `generative.ts`, `indirect_map.ts`, the steering and generative panels, `generativeStatus.ts`, `commands/steer.ts`, the `steer` dial, the `generative` branch; the provider-key read becomes a host resource (V12). Risk low-medium; no review.

**S15. `song` and `orchestra` slice.** `song_player`, the stretchers, `orchestra*`, `pace_controller`, `SongPanel`, the song and orchestra tools, `songStatus`, `orchestraStatus`, `commands/song*`, the `song-pace` branch, `songPrefs` as a `PrefSlice`. Risk medium; no review.

**S16. `trainer` and `lab` slice.** `app/enroll/*` that is not carve-specific, `TrainerPanel` (split its 28 store calls into a controller module, so the component only renders), the trainer HUD and lab overlay elements as contributed elements, `featureLab` and `trainerHud` as `PrefSlice`s (v18's migration moves with it). Risk medium; no review. Conflicts: `src/app/enroll/categoryBinding.ts` and `boundSets.ts` are #385 territory; leave them in place until E10 lands.

**S17. `body` slice.** `webcam_body`, `synthetic_body`, `replay_body`, `body_*` features and mapping, the body panel, the `body-source` and `body-route` branches, the body modality (S11). The `body` slot stays declared by the shell, with candidates contributed by the slice. Risk medium. Review: no. Conflicts: **#570** (shared frame source) changes `frame_pump.ts`, `webcam_hands.ts` and `model_input.ts`, which the body source uses; run S17 after #570 lands. **Landed in two parts.** S17a, the seams: `Extension.slotCandidates` (an extension's node types for a slot the shell declares, and at most one extension's default; folded by `slotCandidatesOf`, joined to the shell's slots by `withSlotCandidates`); a branch's declared `demands` imply it while a live claim (the Lab's shown groups, a tool's demand) wants any of those groups, so the derivation names no source branch for the Lab or a claim, and `Extension.derive(settings, { implied })` sees what a claim implied; core's own needs of the body (the dancer's pulse, the body conductor's pose) are said as feature groups (`body.rhythm`, `body.pos`). S17b, the move.

**S18. `conductor` slice** (after S7). The 8 `conductor*` node files, `ConductorPanel`, `ConductorTiming`, `conductorLead*`, `conductorStatus`, `commands/conductorLead*`, the `conductor` branch, `conductorPrefs` as a `PrefSlice`, v21's migration in its chain; it `requires: ['body']` for the body conductor. The `conductorTime` and `conductorEnabled` overlay ports become its own HUD element (S5). Risk medium-high (largest move). Review: no, provided `conductor_golden` and the `conduct_*_shell` tests are untouched; otherwise yes.

### Phase F: pure moves

**S19. Split the overlay and the store by file.** `canvas_overlay.ts` becomes `src/nodes/output/overlay/{node,layout,elements/<name>}.ts`, one file per remaining core element. `store.ts` becomes `src/app/store/{state,persist,heal,migrations}.ts`. Acceptance: no file over about 600 lines in either; nothing changes in behaviour (goldens, S2). Risk low; no review.

**S20. The app becomes shell plus host; the assistant leaves `src/plugins`.** Whatever feature UI is left in `src/app` moves into its slice or into `src/app/<feature>/`. `src/app` keeps the shell, `host/`, `commands/` (the registry host) and `dials/` (the generic form). `src/plugins/assistant` moves to `src/app/assistant`, so `src/plugins` holds only the frozen legacy app. Acceptance: `src/app` root has fewer than 25 entries; `layering.test.ts` adds "nothing outside the legacy entry imports `src/plugins`". Risk low; no review. The frozen legacy files themselves are not touched.

### Conflicts with in-flight work, in one place

| In-flight | Files it owns | Steps that must wait or coordinate |
|---|---|---|
| E10 of #385 ([#598](https://github.com/thorwhalen/thoremin/issues/598)), backlog worker | `ext-faces/src/app/{sources,models}.ts`, `sdk-ui/src/enroll/categorizers.ts`, `src/app/enroll/boundSets.ts`, `ext-faces/src/lib/synthetic.ts` | S9, S10, S11, S12 and S16 after it lands |
| #570 shared frame source | `src/nodes/sources/{frame_pump,webcam_hands,model_input}.ts`, possibly `useEngine.ts` resources | S3 (rebase), S17 after it lands |
| #587 merge off the main thread | `sdk/src/enroll/{cluster,categorizer,sorting,from_model}.ts`, `ext-faces/src/app/sessionStore.ts`, `lib/corrections.ts` | none; no step touches these. `sessionStore.ts` (1,779 lines) is deliberately left out of this plan until #587 is done |
| chord-layout instrument (worker in its own worktree) | a new extension package, `extensions.json`, probably one temporary core overlay port and a `chord-select` input | S3, S4, S5 first, ideally before its PR. Otherwise S4, S5 and S8 absorb its temporary core edits |
| #557 | `src/nodes/features/conductor*.ts` | folded in as S7 |

Suggested order: S1 → S2 → S3 → S4 → S5 → S6 (S6 edits the settings and overlay files that S3 and S5 change, so it follows them; S4 and S5 touch disjoint files and may run in parallel). Then S7 → S8. Then, after E10, S9 → S10 → S11 → S12. Then S13 → S14 → S15 → S16, S17 after #570, S18 after S7. Finally S19 and S20. Phases A and B are about a week of worker time and give the chord instrument its seams. The rest can run in the background behind the backlog.

### What this plan deliberately does not do

- It does not split repositories or publish packages (#262 decides that). Slices are in-tree directories; any of them can later become a package by the same `git mv` the air extension used.
- It does not build a runtime plugin loader, a sandbox (Figma's model), or per-extension permissions: there is no untrusted third party yet.
- It does not touch the frozen legacy app, `ext-faces`' session store, or the carve flow while #385 and #587 are in flight.
- It does not rename persisted keys or dial keys for neatness; every stored-data step either keeps names or carries a migration and a golden.

## REFERENCES

1. Microsoft. Contribution Points, VS Code Extension API. [code.visualstudio.com/api/references/contribution-points](https://code.visualstudio.com/api/references/contribution-points)
2. Microsoft. Activation Events, VS Code Extension API. [code.visualstudio.com/api/references/activation-events](https://code.visualstudio.com/api/references/activation-events)
3. Microsoft. Extension Manifest, VS Code Extension API. [code.visualstudio.com/api/references/extension-manifest](https://code.visualstudio.com/api/references/extension-manifest)
4. Obsidian. Anatomy of a plugin. [docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin)
5. Obsidian. Component (TypeScript API reference). [docs.obsidian.md/Reference/TypeScript+API/Component](https://docs.obsidian.md/Reference/TypeScript+API/Component)
6. Obsidian. obsidian-api (type definitions). [github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)
7. Figma. Plugin manifest. [figma.com/plugin-docs/manifest](https://www.figma.com/plugin-docs/manifest/)
8. Figma. How plugins run. [figma.com/plugin-docs/how-plugins-run](https://www.figma.com/plugin-docs/how-plugins-run/)
9. Grafana Labs. UI extensions (how-to guides). [grafana.com/developers/plugin-tools/how-to-guides/ui-extensions](https://grafana.com/developers/plugin-tools/how-to-guides/ui-extensions/)
10. Grafana Labs. UI extensions, key concepts. [grafana.com/developers/plugin-tools/key-concepts/ui-extensions](https://grafana.com/developers/plugin-tools/key-concepts/ui-extensions/)
11. Grafana Labs. plugin.json reference (`extensions`, `dependencies.extensions`). [grafana.com/developers/plugin-tools/reference/plugin-json](https://grafana.com/developers/plugin-tools/reference/plugin-json)
12. webpack. tapable. [github.com/webpack/tapable](https://github.com/webpack/tapable)
13. webpack. Writing a plugin. [webpack.js.org/contribute/writing-a-plugin](https://webpack.js.org/contribute/writing-a-plugin/)
14. Backstage. Frontend system: Extensions. [backstage.io/docs/frontend-system/architecture/extensions](https://backstage.io/docs/frontend-system/architecture/extensions)
15. Backstage. Frontend system: Extension blueprints. [backstage.io/docs/frontend-system/architecture/extension-blueprints](https://backstage.io/docs/frontend-system/architecture/extension-blueprints)
16. Backstage. Backend system: Extension points. [backstage.io/docs/backend-system/architecture/extension-points](https://backstage.io/docs/backend-system/architecture/extension-points)
17. Eclipse Foundation. The runtime plug-in model and extension registry (Platform Plug-in Developer Guide). [help.eclipse.org/.../runtime_registry.htm](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/runtime_registry.htm)
18. OSGi Alliance / Eclipse Foundation. OSGi specifications (Core: modules, lifecycle, service layer). [docs.osgi.org/specification](https://docs.osgi.org/specification/)
19. Python Packaging Authority. Entry points specification. [packaging.python.org/en/latest/specifications/entry-points](https://packaging.python.org/en/latest/specifications/entry-points/)
20. pytest-dev. pluggy: a minimalist production-ready plugin system. [pluggy.readthedocs.io](https://pluggy.readthedocs.io/en/stable/)
21. Microsoft. VS Code built-in extensions (`extensions/` in the vscode repository). [github.com/microsoft/vscode/tree/main/extensions](https://github.com/microsoft/vscode/tree/main/extensions)
22. Fowler M. Presentation Domain Data Layering. 2015. [martinfowler.com/bliki/PresentationDomainDataLayering.html](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)
23. Bogard J. Vertical Slice Architecture. 2018. [jimmybogard.com/vertical-slice-architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
24. Feature-Sliced Design. Layers (reference). [feature-sliced.design/docs/reference/layers](https://feature-sliced.design/docs/reference/layers)
25. Martin RC. The Clean Architecture. 2012. [blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
26. Parnas DL. On the criteria to be used in decomposing systems into modules. Commun ACM. 1972;15(12):1053-8. [doi.org/10.1145/361598.361623](https://doi.org/10.1145/361598.361623)
27. Fowler M (Sato D). Parallel Change (expand, migrate, contract). 2014. [martinfowler.com/bliki/ParallelChange.html](https://martinfowler.com/bliki/ParallelChange.html)
28. Poimandres. zustand: Slices pattern. [zustand.docs.pmnd.rs/learn/guides/slices-pattern](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern)
29. Poimandres. zustand: persist middleware (version and migrate). [zustand.docs.pmnd.rs/reference/middlewares/persist](https://zustand.docs.pmnd.rs/reference/middlewares/persist)
30. Verweij S. dependency-cruiser (rule-based import validation, an option for S1's ratchet). [github.com/sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser)

## Appendix: how the numbers were measured

- Import matrix: a script over every non-test `.ts`/`.tsx` in `src/` and `packages/`, resolving `@/`, relative and `@thoremin/*` specifiers to directories, with value and type-only imports counted separately. That script was not committed. S1's ratchet (`scripts/lib_architecture.ts`, baseline `test/architecture.baseline.json`) replaces it with stricter definitions (comments excluded from the extension-name count, contract modules excluded from the node-implementation count, cycles counted as strongly connected groups), so its baseline numbers are somewhat lower than the ones quoted above; the ratchet's numbers are the ones that gate.
- Cycles: `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src packages` (561 files; `@thoremin/*` counted as external, so cross-package cycles are covered by `packages_purity` instead).
- Feature spread: `rg -l -i <feature> src` outside tests, grouped by directory. These are upper bounds, since a file can mention a feature in a comment; the ranking holds either way.
- In-flight scopes: the issue bodies of #385, #557, #570, #587 and [#598](https://github.com/thorwhalen/thoremin/issues/598), and `rg` for the keys and functions they name.
