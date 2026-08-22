# Thoremin Roadmap

Status board, swept 2026-08-17 (previous sweep 2026-07-12). Two horizons:

1. **What shipped** and **what is next** (below) — the live planning surface.
2. **Longer-horizon engine milestones (M0–M8)** — the original platform/engine arc,
   kept at the bottom for direction.

A note on vocabulary, because it used to collide: **annotations** are the live
time-anchored taps over a *recording* (#92); **tags** are keywords on a saved
*instrument* (#113). PR #125 renamed the former, and it now writes
`<take>.annotations.jsonl`. Do not call annotations "tags" again.

---

## Shipped (2026-06 → 2026-08)

The five tracks below all landed. Each row is the issue, the PR that closed it, and
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

- **[#150] Rolling correlation view** — item 3 of #131, split out when items 1+2 landed
  in PR #151. A rolling correlation matrix over the currently-watched features, so
  coupling between them is *visible* rather than inferred. It is what makes the
  `invariantTo` labels and the `residual`/`deconfound` helpers actionable: it tells you
  which confound to remove.
- **[#148] Adopt the handedness dwell in `hand-features`** — PR #149 fixed handedness
  flicker with hysteresis in the Lab's feature path, but not in the SOUND path. Either
  adopt it there too, or decide the divergence is wanted and say why.

### Face / head control

- **[#76] Controllable face/head CONTROL dimensions** — PR #86 shipped the pose/control
  plumbing (head/jaw/brow → chord instrument, the `controls` face mode). The issue's own
  narrowed scope is what remains: **per-axis live-tuning UI**, **per-user calibration**
  (the `*ZeroDeg` seam exists), and **demoting the emotion classifier to opt-in** once
  `controls` proves out. The **axis-sign live check** is the #146 item.

- **[#160] Trainer mode — learn the player's OWN categories from a live stream.**
  Research: [`docs/research/trainer-mode.md`](research/trainer-mode.md) (26 refs).
  Reframes the face-mapping problem: the difficulty hitting the shipped expression
  categories is **identity bias** — a named, measured gap — and the field's answer is
  personalization, whose usual blocker (subject-specific labels are unavailable) simply
  does not apply to an instrument whose player is sitting at the camera. So: stop tuning
  a population model, let each player carve their own space.

  Four things the research settles, each load-bearing:

  1. **Train on the FEATURE VECTOR, not the face.** `src/features/catalog.ts` already
     emits a flat named scalar vector from face *and* hands through one contract, so
     `Record<featureId, number>` makes this modality-general on day one. Building it
     against `FaceFrame` is the one decision that would make it face-only forever.
  2. **Build a hierarchy, cut it at k.** That is what makes "specify the count before
     *or afterwards*" nearly free — one recording supports 3 then 5 then 4 categories
     with no retraining. The player drags a slider; the vocabulary gets finer or coarser.
  3. **Cluster the still points, not the frames.** A free-motion stream is mostly
     transitions; clustering every frame finds the centre of the motion envelope rather
     than the expressions. Velocity-gate to poses actually held.
  4. **No-man's-land is a reject region, hysteretic, and NOT silent** — it should hold
     the last category, not drop out. An instrument that goes quiet whenever the
     classifier is unsure is unplayable.

  The invariance half ("camera distance shouldn't matter") is **~70% already shipped**:
  #131's `invariantTo` vocabulary already names `scale` as camera distance and ships
  `residual()`/`deconfound()`. Nothing consumes it — level 1 is a selection policy, not
  new mathematics. Level 2 (learn the nuisance from a demonstration clip) is the elegant
  target; level 3 (adversarial invariance) is knowingly declined.

  Four maintainer questions are open in the issue (discrete vs continuous; persistence;
  command vs dial; acceptable recording length).

### Command dispatch

- **[#127] #87 Phase 4 — DONE (PR #159).** One middleware seam on `registry.dispatch`
  (`src/app/commands/middleware.ts`), read three ways: undo/redo, the telemetry journal,
  and command export/replay. Order is stated as data, gate outermost, because a blocked
  command did not run and must not be journaled or undoable. Undo is hand-written, not
  `acture-undo`: that package observes `setStateWithPatches` on a `PatchCapableAdapter`,
  and this registry deliberately holds no adapter while zodal's settings store emits no
  patches. History snapshots the whole editable layer per dispatch rather than
  registering per-command inverses, so a command added later gets undo for free and
  `dial.patch` cannot be half-undone. Bound to ⌘/Ctrl-Z + both redo spellings — an undo
  history reachable only from a module export is the #137 trap. Two properties to know:
  slider drags bypass the registry (Decision B) so they appear in neither surface, and
  the journal has **no egress and no persistence**.

### Generative

- **[#141] Gesture-steered generative layer** — DAG-native, budgeted as new work rather
  than as a port, per the #128 decision. The `indirect-map` node it would build on has
  never run in a browser, so this is a first-run, not a migration.

### Engine / platform

- **[#101] Stream Applier epic** (M8) — M-A and M-B shipped; M-C (#104) resolved but
  deferred (above); M-D…M-G in [design/stream-applier.md](design/stream-applier.md).
- **[#104] M-C** — async-iterator `Source` contract + `source` slot. Design resolved,
  build deferred; see "Open decisions" above.
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
- **DAG diagnostics + connection assistant** — a "linter for the instrument graph".
  Pure analyzers + a notes panel are buildable headless today; mid-drag compatibility
  highlighting waits on the patcher (#14). This lives in **discussion #93**, not an
  issue — earlier revisions of this file listed it as `[#93]` alongside issues, which
  was wrong: there is no issue #93.
- **[#5]** The original DAG roadmap issue, kept as the umbrella. Its M2 "CI gate" line
  was unbacked until #153 (below).

### Infrastructure

- **[#153] No test CI** — `npm test` / `typecheck` / `build` were local-only gates on a
  repo whose `main` auto-deploys to production; no test workflow had ever existed here.
  A `pull_request` + `push: main` workflow closes it. Note the deploy is **not** made
  conditional on the gate — that is a separate, deliberate decision.

Closed since the 2026-07-12 sweep: **#87, #126, #128, #129, #130, #131, #136, #137,
#143, #144** (see the shipped tables above).

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
5. **Lyria API key** — key-in-localStorage; a proxy/platform-managed key only if a
   generative layer comes to the default app (**#141**; the legacy AI-DJ that used it is
   retired to `?engine=legacy` per #128).
