# thoremin

**From anything to music** — a DAG-based real-time sonification platform. Map
live sensor streams (webcam hand gestures, computer keyboard, later MIDI &
facial expressions) to a live audiovisual stream: musical audio plus the
captured video overlaid with visual guides. A generalized, software-defined
[theremin](https://github.com/thorwhalen/theremin).

## What it does today

Move your hand in front of the webcam → play tonal, scale-snapped notes (left/​
right = pitch, up/down = volume). Two hands = two voices. Keyboard arrows and
`m` steer octave / scale-magnetism / mute live; a panel changes key, scale,
range and waveform live. The screen shows the mirrored video with landmark
overlays, per-hand control markers (openness = ring size, pinch = fill), and a
feature HUD.

Under the hood it's a **typed dataflow graph** you compose by wiring small
nodes — the same structure that will carry facial expressions, pose, MIDI, and
AI music generation (Google Lyria RealTime) as the project grows.

## Quick start

```bash
npm install
npm run dev        # open http://localhost:3000, allow camera, click "Initialize Audio Engine"
npm test           # headless tests (no camera/GPU/audio needed)
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run record     # regenerate test fixtures
```

Chrome recommended. Audio starts only after a click (browser requirement).

## How it's built

A small, framework-agnostic dataflow DAG (`src/dag/`) — a TypeScript mirror of
the Python [`meshed`](https://github.com/i2mint/meshed) library — with six
layers: **input → feature → mapping → music-logic → synthesis/generation →
output**. Components are small, typed, parameterizable nodes wired by edges, and
**every edge can be recorded and replayed**, which is the backbone of the test
strategy (test downstream stages from persisted streams, no camera required).

- `src/dag/` — the engine, registry, recorder/replay.
- `src/nodes/` — the node library (pure nodes are Node-safe & tested; browser
  nodes touch DOM/audio only at runtime).
- `src/music/theory.ts` — pure tonal-guidance helpers (scale snapping, etc.).
- `src/app/` — the React shell wiring the default instrument graph.
- `scripts/` + `test/fixtures/` — fixture recording & replay.
- `wips/` — the original working React+Lyria app this grows from (reference).

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the DAG spine and six layers.
- [`docs/DAG_NODES.md`](docs/DAG_NODES.md) — the node catalog.
- [`docs/MAPPING_SPECTRUM.md`](docs/MAPPING_SPECTRUM.md) — direct↔indirect mapping + conductor mode.
- [`docs/TESTING.md`](docs/TESTING.md) — the DAG-aware record/replay test strategy.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones M0–M7 and status.

## Status

Alpha. M0–M2 implemented (DAG core, browser vertical slice, fixture infra);
28 tests passing. Next: Lyria generative node + indirect (gesture→AI) mapping.
