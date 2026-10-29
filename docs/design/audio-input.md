# Audio as an input stream

Status: implemented 2026-10-29 (lane B of [#866](https://github.com/thorwhalen/thoremin/issues/866)). The pure half is in `packages/sdk/src/audio/` (#870); the browser half (microphone, worklet, hub, graph node) is #872; the first consumer is the Sound mapper tool (`src/slices/sound-mapper/`). Follow-ups: #873 (a real-room take), #874-#879.

thoremin was built camera-in, sound-out. This document is the seam for **sound in**: a microphone (or a file, or a synthetic take) whose stream feeds both things that must answer in the time of a drum stroke, and things that only need to know what was heard. The research behind it is [`docs/research/live-audio-to-audio.md`](../research/live-audio-to-audio.md); the numbers behind it are [`docs/research/audio-trigger-latency.md`](../research/audio-trigger-latency.md).

## Two paths, two clocks

The graph ticks once per camera frame (30 to 60 Hz, `packages/dag/src/applier.ts`). A frame is 17 to 33 ms; a drummer hears 10 ms. So nothing a player hears **as a reaction to a sound** may wait for a tick.

- **The fast path runs on the audio thread.** One AudioWorklet hosts a chain of analysers. Each reads every render quantum (128 frames, 2.67 ms at 48 kHz), may add to the output (a triggered sample, an effect), and returns events. Detect, analyse, decide and render happen inside one `process` call, so the latency a player hears is the analysis window plus the device's input and output stages, and does not depend on the quantum or the frame rate. The sound mapper is this path: `packages/sdk/src/audio/mapper.ts`.
- **The slow path is events into the graph.** The worklet posts its events (only when there are some), stamped in context frames. The host queues them; a DAG source node, `audio-events`, drains the queue once per tick and converts each stamp to engine time. Visuals, games, scoring and the control of other instruments read that port.

Every event carries the time of the AUDIO it describes (`frame`: the context sample frame of the onset, the decision, the level period's end), never the tick it arrived on. Converting to engine time is `engine = nowEngine + (frame / sampleRate - inputStage - ac.currentTime)`, the inverse of the timing resource's clock map (`packages/sdk/src/timing/clock_map.ts`) with the input stage taken off, because a frame is stamped when the sample reached the context, `inputStage` after it reached the microphone.

## The pieces

| Piece | Where | What |
|---|---|---|
| Event types | `packages/sdk/src/audio/types.ts` | `onset`, `class`, `level`, `pitch`, `snippet`; plain types, no runtime imports (they are bundled into the worklet) |
| The analyser interface | same file | `AudioAnalyser.process(input, output, frame) -> readonly AudioEvent[]`; `output` is added to, never overwritten; no allocation per call beyond the events; optional `configure(message)` |
| The analyser table | `packages/sdk/src/audio/analysers.ts` | `ANALYSERS` by name (`onset`, `sound-mapper`, lane A's `pitch`); `createAnalyserChain` is the processor's loop; `runAnalysers(pcm, sampleRate, specs)` is the same loop offline |
| The offline harness | `packages/sdk/src/audio/offline.ts` | `runOffline`: 128-frame quanta exactly as the worklet feeds them; the real-time tests use it |
| Onsets | `packages/sdk/src/audio/onset.ts` | causal energy detector on 32-sample hops: pre-emphasis, a room-relative threshold, a per-band rise test against the recent peak, a refractory time; sample-accurate placement |
| Attack features | `packages/sdk/src/audio/features.ts` | a short window from the onset: MFCC (or log band fractions), centroid, roll-off, flatness, zero crossings, decay, loudness; allocation-free |
| Few-shot classifier | `packages/sdk/src/audio/classifier.ts` | nearest example per class, features scaled by their within-class spread, a reject radius learned from the examples |
| Taught examples | `packages/sdk/src/audio/examples.ts` | the raw audio around each taught onset is the SSOT; models are derived per window |
| Sample voices | `packages/sdk/src/audio/sampler.ts` | one-shots started at an exact sample; fade-in part-way through and fade-out from an offset (the correction) |
| Synthetic taps | `packages/sdk/src/audio/synthetic_taps.ts` | seeded modal-synthesis taps with known onsets and surfaces |
| Input stage | `packages/sdk/src/timing/input_stage.ts` | `InputStage { seconds, source }` and the trust order |
| Worklet, hub, sources, graph node | `src/app/audio/`, `packages/sdk-ui/src/audio/hub.ts`, `src/nodes/sources/audio_events*.ts` | below |

## Decisions

**1. One worklet, analysers by name.** The processor is generic: it builds an `AnalyserChain` from the spec list it is constructed with and routes port messages to analysers by id. An analyser is a pure module plus one entry in `ANALYSERS`. Offline (`runAnalysers`) and live run the same table, so a fixture test is a test of the code the microphone feeds. Rejected: one worklet per consumer (each would re-read the same microphone, and their outputs would need mixing anyway); analysis on the main thread through an `AnalyserNode` (the chord map's microphone does this, `packages/ext-harmony/src/app/micChordIn.ts`; fine for a chroma ten times a second, useless for a trigger, since the main thread is blocked for whole frames by React and the graph).

**2. Events, not raw audio, cross into the graph.** Posting every quantum to the main thread is about 375 messages a second, and the graph would then re-do in a tick what the worklet could have done per sample. Raw PCM is an opt-in subscription on the hub (recording, an offline look), batched, with a dropped-block count. The `snippet` event (the audio around one onset) is the one case of audio in an event: teaching needs exactly the audio the detector heard, around exactly the onset it placed.

**3. Every event names its analyser.** On the `audio-events` port an event is `{ source, ...event }`, so a clap trainer reading the `onset` analyser never sees the sound mapper's onsets or classes, and vice versa (lane A's ask 3 on #866).

**4. The microphone is opened once, with processing off.** `echoCancellation`, `noiseSuppression` and `autoGainControl` each add latency and smear transients; all three are off by default and a consumer may ask otherwise (the strictest-latency request wins; the hub reports the active set). The microphone opens in the app's one AudioContext (`useEngine`'s), so the output stage is the timing resource's, and only when a consumer asks: no permission prompt for a player who never used a sound instrument.

**5. The input stage is a number with a source**, chosen by trust (`measured` > `loopback` > `tap` > `reported` > `prior`, never 0), stored per device (`src/app/audio/inputStage.ts`, with a setter lane A's calibration takes write through).

**6. Three sources, one slot.** `microphone`, `replay` (a decoded file through the same worklet: the Replay tool and the smoke) and `synthetic` (seeded taps from `synthetic_taps.ts`, with known onsets): `?audio.source=...`, as `?slot.source=synthetic-hands` is for the camera. A test never needs a microphone.

**7. Sound early, decide late.** The sound mapper sounds on a short window (4 ms) and re-decides on a long one (12 ms); a changed decision crossfades to the corrected sample, started as far into itself as the first had played. The numbers that chose the windows are in the latency doc.

## What it does not do yet

- A pitch analyser: lane A's (`packages/sdk/src/audio/pitch.ts`, one entry in the table).
- Effects (filters, delay, a harmoniser) on the microphone: further seeds, filed as idea issues.
- Raw audio as a graph port: on request (#866).
