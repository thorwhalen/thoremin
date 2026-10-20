# Thoremin Roadmap

Status board, swept 2026-10-13 (previous sweeps 2026-09-05, 2026-08-17, 2026-07-12). Two horizons:

1. **What shipped** and **what is next** (below) — the live planning surface.
2. **Longer-horizon engine milestones (M0–M8)** — the original platform/engine arc, kept at the bottom for direction.

A note on vocabulary, because it used to collide: **annotations** are the live
time-anchored taps over a *recording* (#92); **tags** are keywords on a saved
*instrument* (#113). PR #125 renamed the former, and it now writes
`<take>.annotations.jsonl`. Do not call annotations "tags" again.

---

## Shipped (2026-06 → 2026-10)

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
| **#92** Annotations (was "live tagging") | #123, #125 | Toggle annotations during a take → a time-aligned `<take>.annotations.jsonl` on the same absolute engine clock as `features.jsonl`. Interval + point annotations, mutual-exclusivity groups, 1–9 keyboard toggles, per-annotation lead-in + countdown, a burned-in corner overlay as in-band ground truth. Built as a reusable, extraction-ready tool in `packages/taglog/src/` (affordances / adapters / provider / presentation) + thoremin glue in `src/app/tagging/`. **PR #125** added the **Export panel** (Audacity / WebVTT / CSV / Praat TextGrid / OTIO, with a raw-vs-lead-in-corrected time choice) and killed the "tags" name collision. |

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
| **#136** Feature Lab had no entry point | #138 | 2026-07-13 | The Lab was live in the production bundle for weeks and, in practice, unreachable. Gave it a shell entry point via a new **tools registry** (`src/app/tools/tools.ts` + `ToolsBar`), and stopped filing it as an instrument dial. Source of the "a feature nobody can find is not shipped" rule in CLAUDE.md. |
| **#126** Command write-path sweep | #140 | 2026-07-13 | Routed **every** discrete panel write through `registry.dispatch` via `src/app/dispatchDial.ts` (`dispatchDialSet` / `dispatchDialSetIn` / `dispatchDialPatch`), and locked it with `test/dials_write_path.test.ts` — a TypeScript-AST guard that follows helper indirection, so a violation cannot hide one call away. #87's "single write path" is now a fact, not an intent. |
| **#128** Generative layer decision | #142 | 2026-07-15 | Status decision, no code change: the legacy AI-DJ is **retired** to `?engine=legacy` rather than ported. The compelling version (gesture-steered generation) is budgeted honestly as new work in **#141**. |
| **#130 / #143** Recording export format | #145 | 2026-07-16 | **FLAC** via `libflacjs` (MIT) instead of the LGPL MP3 encoder #130 originally proposed — license-clean, and lossless suits a training-data recorder better than MP3 did. |
| **#137** MIDI out was unreachable | #147 | 2026-08-10 | #13/PR #120 shipped `midi-out` with no UI, no dial, and its `enabled` input left unconnected in `graph.ts`. Now: a `midi` dial group, a live input port, a settings panel, an explicit **denied** phase (permission refused is a state, not silence), and *structural* guards so an unconnected enable input fails the suite. This PR is the template for #136's rule. |
| **#144** Feature Lab correctness | #149 | 2026-08-10 | Circular features (angles) normalized as circular rather than linear, dead `depthZ` removed, handedness flicker fixed with hysteresis, and face-landmark replay coverage added — the Lab was measuring some things wrongly and nothing said so. |
| **#131** Invariance labels + deconfounding | #151 | 2026-08-11 | Items 1+2 of #131: `invariantTo` labels on `FeatureDef` (an honest, per-feature statement of what will contaminate it) and `residual(x, z)` / `deconfound(x, [z…])` helpers in the formula compiler, so a user can write `residual(smile, yaw)` and get a pose-corrected smile with no new node. **Item 3 (the rolling correlation view) was split out as #150 and is still open.** |
| **#129** Gestures as a command dispatcher | #152 | 2026-08-11 | The **fourth** dispatcher into the registry, after panels, keyboard and the AI assistant: discrete hand poses (fist / open / pinch) → `registry.dispatch`, edge-triggered, with held and cooled variants and user-bindable mappings (`src/app/gestures/gestureDispatch.ts`). |

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
| **#76 / #146** Head-pose signs | #161 | 2026-08-23 | Settled the axis signs **headlessly** against a committed fixture (`test/fixtures/video_head_pose/`) — and found a genuinely **inverted pitch axis** in the process. Per axis: **pitch** settled and fixed; **smile** pinned on its positive half only, because a visible frown barely moves `mouthFrown*` at all — the darker-timbre half is a *signal* problem, not a sign problem; **brow** measured and found confounded by camera distance (it swings a third of full scale from leaning in, expression held); **yaw and roll** not settled, because nothing in a recording says whether it was mirrored. |
| **#51** Engine graph lifecycle | #165 | 2026-08-23 | `Engine.applyGraph` reconciles a live engine onto a new `GraphSpec`, keeping every node whose id + type + validated params are unchanged — so a swap reloads no ML model and rebuilds no audio graph. Plans synchronously, inits the new nodes while the old graph keeps ticking, commits atomically. |
| **#101** M-D, first half | #166 | 2026-08-23 | The live loop runs on the `Clock` (in `src/app/engineLoop.ts`, since removed in #189 when `useEngine` became an Applier config), retiring `useEngine`'s hand-rolled rAF recursion, and the graph builds on a `?slot.<name>=` selection. |
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
| **M-D** the `Applier` — both callers are configs of it | #101 | #166, #184, #189 | shipped — `runHeadless` (BatchClock + recorder tap) and `useEngine` (RealtimeClock + the React bridges as sinks). `runEngineLoop`, the intermediate step, retired with it |
| **M-E** `defineMergeNode` (R2) + `event`-kind accumulation | #101 | #191, #184 | shipped — the engine rejects fan-in to one port, so composition is an explicit typed node |
| **M-F** the `StateReader` feedback channel (R3) | #101 | #192 | shipped — the Applier publishes it on the engine's own resources |
| **M-G** boundary (B) enforced + delayed edges + the `delay` node | #101 | #210, #214 | shipped — accelerated playback **mutes** rather than pitch-shifting, enforced by a structural guard over every `synth`-role node; feedback is now *declared* by `EdgeSpec.delayed` rather than inferred from evaluation order |
| **#51** graph lifecycle: re-wire a running engine | #51 | #165 | shipped — `Engine.applyGraph` reconciles onto a new `GraphSpec` without rebuilding audio or reloading models |

**#101 is closed.** Two pieces were deliberately not built and have homes elsewhere: the
`OfflineAudioContext` render-at-speed action (#146 B9 — its value is a listening
judgment), and recorder backpressure (#88). The two source nodes split out to #215,
`replay-source-timed` and `stateGeneratorSource`, are now built.

### Body, conductor, extensions, air instruments and the timing plan (2026-09-05 → 2026-10-13)

The largest wave yet: roughly 110 merged PRs. Five through-lines: the camera is no longer the only source (a body source, a song), the instrument is composed from declared parts (branches and extensions), the air instruments exist, the timing cluster was resolved into one plan and executed, and a player's own categories now reach the sound.

| Track | Issues | PRs | What shipped |
|-------|--------|-----|--------------|
| **Generative layer** | #141, #188 | #195-#208 | Hands steer Lyria RealTime through the `indirect-map` → `lyria` branch, gated by `steer.enabled`; the lyria SDK is lazy-loaded; the steering editor. #141 closed. The human check is #146 §B8. |
| **Body source and pacing** (epic **#186, closed**) | #186 | #194, #205, #207, #341, #345, #347 | A featurized body pose (`webcam-body` / `synthetic-body` / `replay-body`, the body slot, skeleton overlay, body feature catalog, body-to-sound routing, the Que Calor fixture); then F: the octave-free pulse follower and the `body-pulse` node (#341); G: a beat-tracked song, the `song-player` node and the Song tool (#345); H: the pace controller, so the song follows the dancer within ±10 % (#347). Follow-ups: #339, #344, #346. |
| **Conductor** (epic **#187**) | #187 | #200, #206, #213, #216, #336 | The ictus core, the `conductor` node, the score pipeline (MIDI and MusicXML into a `ScoreDoc`), the Conductor tool, and PR 5: the pending-event scheduler and a lazily loaded sampled orchestra (CC11/CC74 dynamics, 6.0 MB SF3). "Done" for the epic is PR 5; PR 6 (meter / beat pattern, optional) and PR 7 (the audio pacer, shared with #186) remain. |
| **Instruments as declared graphs, and extensions** | #268 ADR | #276, #278, #280, #286, #294, #295-#301 | Branches and the composer (the default graph is composed, not listed), only-what-an-instrument-declares-runs, the `InstrumentSpec`, the `Extension` manifest, npm workspaces (`dag`, `ictus`, `taglog`, `lazy`, `sdk`, `sdk-ui`, `ext-air`), the `Settings` type generated from the manifests, and the core-alone guard (`npm run test:core`). O3 (separate repositories) waits on #262. |
| **Lazy extensions and ASL** | #302, #303 | #303, #329, #340 | An extension's code loads when the player asks for it (`lazy` entries in `extensions.json`, `check:lazy`, a Reload offer after a failed import). ASL sign recognition (ASL Viewer, ASL Chords, class `sign`) shipped in #303 and now lives in its own repository, [thorwhalen/thoremin-asl](https://github.com/thorwhalen/thoremin-asl), pinned by sha. |
| **Shell** | #136 follow-ups | #281, #285-#291, #266, #287 | The Tools launcher and pins (the tools as a zodal collection), the Instruments view over the `InstrumentSpec` (list and gallery, facet chips), Record and Annotations bottom-right, an occlusion smoke test. |
| **Air instruments** (#249) | #233, #245, #246, #249, #263, #269 | #236, #250-#258, #275, #277, #279, #282, #284 | Air drum (stick tip, pads, kit, pattern training and the pattern mode), air bass, air guitar with per-player chord enrolment, air flute with enrolled fingerings and breath; fingering charts, the fingering prior and the sequence trainer; every instrument's editor links to its training. |
| **Timing plan** (the 2026-10-05 plan; umbrella #178) | #226, #231, #232, #234, #239, #240, #261, #318 | #228, #235, #241, #305, #309, #310, #321, #328, #319, #335, #304, #354 | Capture-time frame stamps (#228); sub-frame impact prediction (#235); the measured latency budget (#241); step 0, the always-on `timing` resource (#309); steps 1 and 1b, the median-free prefilter and the predictor's time gates (#305); step 2, the rhythm-prior blend (#310); step 3, the lag-gated magnet (#321); step 4, the silent latency levers and the opt-in low-latency audio pref (#328); step 9, the gated de-jitter (#319) and the drum reading the stamp source (#335); the arc landing fit (#304); the three-sample vertex as the air learning reference (#354, #234 narrowed, still open). Details: [research/subframe-impact-prediction.md](research/subframe-impact-prediction.md), [research/latency-budget-and-browser-realtime.md](research/latency-budget-and-browser-realtime.md). |
| **Trainer to sound** | #160, #330, #257 | #327, #338, #343, #350, #307 | A saved category binds to a command and fires it through the registry (#327; #160 closed). Personal face categorizers: P1 the pure core (#338), P2 the session as a lazy tool-only extension, "Your faces" (#343), P3 test, correct, tune, import and export (#350); P4 (instruments choose a categorizer) is in flight. Takes can be saved to a chosen folder (#307). |
| **Small dials and guards** | #148, #168 Q3, #201, #209 | #313, #315, #311, #265 | The handedness dwell as a dial (default unchanged), a dial for whether the master mute silences MIDI (default unchanged), a CI-only type-error ratchet for the React layer, a browser smoke harness, and a measured cost of private CI. |

---

## Open decisions

The maintainer's standing questions live in **#168** (a decision inbox, rewritten 2026-10-13 to show only what is still open). The generative-layer question that used to be recorded here (#128) is settled: the legacy AI-DJ is retired to `?engine=legacy`, and the gesture-steered replacement (#141) shipped.

---

## Next (open issues, by track)

Every entry below is an issue that is **open right now**. Discussions are marked as such; a bracketed `#n` in this list always means an issue. Swept 2026-10-13.

### Live verification

- **[#146] Live verification needed.** Re-scored 2026-10-13: one list ranked by what a human with a webcam can close in five minutes, then the checks that need ears or a DAW, then the decisions that are theirs. It also closes #226 (the capture-stamp check, §A5.1).

### Timing and rhythm

The plan is done through step 9; what remains is measurement, a supported range, and the refinements the benchmark pointed at. Umbrella: **[#178]** (updated 2026-10-13).

- **[#234]** Impact predictor at 24/30 fps. Narrowed by #354, not closed. Follow-ups: **[#352]** (the late mean after #234), **[#351]** (a per-player stroke template), **[#353]** (per-pad floors in the air drum).
- **[#226]** closes on the live camera check in #146.
- **[#320]** the conductor's wrist-versus-stick-tip grid offset, on a real take.
- **[#324]**, **[#325]**, **[#326]** the hand model: no hands on the CPU delegate at 640x360, `numHands: 1` for one-hand instruments, and hand inference off the main thread (timing step 5).
- **[#337]** the stamp-source follow-ups (the clock-lag shift in the SDK, judging presentation stamps).
- **[#339]**, **[#346]**, **[#344]** the body pulse and the song transport: faster tempo-step following, the pace controller's follow-ups, and a Play pressed in the frame the song ends.

### Conductor

- **[#187]** Epic, "done" at PR 5. Remaining: PR 6 (meter / beat pattern, optional) and PR 7 (the audio pacer, shared with #186). Follow-ups: **[#332]** (articulation as a program or keyswitch change), **[#333]** (the KTH final-ritard prior), **[#334]** (stand-ins for programs outside the cut bank).

### Faces and learned categories

- **[#330]** Personal face categorizers. P1 to P3 shipped; P4 (instruments choose a categorizer and a renderer) is in flight. Follow-ups: **[#357]** (play a saved categorizer from the tool), **[#358]** (an exported instrument carries its categorizer), **[#359]** (a browser smoke test), **[#348]** (warn when the room is too dark), **[#349]** (a distance cue in the take).
- **[#323]** A `learned-category` node, so the overlay draws and the recording keeps the player's categories, plus continuous membership mapping.
- **[#76]** Face/head control dimensions: what remains is per-user calibration and demoting the emotion classifier to opt-in; the yaw/roll signs wait on the trainer take in #146 §A1.

### Platform

- **[#14]** The React Flow patcher UI, with its scope the open question (**[#181]**). The build is parked.
- **[#82]** The configuration calculus for composable instruments (design only; waits on a #168 answer).
- **[#283]**, **[#322]** migrate the in-repo zodal stand-ins and adopt `@zodal/store-localstorage` 0.3 once published.
- **[#331]** Accounts, cloud save and tiers (future).
- **[#262]** What to open-source and what to keep private; it gates the repository split (O3 of the extensions ADR) and publishing `ictus`.
- Hygiene: **[#308]** (a recorder folder write that fails at stop), **[#312]** (untyped React hooks defeat the ratchet), **[#314]** (air instruments and the ASL reader ignore the handedness dwell), **[#342]** (`check:lazy` and barrel imports), and the **[#355]** sprint-review checklist (6 should-fix items and 6 nits across 18 merged PRs).

Closed since the 2026-09-05 sweep: **#101, #141, #148, #160, #163, #186, #188, #201, #231, #232, #239, #240, #249, #257, #261, #263, #269, #302, #318** and the rest of the shipped table above.

---

## Longer-horizon engine milestones (M0–M8)

The original engine arc. Kept for direction; recent feature work landed *alongside*
these rather than inside them, so read the status column, not the milestone numbering.

| Milestone | Goal | Status |
|-----------|------|--------|
| **M0** | Baseline + node contract: DAG engine, recorder/replay, pure node library, music theory, headless tests. | done |
| **M1** | First real video→sound vertical slice in the browser, on-device. | done |
| **M2** | Fixture record/replay infra + persisted per-edge feature streams on disk + CI gate. | done — but the "CI gate" half was **claimed years before it existed**: no test workflow had ever been committed to this repo. Closed by #153. |
| **M3** | Wire the deployed app through the DAG. | **done** — the DAG view is the default at the bare URL (PR #58); the legacy app is frozen at `?engine=legacy`. The Lyria half (a generative node in the *default graph*) was decided in **#128** — the legacy AI-DJ is retired to `?engine=legacy`; the DAG-native, gesture-steered generative layer (**#141**) has since shipped too (#188's PR chain, #195-#208), live behind `steer.enabled`. |
| **M4** | Broaden the feature surface + tonal depth. | done and then some — face blendshapes, face expression, head/jaw/brow pose control, gesture classifier, Tonal.js chords/voicings, and the ~200-feature catalog (#119). |
| **M5** | Conductor mode: immutable `score` node + `performance` overlay + humanization. | **Decided (#180 → #187, Option A: wire it) and wired.** The `conductor` node (PR 2 of #187) wraps `packages/ictus/src` (PR 1): the beating hand's ictus → an adaptive oscillator → `beat` / `bpm` / `velocityScale` for the `score` node, which is now in the default graph behind the `conductor.enabled` dial (off by default; the built-in demo scale until the score pipeline, PR 3). `transport` / `performance` stay registered for the non-conductor chain. The score pipeline (PR 3) loads MIDI / MusicXML lazily into a `ScoreDoc` (two shipped public-domain / CC0 demos, a file picker, saved scores) that the `score` node plays instead of the demo scale. The Conductor tool (PR 4) and the sampled orchestra with its scheduler (PR 5, #336) landed, which is "done" for the epic; meter recognition (PR 6, optional) and the audio pacer (PR 7, shared with #186) remain. |
| **M6** | `midi-out` + a React Flow patcher UI + deploy as a tw_platform static app. | partial — deploy done; `midi-out` shipped (#13 / PR #120) and made reachable (#137 / PR #147); the patcher (#14) is open, with its **scope** the actual open question (#181). |
| **M7** | (optional) Pluggable Python feature service + self-hosted generative service behind the existing node facades. | optional, untouched. |
| **M8** | **Stream Applier**: pluggable sources + batch-vs-paced execution + state-feedback generators. | **done** — M-A…M-G shipped; #101 closed. The two source nodes split out to #215 are built; the offline render-at-speed action is not built (its value is a listening judgment, see #146 B9). See [design/stream-applier.md](design/stream-applier.md). |

### Open engine decisions (recorded; defaults taken)

1. **Music theory lib** — hand-rolled snapping stays on the hot path; Tonal.js does
   chords/voicing/progression.
2. **Synth engine** — Web Audio with declarative additive presets (`src/music/sounds.ts`);
   adopt Tone.js only if richer effects/Transport are needed.
3. **On-device vs backend** — frontend-only. Node interfaces stay clean so a
   Python/`theremin` or generative service can plug in later (M7). The AI assistant
   deliberately follows this too: client-side, BYO-key, no `aix`.
4. **Fixture videos** — commit small derived NDJSON; raw `.mp4`s optional/external.
5. **Lyria API key** — key-in-localStorage, unchanged now that the generative layer
   is in the default app (**#141**, shipped); a proxy/platform-managed key stays a
   later option if the BYO-key posture ever needs to change. The legacy AI-DJ that
   used a different key path is retired to `?engine=legacy` per #128.
