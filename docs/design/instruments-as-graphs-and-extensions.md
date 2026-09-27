# ADR: instruments as declared graphs, and thoremin as a core with extensions

> Status: **proposed** (2026-09-27), awaiting the maintainer's acceptance and an independent review before any code moves. Round 4 items (3) and (4). Companion to [`component-model.md`](component-model.md) (the vocabulary this builds on), [`lazy-loading.md`](lazy-loading.md) (the loading pattern it reuses) and [`instrument-library.md`](instrument-library.md) (the metadata layer it extends). The business question this ADR must not answer is [#262](https://github.com/thorwhalen/thoremin/issues/262); §5 lays out its technical options only. Related: [#82](https://github.com/thorwhalen/thoremin/issues/82) (the configuration calculus, reconciled in §3.6), [#178](https://github.com/thorwhalen/thoremin/issues/178) (extracting `ictus`), [#5](https://github.com/thorwhalen/thoremin/issues/5) (the DAG roadmap).

## 0. TL;DR

1. **An instrument becomes a declared graph, not a settings profile over one monolithic graph.** Today `defaultGraph()` wires all 32 nodes of every instrument and each instrument is a sparse dials `Layer` that gates them on or off. The ADR introduces **branches** (named, reusable pieces of `GraphSpec` that attach to a shared **trunk**), a pure `composeGraph(branches)`, and an `InstrumentSpec` (Zod) that names its branches, its class, its tags and its settings. The engine's existing `applyGraph` swaps instruments in place, so the trunk (camera, hand model, synth, overlay) is kept and nothing reloads.
2. **Only what an instrument declares is wired, loaded and drawn.** The face branch, its model and its overlay elements exist in the graph only when an instrument's spec or a live feature demand asks for them. The inventory (§2.2) corrects the premise: for the Air Drum, Bass and Guitar the face model already does not load. The real defect is the Air Flute: its breath gate legitimately demands mouth features, which correctly loads the model but also draws the full face mesh and the expression bars, because demand scopes compute and not overlay elements. The branch model fixes that class of bug structurally.
3. **Extensions are one manifest, and the repo becomes a monorepo of packages before it becomes several repos.** One new air instrument today touches 13 source files and 6 hand-listed registries (§2.3). An `Extension` manifest (nodes, branches, instruments, dial slice, panels) collapses those into one object; `createAppRegistry(extensions)` and `composeGraph` read it. The air instruments become the first in-tree extension. npm workspaces then make the future repos real packages (`sdk`, `ictus`, `taglog`, `ext-air`) while keeping one checkout, one CI and an unchanged deploy. Splitting into separate repositories is the last step, by `git subtree split`, and only after the maintainer answers #262.
4. The non-air class is **Field instruments** (the maintainer's name), class id `field`. The id migration from `theremin` is code-only: the category is derived, never persisted (§3.7).

## 1. What was asked

The maintainer's Round 4 request, in substance:

- (a) *"An instrument is a general specification of how live streams go through the processing DAG and create output streams (video, overlays, sound). What streams and what nodes may be involved is unbounded."* The face overlay and model should not be there for instruments that do not use the face. Components (face model → expression names → chords → rendering) must compose flexibly, and it must stay fast in real time.
- (b) *"Everything platform oriented: wherever we can separate concerns and create clean seams, we should; bolt-on repos are one way to test the architecture concretely."* thoremin as the core engine; instrument classes or instruments as plugins/extensions injected at deploy time; deploys must keep working; can the non-core repos be public for free GitHub Actions, and does the split pay off?

The user's standing rule for this kind of work is *seams before surfaces*: decide the boundaries now so that every later iteration adds at a boundary that already exists, and declare a seam only when its replacement can be pointed at. The seam table is §6.

## 2. What the code does today (inventory, 2026-09-27)

Three read-only inventories were run against `main` at `1134a34`. Numbers below are theirs; file references are to this tree.

### 2.1 One graph, seventeen profiles

- `defaultGraph()` (`src/app/graph.ts`) wires **32 node instances** and 100 edges. Every shipped instrument runs this same graph. `applyGraph` is used today only for slot swaps (`?slot.source=…`), never for instrument switches.
- An **instrument** is a sparse dials `Layer` (`src/app/dials/instruments.ts`, 17 seeds). Its **category** is derived on read from four `air*.enabled` dials (`src/app/library/category.ts`); nothing persists a class id.
- Gating is per node and hand-written: most of the 32 nodes have an `enabled`-style early return; three (`webcam-face`, `webcam-body`, the two feature-vector nodes) compute a three-way OR of *dial* ∥ *Feature Lab shown* ∥ *feature demand* each tick. Idle nodes cost a cheap early return per tick; this is not a performance problem today, it is a reasoning problem: nothing states which nodes an instrument *is*.
- The **trunk** every instrument shares is already visible in the wiring: `cam` (`webcam-hands`, the only node that loads a model unconditionally in `init()`), `feat`, `ui` (`store-controls`, ~29 hand-listed output ports), `map` (the `mapping` slot), `merge` (`synth-merge`, five fixed voice inputs `a..e` plus `mute`), `synth`, `overlay`.

### 2.2 The face path, precisely

| Instrument | Face model loads | Face overlay draws | Why |
|---|---|---|---|
| Pentatonic (default), the seven non-face field instruments | no | no | `faceActive()` is false: `faceMapping='none'`, no Lab, no demand (`src/nodes/sources/webcam_face.ts:135-144`) |
| Glass Bells, Pulse Organ, Everything | yes | yes | `faceMapping` is `chord` or `timbre`: they use the face |
| Air Drum, Air Bass, Air Guitar | **no** | **no** | they set nothing face-related and claim no demand |
| **Air Flute** | **yes** | **yes: full mesh and expression bars** | `airFluteDemand.ts:19-21` claims the three mouth groups whenever `breath='mouth'` (the default); the demand loads the model, and the overlay's `faceMesh` and `faceExpressionCue` elements draw for *any* present face, with no knowledge of *why* the face is there |

So the maintainer's observation is accurate for one instrument, and the mechanism behind it is worth naming: **the demand seam (`src/features/demand.ts`) scopes compute correctly and scopes rendering not at all.** A claim on `face.geom.mouth` should produce a mouth cue, not an emotion bar graph. Any fix that adds a fourth hand-written OR condition to the overlay would repeat the pattern that produced the bug.

### 2.3 What one new instrument costs

The Air Flute commit (`996e2cb`, PR #258) touched **39 files, 13 of them non-test source files, across 6 hand-listed registries**: `CORE_NODES`, the dials schema (two files), `AIR_INSTRUMENTS`, `AIR_UI`, `store-controls` (+3 ports), `synth-merge` (+1 input `e`), plus `graph.ts`, `useEngine.ts`, `App.tsx`, `store.ts`, `instruments.ts`. The command registry needed nothing by hand (per-dial commands are generated from the dials schema, the one registry that already composes). This number is the concrete measure of "how many seams a plugin must extend", and the target is: one directory, one manifest object, zero edits outside it.

### 2.4 Module boundaries and the bundle

- **Pure leaves** (import nothing else in `src/`): `dag`, `ictus`, `taglog`, `lazy`, `keys`, `util`, `hooks`. **Import nothing from `src/app`**: everything except `App.tsx`, `main.tsx` and `plugins`. `src/nodes/**` imports nothing from `src/app` (no store, no React). These facts are what make a core package a cut and not a rewrite.
- **One real cycle to break:** `src/settings/schema.ts` and `dials.ts` import the dial schemas of concrete nodes (`air_drum`, `air_bass`, `air_guitar`, `air_flute`, `conductor`, `face_controls`, `indirect_map`, `hand_map`, `canvas_overlay`), while `store_controls.ts` imports types from `settings/schema`. An extension that owns a node must also own that node's dial slice, so the core settings schema must stop naming extension nodes (§4.2).
- **Bundle** (vite build, 23 chunks, 4.06 MB raw / 1.01 MB gzip). The entry chunk is 1.1 MB raw / 342 kB gzip and is dominated by vendor libraries (react-dom, cmdk, acture, zodal, tonal, lucide), not by node code. Every heavy vendor library is already behind a dynamic `import()` gate (tasks-vision, genai, webmidi, libflac, the AI SDKs, the score loaders), and the frozen legacy app is a separate 1.38 MB chunk. **So per-instrument code splitting is not where the bytes are**; it becomes worth doing when extensions are separate packages, and the design leaves that seam open (§6, row 3) without building it now.
- **Deploy.** thoremin's `deploy.yml` only dispatches `tw_platform`'s workflow, which checks out `thorwhalen/thoremin` **with no token** (a public-repo assumption; thoremin is absent from the GitHub App's repository scope), builds on the server with `npm ci && npm run build` per `app.toml`, and rsyncs `frontend/`. `acture` is consumed from the npm registry, not a sibling checkout: the proven pattern for a split. **A private thoremin breaks the deploy at the checkout step** until it is added to the App token's scope the way `tetrachord` and `tagai` are. That change is tw_platform's and is thoremin-mgr's to arrange.
- Tests: 183 files, 2083 tests; 23 files instantiate `defaultGraph()` or `createAppRegistry()` and pin node ids, port names and slot candidates. PR 1 below must leave all of them green with no edits.

## 3. Decision A: the instrument as a declared graph

### 3.1 Vocabulary

| Term | Meaning | In code |
|---|---|---|
| **Trunk** | The nodes every instrument shares: the hand source, hand features, the UI bridge, the voice merge, the synth, the overlay. A branch every spec includes implicitly. | one `GraphBranch` named `trunk` |
| **Branch** | A named, reusable piece of graph: nodes, edges, the voice outputs it contributes to the merge, and the overlay elements it wants drawn. Attaches to the trunk by wiring to trunk node ids. The word is already in use here ("the face branch", "the generative branch", "a second camera branch"). | `GraphBranch` (Zod) |
| **Instrument spec** | Metadata (id, name, class, tags, emoji) + the branches it needs + its settings `Layer` + optional training/enrolment hooks. What the library lists, what the player picks. | `InstrumentSpec` (Zod) |
| **Class** | The instrument's kind for grouping and colour: `field` ("Field instruments") or `air`. An open registry with two entries. | `INSTRUMENT_CLASSES` |
| **Demand** | A live runtime claim on feature groups by a tool (Lab, Trainer) or a node (the flute's breath). Already exists. | `src/features/demand.ts` |

A branch is **not** a node and **not** a settings fragment: it is wiring. `#82`'s fragments are sparse settings `Layer`s (values); a branch is a sparse `GraphSpec` (topology). An instrument is one of each: *branches say what runs, the layer says with which values.*

### 3.2 The shape

```ts
// src/instruments/branch.ts — pure, no React, no DOM
const GraphBranch = z.object({
  id: z.string(),                       // 'trunk' | 'face-source' | 'face-chord' | 'air-drum' | ...
  requires: z.array(z.string()),        // branch ids that must be present (e.g. 'face-chord' requires 'face-source')
  nodes: z.array(NodeSpec),             // ids unique across the composed graph, or identical duplicates
  edges: z.array(EdgeSpec),             // may target trunk node ids
  voices: z.array(PortRef),             // synth-params outputs; the composer allocates merge inputs
  overlay: z.array(z.string()),         // overlay element ids this branch wants drawn
  demands: z.array(z.string()).optional() // feature groups that imply this branch at runtime (e.g. face groups → 'face-source')
});

// src/instruments/spec.ts
const InstrumentSpec = z.object({
  id: z.string(), name: z.string(),
  class: z.string(),                    // 'field' | 'air' (open registry, §3.7)
  tags: z.array(z.string()).default([]),
  emoji: z.string().optional(),
  branches: z.array(z.string()),        // by id; 'trunk' implied
  settings: LayerSchema,                // the dials Layer, exactly what a saved instrument is today
  training: z.object({ route: z.string() }).optional(), // where "train this instrument" goes (the trainer stream reads it)
});
```

`composeGraph(branchIds, registry): GraphSpec` is a pure union: it resolves `requires` transitively, checks that a node id appearing in two branches is the *same* node (id + type + validated params, the identity `applyGraph` already uses), rejects a conflicting duplicate with the two branch ids in the error, allocates each `voices` entry to the next free merge input, and returns a `GraphSpec` the engine already understands. The overlay's element set is the union of the branches' `overlay` lists, pushed to the overlay node as its `elements` param, so **an element is drawn because some branch asked for it, never because a face happened to be present.**

`graphFor(spec, demands): GraphSpec` = `composeGraph(spec.branches ∪ branchesImpliedBy(demands))`. A Lab claim on a face group implies `face-source` and a small `face-landmarks` overlay element; the flute's breath claim implies `face-source` and a `mouth-cue` element (new, ~40 lines) and nothing else. This is the fix for §2.2, and it is the same code path as the static case.

### 3.3 Runtime: switching instruments is an `applyGraph`

`useEngine` today re-applies the graph on a slot change only. It will re-apply on **instrument switch and demand change** with `graphFor(spec, demands)`. Because the trunk is unchanged between any two instruments, the engine keeps `cam` (hand model loaded), `synth` (audio graph), `overlay` (canvas) and `ui`, and rebuilds only the branch nodes. `applyGraph` plans synchronously (a bad spec is a no-op), inits new nodes while the old graph keeps ticking, and commits atomically (`component-model.md` → "Swapping at runtime"). Composition runs once per switch, never per tick; the tick loop is untouched. Real-time cost per tick goes *down* (the ~20 idle early returns disappear), and a switch costs the `init()` of the incoming branch's nodes, which for every branch except `face-source` and `body-source` is microseconds.

Two engine facts constrain the design and are honoured rather than worked around: fan-in to one input port is rejected (hence the merge-input pool, not a variadic port), and `NodeDef.inputs` is static (hence the pool is declared on `synth-merge` as `v1..v8`, and the composer, not the node, does the allocation).

### 3.4 What becomes a branch (the first cut)

| Branch | Nodes today | Voices | Overlay elements | Implied by |
|---|---|---|---|---|
| `trunk` | `cam`, `feat`, `ui`, `merge`, `synth`, `overlay` | — | video backdrop, landmarks | always |
| `field-voices` | `map` (the `mapping` slot), `handVec`, `gesture` | `map.params` | scale guide, markers, finger lines/bars | class `field` |
| `face-source` | `camFace`, `faceVec` | — | `face-landmarks` (small) | `faceMapping≠none`, or any face-group demand |
| `face-timbre` | `faceFeat` → `map.face` | — | — | `faceMapping='timbre'` |
| `face-chord` | `faceExpr`, `exprChord`, `chordSel` | `exprChord.params` | expression cue, chord label | `faceMapping='chord'` |
| `face-controls` | `faceCtrl`, `poseChord` | `poseChord.params` | pose cue | `faceMapping='controls'` |
| `body-source` | `camBody`, `bodyVec` | — | body frame | `body.enabled`, or a body-group demand |
| `body-route` | `bodyRoute` → `map.mods` | — | — | `bodyMap` non-empty |
| `conductor` | `conductor`, `score` | `score.params` | conductor time | `conductor.enabled` |
| `midi-out` | `midiOut` | — | — | `midi.enabled` |
| `generative` | `imap`, `gen` | — | — | `steer.enabled` |
| `air-drum` | `airDrum`, `drumOut` | — | pads, sticks, hits | `airDrum.enabled` |
| `air-bass` | `airBass`, `bassOut` | — | neck | `airBass.enabled` |
| `air-guitar` | `airGuitar`, `guitarOut` | — | chord readout | `airGuitar.enabled` |
| `air-flute` | `airFlute` (+ `mouth-cue` element) | `airFlute.params` | mouth cue | `airFlute.enabled`; demands the mouth groups when `breath='mouth'` |

The right column is the **derivation** from today's dials. It exists so that PR 1–3 change no persisted shape and no UX: every saved instrument in every player's browser keeps working, because its branch set is computed from the `Layer` it already is. The explicit `branches` field arrives with the persisted spec (PR 4) and the derivation becomes the migration for specs that lack it.

### 3.5 What stays as it is

- **`store-controls` stays the one bridge from the hot store to ports.** Each branch wires the `ui` ports it reads. Generating its port list from the dials schema is a seam candidate (§6), not part of this decision.
- **Overlay elements stay functions inside the one overlay node** (`component-model.md`'s promotion rule). The branch model only decides *which* elements are in the list.
- **The demand seam stays the runtime mechanism.** It gains one reader (`branchesImpliedBy`) and loses three (the per-node OR conditions become unnecessary once a node is simply absent when unwanted). `webcam-face`'s `faceActive()` can be deleted, not extended.
- **The `mapping`, `source` and `body` slots stay.** A slot chooses a node type *inside* a branch; a branch chooses which nodes exist. They compose: `field-voices` reads the `mapping` slot for `map`'s type.

### 3.6 Reconciliation with #82 (the configuration calculus)

#82 composes **values**: sparse `Layer`s stacked through the dials cascade, plus `Layer → Layer` transformers. This ADR composes **topology**: branches unioned into a `GraphSpec`. They are orthogonal halves of one instrument, and they meet in exactly one place: `branchesFor(settings)` reads the *resolved* layer. A #82 recipe (scale fragment + timbre fragment + face fragment) resolves to a layer, and that layer implies its branches. Nothing in #82 needs to change; its "face fragment" becomes the thing that turns on the `face-chord` branch. The word *fragment* stays #82's; this document never uses it for wiring.

### 3.7 The class id: `theremin` → `field`

The maintainer named the non-air class **Field instruments**. `INSTRUMENT_CATEGORIES` (`src/app/library/category.ts:52-55`) becomes `INSTRUMENT_CLASSES` with entries `{ id: 'field', label: 'Field instruments', emoji, colour }` and `{ id: 'air', … }`, and gains a colour so the UX stream can tint cards from the same record. The id is **derived and never persisted** today (no localStorage key, no URL parameter, no recording manifest carries it: recordings store instrument *names*), so the migration is a rename in code and tests. When PR 4 begins persisting `class` in the spec collection, the read boundary normalises `theremin → field` once (a one-line `LEGACY_CLASS_IDS` map), so a spec exported from a pre-PR-4 build or hand-edited with the old id still loads. The UX stream changes only the visible label now and reads `INSTRUMENT_CLASSES` for colour and grouping once PR 2 lands.

## 4. Decision B: extensions, and the shape of the repository

### 4.1 Seams before repositories

The maintainer's test for the architecture is that a bolt-on repository can carry an instrument. That test can be passed **without a second repository**: it is passed the moment an extension is one object the app consumes through a manifest, with a CI job that builds the app against an extension installed from outside `src/`. A repository split then changes where files live, not how they compose. Doing it in that order is what keeps the split cheap and reversible; doing it the other way round (split first, then discover the seams) is the do-then-redo the architecture-first rule exists to prevent.

### 4.2 The `Extension` manifest

```ts
// src/sdk/extension.ts — what an extension exports as its default
export interface Extension {
  id: string;                                   // 'air'
  nodes: NodeDef[];                             // registered into the app registry
  branches: GraphBranch[];                      // composable wiring (§3.2)
  instruments: InstrumentSpec[];                // seeds the library lists
  classes?: InstrumentClass[];                  // new classes, if any
  dials?: { schema: ZodObject; defaults: object; panels: Record<string, PanelDef> };  // its settings slice + editor sections
  overlayElements?: OverlayElement[];           // elements its branches may name
  training?: TrainingHook[];                    // what the trainer stream needs per instrument
}
```

The app composes extensions in five places, all of which exist today as hand-listed arrays and become folds over `extensions[]`: the node registry (`createAppRegistry(extensions)`), `composeGraph`'s branch table, the dials schema (`z.object({...core, ...ext.dials.schema.shape})`, which is what breaks the settings → nodes cycle of §2.4: core `schema.ts` stops importing air node schemas because the air extension owns them), the instrument seeds, and the editor's per-instrument sections (today's `AIR_UI`, already keyed by instrument id and already `satisfies Record<AirInstrumentId, …>`, which is the manifest pattern in miniature). Per-dial commands, the palette entries and the AI tool surface need nothing: they are generated from the dials schema, so an extension's dial slice earns them for free, as the flute already showed.

Two guards, both tests in the pattern of `commands_firewall.test.ts`: an extension imports only from the SDK paths (never `src/app`, never another extension), and core imports nothing from `src/extensions/**`. The dials write-path guard (`dials_write_path.test.ts`) extends its walk to extension panels, so an extension cannot bypass command dispatch either.

**The first extension is `air`** (drum, bass, guitar, flute): four node files, four panels, four seeds, four dial slices, one status/demand module each, already grouped in the code and the docs, with no other instrument depending on them. Its move is a `git mv` into `src/extensions/air/` plus the manifest. **Field instruments stay in core for now**: `voice-mapping` is the default of the `mapping` slot and the trunk's `map` node, and moving it before the trunk boundary has been exercised by the air move would be a second migration with no evidence yet. The ADR keeps the door open (an `ext-field` package is the symmetric next step) and does not pretend it is decided.

### 4.3 Repository organisation: the options

| | O1 · monorepo, manifest only | **O2 · monorepo of workspace packages (recommended now)** | O3 · separate repositories |
|---|---|---|---|
| Layout | `src/extensions/air/` + manifest | root app + `packages/{sdk,ictus,taglog,ext-air}` (npm workspaces) | `thoremin` (app) + `thoremin-sdk`, `thoremin-ext-air`, `ictus`, `taglog`, each its own repo, consumed from the npm registry (the `acture` pattern) |
| Enforces the seam | by test only | by `package.json` dependencies and per-package `tsconfig` (an extension physically cannot import the app) | strongest: separate histories, versions, licences |
| Deploy | unchanged | unchanged: `npm ci && npm run build` at the root installs workspaces; `tw_platform` untouched | app unchanged; extensions publish to npm first; a private core needs the App token in `tw_platform` (§2.4) |
| CI | one workflow, free while public | one workflow; per-package test matrices possible | one workflow per repo; free for every public repo; cross-repo changes need two PRs and a version bump |
| Cost to reach | ~1 PR | ~2 PRs after O1 | O2 + `git subtree split` per package (history preserved) + registry publishing + version discipline |
| Reversibility | trivial | trivial (delete the workspace field) | painful: merging repos back loses the simple story |
| Serves #262 | no | **yes**: a licence file per package, a public/private decision per package, without committing to either | yes, and forces the decision now |

**Recommendation: O1 → O2 now, O3 when #262 is answered and only for the packages the answer needs.** O2 is where the split "pays off" in the maintainer's sense: every future repository already exists as a package with its own manifest, tests, README and licence file, the seams are enforced by the module system, and nothing has been published or made irreversible. "Injected at deploy time" is satisfied at O2 by a build-time manifest (`extensions.json`, or `VITE_EXTENSIONS`, read by a tiny Vite plugin that generates the extension import list); at O3 the same manifest names registry packages, and the injection point does not move.

### 4.4 The package cut (O2)

| Package | Contents | Why it is a package |
|---|---|---|
| `packages/sdk` | `src/dag` (engine, registry, applier, recorder), `src/lazy`, `src/features/demand.ts`, the slot contracts, `src/nodes/domain.ts` (port kinds), `GraphBranch` / `InstrumentSpec` / `Extension` schemas, `defineNode` | the one thing an extension author needs; small; the natural public contract |
| `packages/ictus` | `src/ictus` | already pure; #178 wants it in `muvid` too |
| `packages/taglog` | `src/taglog` | already pure and documented as extraction-ready |
| `packages/ext-air` | `src/extensions/air` | the first extension; the proof of the manifest |
| root (`thoremin`) | the app shell, the trunk nodes, the field instruments, the library, commands, panels, recording, trainer, assistant | the deliverable; the deploy unit |

`src/nodes` splits by *who owns the node*: trunk and field nodes stay in the app (or a later `ext-field`), air nodes go to `ext-air`, and the engine-level contracts go to `sdk`. `src/music`, `src/features` (catalog, formula, normalizer), `src/enroll`, `src/score` stay in the app until a second consumer appears, the same rule that has served `ictus`.

### 4.5 What must not break

- **Deploy**: root `npm ci` and `npm run build` keep working at every PR (a smoke assertion in CI: the built `frontend/index.html` still references exactly one entry chunk). `tw_platform` is not touched by this sequence; the two things it may need later (App-token checkout if thoremin goes private; nothing at all for O2) are thoremin-mgr's to schedule.
- **Saved instruments**: every PR keeps the derivation from dials (§3.4) as the fallback, so a `Layer` saved on any earlier version yields the same graph it does today.
- **The 23 wiring tests**: PR 1 is gated on a golden test that `composeGraph(allBranches)` deep-equals today's `defaultGraph()` output (node order, edge order, params), so the existing suite is the regression net rather than being rewritten.
- **The write-path and firewall guards** extend to extensions; none is weakened.

## 5. Options for #262 (technical facts only, no recommendation on the business question)

What the split makes *possible*, so the maintainer can choose; the choice itself is out of scope for every agent.

| Tier | Public | Private | What an extension author can do | Actions cost | Fragility |
|---|---|---|---|---|---|
| T1 | everything | nothing | write and *test* extensions against the real engine and fixtures | free everywhere | none |
| T2 | `sdk`, extensions (`ext-air`, `ictus`, `taglog`) | the app (shell, trunk, field instruments, trained data) | write extensions; **cannot run them** against the real engine in their own CI unless the private app is installable there (a registry token in the public repo's secrets, or a published private package) | free for the public repos; the private app pays per minute and today has no hosted CI at all (the account's Actions block) | medium: the sdk must be versioned honestly, and an extension's tests degrade to unit tests unless the engine is reachable |
| T3 | `sdk` + the engine and trunk (a public "engine" package) | the app shell, instruments, trained/enrolled data, hosted service | write **and test** extensions for free; the value that is kept private is the instruments and the data, not the plumbing | free for everything except the private app | low: this is the classic open-core cut, and the package boundary in §4.4 already draws it |

Facts that bear on the choice, none of them decisions: an extension is useless without the core, exactly as a plugin is useless without its host, and that is not a problem; what matters is whether it is *testable* without the core, which is where T2 pays for its privacy. Per-package licence files are mechanical once O2 exists. Data derived from third-party footage stays out of every public package regardless of tier (the standing provenance rule). The only deploy consequence of any tier is the App-token checkout in `tw_platform` for whichever repo goes private.

## 6. Seam table (architecture-first)

| # | Seam | v1 default (no new dependency) | Replacement that already exists to point at |
|---|---|---|---|
| 1 | which branches an instrument has | derived from its dials `Layer` (§3.4) | the explicit `branches` field of a persisted `InstrumentSpec` (PR 4) |
| 2 | how voices reach the synth | a declared pool of merge inputs, allocated by the composer | a variadic merge once the engine allows dynamic ports (`dag/types.ts`, static `inputs` today) |
| 3 | how an extension's node code is loaded | statically, through the manifest array | `registry.registerLazy(type, () => import(...))` resolved before `applyGraph` plans, giving one chunk per extension (`lazy-loading.md`'s loader seam, applied to node *definitions*) |
| 4 | where the extension list comes from | an in-tree array of manifests | a build-time `extensions.json` (O2) naming registry packages (O3) |
| 5 | the class registry | two entries, `field` and `air` | an extension's `classes` field |

```
Surface for v1: the app (the instrument picker and the editor read the spec); the CLI is the headless composer test (`runHeadless` over `graphFor`), which is also the "one-command proof"
NOT seams:      overlay z-order (list order, on purpose); the store-controls port list (seam candidate, comment only); the licence per package (a file, #262's to fill); the React Flow patcher (#14, unchanged)
```

## 7. The PR sequence (after acceptance)

Each PR is independently landable and leaves every existing test green. Sizes are estimates of changed source lines excluding tests.

| # | PR | Scope | Verifies | Unblocks / coordinates |
|---|---|---|---|---|
| 1 | **Branches and the composer** | `src/instruments/{branch,compose}.ts`; `defaultGraph()` re-expressed as `composeGraph(ALL_BRANCHES)`; `synth-merge` inputs `a..e` become the declared pool | golden test: composed spec deep-equals today's; the 23 wiring tests unchanged | pure refactor, ~350 lines; touches `graph.ts`, `synth_merge.ts` |
| 2 | **Classes** | `INSTRUMENT_CLASSES` with `field`/`air`, label, emoji, colour; `theremin → field` rename; `LEGACY_CLASS_IDS` normaliser | `library_category` tests; `air_instruments_view` reachability | **UX stream (6)** reads it for tint and grouping; ~80 lines; touches `category.ts` (coordinate with `ux/instruments-and-controls`, arch lands first) |
| 3 | **Only what is declared runs** | `graphFor(settings, demands)`; `useEngine` re-applies on instrument switch and demand change; overlay `elements` param from the branch set; `mouth-cue` element; delete the per-node OR gates | per-seed graph snapshot tests (Air Drum has no `camFace`; Air Flute has `camFace`, `mouth-cue`, no `faceExpressionCue`; Glass Bells has `face-chord`); `engine_lifecycle` switch test (trunk kept); a jsdom test that the face chip is absent for the flute | fixes §2.2; ~400 lines; touches `useEngine.ts`, `canvas_overlay.ts`, `webcam_face.ts` (coordinate with `fix/trainer-overlay-and-mute` on `useEngine.ts`; whoever lands second rebases) |
| 4 | **The instrument spec** | `InstrumentSpec` (Zod); seeds become specs; the instruments collection carries `class`, `tags`, `branches`, `training`; derivation kept as the fallback for specs without `branches` | `library_*` tests; a migration test from a v7 seed store | **UX (6)** full metadata; **trainer stream** reads `spec.training.route` for the per-instrument link; ~300 lines |
| 5 | **The extension manifest, air as the first extension** | `Extension` type; `createAppRegistry(extensions)`; `composeGraph` reads extension branches; dials schema composed from slices (breaks the settings → nodes cycle); `git mv` of the air files into `src/extensions/air/`; catalog generation reads extensions; the two boundary guards | `commands_firewall`-style guards; catalog regenerated; every air test unchanged in content | ~500 lines, mostly moves; the flute's 13-file footprint becomes one directory |
| 6 | **Workspaces (O2)** | root `workspaces`; `packages/{sdk,ictus,taglog,ext-air}` with `package.json`, `tsconfig`, README, LICENSE placeholder; `@/` aliases replaced by package imports; `extensions.json` + the Vite plugin | `npm ci && npm run build` at the root; the CI smoke; per-package `tsc` | deploy unchanged, verified against `app.toml`'s commands; ~200 lines of config plus moves |
| 7 | **Split (O3), per #262** | `git subtree split` of the chosen packages; publish to the registry; the app depends on published versions; `tw_platform` App-token change if any repo goes private | a fresh clone of the app builds from the registry alone | last, after the Round 4 freeze window; needs the maintainer's #262 answer and thoremin-mgr for `tw_platform` |

Ordering constraints: 1 → 3 → 4 → 5 → 6 is a chain; 2 is independent and should land first because the UX stream waits on it; 7 waits on #262 and on the other Round 4 streams having landed. PRs 3 and 5 are *significant* by the landing rule (changed behaviour, >200 lines) and get an independent adversarial review each; the reviewer's brief includes §6 and the question "does the next change (`ext-field`) touch any caller?".

## 8. What this ADR deliberately does not do

- Does not decide what is public, private or under which licence (#262).
- Does not move the field instruments out of core, or build `ext-field`; it records the step.
- Does not build per-extension lazy loading of node code (seam 3); the bytes are elsewhere today (§2.4).
- Does not build a discovery mechanism beyond the manifest array and the build-time list; a third party appears before a plugin loader does.
- Does not change `webcam-hands`' unconditional model load: the hand source is the trunk. A hand-free instrument (keyboard, MIDI-in) would make it a branch; that is a real future instrument and a one-line change to the trunk definition when it comes.
- Does not touch the frozen legacy app or the trainer, CI or UX streams' files beyond the coordination points named in §7.

## 9. Open questions for the maintainer

1. **Symmetry:** should the field instruments become an extension (`ext-field`) in the same sequence, or stay in core until a second field-class package exists? The ADR recommends the latter and asks only for the principle.
2. **O2 timing:** land workspaces (PR 6) inside Round 4, or hold it for the freeze window with the split? The ADR recommends inside Round 4, since it changes no behaviour and is what makes PR 7 a mechanical step.
3. **The word "branch"** for a reusable graph piece: acceptable, given `git` also uses it? The code already says "the face branch"; the alternative is "patch" (modular-synth sense), which collides with `dispatchDialPatch`.
