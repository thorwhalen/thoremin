# ADR: instruments as declared graphs, and thoremin as a core with extensions

> Status: **accepted** (2026-09-27), after an independent adversarial review (verdict: accept with changes; its nine findings are folded in below and marked *[review]* where they changed a decision). Round 4 items (3) and (4). Companion to [`component-model.md`](component-model.md) (the vocabulary this builds on), [`lazy-loading.md`](lazy-loading.md) (the loading pattern it reuses) and [`instrument-library.md`](instrument-library.md) (the metadata layer it extends). The business question this ADR must not answer is [#262](https://github.com/thorwhalen/thoremin/issues/262); §5 lays out its technical options and states the one engineering opinion the maintainer asked for. Related: [#82](https://github.com/thorwhalen/thoremin/issues/82) (the configuration calculus, reconciled in §3.6), [#178](https://github.com/thorwhalen/thoremin/issues/178) (extracting `ictus`), [#5](https://github.com/thorwhalen/thoremin/issues/5) (the DAG roadmap). PR 2 of the sequence (the class id `field`) landed separately as [#274](https://github.com/thorwhalen/thoremin/pull/274).

## 0. TL;DR

1. **An instrument becomes a declared graph, not a settings profile over one monolithic graph.** Today `defaultGraph()` wires all 32 nodes of every instrument and each instrument is a sparse dials `Layer` that gates them on or off. The ADR introduces **branches** (named, reusable pieces of `GraphSpec` that attach to a shared **trunk**), a pure `composeGraph(branches)`, and an `InstrumentSpec` (Zod) that names its branches, its class, its tags and its settings. The engine's existing `applyGraph` swaps instruments in place, so the trunk (camera, hand model, synth, overlay) is kept and nothing reloads.
2. **Only what an instrument declares is wired, loaded and drawn.** The face branch, its model and its overlay elements exist in the graph only when an instrument's spec or a live feature demand asks for them. The inventory (§2.2) corrects the premise: for the Air Drum, Bass and Guitar the face model already does not load. The real defect is the Air Flute: its breath gate legitimately demands mouth features, which correctly loads the model but also draws the full face mesh and the expression bars, because demand scopes compute and not overlay elements. The branch model fixes that class of bug structurally.
3. **Extensions are one manifest, and the repo becomes a monorepo of packages before it becomes several repos.** One new air instrument today touches 21 source files and 6 hand-listed registries (§2.3). An `Extension` manifest (nodes, branches, instruments, dial slice, transient fields, panels) collapses those into one object; `createAppRegistry(extensions)`, `composeGraph` and a *generated* `store-controls` port list read it. The air instruments become the first in-tree extension. npm workspaces then make the future repos real packages (`sdk`, `ictus`, `taglog`, `ext-air`) while keeping one checkout, one CI and an unchanged deploy. Splitting into separate repositories is the last step, by `git subtree split`, and only after the maintainer answers #262.
4. The non-air class is **Field instruments** (the maintainer's name), class id `field` (landed in #274). Nothing persisted the old id, so the rename was code-only.

## 1. What was asked

The maintainer's Round 4 request, in substance:

- (a) *"An instrument is a general specification of how live streams go through the processing DAG and create output streams (video, overlays, sound). What streams and what nodes may be involved is unbounded."* The face overlay and model should not be there for instruments that do not use the face. Components (face model → expression names → chords → rendering) must compose flexibly, and it must stay fast in real time.
- (b) *"Everything platform oriented: wherever we can separate concerns and create clean seams, we should; bolt-on repos are one way to test the architecture concretely."* thoremin as the core engine; instrument classes or instruments as plugins/extensions injected at deploy time; deploys must keep working; can the non-core repos be public for free GitHub Actions, and does the split pay off?

The user's standing rule for this kind of work is *seams before surfaces*: decide the boundaries now so that every later iteration adds at a boundary that already exists, and declare a seam only when its replacement can be pointed at. The seam table is §6.

## 2. What the code does today (inventory, 2026-09-27)

Three read-only inventories were run against `main` at `1134a34`, and the review re-verified them against `54def9a`. File references are to this tree.

### 2.1 One graph, seventeen profiles

- `defaultGraph()` (`src/app/graph.ts`) wires **32 node instances** and **100 edges**. Every shipped instrument runs this same graph. `applyGraph` is used today only for slot swaps (`?slot.source=…`), never for instrument switches.
- An **instrument** is a sparse dials `Layer` (`src/app/dials/instruments.ts`, 17 seeds). Its **class** is derived on read from four `air*.enabled` dials (`src/app/library/category.ts`); nothing persists a class id.
- Gating is per node and hand-written: most of the 32 nodes have an `enabled`-style early return; three (`webcam-face`, `webcam-body`, the feature-vector nodes) compute a three-way OR of *dial* ∥ *Feature Lab shown* ∥ *feature demand* each tick. Idle nodes cost a cheap early return per tick; this is not a performance problem today, it is a reasoning problem: nothing states which nodes an instrument *is*.
- The **trunk** every instrument shares is already visible in the wiring: `cam` (`webcam-hands`, the only node that loads a model unconditionally in `init()`), `feat`, `ui` (`store-controls`, **32 hand-listed output ports**), `merge` (`synth-merge`: five fixed voice inputs `a..e`, a master `mute`, and since #264 a `hush` that silences `a`, `b`, `c`, `e` and keeps `d`, the conducted score), `synth`, `overlay`. `map` (the `mapping` slot's node) is *not* trunk: it is the field instruments' voice source (§3.4). *[review, finding 7]*

### 2.2 The face path, precisely

| Instrument | Face model loads | Face overlay draws | Why |
|---|---|---|---|
| Pentatonic (default), the seven non-face field instruments | no | no | `faceActive()` is false: `faceMapping='none'`, no Lab, no demand (`src/nodes/sources/webcam_face.ts:135-144`) |
| Glass Bells, Pulse Organ, Everything | yes | yes | `faceMapping` is `chord` or `timbre`: they use the face |
| Air Drum, Air Bass, Air Guitar | **no** | **no** | they set nothing face-related and claim no demand |
| **Air Flute** | **yes** | **yes: full mesh and expression bars** | `airFluteDemand.ts:19-21` claims the three mouth groups whenever `breath='mouth'` (the default); the demand loads the model, and the overlay's `faceMesh` and `faceExpressionCue` elements draw for *any* present face (`show` defaults true; `face-expression` has no mapping gate) |

So the maintainer's observation is accurate for one instrument, and the mechanism behind it is worth naming: **the demand seam (`src/features/demand.ts`) scopes compute correctly and scopes rendering not at all.** A claim on `face.geom.mouth` should produce a mouth cue, not an emotion bar graph. Any fix that adds a fourth hand-written OR condition to the overlay would repeat the pattern that produced the bug.

### 2.3 What one new instrument costs

The Air Flute commit (`996e2cb`, PR #258) touched **39 files: 21 under `src/` (16 modified, 5 added) across 6 hand-listed registries** *[review, finding 7]*: `CORE_NODES`, the dials schema (two files), `AIR_INSTRUMENTS`, `AIR_UI`, `store-controls` (+3 of its 32 ports: the `airFlute` dial object and two transient model fields), `synth-merge` (+1 input `e`), plus `graph.ts`, `useEngine.ts`, `App.tsx`, `store.ts`, `instruments.ts`. The command registry needed nothing by hand (per-dial commands are generated from the dials schema, the one registry that already composes). This number is the concrete measure of "how many seams a plugin must extend", and the target is: one directory, one manifest object, zero edits outside it. Reaching zero requires `store-controls` to be generated too (§3.5, seam 6); without that, an extension's dial slice still edits a trunk node.

### 2.4 Module boundaries and the bundle

- **Pure leaves** (import nothing else in `src/`): `dag`, `ictus`, `taglog`, `lazy`, `keys`, `util`, `hooks`. **Import nothing from `src/app`**: everything except `App.tsx`, `main.tsx` and `plugins`. `src/nodes/**` imports nothing from `src/app` (no store, no React). These facts are what make a core package a cut and not a rewrite. The cut is not free of churn, though: `@/dag` is imported from about 140 files across `src`, `test` and `scripts` (`ictus` 23, `taglog` 18, `lazy` 15, `features/demand` 11), so the workspace step is a codemod, not a hand edit (§7, PR 6). *[review, finding 7]*
- **One real cycle to break:** `src/settings/schema.ts` and `dials.ts` import the dial schemas of concrete nodes (`air_drum`, `air_bass`, `air_guitar`, `air_flute`, `conductor`, `face_controls`, `indirect_map`, `hand_map`, `canvas_overlay`), while `store_controls.ts` imports types from `settings/schema`. An extension that owns a node must also own that node's dial slice, so the core settings schema must stop naming extension nodes (§4.2).
- **Bundle** (vite build, 23 chunks, 4.06 MB raw / 1.01 MB gzip). The entry chunk is 1.1 MB raw / 342 kB gzip and is dominated by vendor libraries (react-dom, cmdk, acture, zodal, tonal, lucide), not by node code. Every heavy vendor library is already behind a dynamic `import()` gate (tasks-vision, genai, webmidi, libflac, the AI SDKs, the score loaders), and the frozen legacy app is a separate 1.38 MB chunk. **So per-instrument code splitting is not where the bytes are**; it becomes worth doing when extensions are separate packages, and the design leaves that seam open (§6, row 3) without building it now.
- **Deploy.** thoremin's `deploy.yml` only dispatches `tw_platform`'s workflow, which checks out `thorwhalen/thoremin` **with no token** (a public-repo assumption; thoremin is absent from the GitHub App's repository scope), builds on the server with `npm ci && npm run build` per `app.toml`, and rsyncs `frontend/`. `acture` is consumed from the npm registry, not a sibling checkout: the proven pattern for a split. **A private thoremin breaks the deploy at the checkout step** until it is added to the App token's scope the way `tetrachord` and `tagai` are. That change is tw_platform's and is thoremin-mgr's to arrange.
- Tests: 183 files, 2083 tests at the inventory commit; **20 files** instantiate `defaultGraph()` or `createAppRegistry()` and pin node ids, port names and slot candidates *[review, finding 7]*. PR 1 below must leave all of them green with no edits.

## 3. Decision A: the instrument as a declared graph

### 3.1 Vocabulary

| Term | Meaning | In code |
|---|---|---|
| **Trunk** | The nodes every instrument shares: the hand source, hand features, the UI bridge, the voice merge, the synth, the overlay. A branch every spec includes implicitly. | one `GraphBranch` named `trunk` |
| **Branch** | A named, reusable piece of graph: nodes, edges, the voices it contributes to the merge (with their role), and the overlay elements it wants drawn. Attaches to the trunk by wiring to trunk node ids. The word is already in use here ("the face branch", "the generative branch", "a second camera branch"). It collides with `git`'s word; in this repository "branch" without a qualifier means the graph piece, and a git branch is called that in full. Noted once, here. *[review, §9 Q3]* | `GraphBranch` (Zod) |
| **Instrument spec** | Metadata (id, name, class, tags, emoji) + the branches it needs + its settings `Layer` + optional training/enrolment hooks. What the library lists, what the player picks. | `InstrumentSpec` (Zod) |
| **Class** | The instrument's kind for grouping and colour: `field` ("Field instruments") or `air`. An open registry with two entries (`INSTRUMENT_CLASSES`, #274). | `src/app/library/category.ts` |
| **Demand** | A live runtime claim on feature groups by a tool (Lab, Trainer) or a node (the flute's breath). Already exists. | `src/features/demand.ts` |

A branch is **not** a node and **not** a settings fragment: it is wiring. `#82`'s fragments are sparse settings `Layer`s (values); a branch is a sparse `GraphSpec` (topology). An instrument is one of each: *branches say what runs, the layer says with which values.*

### 3.2 The shape

```ts
// src/instruments/branch.ts — pure, no React, no DOM
const VoiceRole = z.enum(['instrument', 'score']);   // 'instrument' voices are hushed by `hush`; 'score' voices are kept
const GraphBranch = z.object({
  id: z.string(),                        // 'trunk' | 'face-source' | 'face-chord' | 'air-drum' | ...
  requires: z.array(z.string()),         // branch ids that must be present (resolved transitively)
  nodes: z.array(NodeSpec),              // ids unique across the composed graph, or identical duplicates
  edges: z.array(EdgeSpec.extend({ optional: z.boolean().default(false) })),  // see the cross-branch rule
  voices: z.array(z.object({ from: PortRef, role: VoiceRole })),  // the composer allocates merge inputs by role
  overlay: z.array(z.string()),          // overlay element ids this branch wants drawn
  demands: z.array(z.string()).optional() // feature groups whose claim implies this branch at runtime
});

// src/instruments/spec.ts
const InstrumentSpec = z.object({
  id: z.string(), name: z.string(),
  class: z.string(),                     // 'field' | 'air' (INSTRUMENT_CLASSES; normaliseClassId at the read boundary)
  tags: z.array(z.string()).default([]),
  emoji: z.string().optional(),
  branches: z.array(z.string()),         // by id; 'trunk' implied
  settings: LayerSchema,                 // the dials Layer, exactly what a saved instrument is today
  training: z.object({ route: z.string() }).optional(), // where "train this instrument" goes (the trainer stream reads it)
});
```

> **As built (PR 4, #280):** the persisted spec is a *join*, not a third store: the `settings` Layer stays in the dials profile store, and `class` (a cache of the derivation), `branches`, `training`, `image`, `emoji` and the tags live in the library's metadata record; `assembleSpec` produces the record above plus `starred` and a derived `features` facet (the branch closure minus the trunk) for the Instruments view. An explicit `branches` list is persisted and assembled, and `branchIdsFor` honours it when given, but the engine host does not read it yet: honouring it at runtime needs a writer, and the writer must be a dial or a command (restored on undo and reload), so it lands with the first UI that sets branches. See `instrument-library.md`, Decision 7.

**`composeGraph(branchIds, registry): { spec: GraphSpec; elements: string[] }`** is a pure union with four rules:

1. **Shared nodes must be the same node.** A node id appearing in two branches must have the same type and the same validated params (the identity `applyGraph` already uses); a conflicting duplicate is rejected with both branch ids in the error.
2. **An edge belongs to the branch that declares it, and may reach outside it.** *[review, finding 4]* Today's wiring crosses every line the branches draw: `faceFeat → imap.face`, `faceVec`/`camFace → airFlute`, `conductor.time → airDrum.time`, `poseChord.chord → chordSel.b`, `bodyRoute → map.mods`, `faceFeat → map.face`. A "pure union" of independently declared pieces would leave such an edge dangling and the engine would refuse to compile. So: an edge whose far endpoint is in a branch that is absent is **dropped if the declaring branch marked it `optional`**, and is **a composition error otherwise** (which forces the declaring branch to say `requires`). The generative branch's face input, the drum's conductor clock, the body router's hook into the hand voices are optional; the face-timbre branch *requires* `field-voices` (it has no meaning without the voices it colours), and the two face-chord branches require `face-source`. `chordSel` lives in `face-source`, since it only ever picks between face-derived chords.
3. **Voices are allocated by role.** *[review, finding 2]* `synth-merge` declares two pools, `voice1..voice8` (hushed by `hush`) and `score1..score2` (kept), replacing `a..e`; the composer assigns each declared voice to the next free input of its role. The synth keys its voices by `v.id` (`webaudio_synth.ts`), so which merge input a stream arrives on never retriggers a note; only the role had to be preserved, and now it is declared rather than remembered.
4. **The overlay's element set is data on a port, not a param.** *[review, finding 3]* `compile` reuses a node only when its params are equal, so an `elements` *param* would rebuild the overlay (the trunk's most stateful node: HUD layout, the recording's alpha canvas) on every switch that changes the set, and "trunk kept" would be false. Instead the composer returns the element ids, the switch writes them to the hot store's transient `graph.elements` field *before* it applies, and `store-controls` emits them on a generated `graphElements` port wired to the overlay's new `elements` input. The overlay draws the intersection of that set and each element's own `show` dial. This keeps the fact in the graph (recordable, replayable) and the overlay instance alive.

`graphFor(spec, demands)` = `composeGraph(spec.branches ∪ branchesImpliedBy(demands))`. A Lab claim on a face group implies `face-source` and a small `face-landmarks` element; the flute's breath claim implies `face-source` and a `mouth-cue` element (new, ~40 lines) and nothing else. This is the fix for §2.2, and it is the same code path as the static case.

### 3.3 Runtime: switching instruments is an `applyGraph`

`useEngine` today re-applies the graph on a slot change only. It will re-apply on **instrument switch and demand change** with `graphFor(spec, demands)`. Because the trunk is unchanged between any two instruments, the engine keeps `cam` (hand model loaded), `synth` (audio graph), `overlay` (canvas and HUD state, by rule 4 above) and `ui`, and rebuilds only the branch nodes. `applyGraph` plans synchronously (a bad spec is a no-op), inits new nodes while the old graph keeps ticking, and commits atomically (`component-model.md` → "Swapping at runtime"). Composition runs once per switch, never per tick; the tick loop is untouched. Real-time cost per tick goes *down* (the idle early returns disappear), and a switch costs the `init()` of the incoming branch's nodes.

Two engine facts constrain the design and are honoured rather than worked around: fan-in to one input port is rejected (hence the merge pools, not a variadic port), and `NodeDef.inputs` is static (hence the pools are declared on `synth-merge`, and the composer, not the node, does the allocation).

**Proof, not assertion.** *[review, finding 9]* PR 3 ships two tests: (i) a headless switch test over the `Applier` with a simulated clock, asserting that between any two seed instruments the engine's tick counter advances every period during the switch and the trunk's node instances are identical before and after; (ii) a **property test**: every seed × every subset of `{face groups, body groups, none}` demand compiles under `runHeadless` with `validatePorts` on and ticks for 30 frames. The second would have caught finding 4 on paper. The latency probe (`?probe=latency`) is the human check that a live switch produces no audible hole; it goes on #146's list.

### 3.4 What becomes a branch (the first cut)

| Branch | Nodes today | Voices (role) | Overlay elements | Implied by (the derivation from dials) |
|---|---|---|---|---|
| `trunk` | `cam`, `feat`, `ui`, `merge`, `synth`, `overlay` | — | video backdrop, landmarks | always |
| `field-voices` | `map` (the `mapping` slot), `handVec`, `gesture` | `map.params` (instrument) | scale guide, markers, finger lines/bars | **the voice dials, never the class** *[review, finding 1]*: `handMap.maxGain > 0` (the air seeds' own way of silencing the hands). A field instrument with a drum added is class `air` and still plays its hand voices; a class-based rule would have muted it, breaking §4.5's promise |
| `face-source` | `camFace`, `faceVec`, `chordSel` | — | `face-landmarks` (small) | `faceMapping ≠ none`, or any face-group demand |
| `face-timbre` | `faceFeat` → `map.face` (requires `field-voices`) | — | — | `faceMapping = 'timbre'` |
| `face-chord` | `faceExpr`, `exprChord` (requires `face-source`) | `exprChord.params` (instrument) | expression cue, chord label | `faceMapping = 'chord'` |
| `face-controls` | `faceCtrl`, `poseChord` (requires `face-source`) | `poseChord.params` (instrument) | pose cue | `faceMapping = 'controls'` |
| `body-source` | `camBody`, `bodyVec` | — | body frame | `body.enabled`, or a body-group demand |
| `body-route` | `bodyRoute` → `map.mods` (optional edge) | — | — | `bodyMap` non-empty |
| `conductor` | `conductor`, `score` | `score.params` (**score**) | conductor time | `conductor.enabled` |
| `midi-out` | `midiOut` | — | — | `midi.enabled` |
| `generative` | `imap`, `gen` (`faceFeat → imap.face` optional) | — | — | `steer.enabled` |
| `air-drum` | `airDrum`, `drumOut` (`conductor.time → airDrum.time` optional) | — | pads, sticks, hits | `airDrum.enabled` |
| `air-bass` | `airBass`, `bassOut` | — | neck | `airBass.enabled` |
| `air-guitar` | `airGuitar`, `guitarOut` | — | chord readout | `airGuitar.enabled` |
| `air-flute` | `airFlute` (+ `mouth-cue` element; face edges optional) | `airFlute.params` (instrument) | mouth cue | `airFlute.enabled`; demands the mouth groups when `breath = 'mouth'` |

The right column is the **derivation** from today's dials. It exists so that PR 1 and PR 3 change no persisted shape and no UX: every saved instrument in every player's browser keeps working, because its branch set is computed from the `Layer` it already is, and the golden test (§4.5) pins that the derivation reproduces today's graph for every seed. The explicit `branches` field arrives with the persisted spec (PR 4) and the derivation becomes the migration for specs that lack it.

### 3.5 What stays, and the one trunk node that must become generated

- **`store-controls` stays the one bridge from the hot store to ports, but its port list becomes generated.** *[review, finding 5]* Today it is 32 hand-listed ports, and the flute had to add three: that is the seam that defeats the "zero edits outside the extension" target. The replacement already exists in the file: the whole-object ports (`airDrum`, `airFlute`, `conductor`, `faceControls`) that pass one top-level dial as one value. So: **one port per top-level key of the composed dials schema, plus one per transient store field an extension declares in its manifest**, generated at registry build time from the same schema the commands are generated from. The hand-written scalar ports (`magnetism`, `scaleRight`, …) survive as the trunk's own slice. Seam 6 in §6.
- **Overlay elements stay functions inside the one overlay node** (`component-model.md`'s promotion rule). The branch model only decides *which* elements are in the list, and delivers that list on a port (§3.2 rule 4).
- **The demand seam stays the runtime mechanism.** It gains one reader (`branchesImpliedBy`) and loses three (the per-node OR conditions become unnecessary once a node is simply absent when unwanted). `webcam-face`'s `faceActive()` can be deleted, not extended.
- **The `mapping`, `source` and `body` slots stay.** A slot chooses a node type *inside* a branch; a branch chooses which nodes exist. They compose: `field-voices` reads the `mapping` slot for `map`'s type.
- **Two slots are named and deferred.** *[review, finding 8]* The maintainer's composability ask (model → expression names → chords → rendering, as swappable parts) is answered by slots inside the face branches, not by finer branches. An **`expression` slot** (face frame → expression scores; today's candidate `face-expression`, and a pointable second candidate: the Trainer's learned classifier over the face vector, `src/enroll/classify.ts`, once it emits the same `expression` port kind) is a real seam and is declared as a slot in PR 3 with one candidate wired. A **`chord-mapper` slot** (expression → chord; today's only candidate `expression-chord`) has no second implementation and stays a fixed component with options, per the ≥2 rule; the place where it would go is `face-chord`'s node table. Neither is built as a dropdown.

### 3.6 Reconciliation with #82 (the configuration calculus)

#82 composes **values**: sparse `Layer`s stacked through the dials cascade, plus `Layer → Layer` transformers. This ADR composes **topology**: branches unioned into a `GraphSpec`. They are orthogonal halves of one instrument, and they meet in exactly one place: `branchesFor(settings)` reads the *resolved* layer. A #82 recipe (scale fragment + timbre fragment + face fragment) resolves to a layer, and that layer implies its branches. Nothing in #82 needs to change; its "face fragment" becomes the thing that turns on the `face-chord` branch. The word *fragment* stays #82's; this document never uses it for wiring.

### 3.7 The class id: `theremin` → `field` (done, #274)

The maintainer named the non-air class **Field instruments**. `INSTRUMENT_CLASSES` (`src/app/library/category.ts`) carries `{ id: 'field', label, emoji, colour }` and `{ id: 'air', … }` so the UX stream tints and groups from one record; `normaliseClassId` maps `theremin → field` at the read boundary (`LEGACY_CLASS_IDS`). The id was derived and never persisted (no localStorage key, no URL parameter; recordings store instrument *names*), so the rename was code-only, and the normaliser is there for the persisted spec (PR 4) and any hand-written id.

## 4. Decision B: extensions, and the shape of the repository

### 4.1 Seams before repositories

The maintainer's test for the architecture is that a bolt-on repository can carry an instrument. That test can be passed **without a second repository**: it is passed the moment an extension is one object the app consumes through a manifest, with a CI job that builds the app against an extension installed from outside `src/`. A repository split then changes where files live, not how they compose. Doing it in that order is what keeps the split cheap and reversible; doing it the other way round (split first, then discover the seams) is the do-then-redo the architecture-first rule exists to prevent. The workspace step (O2) is not a detour on the way to a split: `git subtree split` needs the package layout to exist first. *[review]*

### 4.2 The `Extension` manifest

```ts
// sdk/extension.ts — what an extension exports as its default
export interface Extension {
  id: string;                                   // 'air'
  nodes: NodeDef[];                             // registered into the app registry
  branches: GraphBranch[];                      // composable wiring (§3.2)
  instruments: InstrumentSpec[];                // seeds the library lists
  classes?: InstrumentClass[];                  // new classes, if any
  dials?: { schema: ZodObject; defaults: object; panels: Record<string, PanelDef> };  // its settings slice + editor sections
  transient?: Record<string, ZodType>;          // hot-store fields it needs as ports (a learned model, a status)
  overlayElements?: OverlayElement[];           // elements its branches may name
  training?: TrainingHook[];                    // what the trainer stream needs per instrument
}
```

The app composes extensions in six places, all of which exist today as hand-listed arrays and become folds over `extensions[]`: the node registry (`createAppRegistry(extensions)`), `composeGraph`'s branch table, the dials schema (`z.object({...core, ...ext.dials.schema.shape})`, which is what breaks the settings → nodes cycle of §2.4: core `schema.ts` stops importing air node schemas because the air extension owns them), the generated `store-controls` port list (§3.5), the instrument seeds, and the editor's per-instrument sections (today's `AIR_UI`, already keyed by instrument id and already `satisfies Record<AirInstrumentId, …>`, which is the manifest pattern in miniature). Per-dial commands, the palette entries and the AI tool surface need nothing: they are generated from the dials schema, so an extension's dial slice earns them for free, as the flute already showed.

> **As built (PR 5a):** the manifest is two halves that mirror the two SDK entry points: `Extension` (pure: `src/instruments/extension.ts`: nodes, branches, dial slices, transient ports, `derive`) and `ExtensionUi` (React: `src/app/extensions/types.ts`: editor sections per instrument, status hooks with `make`/`onRemoved`/`reset`, mount effects). The lists are `EXTENSIONS` (`src/extensions`) and `EXTENSION_UIS` (`src/app/extensions`); the fold points are `createAppRegistry(extensions)`, `makeStoreControlsNode(extensions)` (seam 6: one whole-object port per dial slice, one per transient field), `ALL_BRANCHES` in `graph.ts`, `branchIdsFor` and `assembleSpec` (bound there to the extension table; the pure `deriveBranchIds` and `assembleSpecWith` in `src/instruments` take it as a parameter), the settings schema and dials form (the slices), `DialsControlsPanel` (panels), `useEngine` (status hooks), `App` (mount effects). The air instruments are the first extension, registered at their pre-move paths; `test/extensions_boundary.test.ts` guards that core reaches the extensions only through the lists from the fold points (one typed exception: `settings/schema.ts` spreads the air dial shape so the `Settings` type keeps its air keys). The physical move (5b) and the "an extension imports only the SDK" guard come next; the `sdk/ui` re-export module comes with them.

> **As built (PR 5b):** the air files moved into `src/extensions/air/{nodes,lib,app,panels}` by a purely mechanical mover (a rename table plus an import-specifier rewrite; no file content was regenerated). Some files stay in core because core uses them too: `drum_pads.ts` and `drum_anchor.ts` (the overlay draws pads and sticks), `music/notes.ts` and `music/fingerings.ts` (the fingering charts, read by the trainer's starter sequences) and the four drum-pattern libraries (the hot store types its pattern field with them). The node barrels no longer re-export air names; the overlay reads the flute's status through a structural `BreathStatus`. **There is no SDK barrel module**: the reverse guard's `SDK_SURFACE` list in `test/extensions_boundary.test.ts` is the SDK contract as data, computed from what the extension imports (a barrel re-exporting it closes a module cycle through the settings schema and drags JSX into the strict typecheck). PR 6 cuts the `sdk` packages from that list.

> **As built (PR 6):** npm workspaces, with the four directories that were already pure leaves cut into packages consumed as TypeScript source (no build step): `@thoremin/dag`, `@thoremin/ictus`, `@thoremin/taglog`, `@thoremin/lazy` (`packages/<name>/src`, an `exports` entry per module, the importers' specifiers rewritten mechanically; `test/packages_purity.test.ts` holds each package to its own files and its declared dependencies). The deploy is unchanged: `npm ci && npm run build` at the root links the workspaces from the lockfile. The extension list is now data injected at build time: `extensions.json` names the extensions and `vite.extensions.ts` turns it into two virtual modules the list modules import (`THOREMIN_EXTENSIONS` points a build at another file; a module is named by an alias or a package, never a path). **What the manifest does not do yet:** a build from a manifest without `air` has no air node, branch, port or panel, but still carries the air code in its bundle, because `src/settings/schema.ts` imports the air dial shape directly so that the `Settings` type knows the air keys (the one named exception in the boundary guard). Generating that type from the manifests was planned for this PR and is deferred to the `sdk` cut below; until it lands, "the deploy chooses the set" is true of what runs and not of what ships. **Not cut, and why:** `ext-air` and an `sdk` package. The air extension's React side imports the app half of the SDK surface (the hot store, the dial dispatchers, the settings hook, the trainer's hooks), which lives in the app; a package cannot depend on the app that depends on it, so `ext-air` becomes a package when that app half is itself extracted (an `sdk-ui` package), which is a refactor of the app's state layer and not a mechanical cut. The pure half of the surface is partly packages already (`dag`, `ictus`, `lazy`); the rest (`nodes/domain`, `instruments`, `features`, `music`, `enroll`) has cross-imports that need untangling first. The boundary guard keeps both halves honest in the meantime, and `SDK_SURFACE` is the list to cut from.

> **As built (after PR 6, follow-up a):** the `Settings` type is generated from the manifests, and the named exception is gone. `npm run extensions` (`scripts/gen_extensions.ts`) writes the declaration of `virtual:thoremin/extensions` from `extensions.json` (or `THOREMIN_EXTENSIONS`) as a tuple of each listed manifest's own type (`typeof import('@/extensions/air').default`): a type-only import, erased from the bundle; a test fails when the file is stale. `defineExtension` and `dialSlice` keep the slices' keys and schemas literal, `ExtensionsSettingsShape<Es>` folds them into a shape, and `SettingsSchema = CoreSettingsSchema.extend(EXTENSION_SETTINGS_SHAPE)`, so `Settings['airDrum']` is `AirDrumSettings` with no import of air in core. The schema is now a fold point; the hot store defaults, heals and types its extension dials through `EXTENSION_DIAL_SCHEMAS` / `extensionDialDefaults()` / `ExtensionDials`, and the instruments' nested-key heal folds over the same schemas. Breaking the one cycle this opened (schema → list → air branches → `src/instruments/branches` → schema) moved `DEFAULT_STEER_CONFIG` to its node (`indirect_map.ts`), re-exported from the schema. Measured: a build from an empty manifest bundles none of the air nodes (main chunk 1,098 kB against 1,230 kB). Still named in core, as strings and types rather than imports: the overlay's `airDrumConfig`/`airFluteStatus` ports, the hot store's transient fields and their setters, the seeds, `AIR_INSTRUMENTS`, the training routes table, the real-vs-air routines.

> **As built (after PR 6, follow-up b): core alone.** `npm run test:core` typechecks core strictly against `extensions.core.json` (no extensions; `tsconfig.core.json` reads the generated `extensions.core.d.ts`, so `Settings` has no extension key), runs the suite with that manifest, and builds it, failing if the bundle carries any node type, branch id or dial kind of a shipped extension; CI runs it as its own job. Tests that exercise an extension opt out with `it.runIf(AIR)` (`test/helpers/extensions.ts`); core tests that count an extension's nodes branch on it. Making it pass moved two more hand-listed remnants into the manifest: the shipped air instruments (`Extension.instruments`, patches over the default settings that core's seeder deep-merges and validates; the seed list is byte-identical) and the training routes (`Extension.training`: the routes and the branch → route table; core keeps only its Trainer fallback). Still named in core, as strings: the overlay's `airDrumConfig`/`airFluteStatus` ports, the hot store's transient fields and setters, `AIR_INSTRUMENTS` (labels and emoji), the real-vs-air routines.

> **As built (after PR 6, follow-up c, part 1): `@thoremin/sdk`, the pure SDK as a package.** `packages/sdk` holds what an extension's pure side imports, closed over what those modules import: 38 files moved by `git mv` with every specifier rewritten mechanically (363), so it is `@thoremin/sdk/<path>` from outside and relative inside. It is the manifest and branch types, the trunk's names (split out of the branch table into `instruments/trunk.ts`, so wiring to the trunk no longer drags the trunk's node implementations into the SDK), the port kinds, and the libraries the air extension shares with core: `music/*` (theory, sounds, notes, fingerings, drum patterns, GM drums), `enroll/*` (the trainer's pure core), `features/*` (catalog, demand, the Lab config), `drums/*`, `score/schema`, the drum pad geometry. The extension is these libraries' second consumer, the rule that made `ictus` a package, so this departs from §4.4's "stay in the app until a second consumer appears" only in fact, not in principle. The pure half of `SDK_SURFACE` is gone from the boundary guard: `packages_purity` enforces the package, and an extension's pure side may import only packages. Next: `@thoremin/sdk-ui` (the app half, with the host injected), then `ext-air`.

**The SDK has two entry points, and the panel contract is one of them.** *[review, finding 6]* The flute's panel imports `dispatchDialSetIn`, `useDialsSettings`, the panel primitives, a status hook and the vocabulary store from `src/app`; an SDK of engine types alone would fail the "extension imports only the SDK" guard on the first extension. So:

- `sdk` (pure; no React, no acture, no DOM): the DAG engine and types, `defineNode`, port kinds, the slot contracts, `GraphBranch` / `InstrumentSpec` / `Extension` / `InstrumentClass` schemas, `lazy`, `features/demand`. A test pins that importing it pulls no React into `sys.modules`' equivalent (the module graph).
- `sdk/ui` (React + acture): the three dial dispatchers (`dispatchDialSet` / `dispatchDialSetIn` / `dispatchDialPatch`), `useDialsSettings`, `useNodeOutput(nodeId, port)` (the generic form of `airFluteStatus`), `LoadStatusReadout`, and the panel primitives. The dials write-path guard extends its AST walk to extension panels, so an extension cannot bypass command dispatch.

The vocabulary store (`src/extensions/air/app/vocabularyStore.ts`) and the enrolment component are the air extension's own and move with it. Two guards, both tests in the pattern of `commands_firewall.test.ts` (`test/extensions_boundary.test.ts`): core imports nothing from `src/extensions/**` outside the fold points; and an extension imports only the SDK surface, packages and itself. The surface is listed as data in two halves: the pure half (engine, contracts, music libraries) is all an extension's nodes, libraries and pure manifest files may import; its React side may also import the app half (the dial dispatchers, the settings hook, the panel primitives, the hot store, the demand registry, the trainer's hooks). Until PR 6 cuts the packages, those `src/app` modules ARE the app half of the SDK.

**The first extension is `air`** (drum, bass, guitar, flute): four node files, four panels, four seeds, four dial slices, one status/demand module each, already grouped in the code and the docs, with no other instrument depending on them. Its move is a `git mv` into `src/extensions/air/` plus the manifest. **Field instruments stay in core** *[decision, §9 answer 1]*: `voice-mapping` is the trunk-adjacent voice source three other branches wire into (`face-timbre`, `body-route`, `face-source`'s consumers), and moving it would make those cross-extension edges before the optional-edge rule (§3.2 rule 2) has been exercised by a real second extension. `ext-field` is the symmetric next step once the rule has a track record; it is recorded, not scheduled.

### 4.3 Repository organisation: the options

| | O1 · monorepo, manifest only | **O2 · monorepo of workspace packages (decided: inside Round 4, after PR 5)** | O3 · separate repositories |
|---|---|---|---|
| Layout | `src/extensions/air/` + manifest | root app + `packages/{sdk,ictus,taglog,ext-air}` (npm workspaces) | `thoremin` (app) + `thoremin-sdk`, `thoremin-ext-air`, `ictus`, `taglog`, each its own repo, consumed from the npm registry (the `acture` pattern) |
| Enforces the seam | by test only | by `package.json` dependencies and per-package `tsconfig` (an extension physically cannot import the app) | strongest: separate histories, versions, licences |
| Deploy | unchanged | unchanged: `npm ci && npm run build` at the root installs workspaces; `tw_platform` untouched | app unchanged; extensions publish to npm first; a private core needs the App token in `tw_platform` (§2.4) |
| CI | one workflow, free while public | one workflow; per-package test matrices possible | one workflow per repo; free for every public repo; cross-repo changes need two PRs and a version bump |
| Cost to reach | ~1 PR | ~1 PR of config plus a codemod after O1 | O2 + `git subtree split` per package (history preserved) + registry publishing + version discipline |
| Reversibility | trivial | trivial (delete the workspace field) | painful: merging repos back loses the simple story |
| Serves #262 | no | **yes**: a licence file per package, a public/private decision per package, without committing to either | yes, and forces the decision now |

**Decision: O1 → O2 inside Round 4, O2 only after PR 5 has proved the manifest with a real extension; O3 when #262 is answered and only for the packages the answer needs.** *[§9 answer 2]* O2 is where the split "pays off" in the maintainer's sense: every future repository already exists as a package with its own manifest, tests, README and licence file, the seams are enforced by the module system, and nothing has been published or made irreversible. "Injected at deploy time" is satisfied at O2 by a build-time manifest (`extensions.json`, or `VITE_EXTENSIONS`, read by a tiny Vite plugin that generates the extension import list); at O3 the same manifest names registry packages, and the injection point does not move.

### 4.4 The package cut (O2)

| Package | Contents | Why it is a package |
|---|---|---|
| `packages/sdk` | `packages/dag/src` (engine, registry, applier, recorder), `packages/lazy/src`, `src/features/demand.ts`, the slot contracts, `src/nodes/domain.ts` (port kinds), `GraphBranch` / `InstrumentSpec` / `Extension` schemas, `defineNode`; and under `sdk/ui` the panel contract of §4.2 | the one thing an extension author needs; the natural public contract; the pure entry stays React-free |
| `packages/ictus` | `packages/ictus/src` | already pure; #178 wants it in `muvid` too |
| `packages/taglog` | `packages/taglog/src` | already pure and documented as extraction-ready |
| `packages/ext-air` | `src/extensions/air` | the first extension; the proof of the manifest |
| root (`thoremin`) | the app shell, the trunk nodes, the field instruments (`field-voices` and the face branches), the library, commands, panels, recording, trainer, assistant | the deliverable; the deploy unit |

`src/nodes` splits by *who owns the node*: trunk and field nodes stay in the app (or a later `ext-field`), air nodes go to `ext-air`, and the engine-level contracts go to `sdk`. `src/music`, `src/features` (catalog, formula, normalizer), `src/enroll`, `src/score` stay in the app until a second consumer appears, the same rule that has served `ictus`.

### 4.5 What must not break

- **Deploy**: root `npm ci` and `npm run build` keep working at every PR (a smoke assertion in CI: the built `frontend/index.html` still references exactly one entry chunk). `tw_platform` is not touched by this sequence; the two things it may need later (App-token checkout if thoremin goes private; nothing at all for O2) are thoremin-mgr's to schedule.
- **Saved instruments**: every PR keeps the derivation from dials (§3.4) as the fallback, so a `Layer` saved on any earlier version yields the same graph it does today. Finding 1 is the reason the derivation reads dials and not the class.
- **The 20 wiring tests**: PR 1 is gated on a golden test that `composeGraph(allBranches)` deep-equals today's `defaultGraph()` output (node set, edge set, params; merge inputs compared by role, since `a..e` become `voice1..`/`score1`), so the existing suite is the regression net rather than being rewritten.
- **The write-path and firewall guards** extend to extensions; none is weakened.

## 5. #262: the technical options, and the one opinion asked for

What the split makes *possible*, so the maintainer can choose; the choice itself is out of scope for every agent.

| Tier | Public | Private | What an extension author can do | Actions cost | Fragility |
|---|---|---|---|---|---|
| T1 | everything | nothing | write and *test* extensions against the real engine and fixtures | free everywhere | none |
| T2 | `sdk`, extensions (`ext-air`, `ictus`, `taglog`) | the app (shell, trunk, field instruments, trained data) | write extensions; **cannot run them** against the real engine in their own CI unless the private app is installable there (a registry token in the public repo's secrets, or a published private package) | free for the public repos; the private app pays per minute and today has no hosted CI at all (the account's Actions block) | medium: the sdk must be versioned honestly, and an extension's tests degrade to unit tests unless the engine is reachable |
| T3 | `sdk` + the engine and trunk (a public "engine" package) | the app shell, instruments, trained/enrolled data, hosted service | write **and test** extensions for free; the value that is kept private is the instruments and the data, not the plumbing | free for everything except the private app | low: this is the classic open-core cut, and the package boundary in §4.4 already draws it |

**The opinion the maintainer asked for** ("see if you agree that non-core repos can be public, and that it's useful"): *[review]* an extension is useless without the core, exactly as a plugin is useless without its host, and that is not a problem; what matters is whether it is **testable** without the core. It is not: an air instrument's tests replay recorded hands through the real engine and trunk. So **public extension repositories only pay off if the SDK and the engine are public too (T3)**; T2 gives free Actions to repositories whose CI cannot exercise what they ship. Which tier applies is #262's decision, so **no repository is split or published this round**; the sequence below stops at the workspace layout that makes any of the three tiers a mechanical step. Per-package licence files are mechanical once O2 exists. Data derived from third-party footage stays out of every public package regardless of tier (the standing provenance rule). The only deploy consequence of any tier is the App-token checkout in `tw_platform` for whichever repo goes private.

## 6. Seam table (architecture-first)

| # | Seam | v1 default (no new dependency) | Replacement that already exists to point at |
|---|---|---|---|
| 1 | which branches an instrument has | derived from its dials `Layer` (§3.4) | the explicit `branches` field of a persisted `InstrumentSpec` (PR 4) |
| 2 | how voices reach the synth | two declared pools by role (`voice1..8` hushable, `score1..2` kept), allocated by the composer | a variadic merge once the engine allows dynamic ports (`dag/types.ts`, static `inputs` today) |
| 3 | how an extension's node code is loaded | statically, through the manifest array | `registry.registerLazy(type, () => import(...))` resolved before `applyGraph` plans, giving one chunk per extension (`lazy-loading.md`'s loader seam, applied to node *definitions*) |
| 4 | where the extension list comes from | an in-tree array of manifests | a build-time `extensions.json` (O2) naming registry packages (O3) |
| 5 | the class registry | two entries, `field` and `air` (#274) | an extension's `classes` field |
| 6 | how a dial reaches the graph | `store-controls` ports **generated**: one per top-level key of the composed dials schema, one per declared transient field, plus the trunk's hand-written scalars | the whole-object ports already in `store_controls.ts` are the pattern; nothing further needed |
| 7 | the face's expression classifier | the `expression` slot with one candidate, `face-expression` | the Trainer's learned classifier (`src/enroll/classify.ts`) emitting the same port kind |

```
Surface for v1: the app (the instrument picker and the editor read the spec); the CLI is the headless composer test (`runHeadless` over `graphFor`), which is also the "one-command proof"
NOT seams:      overlay z-order (list order, on purpose); the chord-mapper (one candidate, a fixed component with options, §3.5); the licence per package (a file, #262's to fill); the React Flow patcher (#14, unchanged)
```

Seven rows is the ceiling the architecture-first rule sets; rows 6 and 7 were added by the review because each has a replacement already in the tree, and the table will not grow further in this sequence.

## 7. The PR sequence

Each PR is independently landable and leaves every existing test green. Sizes are estimates of changed source lines excluding tests. PR 2 is done (#274).

| # | PR | Scope | Verifies | Unblocks / coordinates |
|---|---|---|---|---|
| 1 | **Branches and the composer** | `src/instruments/{branch,compose}.ts`; the four composition rules of §3.2 (shared-node identity, owned edges with `optional`, voice roles and the two merge pools, the element set as data); `defaultGraph()` re-expressed as `composeGraph(ALL_BRANCHES)`; `synth-merge` inputs `a..e` become `voice1..8` + `score1..2` with `hush` semantics by pool | golden test: composed spec equals today's (merge inputs by role); the property test of §3.3 over every branch subset that the derivation can produce; the 20 wiring tests unchanged | pure refactor, ~450 lines; touches `graph.ts`, `synth_merge.ts` |
| 2 | **Classes** (done, #274) | `INSTRUMENT_CLASSES` with `field`/`air`, label, emoji, colour; `theremin → field`; `normaliseClassId` | `library_category` tests; `air_instruments_view` reachability | the UX stream reads it |
| 3 | **Only what is declared runs** | `graphFor(settings, demands)` with the dial-based derivation; `useEngine` re-applies on instrument switch and demand change; the overlay's `elements` input fed by the `graphElements` port; `mouth-cue` element; the `expression` slot declared with one candidate; delete the per-node OR gates | per-seed graph snapshot tests (Air Drum has no `camFace`; Air Flute has `camFace`, `mouth-cue`, no `faceExpressionCue`; Glass Bells has `face-chord`; a field instrument with a drum added keeps `map`); the no-dropped-tick switch test and the seed × demand property test of §3.3; a jsdom test that the face chip is absent for the flute | fixes §2.2; ~450 lines; touches `useEngine.ts`, `canvas_overlay.ts`, `webcam_face.ts`, `store_controls.ts`; **adversarial review**; `useEngine.ts` was also touched by #264, rebase on main first |
| 4 | **The instrument spec** | `InstrumentSpec` (Zod); seeds become specs; the instruments collection carries `class`, `tags`, `branches`, `training`; derivation kept as the fallback for specs without `branches`; `normaliseClassId` at the read boundary | `library_*` tests; a migration test from a v7 seed store | the UX stream's full metadata; the trainer stream reads `spec.training.route` for the per-instrument link; ~300 lines |
| 5 | **The extension manifest, air as the first extension** | `Extension` type with `dials` and `transient`; `createAppRegistry(extensions)`; `composeGraph` reads extension branches; dials schema composed from slices (breaks the settings → nodes cycle); **`store-controls` ports generated** (seam 6); `sdk/ui`'s panel contract extracted (`useNodeOutput`, the dispatchers, primitives); `git mv` of the air files into `src/extensions/air/`; catalog generation reads extensions; the two boundary guards and the React-free test for the pure SDK entry | `commands_firewall`-style guards; the write-path guard over extension panels; catalog regenerated; every air test unchanged in content | ~600 lines, mostly moves; the flute's 21-file footprint becomes one directory; **adversarial review** |
| 6 | **Workspaces (O2)** | root `workspaces`; `packages/{sdk,ictus,taglog,ext-air}` with `package.json`, `tsconfig`, README, LICENSE placeholder; `@/dag` and friends rewritten to package imports by a codemod (~140 files for `@/dag` alone, mechanical); `extensions.json` + the Vite plugin | `npm ci && npm run build` at the root; the CI smoke; per-package `tsc`; the codemod's diff is import lines only | deploy unchanged, verified against `app.toml`'s commands; after PR 5 by decision |
| 7 | **Split (O3), per #262** | `git subtree split` of the chosen packages; publish to the registry; the app depends on published versions; `tw_platform` App-token change if any repo goes private | a fresh clone of the app builds from the registry alone | last, after the Round 4 freeze window; needs the maintainer's #262 answer and thoremin-mgr for `tw_platform` |

Ordering: 1 → 3 → 4 → 5 → 6 is a chain; 7 waits on #262 and on the other Round 4 streams having landed. PRs 3 and 5 are *significant* by the landing rule (changed behaviour, >200 lines) and get an independent adversarial review each; the reviewer's brief includes §6 and the question "does the next change (`ext-field`) touch any caller?".

## 8. What this ADR deliberately does not do

- Does not decide what is public, private or under which licence (#262); it states the engineering opinion in §5 and stops.
- Does not move the field instruments out of core, or build `ext-field`; it records the step and the condition (a track record for the optional-edge rule).
- Does not build per-extension lazy loading of node code (seam 3); the bytes are elsewhere today (§2.4).
- Does not build a discovery mechanism beyond the manifest array and the build-time list; a third party appears before a plugin loader does.
- Does not change `webcam-hands`' unconditional model load: the hand source is the trunk. A hand-free instrument (keyboard, MIDI-in) would make it a branch; that is a real future instrument and a one-line change to the trunk definition when it comes.
- Does not build the `chord-mapper` slot or any swap dropdown; the `expression` slot is declared with one candidate and no UI.
- Does not touch the frozen legacy app or the trainer, CI or UX streams' files beyond the coordination points named in §7.

## 9. Decisions taken with the review (formerly open questions)

1. **Field instruments stay in core** until the optional-edge rule has been exercised by a real second extension; `ext-field` is recorded in §4.2, not scheduled.
2. **Workspaces (O2) land inside Round 4, after PR 5** has proved the manifest with the air extension.
3. **"Branch" is the word** for a reusable graph piece; the git collision is noted once, in §3.1.
