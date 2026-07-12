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
  new work never lands there. Whether the generative layer is ported into the DAG
  app or the legacy view is formally retired is issue **#128**.

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
- Two known prerequisites before "node swapping is a config flip" is true: the
  interchangeable mapping nodes don't yet share an **input/params contract**
  (only the output contract), and the registry is a **hand-listed array** with no
  discovery seam. See the design doc's "Two corrections" section.

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
- `npm test` — vitest (75+ test files). **Test against the real fixtures**
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

## Conventions

- Nodes: `defineNode` with typed ports + a Zod params schema + `process()`/`make()`.
  Static params = build-time defaults; input ports = live overrides (so the UI
  changes scale/sound without rebuilding the graph or reloading the ML model).
- No emojis in code. Module docstrings/headers explain *why*.
- Workflow: branch → PR → squash-merge → delete branch. Reference the issue.

## Command dispatch is the *intended* single write path (#87)

The design (issue #87, `docs/design/command-dispatch.md`): **every param-mutation is
an `acture` command**, and `src/app/commands/` is the one registry that the keyboard
shortcuts, the Cmd/Ctrl-K palette, and the AI assistant all dispatch into. A command
changes sound *only* by writing a dial; the per-tick/audio path is never a command.
`test/commands_firewall.test.ts` enforces the boundary (commands may not import the
hot store / DAG / nodes / audio; the DAG may not import the registry).

**Honest status: this is NOT yet true on main.** Only two settings-panel call sites
dispatch (`face.mapping`, `master.syncHands`, via `src/app/dispatchDial.ts`); the
other discrete `<select>`s still call `setDial` directly. Completing the sweep is the
open, load-bearing **issue #126**. Two deliberate exceptions that are *not* bugs:
continuous `type="range"` sliders stay a direct `setDial` for latency (**Decision B**),
and the non-dial `muted` flag (#91) is not a command yet.

When you add a write path: dispatch it. When you touch a panel, prefer moving it onto
`dispatchDialSet` rather than adding another direct `setDial`.

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
| **Command registry** (#87) — the intended single write path | `src/app/commands/` (`registry.ts`, `dials.ts`, `perDial.ts`, `instruments.ts`, `confirmation.ts`) |
| **Dials** — settings schema store + named **instruments** (saved profiles) | `src/app/dials/` (`settingsStore.ts`, `instruments.ts`, panels) |
| Dials schema / presets SSOT | `src/settings/` (`schema.ts`, `dials.ts`, `presets.ts`) |
| **Feature catalog** (#119) — data-driven features, safe formula compiler, online normalizer | `src/features/` (`catalog.ts`, `formula.ts`, `normalizer.ts`) |
| **Feature Lab** views (#119) — saved lab configs (zodal collection) | `src/app/lab/` + `src/app/LabControls.tsx` |
| **Instrument library** (#113/#114/#115) — favorites, tags, system tags, summaries | `src/app/library/` |
| **Recording v2** (#88) — session, plan, naming, manifest, sinks, feature tap | `src/app/recording/` + `src/app/RecordButton.tsx` |
| **Annotations** (#92) — thoremin glue for the tagging tool | `src/app/tagging/` |
| **taglog** — the extraction-ready annotation package (no thoremin imports) | `src/taglog/` (see its own `README.md`) |
| **AI assistant** (#87 Phase 3) — chat that operates the instrument | `src/plugins/assistant/` |
| Keyboard shortcuts (#90) — tinykeys → command dispatch | `src/app/keyboardShortcuts.ts` |
| Legacy app (**frozen**) | `src/App.tsx`, `src/components/`, `src/hooks/`, `src/plugins/ai-dj/` |
| Fixtures + replay | `test/fixtures/`, `scripts/record_stream.ts`, `src/dag/recorder.ts` |
| Conceptual model | `docs/design/component-model.md` |

## Roadmap & tracking

`docs/ROADMAP.md` + GitHub issues. The live tracking issues are **#87** (command
dispatch), **#101** (Stream Applier epic) and **#126** (the command write-path sweep).
Discussions #3 (architecture) and #4 (mapping spectrum) are the design record.
Per-subsystem SSOT design docs live in `docs/design/`.
