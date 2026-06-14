# thoremin

**From anything to music** — a real-time sonification platform: map live sensor
streams (webcam hand gestures, computer keyboard, later MIDI & facial
expressions) to a live audiovisual stream — musical audio plus the captured
video overlaid with visual guides. A generalized, software-defined
[theremin](https://github.com/thorwhalen/theremin).

**Live:** https://apps.thorwhalen.com/thoremin/

## What it does today (the deployed app)

The deployed app (`src/`) is a React hand-tracking theremin: move your hand in
front of the webcam to play tonal, scale-snapped notes (horizontal = pitch,
vertical = volume), two hands = two voices, with a settings panel for key,
scale, octave range and waveform — plus an optional **AI-DJ** plugin
(`src/plugins/ai-dj/`) that steers Google **Lyria RealTime** generative music
with weighted text "strains".

## The DAG engine (being adopted)

Alongside the app, the repo now carries a small, framework-agnostic **dataflow
DAG** (`src/dag/`) — a TypeScript mirror of the Python
[`meshed`](https://github.com/i2mint/meshed) library — with six layers:
**input → feature → mapping → music-logic → synthesis/generation → output**.
Components are small, typed, parameterizable nodes wired by edges, and **every
edge can be recorded and replayed**, which is the backbone of the test strategy
(test downstream stages from persisted streams, no camera required).

It is fully built and tested but **not yet wired into the deployed app** — that
is the next step (M3): refactor the app's detect loop onto the DAG and port the
Lyria plugin into a `lyria` generative node. See `docs/ROADMAP.md` and issue #6.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000 — allow camera, click "Initialize Audio Engine"
npm test           # headless DAG tests (no camera/GPU/audio needed)
npm run typecheck  # strict typecheck of the DAG layer (tsconfig.dag.json)
npm run build      # production build → frontend/ (the deployed artifact)
npm run record     # regenerate test fixtures
```

Chrome recommended. Audio starts only after a click (browser requirement).

## Repo layout

- `src/` — the deployed React app (`App.tsx`, `components/`, `hooks/`,
  `plugins/ai-dj` Lyria) **and**, alongside it, the DAG engine + node library:
  - `src/dag/` — the engine, registry, recorder/replay.
  - `src/nodes/` — the node library (pure nodes are Node-safe & tested; browser
    nodes touch DOM/audio only at runtime).
  - `src/music/theory.ts` — pure tonal-guidance helpers (scale snapping, etc.).
  - `src/app/graph.ts` — the default instrument graph definition.
- `scripts/` + `test/` + `test/fixtures/` — fixture recording & replay tests.
- `app.toml` / `vite.config.ts` — enlace deployment config (mounts at `/thoremin/`).
- `wips/` — earlier standalone experiments (promptdj-midi, etc.), kept for reference.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the DAG spine and six layers.
- [`docs/DAG_NODES.md`](docs/DAG_NODES.md) — the node catalog.
- [`docs/MAPPING_SPECTRUM.md`](docs/MAPPING_SPECTRUM.md) — direct↔indirect mapping + conductor mode.
- [`docs/TESTING.md`](docs/TESTING.md) — the DAG-aware record/replay test strategy.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones M0–M7 and status.

## Status

Alpha, deployed live. The hand-tracking theremin + Lyria AI-DJ app is live; the
DAG foundation (M0–M2 + the `indirect-map` node) is in the repo with 33 passing
tests. **Next: M3** — wire the deployed app through the DAG and port Lyria to a
generative node (issue #6).
