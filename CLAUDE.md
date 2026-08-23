# thoremin — AI Agent Instructions

"Anything to music": a browser hand-theremin. Live sensor streams (webcam hand
gestures now; keyboard, face, later MIDI) map to a live audiovisual stream
(musical audio + the captured video with overlaid guides), all **client-side**
(MediaPipe/TF.js inference, Web Audio synthesis, canvas rendering in the browser;
no backend compute — the app is a static Vite bundle).

## Two front-ends in one build

- **DAG instrument view (default)** — `src/app/*`, `src/nodes`, `src/dag`,
  `src/music`. The typed dataflow engine everything new is built on. Loads at
  the bare URL (https://apps.thorwhalen.com/thoremin/). `?engine=dag` is still
  honored (it equals the default), so older links keep working.
- **Legacy app** — opt-in via `?engine=legacy` (alias `?engine=classic`) →
  `src/App.tsx`, `src/components/Theremin.tsx`, `src/plugins/ai-dj/` (Lyria
  RealTime). The original hand-theremin; the code-split (lazy) view.
  **It is FROZEN** (maintainer decision): it stays reachable so the AI-DJ / Lyria
  plugin is not lost, but it gets no new features, is excluded from refactors, and
  new work never lands there. **#128 decided this** (closed 2026-07-15): the legacy
  AI-DJ is formally retired to `?engine=legacy` rather than ported. The compelling
  version — hand/face features steering a generative model — is budgeted honestly as
  new work in **#141**, not as a port.

Outward-facing changes (deploying, moving the default) still get the user's OK.

## The architecture in one breath (read this first)

The engine is a typed dataflow **DAG** (`src/dag/`), a TS mirror of the Python
`meshed` library. The conceptual model — **components, roles, elements, options,
presets, slots** — is in [`docs/design/component-model.md`](docs/design/component-model.md).
It **supersedes the "six layers"** framing in `docs/ARCHITECTURE.md` and
Discussion #3. Key rules from it:

- **Don't say "layer"** as a structural term — it's a DAG, not a stack. Roles are
  metadata on a node; a node can carry **several** roles.
- **`role` for nodes, `kind` for ports.** Never add a node-level `kind`
  (`PortSpec.kind` already owns that word).
- **Sub-components (e.g. overlay elements) are toggled functions *inside* a node,
  not DAG nodes** — the engine rejects fan-in to a single input port. Promote an
  element to a node only when something *outside* the node must consume/tap it.
- **A role earns a settings swap-dropdown only when ≥2 real implementations
  exist.** Don't build slot machinery for hypothetical swaps.
- Of the prerequisites before "node swapping is a config flip" is true, one
  remains: the registry is a **hand-listed array** with no discovery seam (the
  design doc's "Two corrections", #2). The other two are done — the mapping nodes
  share an **input/params contract** (`src/nodes/mapping/mapping_contract.ts`),
  and the engine can now re-wire itself while running (next bullet).
- **The running graph is not frozen.** `Engine.applyGraph(spec, registry?)`
  reconciles a live engine onto a new `GraphSpec`, keeping every node whose id +
  type + *validated* params are unchanged — so a swap does not reload the
  MediaPipe models or rebuild the audio graph. It plans synchronously (a bad spec
  is a no-op), inits the new nodes **while the old graph keeps ticking**, then
  commits atomically. Never construct a second `Engine` to change wiring. See
  `docs/design/component-model.md` → "Swapping at runtime: the engine lifecycle".

## Persistence & collections → **zodal** (project rule)

Anything that persists, or is a collection of named things (settings presets,
saved overlays, recordings index, …) is designed the **zodal** way, in this order:

1. **Affordances first** — define a Zod schema (the SSOT of what the data *is*).
2. **Storage target behind a stable contract** — `@zodal/store`'s
   `DataProvider<T>` (`getList/getOne/create/update/delete`). **Default target =
   localStorage**; files/cloud later by swapping the provider, never the call
   sites. Collections via `@zodal/core` `defineCollection`.
3. **UI behind the affordances** — `@zodal/ui` generators; shadcn renderers when
   production-ready.

`@zodal/core` / `@zodal/store` / `@zodal/ui` are on npm (0.1.2). The localStorage
adapter (`@zodal/store-localstorage`) and shadcn renderer (`@zodal/ui-shadcn`) are
**not yet published** — prefer publishing/developing them in the zodal repo over
inlining in thoremin (ecosystem storage-facade + zodal-development policy). A thin
in-repo adapter implementing the published `DataProvider<T>` is a *temporary*
fallback only, tracked for migration.

**Hot-path split:** live per-tick control state stays in the **zustand** store
(`src/app/store.ts`, read synchronously each tick). zodal is the *persistence +
preset-collection* layer. Load preset → hydrate zustand; edit → debounce → save
via the provider. Never `await` a provider in the tick/audio loop.

## Verification gates (every change)

- `npm run typecheck` — strict DAG typecheck (`tsconfig.dag.json`; covers
  `src/dag`, `src/nodes`, `src/music`, `src/app/graph.ts`, tests, scripts). The
  React layer (`src/app/*.tsx`, `src/components`) is **not** strict-typechecked
  (the repo ships no `@types/react`); it is verified by `npm run build`.
- `npm test` — vitest (87 test files, 910 tests). **Test against the real fixtures**
  (`test/fixtures/`, recorded hand/face videos, NDJSON intermediate streams). New
  behaviour gets a fixture-replay test, not just a unit test.
- `npm run build` — vite build must stay green (verifies the React layer).
- `npm run catalog` — regenerates `docs/CATALOG.md`, `public/manual.html` and
  `public/catalog.json` from the node registry. **Run it after adding/renaming a node
  or changing a port/param, and commit the result** — those three files are generated
  and must never be hand-edited.
- Do **adversarial reviews at junctures** (multi-agent workflow) — they have
  repeatedly caught real bugs here.

## Vocabulary: "sound" vs "instrument" (do not re-break this)

PR #73 renamed the *timbre* concept. Both words are now taken, and they mean
different things:

- **Sound** = a timbre preset (sine / bell / reed / …). SSOT registry:
  **`src/music/sounds.ts`** (`SOUNDS`, `SoundId`, `as const satisfies Record<…>`).
  This is why the ports are `soundRight` / `soundLeft` and a voice carries `sound`.
- **Instrument** = a *named saved dials profile* — a complete settings snapshot the
  player loads from the library. Owned by **`src/app/dials/instruments.ts`**
  (persisted via `@zodal/dials-ui`'s `createProfileStore`); the browsable metadata
  *about* instruments (favorites, tags) lives in `src/app/library/`.

There is **no `src/music/instruments.ts`**. If you are looking for the timbre enum,
it is `src/music/sounds.ts`.

## Vocabulary: "cue" and "routine" (the trainer, #163)

- **Cue** = one thing the trainer asks the player to do ("look to your left"). A
  Zod-schema'd record in a zodal collection; it declares feature **groups**, never
  feature ids and never a modality. The written and spoken forms are the same string.
- **Routine** = a saved, ordered list of cue ids.
- Rejected words: *prompt* (LLM-overloaded here), *drill* (tetrachord's term), *step*
  (v1's word; too anonymous), *exercise* (the system is the one learning).
- Trainer distances are in **noise units** (`src/enroll/noise.ts`): a feature's
  displacement divided by its own frame-to-frame jitter. The live vector is raw
  (degrees next to 0..1 blendshapes), so this is what makes any threshold mean the
  same thing for every feature. Do not reintroduce a raw-unit threshold.

## Conventions

- Nodes: `defineNode` with typed ports + a Zod params schema + `process()`/`make()`.
  Static params = build-time defaults; input ports = live overrides (so the UI
  changes scale/sound without rebuilding the graph or reloading the ML model).
- No emojis in code. Module docstrings/headers explain *why*.
- Workflow: branch → PR → squash-merge → delete branch. Reference the issue.

## Command dispatch is the single write path (#87) — and it is enforced

The design (issue #87, `docs/design/command-dispatch.md`): **every param-mutation is
an `acture` command**, and `src/app/commands/` is the one registry that the settings
panels, the keyboard shortcuts, the Cmd/Ctrl-K palette, the AI assistant and (since
#129) discrete hand gestures all dispatch into. A command changes sound *only* by
writing a dial; the per-tick/audio path is never a command.
`test/commands_firewall.test.ts` enforces the boundary (commands may not import the
hot store / DAG / nodes / audio; the DAG may not import the registry).

**Status: TRUE on main since #126 (PR #140, merged 2026-07-13).** The sweep landed.
`rg 'setDial\(' src/ --glob '!*.test.*'` now hits **only** `src/app/commands/dials.ts`
— the command implementations themselves. Every discrete panel control writes through
one of the three dispatchers in `src/app/dispatchDial.ts`:

- `dispatchDialSet(key, value)` — one scalar dial (`faceChord.voicing`).
- `dispatchDialSetIn(path, value)` — one scalar LEAF of a **structured** dial, by
  dotted path (`overlay.landmarks.show`, `handMap.fingers.index.target`). Structured
  dials get no per-dial command and a command's value must stay scalar (an object
  param emits a JSON Schema Gemini rejects), so the path is what makes overlay /
  hand-map / expression-map dispatchable at all. See `commands/paths.ts`.
- `dispatchDialPatch(writes)` — several dials **atomically**, for the one-gesture /
  several-writes controls (the chord-source flip that seeds root+type; a synced-hands
  voice edit mirrored onto the other hand). All-or-nothing.

**The invariant is guarded, not merely documented.** `test/dials_write_path.test.ts`
is a real TypeScript-AST analysis over `src/app/dials/panels/` + `DialsControlsPanel.tsx`:
it follows the local helper functions a handler calls, so a violation cannot hide one
indirection away. Add a `<select>` or `<Toggle>` that writes `setDial` directly and the
suite goes red. (thoremin ships no ESLint — it lints with `tsc --noEmit` — so, like the
import firewall, this boundary is enforced as a test.)

Two deliberate exceptions that are *not* bugs, and that the guard permits **by name**
rather than by vagueness:

- Continuous `type="range"` sliders being dragged stay a direct `setDial` for latency
  (**Decision B**). A live drag fires a write per pointer-move frame; routing that
  through Zod validation, the confirmation-gate wrapper and a promise buys nothing and
  costs latency on the one interaction where latency is audible.
- The non-dial `muted` flag (#91) is not a command yet. It is transient hot-store state,
  not a persisted param.

When you add a write path: dispatch it. When you add a discrete panel control, use
`dispatchDialSet` / `dispatchDialSetIn` / `dispatchDialPatch` — the guard will tell you
if you forget, but knowing why is cheaper than reading the failure.

## Shipping rule: a feature nobody can find is not shipped

Twice now. The Feature Lab (#119) was merged, deployed, and live in the production bundle
for weeks while being, in practice, **unreachable**: no entry point in the app shell,
defaulting to off, buried inside a per-instrument editor. MIDI out (#120) was worse — no
UI, no dial, and its `enabled` input left unconnected in `graph.ts`. Both passed every
test in the suite. Both are fixed now (#136 → PR #138; #137 → PR #147), and #147 is the
template: dial + live input port + panel + a *structural* guard that fails if the port
goes unconnected again. The lesson is what stays.

So, when you add a user-facing capability:

1. **Give it an entry point in the shell.** Register it in `src/app/tools.ts` if it is a
   *tool* (something you use ON the instrument: the Lab, the palette, the manual); give it
   a dial in `src/settings/dials.ts` if it is an *instrument parameter* (which also earns
   it a panel control, a palette entry, a per-dial command and an AI tool surface for
   free). If it is neither, say why in the PR.
2. **Ask "how many clicks from a cold load?"** and write the answer in the PR. If the
   answer needs the phrase "then scroll", reconsider.
3. **Test the reachability, not just the logic.** `test/tools_shell.test.tsx` (jsdom) and
   `test/app_shell.test.ts` are the pattern. A green unit suite says the code runs; it
   says nothing about whether a player can get to it.

## Where things live

| Area | Path |
|------|------|
| DAG engine (framework-agnostic) | `src/dag/` (`engine.ts`, `types.ts`, `registry.ts`, `recorder.ts`, `clock.ts`) |
| Node library | `src/nodes/{sources,features,mapping,music,output}/` |
| Default graph wiring | `src/app/graph.ts` |
| React↔DAG bridge (webcam, AudioContext, rAF, recorder) | `src/app/useEngine.ts` |
| Live control store (zustand+persist) — the hot per-tick mirror | `src/app/store.ts` |
| Music theory + **sounds** (timbre presets) | `src/music/` (`theory.ts`, `sounds.ts`, `voicing.ts`, `expression.ts`) |
| Overlay (compose elements here) | `src/nodes/output/canvas_overlay.ts` |
| **Command registry** (#87) — the single write path, guarded by `test/dials_write_path.test.ts` | `src/app/commands/` (`registry.ts`, `dials.ts`, `perDial.ts`, `paths.ts`, `instruments.ts`, `confirmation.ts`) + the panel dispatchers in `src/app/dispatchDial.ts` |
| **Dispatch middleware** (#127) — one seam on `registry.dispatch`; undo/redo, telemetry and export/replay are three readings of it. Order is stated as data in `registry.ts` (gate outermost) | `src/app/commands/` (`middleware.ts`, `history.ts`, `journal.ts`) + the ⌘Z/⌘⇧Z bindings in `src/app/keyboardShortcuts.ts` |
| **Dials** — settings schema store + named **instruments** (saved profiles) | `src/app/dials/` (`settingsStore.ts`, `instruments.ts`, panels) |
| Dials schema / presets SSOT | `src/settings/` (`schema.ts`, `dials.ts`, `presets.ts`) |
| **Feature catalog** (#119) — data-driven features, safe formula compiler, online normalizer | `src/features/` (`catalog.ts`, `formula.ts`, `normalizer.ts`) |
| **Feature Lab** (#119/#136) — config SSOT, the shell panel, saved views (zodal collection) | `src/features/labConfig.ts`, `src/app/LabPanel.tsx`, `src/app/LabControls.tsx`, `src/app/lab/` |
| **Shell tools** (#136) — the registry of non-instrument surfaces + the bar that exposes them | `src/app/tools.ts`, `src/app/ToolsBar.tsx`, `src/app/toolsStore.ts` |
| **Instrument library** (#113/#114/#115) — favorites, tags, system tags, summaries | `src/app/library/` |
| **Recording v2** (#88) — session, plan, naming, manifest, sinks, feature tap | `src/app/recording/` + `src/app/RecordButton.tsx` |
| **Annotations** (#92) — thoremin glue for the tagging tool | `src/app/tagging/` |
| **taglog** — the extraction-ready annotation package (no thoremin imports) | `src/taglog/` (see its own `README.md`) |
| **AI assistant** (#87 Phase 3) — chat that operates the instrument | `src/plugins/assistant/` |
| Keyboard shortcuts (#90) — tinykeys → command dispatch | `src/app/keyboardShortcuts.ts` |
| **Gesture dispatch** (#129) — discrete hand poses → command dispatch (edge-triggered, held, cooled) | `src/app/gestureDispatch.ts` |
| **Trainer** (#160/#163) — learn a player's OWN categories. Pure core over `FeatureVector` (never a face type): `cue.ts` (Zod cues/routines), `noise.ts` (every distance in multiples of a feature's own jitter), `sampler.ts`, `sufficiency.ts` (the `SufficiencyEvaluator` seam), `runner.ts`, `session.ts`, `cluster.ts`, `classify.ts`. Host glue: starter face cues + the two zodal collections + the store | `src/enroll/`, `src/app/enroll/` (`starterCues.ts`, `cueStore.ts`, `store.ts`), `src/app/TrainerPanel.tsx` |
| **Feature demand** (#163) — a non-Lab consumer claims feature GROUPS; the vector nodes (and the face-model gate) compute them with the Lab closed | `src/features/demand.ts`, `src/app/featureDemand.ts` |
| Legacy app (**frozen**) | `src/App.tsx`, `src/components/`, `src/hooks/`, `src/plugins/ai-dj/` |
| Fixtures + replay | `test/fixtures/`, `scripts/record_stream.ts`, `src/dag/recorder.ts` |
| Conceptual model | `docs/design/component-model.md` |

## Roadmap & tracking

`docs/ROADMAP.md` + GitHub issues. **#87 and #126 are both closed** — the command
write path is done and guarded. The live tracking issues are **#101** (Stream Applier
epic), **#5** (the umbrella DAG roadmap) and **#146** (the standing live-verification
list: everything that can only be confirmed with a webcam and human eyes).
Discussions #3 (architecture) and #4 (mapping spectrum) are the design record.
Per-subsystem SSOT design docs live in `docs/design/`.
