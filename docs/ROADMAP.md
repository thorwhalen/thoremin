# Thoremin Roadmap

Status board, swept 2026-09-05 (previous sweeps 2026-08-17, 2026-07-12). Two horizons:

1. **What shipped** and **what is next** (below) — the live planning surface.
2. **Longer-horizon engine milestones (M0–M8)** — the original platform/engine arc,
   kept at the bottom for direction.

A note on vocabulary, because it used to collide: **annotations** are the live
time-anchored taps over a *recording* (#92); **tags** are keywords on a saved
*instrument* (#113). PR #125 renamed the former, and it now writes
`<take>.annotations.jsonl`. Do not call annotations "tags" again.

---

## Shipped (2026-06 → 2026-09)

The tracks below all landed. Each row is the issue, the PR that closed it, and
what it actually gives you.

### Interaction / control

| Issue | PR | What shipped |
|-------|----|--------------|
| **#91** Mute fix + cue | #95 | A true master mute at `synth-merge` (the single convergence point of every sound producer), so muting silences the hands *and* both chord instruments, plus an unmissable "muted" HUD cue. |
| **#89** Chord overlays | #96 | Chord-name HUD cue (jazz symbol + optional Roman/Nashville) and a keyboard-strip element with a layered visual-cue hierarchy. |
| **#87** Command dispatch (acture) | #97 (Phase 0), #107 (Phase 1), #98 (Phase 2), #111 (Phase 3), **#140** (the sweep, #126) | The command registry: every dial is a typed `acture` command. Phase 2 added the **Cmd/Ctrl-K command palette** (one generated `dial.<key>.set` per dial). Phase 3 added the **AI assistant**. **#126 finished it**: `rg 'setDial\('` over `src/` now hits only the command implementations, and `test/dials_write_path.test.ts` — a TypeScript-AST guard that follows helper indirection — fails the suite if a discrete panel control writes the store directly. #87 and #126 are both closed. |
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

### Reachability, correctness, and the fourth dispatcher (2026-07-13 → 2026-08-11)

The wave after the 2026-07-12 sweep. Its through-line: three of these five fix things
that were *merged and deployed* yet not actually usable, or not actually enforced.

| Issue | PR | Merged | What shipped |
|-------|----|--------|--------------|
| **#136** Feature Lab had no entry point | #138 | 2026-07-13 | The Lab was live in the production bundle for weeks and, in practice, unreachable. Gave it a shell entry point via a new **tools registry** (`src/app/tools.ts` + `ToolsBar`), and stopped filing it as an instrument dial. Source of the "a feature nobody can find is not shipped" rule in CLAUDE.md. |
| **#126** Command write-path sweep | #140 | 2026-07-13 | Routed **every** discrete panel write through `registry.dispatch` via `src/app/dispatchDial.ts` (`dispatchDialSet` / `dispatchDialSetIn` / `dispatchDialPatch`), and locked it with `test/dials_write_path.test.ts` — a TypeScript-AST guard that follows helper indirection, so a violation cannot hide one call away. #87's "single write path" is now a fact, not an intent. |
| **#128** Generative layer decision | #142 | 2026-07-15 | Status decision, no code change: the legacy AI-DJ is **retired** to `?engine=legacy` rather than ported. The compelling version (gesture-steered generation) is budgeted honestly as new work in **#141**. |
| **#130 / #143** Recording export format | #145 | 2026-07-16 | **FLAC** via `libflacjs` (MIT) instead of the LGPL MP3 encoder #130 originally proposed — license-clean, and lossless suits a training-data recorder better than MP3 did. |
| **#137** MIDI out was unreachable | #147 | 2026-08-10 | #13/PR #120 shipped `midi-out` with no UI, no dial, and its `enabled` input left unconnected in `graph.ts`. Now: a `midi` dial group, a live input port, a settings panel, an explicit **denied** phase (permission refused is a state, not silence), and *structural* guards so an unconnected enable input fails the suite. This PR is the template for #136's rule. |
| **#144** Feature Lab correctness | #149 | 2026-08-10 | Circular features (angles) normalized as circular rather than linear, dead `depthZ` removed, handedness flicker fixed with hysteresis, and face-landmark replay coverage added — the Lab was measuring some things wrongly and nothing said so. |
| **#131** Invariance labels + deconfounding | #151 | 2026-08-11 | Items 1+2 of #131: `invariantTo` labels on `FeatureDef` (an honest, per-feature statement of what will contaminate it) and `residual(x, z)` / `deconfound(x, [z…])` helpers in the formula compiler, so a user can write `residual(smile, yaw)` and get a pose-corrected smile with no new node. **Item 3 (the rolling correlation view) was split out as #150 and is still open.** |
| **#129** Gestures as a command dispatcher | #152 | 2026-08-11 | The **fourth** dispatcher into the registry, after panels, keyboard and the AI assistant: discrete hand poses (fist / open / pinch) → `registry.dispatch`, edge-triggered, with held and cooled variants and user-bindable mappings (`src/app/gestureDispatch.ts`). |

### The trainer, the engine lifecycle, and the sign check (2026-08-17 → 2026-09-02)

The wave after the 2026-08-17 sweep, and the largest single run in this repo's history:
21 PRs. Its through-line is that **the instrument stopped being the only thing that
learns** — the trainer asks the player to demonstrate their own categories, on a clock
and in a recording that can be replayed headlessly afterwards.

| Issue | PR | Merged | What shipped |
|-------|----|--------|--------------|
| **#153** No test CI | #154 | 2026-08-17 | The gate this repo never had: `typecheck` / `test` / `build` on `pull_request` + `push: main`. The deploy is deliberately **not** made conditional on it. |
| **#150** Rolling correlation view | #157 | 2026-08-17 | Item 3 of #131: a rolling correlation matrix over the watched features, on one shared exponentially-weighted moments implementation, cost-guarded. It is what makes `invariantTo` and `residual()`/`deconfound()` actionable — it tells you *which* confound to remove. |
| **#76** Face/head axes as a dial | #156 | 2026-08-17 | The per-axis live-tuning surface, landed **deliberately before** the sign check, so the signs could then be settled against a real UI rather than in the abstract. |
| **#127** Dispatch middleware | #159 | 2026-08-22 | One middleware seam on `registry.dispatch`, read three ways: undo/redo, the telemetry journal, and command export/replay. Order stated as data, gate outermost. |
| **#76 / #146** Head-pose signs | #161 | 2026-08-23 | Settled the axis signs **headlessly** against a committed fixture (`test/fixtures/video_head_pose/`) — and found a genuinely **inverted pitch axis** in the process. Pitch, smile and brow are now pinned; **yaw and roll are not** (see below). |
| **#51** Engine graph lifecycle | #165 | 2026-08-23 | `Engine.applyGraph` reconciles a live engine onto a new `GraphSpec`, keeping every node whose id + type + validated params are unchanged — so a swap reloads no ML model and rebuilds no audio graph. Plans synchronously, inits the new nodes while the old graph keeps ticking, commits atomically. |
| **#101** M-D, first half | #166 | 2026-08-23 | The live loop runs on the `Clock` (`src/app/engineLoop.ts`), retiring `useEngine`'s hand-rolled rAF recursion, and the graph builds on a `?slot.<name>=` selection. |
| **#104** M-C: the source slot | #167 | 2026-08-23 | `SLOTS.source` with three real candidates (`webcam-hands` / `synthetic-hands` / `replay-hands`) + `PortSpec.schema` conformance checked in `tick()`. **`?slot.source=synthetic-hands` runs the whole instrument with no camera and no MediaPipe** — the single most useful verification affordance in the repo. |
| **#141** Gesture meaning as a live input | #169 | 2026-08-23 | `indirect-map`'s `steerConfig` becomes a live input port rather than a build-time param, so what a gesture *means* can change without rebuilding the graph. |
| **#160 → #163** Trainer v2 | #162, #164, #170, #171, #172, #173, #174, #176 | 2026-08-23 → 08-27 | The trainer: **cues** (one thing to do, phrased in the player's own words) and **routines** as zodal collections; a runner with distances in **noise units** (a feature's displacement over its own jitter, so one threshold means the same thing for every feature); spoken guidance cached content-addressed via braidio; a projection view the player draws their own categories in; live feedback with an accurate excursion bar and a manual mode. **PR #173 is the load-bearing one**: a take records the clean camera + `features.jsonl` + cue-interval `annotations.jsonl` on one clock — and since #176, recording is **on by default**. |
| **#177** Feature Lab meters | #177 | 2026-08-29 | The Lab's meters could not be turned off. |
| **#178** Rhythm from gesture | #179 | 2026-09-02 | Research map only, no code: rhythm lives at 1–20 ms and a control loop runs at 30–60 Hz, so rhythm must be *inferred* against a musical prior, never measured frame-to-onset. Proposes extracting the engine as a shared package (`ictus`) since `muvid` needs the same latent state from dancer motion. |

**What the trainer changes about everything else.** A take is now the repo's cheapest
source of ground truth. `test/fixtures/video_head_pose/README.md` records why yaw and roll
stayed open after #161: the clip's own metadata cannot say whether it was mirrored, so
"the person turned to *their* left" is unrecoverable from the file. A cue *asks* for that
in the player's terms, which is exactly the missing frame of reference.

### Stream Applier (M8, epic #101)

| Milestone | Issue | PR | Status |
|-----------|-------|----|--------|
| **M-A** camera-free pre-recorded video source (`?source=video`) | #102 | #105 | shipped |
| **M-B** `Clock` abstraction + speed multiplier | #103 | #106 | shipped (`BatchClock` fully tested; the live `RealtimeClock` adoption landed later, in #166) |
| **M-C** `source` slot + typed `replay-hands` + `PortSpec.schema` conformance | #104 | #167 | **shipped** — `?slot.source=synthetic-hands` runs the whole instrument with no camera and no MediaPipe |
| **M-D** (first half) live loop on the `Clock` + `?slot.<name>=` selection | #101 | #166 | shipped — `src/app/engineLoop.ts`; the `Source` interface, its pump and the `Applier` remain |
| **#51** graph lifecycle: re-wire a running engine | #51 | #165 | shipped — `Engine.applyGraph` reconciles onto a new `GraphSpec` without rebuilding audio or reloading models |

---

## Open decisions

### #128 — the generative layer: **DECIDED (retired to `?engine=legacy`)**

The legacy AI-DJ is retired to `?engine=legacy` — a status decision, no code change; it
keeps working there. The reframing fact: the legacy AI-DJ is **slider**-steered, and the
compelling version (hand/face features steering a generative model) exists only as the
`indirect-map` node, which has never run in a browser. So "port it forward" was really
"first-run an unproven feature", now split out and budgeted honestly as **#141**
(gesture-steered generative layer, DAG-native) — which depends on the #126 dials/command
surface, now merged. The `lyria` / `indirect-map` / `generative` nodes stay in the registry,
catalogued and role-tested, so this is fully reversible.

---

## Next (open issues, by track)

Every entry below is an issue that is **open right now**. Discussions are marked as
such — a bracketed `#n` in this list always means an issue.

### Live verification — the one blocking several others

- **[#146] Live verification needed (webcam + human eyes)** — a standing list of things
  that shipped, pass every headless test, and cannot be *confirmed* without a camera and
  a person: head-pose axis signs (#76), the annotations export (#125), AI multi-tool
  (#133), the Feature Lab (#136), FLAC export (#143). This is the honest bottleneck for
  anything face/head-driven, because the suite is structurally unable to close it.

### Feature Lab

- **[#148] Adopt the handedness dwell in `hand-features`** — PR #149 fixed handedness
  flicker with hysteresis in the Lab's feature path, but not in the SOUND path. Either
  adopt it there too, or decide the divergence is wanted and say why.

### Face / head control

- **[#76] Controllable face/head CONTROL dimensions** — PR #86 shipped the pose/control
  plumbing (head/jaw/brow → chord instrument, the `controls` face mode). The issue's own
  narrowed scope is what remains: **per-axis live-tuning UI**, **per-user calibration**
  (the `*ZeroDeg` seam exists), and **demoting the emotion classifier to opt-in** once
  `controls` proves out. The **axis-sign live check** is the #146 item.

- **[#160] Trainer mode → the BINDING half is what remains.** Research:
  [`docs/research/trainer-mode.md`](research/trainer-mode.md) (26 refs). The premise —
  stop tuning a population model against identity bias, let each player carve their own
  space — is unchanged and is now **mostly built**.

  **What shipped** (#162 the core, #164 the feature-demand prep, then #163's five PRs
  #170–#174 and #176): cues and routines as zodal collections; a runner; **noise units**
  (`src/enroll/noise.ts` — a feature's displacement over its own frame-to-frame jitter,
  which is what lets one threshold mean the same thing for a value in degrees and a
  0..1 blendshape); still-point sampling with a velocity gate; hierarchical clustering
  cut at k; a reject region that *holds the last category* rather than going silent; a
  projection view the player labels; spoken guidance; and a recorded take.

  **What did NOT ship is the last verb: bind.** The pipeline ends in an in-memory
  zustand field (`model: TrainedModel | null`, `src/app/enroll/store.ts:117`) that **no
  sound path reads** — `TrainedModel` appears nowhere in `src/nodes/`, `src/music/`,
  `src/app/graph.ts`, `src/app/dials/` or `src/app/commands/`. The temporal layer that
  would make a category playable, `createCategoryTracker`
  (`src/enroll/classify.ts:226`), has **zero callers outside `test/enroll.test.ts`**.
  So a player can today teach the trainer four categories, see them projected, name
  them — and change nothing they can hear.

  #160 therefore stays open as the **binding** issue, not as the trainer issue.
  `src/app/gestureDispatch.ts` is the closest existing precedent for the missing
  shape — a discrete recognized thing, edge-triggered, dispatching a command — and the
  open design question is whether a learned category binds like that (a command
  dispatcher), like a dial, or as a node in the graph.

- **[#163] Trainer v2 — cues, routines, spoken guidance, projection view.** The five PRs
  above landed; the issue stays open on its own live-run gate, which #146 covers.

### Rhythm

- **[#178] Infer rhythm from low-rate gesture — propose `ictus`.** Research map only
  (#179): melody and timbre tolerate a 30–60 Hz control rate, rhythm does not, so rhythm
  must be *inferred* against a musical prior rather than measured frame-to-onset. Read §1
  and §6 of [`docs/research/rhythm-from-gesture-research-map.md`](research/rhythm-from-gesture-research-map.md)
  before touching anything timing-related. Proposes extracting the engine as a package
  shared with `muvid`.

### Waiting on the maintainer

- **[#168] Decisions needed from you.** The standing list of questions only the
  maintainer can answer. Q1 (yaw) and Q2 (frown) were answered 2026-08-23 with a
  redirect — *don't chase them from the old clip; let the trainer produce the material*,
  which is what the trainer-take → fixture path exists to do. Q3 (MIDI mute semantics),
  Q4 (#148 handedness dwell), Q5 (#82 ADR) and Q6 (#141 needs a Gemini key) are open.
  It also carries thorwhalen/tw_platform#156, which is not a thoremin decision.

### Generative

- **[#141] Gesture-steered generative layer** — DAG-native, budgeted as new work rather
  than as a port, per the #128 decision. The `indirect-map` node it would build on has
  never run in a browser, so this is a first-run, not a migration.

### Engine / platform

- **[#101] Stream Applier epic** (M8) — M-A, M-B and M-C have shipped, and M-D's clock
  half landed with #166. **What remains of M-D** is the `Source` interface, its pump and
  the `Applier` that `runHeadless` and `useEngine` both collapse into; M-E…M-G are
  designed and unstarted. SSOT: [design/stream-applier.md](design/stream-applier.md) —
  its per-milestone bullets, not its header, are the authority on status.
- **[#14] React Flow patcher UI** driven by Zod node configs (M6's remaining half).
  **Build is parked**; the open question is scope, not schedule — see #181.

### Design now, build later

- **[#82] Configuration calculus (composable instruments)** — partial instruments
  (sparse dials layers) + transformers that mix into new instruments. Fed by #90 (a
  keymap is a partial) and #87 (a materialized instrument is a replayable command
  sequence). Library tags (#113) are orthogonal metadata; system tags (#114) are a
  read-only *view* of the same parametrization #82 formalizes.
- **DAG diagnostics + connection assistant** — a "linter for the instrument graph".
  Pure analyzers + a notes panel are buildable headless today; mid-drag compatibility
  highlighting waits on the patcher (#14). This lives in **discussion #93**, not an
  issue — earlier revisions of this file listed it as `[#93]` alongside issues, which
  was wrong: there is no issue #93.
- **[#5]** The original DAG roadmap issue, kept as the umbrella. Its M2 "CI gate" line
  was unbacked until #153, which closed it (PR #154).

Closed since the 2026-07-12 sweep: **#51, #87, #104, #126, #127, #128, #129, #130,
#131, #136, #137, #143, #144, #150, #153** (see the shipped tables above).

---

## Longer-horizon engine milestones (M0–M8)

The original engine arc. Kept for direction; recent feature work landed *alongside*
these rather than inside them, so read the status column, not the milestone numbering.

| Milestone | Goal | Status |
|-----------|------|--------|
| **M0** | Baseline + node contract: DAG engine, recorder/replay, pure node library, music theory, headless tests. | done |
| **M1** | First real video→sound vertical slice in the browser, on-device. | done |
| **M2** | Fixture record/replay infra + persisted per-edge feature streams on disk + CI gate. | done — but the "CI gate" half was **claimed years before it existed**: no test workflow had ever been committed to this repo. Closed by #153. |
| **M3** | Wire the deployed app through the DAG. | **done** — the DAG view is the default at the bare URL (PR #58); the legacy app is frozen at `?engine=legacy`. The Lyria half (a generative node in the *default graph*) was decided in **#128** — the legacy AI-DJ is retired to `?engine=legacy`; a DAG-native, gesture-steered generative layer is now the new-feature issue **#141**. |
| **M4** | Broaden the feature surface + tonal depth. | done and then some — face blendshapes, face expression, head/jaw/brow pose control, gesture classifier, Tonal.js chords/voicings, and the ~200-feature catalog (#119). |
| **M5** | Conductor mode: immutable `score` node + `performance` overlay + humanization. | nodes built + tested (`transport` / `score` / `performance`); **not wired into the default graph**, which the manual and `docs/CATALOG.md` both say plainly. Stable but *undecided* — #180 asks for the decision: wire it (it would need a score, and there is no content pipeline), or retire it to node-library-only the way #128 retired the generative nodes. |
| **M6** | `midi-out` + a React Flow patcher UI + deploy as a tw_platform static app. | partial — deploy done; `midi-out` shipped (#13 / PR #120) and made reachable (#137 / PR #147); the patcher (#14) is open, with its **scope** the actual open question (#181). |
| **M7** | (optional) Pluggable Python feature service + self-hosted generative service behind the existing node facades. | optional, untouched. |
| **M8** | **Stream Applier**: pluggable sources + batch-vs-paced execution + state-feedback generators. | in progress — M-A, M-B and M-C shipped; M-D half shipped (the live loop runs on the `Clock`, #166), its `Source` + pump + `Applier` remaining; M-E…M-G designed. See [design/stream-applier.md](design/stream-applier.md). |

### Open engine decisions (recorded; defaults taken)

1. **Music theory lib** — hand-rolled snapping stays on the hot path; Tonal.js does
   chords/voicing/progression.
2. **Synth engine** — Web Audio with declarative additive presets (`src/music/sounds.ts`);
   adopt Tone.js only if richer effects/Transport are needed.
3. **On-device vs backend** — frontend-only. Node interfaces stay clean so a
   Python/`theremin` or generative service can plug in later (M7). The AI assistant
   deliberately follows this too: client-side, BYO-key, no `aix`.
4. **Fixture videos** — commit small derived NDJSON; raw `.mp4`s optional/external.
5. **Lyria API key** — key-in-localStorage; a proxy/platform-managed key only if a
   generative layer comes to the default app (**#141**; the legacy AI-DJ that used it is
   retired to `?engine=legacy` per #128).
