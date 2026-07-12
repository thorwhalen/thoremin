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

| Role | Responsibility | What actually implements it today |
|------|---------------|-----------------------------------|
| **Input** | Capture raw sensor data | `webcam-hands` + `webcam-face` (`getUserMedia`+`<video>`, MediaPipe); `store-controls` (the UI store as a graph input); camera-free `synthetic-hands` / `replay-source` for tests, and `?source=video` for a pre-recorded clip. A `keyboard-source` node exists but is **not** in the default graph — keyboard handling moved app-side (#90). |
| **Feature** | Raw data → normalized control signals | `@mediapipe/tasks-vision` hands + 52-blendshape face. Nodes: `hand-features`, `face-features`, `face-expression`, `face-controls` (head/jaw/brow pose), `gesture-classifier`, and the Feature Lab taps `face-feature-vector` / `hand-feature-vector` (#119). |
| **Mapping** | Features → engine params, across the direct↔indirect spectrum | `voice-mapping` (direct — the default). `indirect-map` (→ weighted prompts) is built and tested but **not wired into the default graph**. |
| **Music-logic** | Tonal guidance: scale snap, chords | `src/music/theory.ts` (magnetic snapping) in the hot path; `expression-chord` / `pose-chord` play diatonic chords from the face; Tonal.js backs `chord` / `progression` (built + tested, not in the default graph) and the voicings. |
| **Synthesis / Generation** | Make sound | `webaudio-synth` (declarative timbre presets from `src/music/sounds.ts`). The `lyria` node + `GenerativeEngine` facade exist and are unit-tested, but the only *running* generative surface is the AI-DJ plugin in the **frozen** legacy app (#128 decides its fate). |
| **Output** | Audio + video + visual guides + MIDI | Web Audio out; `canvas-overlay` (video, landmarks, markers, pitch guides, chord cues, feature-lab meters, annotation HUD); `midi-out` (WEBMIDI.js, shipped #13, off by default). |

## The DAG runtime (`src/dag/`)

Framework-agnostic (no React/DOM/audio) so it runs in plain Node for fast tests.

- **`types.ts`** — `NodeDef`, `PortSpec`, `NodeContext`, `GraphSpec`, `Tap`, `StreamRecord`.
- **`node.ts`** — `defineNode({...})`: author a node from a pure `process(inputs, params, ctx)` or a stateful `make(params) => handlers`.
- **`registry.ts`** — `NodeRegistry`: name → `NodeDef`. Explicit (not global) so tests are hermetic.
- **`engine.ts`** — `Engine`: validates params (Zod), wires edges, topo-sorts (rejects cycles + fan-in to one input port), and `tick(time)` evaluates every node once in dependency order. Async sources (e.g. ML inference) run their own loop and cache the latest value; `process` returns the cache, decoupling detection rate from tick rate.
- **`recorder.ts`** — `StreamRecorder` (a `Tap` that records every edge), NDJSON serialize/parse, `replayNode` (drive one node from recorded inputs).
- **`clock.ts`** — `Clock` / `BatchClock` (as fast as possible, deterministic) / `RealtimeClock` (wall-clock paced, with a speed multiplier). Pacing lives here and nowhere else. See [design/stream-applier.md](design/stream-applier.md).
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

The file is the SSOT; this is its shape (17 nodes). **Keyboard is not in the
graph** — since #90 the shortcuts are an app-level `tinykeys` handler that
dispatches dial commands into the store, which the graph reads back through
`store-controls`.

```
HANDS
  webcam-hands ─┬─▶ hand-features ──┬─▶ voice-mapping ────────────────┐
                │                   └─▶ canvas-overlay                │
                ├─▶ hand-feature-vector ─▶ canvas-overlay             │
                └─▶ canvas-overlay  (landmarks)                       │
                                                                      │
FACE  (wired always; idle until a face mapping is picked)             │
  webcam-face ──┬─▶ face-features ──▶ voice-mapping.face  (timbre)    │
                ├─▶ face-expression ─▶ expression-chord ──────────────┤
                ├─▶ face-controls ───▶ pose-chord ───────────────────-┤
                ├─▶ face-feature-vector ─▶ canvas-overlay             │
                └─▶ canvas-overlay  (mesh + expression)               │
                                                                      ▼
UI                                                              synth-merge
  store-controls ─▶ voice-mapping  (scale/sound/magnetism/octave/mute)     │
                 ─▶ expression-chord + pose-chord  (chord spec/config)     │
                 ─▶ synth-merge  (master mute, #91)               ┌────────┴────────┐
                 ─▶ canvas-overlay  (element config, guides)      ▼                 ▼
                                                            webaudio-synth      midi-out
CHORD CUE
  expression-chord.triad ─┐
                          ├─▶ chord-select ─▶ canvas-overlay  (highlight the sounding chord)
  pose-chord.chord ───────┘
```

Hand x → pitch (snapped toward a scale by a `magnetism` amount), hand y → volume;
openness/pinch/finger curls drive expression and routable finger effects. The face
branch costs nothing when off: `webcam-face` only loads its model once a face
mapping is chosen, and the chord nodes emit silent voices unless their mode is
active, so `synth-merge` passes the hand voices through unchanged.

`synth-merge` is the single convergence point of every sound producer — which is
why the master mute lands there, and why `midi-out` can tap the same merged voices
as the synth. The overlay draws the mirrored video, landmarks, control markers,
pitch/scale guides, chord names, the Feature Lab meters and the annotation HUD.

One output may fan **out** to several inputs; fan-**in** to a single input port is
rejected by the engine (hence `synth-merge` / `chord-select` as explicit merge
nodes).

## The app layer around the graph (`src/app/`)

The DAG is the computation; the app is everything that parametrizes, records and
narrates it. Each of these has its own SSOT design doc in `docs/design/`:

| Subsystem | What it owns |
|-----------|--------------|
| **Command registry** (`src/app/commands/`, #87) | Every param-mutation as an `acture` command — the *intended* single write path, shared by keyboard shortcuts, the Cmd/Ctrl-K palette and the AI assistant. A command changes sound only by writing a **dial**; the per-tick/audio path is never a command, and a test-enforced import firewall keeps it that way. The write-path sweep is **incomplete** (#126) — see [design/command-dispatch.md](design/command-dispatch.md). |
| **Dials + instruments** (`src/app/dials/`, `src/settings/`) | The settings schema (Zod, via `@zodal/dials-*`) and named saved profiles — **instruments**. The hot `useControls` zustand store is the synchronous mirror the DAG reads each tick; dials are the persisted, validated layer above it. |
| **Instrument library** (`src/app/library/`, #113–#115) | Favorites, stable-id tags, read-only `sys:*` tags derived from parametrization, and `summarizeInstrument`. See [design/instrument-library.md](design/instrument-library.md). |
| **Feature Lab** (`src/features/`, `src/app/lab/`, #119) | A data-driven catalog of ~200 face/hand scalar features, a no-eval formula compiler for user-defined derived features, and an online normalizer that makes heterogeneous features comparable on one grid of meters. See [design/feature-lab.md](design/feature-lab.md). |
| **Recording v2** (`src/app/recording/`, #88) | Session-based multi-stream capture into one folder + `manifest.json`. See [design/recording-v2.md](design/recording-v2.md). |
| **Annotations** (`src/taglog/`, `src/app/tagging/`, #92) | Live tag toggles → a time-aligned `<take>.annotations.jsonl` + exporters. `src/taglog/` is written to lift out as a standalone package. |
| **AI assistant** (`src/plugins/assistant/`, #87 Phase 3) | A chat that operates the instrument by dispatching commands. Client-side, multi-provider, bring-your-own-key; destructive commands pass a human confirmation gate. |

## The legacy app (`src/App.tsx` — frozen)

The original React app (`src/App.tsx`, `src/components/Theremin.tsx`,
`src/hooks/`, `src/plugins/ai-dj/`) is the **legacy view**, reachable at
`?engine=legacy`. It is the app this DAG architecture grew from: MediaPipe hands +
Web Audio synth + a **Lyria RealTime** plugin (`lyria-realtime-exp`,
`@google/genai` WebSocket, 48 kHz PCM, weighted "strain" prompts throttled to
200 ms, BPM/density/brightness/guidance config, 10-min sessions).

Since PR #58 the DAG view — not this — is what loads at the bare URL, and the
legacy app is **frozen** (maintainer decision): it stays reachable so the
generative work is not lost, but it receives no new features and is excluded from
refactors. The DAG side already has a `lyria` node and an `indirect-map` node,
both unit-tested against a mock engine; what is *not* done is wiring a generative
layer into the default graph. Issue **#128** decides that: port it in, or formally
retire the legacy view.

## Roadmap

See [`docs/ROADMAP.md`](ROADMAP.md) and the GitHub issues. The DAG instrument is
the shipped product; the engine milestones M0–M6 are done or superseded, and the
live tracks are the Stream Applier (M8 / #101), the command-dispatch write-path
sweep (#126), and the generative-layer decision (#128).
