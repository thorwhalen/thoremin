# Stream Applier — pluggable sources + batch/paced execution

> **Status:** design agreed (2026-07); being built incrementally (M-A…M-G below).
> **M-A** (camera-free video source, #102 / PR #105) and **M-B** (Clock + speed,
> #103 / PR #106) have **shipped**. **M-C** (#104) is **design-resolved but
> deferred** — see [M-C resolved](#m-c-resolved-host-side-source-for-video-node-swap-for-frame-emitters).
> This document is the single source of truth; the ROADMAP and the tracking
> issues point here. It supersedes ad-hoc source/replay wiring.

## The idea in one line

The DAG (`src/dag/`) is *the computation*. **Applying** the DAG to a stream is a
separate concern with pluggable choices: **where the data comes from** (the
*source*), **when the engine advances** (the *clock*), and **what we do with the
outputs** (*taps* for recording, *sinks* for view/hear). One open-closed
**Applier** ties them together; the live app and the headless test runner both
become thin configs of it.

## Requirements (the vision this design serves)

- **R1 — Uniform source interface, origin-independent.** A source is *anything
  with the right interface: a generator yielding the right data format*. Its
  origin is interchangeable — a live sensor (webcam, keyboard, later MIDI/other),
  persisted data (a pre-recorded video file, a persisted keyboard-event sequence,
  recorded feature-stream NDJSON), or a generator function (reading from files
  *or from other live nodes of the DAG*).
- **R2 — Composition / mixing.** e.g. a pre-recorded video as the primary source
  mixed with a persisted-or-generated keyboard-event stream.
- **R3 — State-feedback generators.** A source whose emitted events are a
  *function of current DAG state* (the video/feature stream, or other node
  outputs) — a controlled feedback dependency.
- **R4 — An Applier** that applies the DAG to a source-set, open-closed over
  source origin: anything conforming to the interface plugs in.
- **R5 — Execution mode orthogonal to sourcing.** *Batch/unpaced* (run through
  the DAG as fast as possible, recording chosen node outputs — for testing) vs
  *time-paced play* (imitate real time, capture view/hear, possibly accelerated
  or slowed).
- **R6 — Immediate need:** run the instrument **camera-free** in the browser from
  a pre-recorded persistent video, so the overlays and command palette can be
  seen/verified without a live camera; later mix in a persisted or state-driven
  keyboard-event stream.

Terminology note: this is a general **alternative-source** capability, *not*
"synthetic". `synthetic-hands` is merely one generator instance among many
origins (file / persisted / generated / live).

## Design invariants (constraints every abstraction honors)

These come from the existing engine (`src/dag/engine.ts`) and are load-bearing:

1. **`process()` is synchronous; only `init()` is async.** All I/O (video decode,
   file read, MediaPipe, fetch) happens in the background and is *latched* into a
   value that `process()` reads synchronously. Never `await` in `process()`.
2. **The v0 engine is acyclic** — cycles are rejected at build time. Feedback is
   one-tick-delayed via `getOutput` today; a real `delay` node comes later
   (M-G) as the principled path.
3. **Taps are the recording mechanism**, orthogonal to pacing. A dev-mode
   port-schema conformance check lives in `tick()`'s output path (not
   `emitTaps`, which skips `undefined` and never runs in the live app).
4. **Sources are ordinary zero-input nodes.** We do **not** fork the node model.
   The `Source` below is a host-side thing that *feeds* a plain node via
   `ctx.resources`.

## Two hard boundaries (accepted, not worked around)

- **(A) Batch-in-Node cannot decode raw video.** No DOM / tasks-vision WASM /
  `requestAnimationFrame` / `performance.now`. The fast/test path consumes
  **pre-extracted landmark NDJSON** (via a replay source); raw video → landmarks
  is an *offline* pre-processing step (`scripts/video_to_landmarks.py`), never an
  in-loop batch source. Automated raw-video regression, if ever needed, is a
  separate Playwright/headless-Chrome investment — out of scope.
- **(B) Accelerated/slowed audio is not a time-multiply.** Control-rate params
  scale with `ctx.time` for free; audio rides `AudioContext.currentTime` and does
  not. Policy: **real-time = live audio; accelerated/slowed = control-rate
  preview with audio muted, plus an explicit "render at speed" action on demand**
  (`OfflineAudioContext`). Never silently pitch-shift. Live/streaming/generative
  audio (Lyria) cannot be scaled at all.

## The abstractions

### Source — an async iterator yielding the right format

A source is **`AsyncIterable<Frame>`** (an `async function*`) yielding values in
the right data format for its output port, *at its own rate*. Origin lives
entirely inside the generator. Every origin is the same interface:

```ts
interface Source<Frame> {
  readonly id: string;
  readonly kind: 'signal' | 'event';   // how the Applier samples it (see below)
  readonly outputResource: string;     // resources key the in-graph node reads (e.g. 'video', 'hands')
  frames(ctx: SourceContext): AsyncIterable<Frame>;  // async function* — the origin
  exhausted(): boolean;                // EOF stop-condition (video ended, records drained)
  dispose(): void;
}
```

- **`signal`** sources (hand landmarks, video frames): the Applier **latches the
  latest** frame; stale intermediate frames are dropped (you want the newest).
- **`event`** sources (keyboard, MIDI): the Applier **accumulates every frame
  since the last tick** and hands the node a *list*; nothing is dropped when two
  events fall between ticks.

The **"pump"** (the async→sync bridge that services live sources today) is **not
part of the contract** — it is a private detail of the Applier, which drives each
source's iterator in the background and maintains the latched/accumulated value
in `ctx.resources`. Pure generators (`replay`, `synthetic`) are trivial iterators
the Applier pulls with zero overhead. So live / persisted / generated are *one*
interface, with no per-kind branching leaking into node code.

Concrete sources (origin interchangeable **within an execution mode** — see
boundary A): `webcamSource` (live), `videoFileSource(url, {loop, muted})`
(live), `windowSource` (live keyboard), `replaySource(records)` (batch+live,
pure), `generatedSource(fn, {seed})` (batch+live, pure — **seeded, never
`Math.random`**), `stateGeneratorSource(compute, {seed})` (R3, see below).

### Clock — the only place pacing lives

```ts
interface Clock {
  run(onTick: (time?: number) => void, shouldStop: () => boolean): Promise<void>;
}
```

- **`BatchClock(ticks)`** — as fast as possible, deterministic. Calls `onTick()`
  **with no argument** so the engine synthesizes `tickIndex * nominalDt`
  (the regression goldens depend on this exact call).
- **`RealtimeClock({ speed = 1, now, schedule })`** — wall-clock paced. Passes
  `base + (nowReal - base) * speed`, seeding `base` to the first frame's time so
  engine time starts at that wall-clock value and advances at `speed×` (and the
  first frame's delta is `0`, matching the engine's own tick-0 `dt === 0`, which
  it forces for any clock). Control-rate `dt` scales for free. `now`/`schedule`
  are injectable so the clock is fully headless-testable. Speed ≠ 1 is gated to
  recorded/generated sources and obeys boundary B for audio; a **non-positive
  speed** collapses to a frozen clock (`dt = 0`) — validated when `RealtimeClock`
  is adopted into the app (M-D).

### Applier — applies an Engine to a SourceSet under a Clock

```ts
class Applier {
  constructor(o: {
    spec: GraphSpec; registry: NodeRegistry;
    sources: Source[];          // open-closed over origin (R4)
    clock: Clock;               // execution mode, orthogonal to sourcing (R5)
    taps?: Tap[];               // recording — orthogonal to pacing
    sinks?: Sink[];             // audio / overlays / React bridges
  });
  async start(): Promise<void>; // acquire sources → build → init → drive pumps → clock.run(tick+sinks) → stop on exhaustion
  dispose(): void;
}
```

Will live at `src/dag/applier.ts` (**in-repo**; revisit extraction to a reusable
substrate once it stabilizes at M-D and a second consumer appears). Not built yet
— M-D is unstarted, and this section describes the target, not the code. `useEngine`
(live/paced) and `runHeadless` (batch) both collapse to configs of it, differing
on **{clock, sinks, taps} jointly** — not "only the clock". Batch attaches a
recording tap and **no audio sink** (the synth self-no-ops when the audio
resource is absent); paced attaches the AV sinks.

The Applier also injects `resources.stateReader = { get: (n, p) => engine.getOutput(n, p) }`
— the one-tick feedback channel for R3.

### State-feedback + composition

- **R3 (`getOutput` interim — agreed).** `stateGeneratorSource` reads a
  `StateReader` (backed by `engine.getOutput`, via `ctx.resources`, fakeable in
  tests). Because a zero-input source runs topo-first, it reads **"the latest
  value that node emitted, as of the reader's topo position"** — for a downstream
  node that means tick *N-1* (the intended feedback), with no cycle. It must:
  tolerate a first-tick `undefined` (seed or emit nothing), derive any randomness
  from `seed + ctx.tick` (never `Math.random`, else recordings aren't
  reproducible), and **re-emit the read snapshot on a second port** so replay
  reproduces the feedback and it stays tappable. The principled `delay`-node path
  (M-G) is a one-line swap of what backs `StateReader.get`. Caveat: the delay is
  one *tick*, not time-invariant under accelerated play (documented, R5×R3).
- **R2 composition.** A generic per-kind `defineMergeNode({ kind, combine })`
  merges two same-kind streams on the shared tick grid *after* timestamp-aware
  resampling to `ctx.time`. Each video source binds a distinct `videoResource`
  key (default `'video'`) so a primary and a secondary clip coexist. Mixing a
  persisted keyboard sequence with a live/generated one is an `event`-kind merge.
  Sub-tick event timing is lost by design in v0 (latch-and-sample); `event`
  sources accumulate to avoid dropping coalesced events.

## Incremental build order

Each milestone is a small shippable PR set, headless-verifiable where the
boundaries allow.

- **M-A — Camera-free file video (R6). ⭐ Unblocks camera-free overlay/palette
  verification.** Pure host wiring, **no engine code**: `?source=video&video=<url>`
  → skip `getUserMedia`, feed a `<video src loop muted>` into `resources.video`;
  webcam nodes run unchanged. Real guards: `loop` **required** (the
  `currentTime !== lastVideoTime` gate freezes on a non-advancing clip),
  `await loadedmetadata`, StrictMode `disposed` guards, `onended` → `exhausted`,
  loop-boundary MediaPipe tracking-reset. Medium, not 15 lines. The hand model
  still loads (not free). Known limitation: the instrument mirrors the video
  (selfie assumption), so a non-mirror-image clip renders flipped with Left/Right
  swapped — a per-source `mirror` flag is deferred to the M-C Source contract.
- **M-B — Clock + speed multiplier (R5 control-rate core). ✅ shipped.**
  `src/dag/clock.ts` (`Clock` / `BatchClock` / `RealtimeClock`); refit the
  **`runHeadless`** loop → `BatchClock(ticks)` (preserve the no-arg `tick()`
  call). No engine change. The live `useEngine` rAF adoption of `RealtimeClock`
  is **deferred to M-D** — it is the untested live surface and lands with the
  Applier + a browser smoke test; M-B ships the abstraction + the fully-tested
  `BatchClock` path and a headless `RealtimeClock`.
- **M-C — Source contract + `source` slot + conformance (R1/R4 foundation).
  ✅ design resolved, build DEFERRED (#104).**
  The async-iterable `Source` (signal/event); a `source` slot with a
  `SOURCE_SLOT_CONTRACT` guaranteeing `hands`/`hands-frame`; `PortSpec.schema?`
  validated in `tick()` (dev/batch, incl. `undefined`); the seeded-RNG rule.
  **`videoFileSource` is a host-side `Source`, NOT a slot candidate** — see the
  resolution below, which corrects the earlier "slot candidate" reading. M-A's host
  wiring is the right shape and stays.
- **M-D — The Applier (R4 complete, R5 orthogonality). ⚠ untested live surface.**
  `runHeadless` delegates (BatchClock + bounded recorder tap, no audio sink);
  `useEngine`'s effect becomes a thin Applier config — **this is where the live
  rAF loop adopts `RealtimeClock(1)`** (deferred from M-B). Also validate
  `speed > 0` on adoption (a non-positive speed collapses to a frozen clock).
  **Gate on a browser smoke test** — the effect (StrictMode guards, face bridge,
  mute mirror, AudioContext lifecycle) has no headless coverage.
- **M-E — Composition + timestamp-aware replay (R2).** `defineMergeNode`; event
  sources buffer→list; a **separate** time-based `replay-source-timed` reading
  `StreamRecord.t` (index-by-tick stays canonical for CI goldens).
- **M-F — State-feedback generators (R3, `getOutput` option).**
  `stateGeneratorSource`; assert topo order + deterministic one-tick output; the
  fed-back snapshot appears in the recorded tap. #87 command-dispatch is the
  prime consumer.
- **M-G — Honest time-scaled audio + delay node (principled end-state).**
  `OfflineAudioContext` render-then-play behind an explicit action; recorder
  backpressure (fold into #88 recording-v2); the `delay` node + delayed-edge
  topoSort (the only engine change on the whole path); migrate `StateReader` onto
  it.

## M-C resolved: host-side Source for video, node-swap for frame-emitters

> **Decision recorded 2026-07-12 (issue #104). READY to build; DEFERRED — nothing
> currently blocks on it.** This resolves the one open fork in the design above and
> **corrects** the earlier suggestion that `videoFileSource` would become a *slot
> candidate*.

The fork was: when the frames come from a file instead of a camera, is that a
**different node** (swapped into a `source` slot) or a **different feed into the same
node**?

**The answer depends on what the origin emits, and the two cases are genuinely
different:**

| Origin emits | Mechanism | Why |
|---|---|---|
| **Raw video** (a `<video>` element: file, camera, stream) | **Host-side `Source`** with `outputResource: 'video'`. The Applier puts the element in `ctx.resources.video`; `webcam-hands` / `webcam-face` run **unchanged**. | The node's job — run MediaPipe on a video element and latch the result — is *identical* regardless of where the element's pixels came from. Swapping the node would duplicate the entire model-loading, latching, tracking-reset and mirror logic, once per origin, to change nothing but the element's `src`. The variability is in the **resource**, so that is where it belongs. |
| **Finished frames** (`HandsFrame` / `FeatureVector` records: replay, synthetic, generated) | **Node swap** — an ordinary zero-input node (`replay-source`, `synthetic-hands`, `generatedSource`). | These emit the node's *output* type directly. There is no inference to do and no shared machinery to reuse; they are a different computation, not a different feed. They are already ordinary nodes today, and stay that way. |

So the `source` slot exists — but its candidates are the **frame-emitters**, and
`videoFileSource` is not among them. M-A's `if` in the host does **not** retire into a
slot; it becomes a `Source` object with the same responsibility, which is what M-A
already effectively wrote by hand.

Consequences for the rest of the design (all consistent with what is written above):

- **Invariant 4 holds unchanged** — "sources are ordinary zero-input nodes; the `Source`
  is a host-side thing that *feeds* a plain node via `ctx.resources`". The resolution is
  really just taking that invariant seriously for the video case.
- The **per-source `mirror` flag** (the M-A known limitation: a non-selfie clip renders
  flipped with Left/Right swapped) lands on the `Source`, not on a node's params — it is
  a property of the feed.
- A **second video source** (R2 composition) binds a distinct `videoResource` key, which
  is a `Source` field, not a graph edit.
- The `SOURCE_SLOT_CONTRACT` still guarantees `hands` / `hands-frame` — it just governs
  the frame-emitters.

**Why deferred:** M-A already delivers R6 (camera-free runs) and M-B already delivers the
clock. M-C's value is the *contract* — open-closed source plugging and port conformance —
which pays off when the Applier (M-D) lands and when a second non-webcam origin actually
appears. Neither is currently blocking anything, so the design is banked and the build is
not scheduled.

## Relationship to existing work

- **M2 record/replay** (done) is the substrate for the recorded-source mode.
- **#87 command-dispatch** consumes the state-generator source (M-F).
- **#88 recording-v2**: its multi-stream *capture* is the recording half;
  timestamp-aware replay + recorder backpressure + honest scaled audio are the
  playback/scaling halves (extend #88, split into sub-issues).
- **#93 DAG diagnostics** gains concrete pacing/source state from the
  Applier/Clock/source-slot.
