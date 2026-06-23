# Thoremin Architecture

> From anything to music: a DAG-based real-time sonification platform that maps
> live sensor streams (video gestures, computer keyboard, later MIDI) to a live
> audiovisual stream (musical audio + the captured video with overlaid guides).

## The big idea: everything is a dataflow graph

Thoremin is built around a small, typed **dataflow DAG** (`src/dag/`). Sensor
inputs flow through feature extraction, mapping, music logic, and synthesis
nodes to audiovisual outputs. Components are small, parameterizable, and wired
by edges — so you compose new instruments by re-wiring, not rewriting.

The DAG is a deliberate TypeScript mirror of the Python [`meshed`](https://github.com/i2mint/meshed)
library used in the sibling [`theremin`](https://github.com/thorwhalen/theremin)
project (a set of typed nodes wired by ports, evaluated in dependency order).
Keeping that parity means a Python backend can later be slotted behind the same
node interfaces if/when frontend tools are insufficient — but **v0 is
frontend-only**: the live instrument loop stays on-device for lowest latency.

### The signal-flow story (formerly "the six layers")

> **Superseded framing.** These six names are kept here only as an onboarding
> *narrative* for the default signal path. They are **not** a code-level
> abstraction: the engine is a DAG (fan-out + a multi-input merge sink), not a
> linear stack, so a node sees whatever it is wired to. The durable model is
> **components carrying roles, composed of elements, swapped via slots** — see
> [`docs/design/component-model.md`](design/component-model.md). Read the table
> below as a list of **roles**, not pipeline stages.

```
INPUT ──▶ FEATURE ──▶ MAPPING ──▶ MUSIC-LOGIC ──▶ SYNTHESIS/GEN ──▶ OUTPUT
sensors   normalized   feature→     tonal           sound            audio +
          control      param        guidance        (direct) or      video +
          signals      (direct↔                     steered-AI       overlays
                        indirect)                    (indirect)
```

| Layer | Responsibility | Tools (chosen) |
|-------|---------------|----------------|
| **Input** | Capture raw sensor data | `getUserMedia`+`<video>`, Web keyboard events, (later WEBMIDI.js); camera-free `synthetic-hands` + `replay-source` for tests |
| **Feature** | Raw data → normalized control signals | `@mediapipe/tasks-vision` (hands now; face 52-blendshapes & pose later); pure `hand-features` node |
| **Mapping** | Features → engine params, across the direct↔indirect spectrum | pure `voice-mapping` (direct); `indirect-map` → prompt weights (planned) |
| **Music-logic** | Tonal guidance: scale snap, chords, rhythm | pure `src/music/theory.ts` (magnetic snapping); Tonal.js for chords/voicing (planned) |
| **Synthesis / Generation** | Make sound | `webaudio-synth` (direct); Lyria RealTime via `@google/genai` (steerable AI, planned port from `src/plugins/ai-dj/`) |
| **Output** | Audio + video + visual guides | Web Audio out; `canvas-overlay` (landmarks, markers, HUD); (later WEBMIDI.js out) |

## The DAG runtime (`src/dag/`)

Framework-agnostic (no React/DOM/audio) so it runs in plain Node for fast tests.

- **`types.ts`** — `NodeDef`, `PortSpec`, `NodeContext`, `GraphSpec`, `Tap`, `StreamRecord`.
- **`node.ts`** — `defineNode({...})`: author a node from a pure `process(inputs, params, ctx)` or a stateful `make(params) => handlers`.
- **`registry.ts`** — `NodeRegistry`: name → `NodeDef`. Explicit (not global) so tests are hermetic.
- **`engine.ts`** — `Engine`: validates params (Zod), wires edges, topo-sorts (rejects cycles + fan-in to one input port), and `tick(time)` evaluates every node once in dependency order. Async sources (e.g. ML inference) run their own loop and cache the latest value; `process` returns the cache, decoupling detection rate from tick rate.
- **`recorder.ts`** — `StreamRecorder` (a `Tap` that records every edge), NDJSON serialize/parse, `replayNode` (drive one node from recorded inputs).
- **`runHeadless(spec, registry, {ticks})`** — build + init + tick N times with a recorder attached. The driver for headless tests and the fixture recorder.

### Node contract

A node declares typed input/output **ports**, a **Zod params schema** (validated
+ defaulted at build), and a `process(inputs, ctx) → outputs` run each tick.
Pure nodes (features, mapping, music-logic) are trivially testable. Stateful
nodes (synth voices, websocket sessions, recorder) own resources via
`init`/`process`/`dispose` and read host resources (AudioContext, canvas, video)
from `ctx.resources`. **Static params** are build-time defaults; **input ports**
are live overrides — e.g. `voice-mapping` takes `scale`/`instrument`/`magnetism`
on input ports so the UI changes them without rebuilding the graph or reloading
the ML model.

## The default instrument (`src/app/graph.ts`)

```
webcam ─┬─▶ hand-features ─┬─▶ voice-mapping ─▶ webaudio-synth
        │                  │        ▲ ▲ ▲
        └──────▶ overlay ◀─┘        │ │ └── store-controls (scale/instrument from UI)
                  (video+guides)    │ └──── keyboard-control (magnetism/octave/mute)
                                    └────── keyboard-source ─▶ keyboard-control
```

Hand x → pitch (snapped toward a scale by a `magnetism` amount), hand y →
volume; openness/pinch are extracted for future mappings. Keyboard arrows/​`m`
adjust octave/magnetism/mute live; the UI panel changes scale/key/wave live.
The overlay draws the mirrored video, landmarks, per-hand control markers
(openness = ring size, pinch = fill), and a feature HUD.

## The deployed app being folded in (`src/`)

The **currently deployed app** is the React app at the repo root
(`src/App.tsx`, `src/components/Theremin.tsx`, `src/hooks/`, `src/plugins/`),
live at https://apps.thorwhalen.com/thoremin/. It is the working app this DAG
architecture grows from: MediaPipe hands + Web Audio synth + a **Lyria RealTime**
plugin (`src/plugins/ai-dj/`: `lyria-realtime-exp`, `@google/genai` WebSocket,
48 kHz PCM, weighted "strain" prompts throttled to 200 ms,
BPM/density/brightness/guidance config, 10-min sessions).

The DAG engine + node library (`src/dag/`, `src/nodes/`, `src/music/`) currently
live **alongside** that app — fully tested, but not yet wired into it. The next
step (M3, issue #6) refactors `Theremin.tsx`'s monolithic detect loop onto the
DAG (`webcam-hands → hand-features → voice-mapping → webaudio-synth` +
`canvas-overlay`) and ports `LyriaSession`/`audioUtils`/the vibe-strain UI into a
`lyria` generative node + `indirect-map` mapping node behind the
`GenerativeEngine` facade.

## Roadmap

See `docs/ROADMAP.md` (milestones M0–M7) and the GitHub issues. v0 status: M0
(baseline) and M1 (browser video→sound vertical slice) implemented; M2 (fixture
record/replay) implemented. Next: M3 (Lyria generative node + indirect mapping).
