# Thoremin Roadmap

Status board, swept 2026-07-12. Two horizons:

1. **What shipped** and **what is next** (below) — the live planning surface.
2. **Longer-horizon engine milestones (M0–M8)** — the original platform/engine arc,
   kept at the bottom for direction.

A note on vocabulary, because it used to collide: **annotations** are the live
time-anchored taps over a *recording* (#92); **tags** are keywords on a saved
*instrument* (#113). PR #125 renamed the former, and it now writes
`<take>.annotations.jsonl`. Do not call annotations "tags" again.

---

## Shipped (2026-06 → 2026-07)

The five tracks below all landed. Each row is the issue, the PR that closed it, and
what it actually gives you.

### Interaction / control

| Issue | PR | What shipped |
|-------|----|--------------|
| **#91** Mute fix + cue | #95 | A true master mute at `synth-merge` (the single convergence point of every sound producer), so muting silences the hands *and* both chord instruments, plus an unmissable "muted" HUD cue. |
| **#89** Chord overlays | #96 | Chord-name HUD cue (jazz symbol + optional Roman/Nashville) and a keyboard-strip element with a layered visual-cue hierarchy. |
| **#87** Command dispatch (acture) | #97 (Phase 0), #107 (Phase 1), #98 (Phase 2), #111 (Phase 3) | The command registry: every dial is a typed `acture` command. Phase 2 added the **Cmd/Ctrl-K command palette** (one generated `dial.<key>.set` per dial). Phase 3 added the **AI assistant**. The registry is the *intended* single write path — the sweep is **not finished**, see #126. |
| **#90** Custom keyboard mappings | #110 | App-level `tinykeys` keymap dispatching dial commands; retires the in-DAG `keyboard-control` node. Keyboard is no longer in the graph. |
| **AI assistant** (#87 Phase 3) | #111 | An in-app chat that operates the instrument by dispatching the registry via `acture-ai-vercel`. **Client-side, multi-provider, BYO-key** (OpenAI / Anthropic / Google — default Gemini 3.5 Flash); **no aix** — thoremin stays client-side, with a pluggable `ChatBackend` seam for a future server-side move. A human-in-the-loop confirmation gate guards the destructive `instrument.*` commands. Lazy-loaded so the AI SDK stays out of the initial bundle. |

### Capture / training data

| Issue | PR | What shipped |
|-------|----|--------------|
| **#88** Recording v2 | #118 | Session-based multi-stream recorder: settings live **outside** the instrument in a transient sheet (Record → sheet → "Rec now" in the same slot); five capturable streams (audio, video+overlays, pure webcam, overlay-only alpha, feature-JSONL); **one folder per take** with an info-carrying naming scheme; a `manifest.json` as the cross-stream alignment SSOT; a three-tier local sink (directory handle / ZIP / per-file). SSOT: [design/recording-v2.md](design/recording-v2.md). |
| **#92** Annotations (was "live tagging") | #123, #125 | Toggle annotations during a take → a time-aligned `<take>.annotations.jsonl` on the same absolute engine clock as `features.jsonl`. Interval + point annotations, mutual-exclusivity groups, 1–9 keyboard toggles, per-annotation lead-in + countdown, a burned-in corner overlay as in-band ground truth. Built as a reusable, extraction-ready tool in `src/taglog/` (affordances / adapters / provider / presentation) + thoremin glue in `src/app/tagging/`. **PR #125** added the **Export panel** (Audacity / WebVTT / CSV / Praat TextGrid / OTIO, with a raw-vs-lead-in-corrected time choice) and killed the "tags" name collision. |

### Instrument library UX (epic #116 — closed)

All four sub-issues shipped in **PR #121**. SSOT: [design/instrument-library.md](design/instrument-library.md).

| Issue | What shipped |
|-------|--------------|
| **#112** Starring & sorting | Multi-star favorites; sort by star/name; filter by name. "Default" moved out of the star into the instrument's own settings + a `(default)` cue. |
| **#113** Tag system | Tags as `{ stable hidden id, editable label, emoji }` — a rename can never orphan an association. Comma-input tagging with autosuggest, a tag manager, an emoji column. Emoji search + auto-assign from a curated ~110-glyph pool, dependency-free. |
| **#114** System tags | Read-only `sys:*` tags derived on read from parametrization (scale quality, note-control source, face mode, split voices, finger FX). Never persisted, never renameable. |
| **#115** Parametrization tooltip | A compact per-instrument hover summary, sharing `summarizeInstrument()` with #114. |

### Feature Instrumentation Lab (#119 — closed, PR #122)

A whole new subsystem, and the first one that is about *finding* what to map rather
than mapping it. SSOT: [design/feature-lab.md](design/feature-lab.md).

- A **data-driven feature catalog** (`src/features/`): ~200 scalar face + hand
  features (blendshapes, mesh geometry, head pose, symmetry, action units, per-finger
  curls/gaps), each a pure `compute` with an id, a group, an advisory range and a
  **controllability** class (`easy` / `moderate` / `involuntary`) — the honest answer
  to "which channels can a performer actually drive?".
- Two pure DAG taps (`face-feature-vector`, `hand-feature-vector`) that fan out off
  the *existing* face/hand sources, so the lab costs nothing when off and is recorded
  by the existing feature-JSONL stream.
- A live **meter grid** overlay element, an **online normalizer** that makes wildly
  heterogeneous features comparable, and a **safe formula compiler** for user-defined
  derived features (jsep + whitelist; no `eval`, no `new Function`, no member access).
- Named **lab views** saved as a zodal collection.

### Sound / scale

| Issue | PR | What shipped |
|-------|----|--------------|
| **#75** Decouple the chord-source scale | #124 | Chords are drawn from a decoupled chord-source scale (auto-derived from the melody, or custom), so a pentatonic melody still gets sensible chords and the 7-note-scale friction on the chord/`controls` face modes is gone. |
| **#63** Octave-range slider | #124 | Double-thumb octave-**range** slider (1–3 octaves, locked middle); per-voice `rangeLow`/`rangeHigh`; store persist v6. |
| **#13** MIDI out | #120 | A `midi-out` node (WEBMIDI.js) tapping the same merged voices as the synth, to drive an external instrument/DAW. Off by default, a no-op where Web MIDI is unsupported (Safari/iOS gated), so it costs nothing until turned on. |

### Stream Applier (M8, epic #101)

| Milestone | Issue | PR | Status |
|-----------|-------|----|--------|
| **M-A** camera-free pre-recorded video source (`?source=video`) | #102 | #105 | shipped |
| **M-B** `Clock` abstraction + speed multiplier | #103 | #106 | shipped (`BatchClock` fully tested; the live `RealtimeClock` adoption is deferred to M-D) |
| **M-C** async-iterator `Source` contract + `source` slot | #104 | — | **design resolved, build deferred** — see below |

---

## Open decisions

### M-C (#104) — resolved, deferred

The design fork is settled: a pre-recorded **video** source is a **host-side
`Source`** (`outputResource: 'video'`) that feeds the unchanged `webcam-*` nodes
through `ctx.resources` — it is *not* a node swap. Node-swap is reserved for sources
that emit **finished frames** (replay / synthetic), which are ordinary zero-input
nodes. So `videoFileSource` is **not** a slot candidate; M-A's host wiring is the
right shape and stays. Recorded in
[design/stream-applier.md](design/stream-applier.md#m-c-resolved-host-side-source-for-video-node-swap-for-frame-emitters).
Ready to build; not scheduled.

### #128 — the generative layer

The `lyria` node + `indirect-map` node are built and unit-tested, but no generative
layer runs in the DAG app; the only working one is the AI-DJ plugin in the **frozen**
legacy view (`?engine=legacy`). Decide: port it into the default graph, or formally
retire the legacy view. Nothing else blocks on this.

---

## Next (open issues, by track)

### Command dispatch — the load-bearing one

- **[#126] Complete the command-dispatch write-path sweep** — *the one that matters.*
  Today only two panel call sites dispatch (`face.mapping`, `master.syncHands`, via
  `src/app/dispatchDial.ts`); every other discrete `<select>` still calls `setDial`
  directly, so the "single write path" #87 promises is **not yet true**. Route them
  all through `registry.dispatch`. **Decision B** stands: continuous `type="range"`
  sliders deliberately stay a direct `setDial` for latency, and are not a gap.
- **[#127] #87 Phase 4 (opt-in)** — undo via `acture-undo`, telemetry, command
  export/replay. Deliberately opt-in, after #126.
- **[#129] gesture-classifier as a command-dispatch consumer** — discrete hand poses
  (fist/open/pinch) → `registry.dispatch`, so a gesture can change a scale or load an
  instrument. The node already exists and emits edge events; this is the wiring.

### Capture

- **[#130] Recording: MP3 export** via a lazy `lamejs` converter (+ optional
  `ffmpeg.wasm` for any format).

### Feature Lab

- **[#131] Invariance labels + decorrelation helpers** — tell the performer which
  features are actually independent, and which are just restating each other.

### Engine / platform

- **[#101] Stream Applier epic** (M8) — M-A and M-B shipped; M-C resolved-but-deferred
  (above); M-D…M-G in [design/stream-applier.md](design/stream-applier.md).
- **[#14] React Flow patcher UI** driven by Zod node configs (M6's remaining half).
- **[#51] Node-swap slots** — blocked on the mapping input/params contract; the
  developer-facing seam exists (`SLOTS` in `src/app/graph.ts`), but a slot only earns
  a user-facing dropdown at ≥2 real candidates.

### Design now, build later

- **[#82] Configuration calculus (composable instruments)** — partial instruments
  (sparse dials layers) + transformers that mix into new instruments. Fed by #90 (a
  keymap is a partial) and #87 (a materialized instrument is a replayable command
  sequence). Library tags (#113) are orthogonal metadata; system tags (#114) are a
  read-only *view* of the same parametrization #82 formalizes.
- **[#76] Head-pose follow-ups** — per-axis live-tuning UI, per-user calibration (the
  `*ZeroDeg` seam exists), and demoting the emotion classifier to opt-in once
  `controls` proves out. The **axis-sign live check** is still open.
- **[#93] DAG diagnostics + connection assistant** — a "linter for the instrument
  graph". Pure analyzers + a notes panel are buildable headless today; mid-drag
  compatibility highlighting waits on the patcher (#14). Design in discussion #93.
- **[#5]** The original DAG roadmap issue, kept as the umbrella.

Closed in this sweep: **#6, #8, #9, #10, #11, #12, #45, #47, #49, #50, #116, #119**
(shipped, or superseded by the work above).

---

## Longer-horizon engine milestones (M0–M8)

The original engine arc. Kept for direction; recent feature work landed *alongside*
these rather than inside them, so read the status column, not the milestone numbering.

| Milestone | Goal | Status |
|-----------|------|--------|
| **M0** | Baseline + node contract: DAG engine, recorder/replay, pure node library, music theory, headless tests. | done |
| **M1** | First real video→sound vertical slice in the browser, on-device. | done |
| **M2** | Fixture record/replay infra + persisted per-edge feature streams on disk + CI gate. | done |
| **M3** | Wire the deployed app through the DAG. | **done** — the DAG view is the default at the bare URL (PR #58); the legacy app is frozen at `?engine=legacy`. The Lyria half (a generative node in the *default graph*) is not done and is now **#128**. |
| **M4** | Broaden the feature surface + tonal depth. | done and then some — face blendshapes, face expression, head/jaw/brow pose control, gesture classifier, Tonal.js chords/voicings, and the ~200-feature catalog (#119). |
| **M5** | Conductor mode: immutable `score` node + `performance` overlay + humanization. | nodes built + tested (`transport` / `score` / `performance`); **not wired into the default graph**. |
| **M6** | `midi-out` + a React Flow patcher UI + deploy as a tw_platform static app. | partial — deploy done; `midi-out` shipped (#13 / PR #120); the patcher (#14) is open. |
| **M7** | (optional) Pluggable Python feature service + self-hosted generative service behind the existing node facades. | optional, untouched. |
| **M8** | **Stream Applier**: pluggable sources + batch-vs-paced execution + state-feedback generators. | in progress — M-A + M-B shipped; M-C resolved/deferred; M-D…M-G designed. See [design/stream-applier.md](design/stream-applier.md). |

### Open engine decisions (recorded; defaults taken)

1. **Music theory lib** — hand-rolled snapping stays on the hot path; Tonal.js does
   chords/voicing/progression.
2. **Synth engine** — Web Audio with declarative additive presets (`src/music/sounds.ts`);
   adopt Tone.js only if richer effects/Transport are needed.
3. **On-device vs backend** — frontend-only. Node interfaces stay clean so a
   Python/`theremin` or generative service can plug in later (M7). The AI assistant
   deliberately follows this too: client-side, BYO-key, no `aix`.
4. **Fixture videos** — commit small derived NDJSON; raw `.mp4`s optional/external.
5. **Lyria API key** — key-in-localStorage; a proxy/platform-managed key only if the
   generative layer returns to the default app (#128).
