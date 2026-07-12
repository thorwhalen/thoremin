# thoremin

**From anything to music** — a real-time sonification platform: map live sensor
streams (webcam hand gestures, facial expressions and head pose, computer
keyboard, MIDI out) to a live audiovisual stream — musical audio plus the
captured video overlaid with visual guides. A generalized, software-defined
[theremin](https://github.com/thorwhalen/theremin).

**Live:** https://apps.thorwhalen.com/thoremin/

## What it does today (the deployed app)

Move your hands in front of the webcam to play tonal, scale-snapped notes
(horizontal = pitch, vertical = volume; two hands = two voices). Your face can
drive timbre, or play chords — from expression, or from deliberate head/jaw/brow
pose. Around that:

- **Instruments** — named saved settings profiles, browsable in a library with
  favorites, tags and at-a-glance summaries.
- **Command palette** (Cmd/Ctrl-K) + keyboard shortcuts — every dial is a typed,
  searchable command.
- **AI assistant** — an in-app chat that operates the instrument by dispatching
  those same commands (client-side, bring-your-own key).
- **Recording** — a session-based multi-stream recorder: audio, video+overlays,
  pure webcam, overlay-only, and a feature JSONL, into one folder with a
  `manifest.json`.
- **Annotations** — tap tags live during a take to segment it, then export to
  Audacity / WebVTT / CSV / Praat / OTIO.
- **Feature Lab** — live meters over ~200 face and hand features, with safe
  user-defined formulas, for finding what is actually worth mapping to sound.
- **MIDI out** — drive an external instrument or DAW from the same voices.

See [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for how to use all of it.

## The DAG engine (this *is* the product)

The app is a small, framework-agnostic **dataflow DAG** (`src/dag/`) — a
TypeScript mirror of the Python [`meshed`](https://github.com/i2mint/meshed)
library. Components are small, typed, parameterizable **nodes** wired by edges,
and **every edge can be recorded and replayed**, which is the backbone of the
test strategy (test downstream stages from persisted streams, no camera
required).

Since PR #58 the DAG instrument view is what loads at the bare URL — it is the
deployed app, not a parallel experiment. The original hand-theremin (plus its
Lyria **AI-DJ** plugin) is code-split behind `?engine=legacy` and is **frozen**:
reachable, but not developed and excluded from refactors. Whether the generative
layer gets ported into the DAG app or the legacy view is formally retired is
tracked in issue #128.

Node roles, not layers: the conceptual model is
[`docs/design/component-model.md`](docs/design/component-model.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000 — allow camera, tap to play
npm test           # headless DAG tests (no camera/GPU/audio needed)
npm run typecheck  # strict typecheck of the DAG layer (tsconfig.dag.json)
npm run build      # production build → the deployed artifact
npm run catalog    # regenerate the node catalog + manual (generated; commit the result)
npm run record     # regenerate test fixtures
```

Chrome recommended. Audio starts only after a click (browser requirement).
`?source=video&video=<url>` runs the instrument camera-free from a pre-recorded
clip.

## Repo layout

- `src/dag/` — the engine, registry, recorder/replay, clock.
- `src/nodes/` — the node library (pure nodes are Node-safe & tested; browser
  nodes touch DOM/audio only at runtime).
- `src/app/` — the deployed instrument: graph wiring, engine bridge, hot control
  store, command registry, dials + instruments, library, recording, annotations,
  Feature Lab.
- `src/features/` — the feature catalog, safe formula compiler, online normalizer.
- `src/taglog/` — the extraction-ready annotation package (no thoremin imports).
- `src/music/` — theory, voicing, and `sounds.ts` (the timbre presets).
- `src/App.tsx`, `src/components/`, `src/plugins/ai-dj/` — the **frozen** legacy app.
- `scripts/` + `test/` + `test/fixtures/` — fixture recording & replay tests.
- `app.toml` / `vite.config.ts` — enlace deployment config (mounts at `/thoremin/`).
- `wips/` — earlier standalone experiments (promptdj-midi, etc.), kept for reference.

## Docs

- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — the user manual for the app.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the DAG spine and the real graph.
- [`docs/CATALOG.md`](docs/CATALOG.md) — **the node catalog** (generated from the
  registry by `npm run catalog`; also served live at `/thoremin/manual.html`).
- [`docs/design/`](docs/design/) — per-subsystem SSOT design docs: the
  [component model](docs/design/component-model.md),
  [recording v2](docs/design/recording-v2.md),
  [stream applier](docs/design/stream-applier.md),
  [feature lab](docs/design/feature-lab.md),
  [instrument library](docs/design/instrument-library.md),
  [command dispatch](docs/design/command-dispatch.md).
- [`docs/MAPPING_SPECTRUM.md`](docs/MAPPING_SPECTRUM.md) — direct↔indirect mapping + conductor mode.
- [`docs/TESTING.md`](docs/TESTING.md) — the DAG-aware record/replay test strategy.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what shipped, what is next.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — what's new, by PR.

## Status

Alpha, deployed live. The DAG instrument is the product; 31 nodes in the
registry and 75+ test files green. Active tracks: completing the command-dispatch
write-path sweep (#126), the Stream Applier (#101), and deciding the fate of the
generative layer (#128).
