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
  RealTime). The original hand-theremin; kept reachable for the AI-DJ plugin
  until it is ported onto the DAG. It is the code-split (lazy) view now.

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
- `npm test` — vitest. **Test against the real fixtures** (`test/fixtures/`,
  recorded hand/face videos, NDJSON intermediate streams). New behaviour gets a
  fixture-replay test, not just a unit test.
- `npm run build` — vite build must stay green (verifies the React layer).
- Do **adversarial reviews at junctures** (multi-agent workflow) — they have
  repeatedly caught real bugs here.

## Conventions

- Nodes: `defineNode` with typed ports + a Zod params schema + `process()`/`make()`.
  Static params = build-time defaults; input ports = live overrides (so the UI
  changes scale/instrument without rebuilding the graph or reloading the ML model).
- Instruments are an SSOT registry (`src/music/instruments.ts`,
  `as const satisfies Record<…>`).
- No emojis in code. Module docstrings/headers explain *why*.
- Workflow: branch → PR → squash-merge → delete branch. Reference the issue.

## Where things live

| Area | Path |
|------|------|
| DAG engine (framework-agnostic) | `src/dag/` (`engine.ts`, `types.ts`, `registry.ts`, `recorder.ts`) |
| Node library | `src/nodes/{sources,features,mapping,music,output}/` |
| Default graph wiring | `src/app/graph.ts` |
| React↔DAG bridge (webcam, AudioContext, rAF, recorder) | `src/app/useEngine.ts` |
| Live control store (zustand+persist) | `src/app/store.ts` |
| Music theory + instruments | `src/music/` |
| Overlay (compose elements here) | `src/nodes/output/canvas_overlay.ts` |
| Recorder | `src/app/recorder.ts` |
| Fixtures + replay | `test/fixtures/`, `scripts/record_stream.ts`, `src/dag/recorder.ts` |
| Conceptual model | `docs/design/component-model.md` |

## Roadmap & tracking

`docs/ROADMAP.md` + GitHub issues (epic #45 for the component-model / plugin-systems
work; per-feature sub-issues #46–#52). Discussions #3 (architecture) and #4 (mapping
spectrum) are the design record.
