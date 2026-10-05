# thoremin — AI Agent Instructions

"Anything to music": a browser hand-theremin. Live sensor streams (webcam hand
gestures now; keyboard, face, later MIDI) map to a live audiovisual stream
(musical audio + the captured video with overlaid guides), all **client-side**
(MediaPipe/TF.js inference, Web Audio synthesis, canvas rendering in the browser;
no backend compute — the app is a static Vite bundle).

## Two front-ends in one build

- **DAG instrument view (default)** — `src/app/*`, `src/nodes`, `packages/dag/src`,
  `src/music`. The typed dataflow engine everything new is built on. Loads at
  the bare URL (https://apps.thorwhalen.com/thoremin/). `?engine=dag` is still
  honored (it equals the default), so older links keep working.
- **Legacy app** — opt-in via `?engine=legacy` (alias `?engine=classic`) →
  `src/App.tsx`, `src/components/Theremin.tsx`, `src/plugins/ai-dj/` (Lyria
  RealTime). The original hand-theremin; the code-split (lazy) view.
  **It is FROZEN** (maintainer decision): it stays reachable so the AI-DJ / Lyria
  plugin is not lost, but it gets no new features, is excluded from refactors, and
  new work never lands there. **#128 decided this** (closed 2026-07-15): the legacy
  AI-DJ is formally retired to `?engine=legacy` rather than ported. The compelling
  version — hand/face features steering a generative model — was budgeted honestly as
  new work in **#141**, not as a port. **#141 is now closed (shipped)**: the
  `indirect-map` → `lyria` additive branch is live in `src/app/graph.ts`, gated behind
  the `steer.enabled` dial and the Generative settings section (#188's PR chain,
  #195-#208). What remains is the human-only live verification (a Gemini key + ears)
  tracked as **#146 §B8**.

Outward-facing changes (deploying, moving the default) still get the user's OK.

## The architecture in one breath (read this first)

The engine is a typed dataflow **DAG** (`packages/dag/src/`), a TS mirror of the Python
`meshed` library. The conceptual model — **components, roles, elements, options,
presets, slots** — is in [`docs/design/component-model.md`](docs/design/component-model.md).
It **supersedes the "six layers"** framing in `docs/ARCHITECTURE.md` and
Discussion #3. Key rules from it:

- **Don't say "layer"** as a structural term — it's a DAG, not a stack. Roles are
  metadata on a node; a node can carry **several** roles.
- **`role` for nodes, `kind` for ports.** Never add a node-level `kind`
  (`PortSpec.kind` already owns that word).
- **Sub-components (e.g. overlay elements) are toggled functions *inside* a node,
  not DAG nodes** — the engine rejects fan-in to a single input port. Promote an
  element to a node only when something *outside* the node must consume/tap it.
- **A role earns a settings swap-dropdown only when ≥2 real implementations
  exist.** Don't build slot machinery for hypothetical swaps. (The rule says a
  swap *may* be surfaced, not that it must: the `source` slot has three real
  candidates and still gets no dropdown, because a replay or synthetic hand is a
  verification affordance, not an instrument a player picks between.)
- **Three slots exist**: `mapping` (one candidate), `source` (#104 —
  `webcam-hands` / `synthetic-hands` / `replay-hands`) and `body` (#186 —
  `webcam-body` / `synthetic-body` / `replay-body`; a second camera branch, composed into the graph only while the `body.enabled` dial, the Lab or a trainer cue
  wants it (the instruments-as-graphs ADR, PR 3), because hands and body are different instruments a player may run together).
  Select with `?slot.<name>=<nodeType>`. `?slot.source=synthetic-hands` runs the
  whole instrument with no camera and no MediaPipe — the fastest way to exercise
  the graph without hardware; `?slot.body=synthetic-body` does the same for the
  body path, once something wants the body (the dial, the Lab or a trainer cue).
- **`PortSpec.schema`** makes a port contract checkable (`kind` is only a label).
  The engine checks it in `tick()`'s output path under
  `EngineOptions.validatePorts` — off by default, **on** in `runHeadless`. It
  exists mainly to catch a node emitting *nothing* on a port it declares, which
  is otherwise a silent graph rather than an error.
- Of the prerequisites before "node swapping is a config flip" is true, one
  remains: the registry is a **hand-listed array** with no discovery seam (the
  design doc's "Two corrections", #2). The other two are done — the mapping nodes
  share an **input/params contract** (`src/nodes/mapping/mapping_contract.ts`),
  and the engine can now re-wire itself while running (next bullet).
- **The running graph is not frozen.** `Engine.applyGraph(spec, registry?)`
  reconciles a live engine onto a new `GraphSpec`, keeping every node whose id +
  type + *validated* params are unchanged — so a swap does not reload the
  MediaPipe models or rebuild the audio graph. It plans synchronously (a bad spec
  is a no-op), inits the new nodes **while the old graph keeps ticking**, then
  commits atomically. Never construct a second `Engine` to change wiring. See
  `docs/design/component-model.md` → "Swapping at runtime: the engine lifecycle".

## Persistence & collections → **zodal** (project rule)

Anything that persists, or is a collection of named things (settings presets,
saved overlays, recordings index, …) is designed the **zodal** way, in this order:

1. **Affordances first** — define a Zod schema (the SSOT of what the data *is*).
2. **Storage target behind a stable contract** — `@zodal/store`'s
   `DataProvider<T>` (`getList/getOne/create/update/delete`). **Default target =
   localStorage**; files/cloud later by swapping the provider, never the call
   sites. Collections via `@zodal/core` `defineCollection`.
3. **UI behind the affordances** — `@zodal/ui` generators; shadcn renderers when
   production-ready.

`@zodal/core` / `@zodal/store` / `@zodal/ui` are on npm (0.1.2). The localStorage
adapter (`@zodal/store-localstorage`) and shadcn renderer (`@zodal/ui-shadcn`) are
**not yet published** — prefer publishing/developing them in the zodal repo over
inlining in thoremin (ecosystem storage-facade + zodal-development policy). A thin
in-repo adapter implementing the published `DataProvider<T>` is a *temporary*
fallback only, tracked for migration.

**Hot-path split:** live per-tick control state stays in the **zustand** store
(`src/app/store.ts`, read synchronously each tick). zodal is the *persistence +
preset-collection* layer. Load preset → hydrate zustand; edit → debounce → save
via the provider. Never `await` a provider in the tick/audio loop.

## Verification gates (every change)

- `npm run typecheck` — strict DAG typecheck (`tsconfig.dag.json`; covers
  `packages/dag/src`, `src/nodes`, `src/music`, `src/app/graph.ts`, tests, scripts). The
  React layer (`src/app/*.tsx`, `src/components`) is **not** strict-typechecked
  (the repo ships no `@types/react`); it is verified by `npm run build`.
- `npm test` — vitest (the suite grows with every PR; `npx vitest run 2>&1 | tail -4` prints the current file and test counts). **Test against the real fixtures**
  (`test/fixtures/`, recorded hand/face videos, NDJSON intermediate streams). New
  behaviour gets a fixture-replay test, not just a unit test.
- `npm run build` — vite build must stay green (verifies the React layer).
- `npm run catalog` — regenerates `docs/CATALOG.md`, `public/manual.html` and
  `public/catalog.json` from the node registry. **Run it after adding/renaming a node
  or changing a port/param, and commit the result** — those three files are generated
  and must never be hand-edited.
- Do **adversarial reviews at junctures** (multi-agent workflow) — they have
  repeatedly caught real bugs here.

## Vocabulary: "sound" vs "instrument" (do not re-break this)

PR #73 renamed the *timbre* concept. Both words are now taken, and they mean
different things:

- **Sound** = a timbre preset (sine / bell / reed / …). SSOT registry:
  **`src/music/sounds.ts`** (`SOUNDS`, `SoundId`, `as const satisfies Record<…>`).
  This is why the ports are `soundRight` / `soundLeft` and a voice carries `sound`.
- **Instrument** = a *named saved dials profile* — a complete settings snapshot the
  player loads from the library. Owned by **`src/app/dials/instruments.ts`**
  (persisted via `@zodal/dials-ui`'s `createProfileStore`); the browsable metadata
  *about* instruments (favorites, tags) lives in `src/app/library/`.

There is **no `src/music/instruments.ts`**. If you are looking for the timbre enum,
it is `src/music/sounds.ts`.

## Vocabulary: "cue" and "routine" (the trainer, #163)

- **Cue** = one thing the trainer asks the player to do ("look to your left"). A
  Zod-schema'd record in a zodal collection; it declares feature **groups**, never
  feature ids and never a modality. The written and spoken forms are the same string.
- **Routine** = a saved, ordered list of cue ids.
- Rejected words: *prompt* (LLM-overloaded here), *drill* (tetrachord's term), *step*
  (v1's word; too anonymous), *exercise* (the system is the one learning).
- Trainer distances are in **noise units** (`src/enroll/noise.ts`): a feature's
  displacement divided by its own frame-to-frame jitter. The live vector is raw
  (degrees next to 0..1 blendshapes), so this is what makes any threshold mean the
  same thing for every feature. Do not reintroduce a raw-unit threshold.

## Conventions

- Nodes: `defineNode` with typed ports + a Zod params schema + `process()`/`make()`.
  Static params = build-time defaults; input ports = live overrides (so the UI
  changes scale/sound without rebuilding the graph or reloading the ML model).
- No emojis in code. Module docstrings/headers explain *why*.
- Workflow: branch → PR → squash-merge → delete branch. Reference the issue.

## Command dispatch is the single write path (#87) — and it is enforced

The design (issue #87, `docs/design/command-dispatch.md`): **every param-mutation is
an `acture` command**, and `src/app/commands/` is the one registry that the settings
panels, the keyboard shortcuts, the Cmd/Ctrl-K palette, the AI assistant and (since
#129) discrete hand gestures all dispatch into. A command changes sound *only* by
writing a dial; the per-tick/audio path is never a command.
`test/commands_firewall.test.ts` enforces the boundary (commands may not import the
hot store / DAG / nodes / audio; the DAG may not import the registry).

**Status: TRUE on main since #126 (PR #140, merged 2026-07-13).** The sweep landed.
`rg 'setDial\(' src/ --glob '!*.test.*'` now hits **only** `src/app/commands/dials.ts`
— the command implementations themselves. Every discrete panel control writes through
one of the three dispatchers in `src/app/dispatchDial.ts`:

- `dispatchDialSet(key, value)` — one scalar dial (`faceChord.voicing`).
- `dispatchDialSetIn(path, value)` — one scalar LEAF of a **structured** dial, by
  dotted path (`overlay.landmarks.show`, `handMap.fingers.index.target`). Structured
  dials get no per-dial command and a command's value must stay scalar (an object
  param emits a JSON Schema Gemini rejects), so the path is what makes overlay /
  hand-map / expression-map dispatchable at all. See `commands/paths.ts`.
- `dispatchDialPatch(writes)` — several dials **atomically**, for the one-gesture /
  several-writes controls (the chord-source flip that seeds root+type; a synced-hands
  voice edit mirrored onto the other hand). All-or-nothing.

**The invariant is guarded, not merely documented.** `test/dials_write_path.test.ts`
is a real TypeScript-AST analysis over `src/app/dials/panels/` + `DialsControlsPanel.tsx`:
it follows the local helper functions a handler calls, so a violation cannot hide one
indirection away. Add a `<select>` or `<Toggle>` that writes `setDial` directly and the
suite goes red. (thoremin ships no ESLint — it lints with `tsc --noEmit` — so, like the
import firewall, this boundary is enforced as a test.)

Two deliberate exceptions that are *not* bugs, and that the guard permits **by name**
rather than by vagueness:

- Continuous `type="range"` sliders being dragged stay a direct `setDial` for latency
  (**Decision B**). A live drag fires a write per pointer-move frame; routing that
  through Zod validation, the confirmation-gate wrapper and a promise buys nothing and
  costs latency on the one interaction where latency is audible.
- The non-dial `muted` flag (#91) is not a command yet. It is transient hot-store state,
  not a persisted param.

When you add a write path: dispatch it. When you add a discrete panel control, use
`dispatchDialSet` / `dispatchDialSetIn` / `dispatchDialPatch` — the guard will tell you
if you forget, but knowing why is cheaper than reading the failure.

## Shipping rule: a feature nobody can find is not shipped

Twice now. The Feature Lab (#119) was merged, deployed, and live in the production bundle
for weeks while being, in practice, **unreachable**: no entry point in the app shell,
defaulting to off, buried inside a per-instrument editor. MIDI out (#120) was worse — no
UI, no dial, and its `enabled` input left unconnected in `graph.ts`. Both passed every
test in the suite. Both are fixed now (#136 → PR #138; #137 → PR #147), and #147 is the
template: dial + live input port + panel + a *structural* guard that fails if the port
goes unconnected again. The lesson is what stays.

So, when you add a user-facing capability:

1. **Give it an entry point in the shell.** Register it in `src/app/tools.ts` if it is a
   *tool* (something you use ON the instrument: the Lab, the palette, the manual); give it
   a dial in `src/settings/dials.ts` if it is an *instrument parameter* (which also earns
   it a panel control, a palette entry, a per-dial command and an AI tool surface for
   free). If it is neither, say why in the PR.
2. **Ask "how many clicks from a cold load?"** and write the answer in the PR. If the
   answer needs the phrase "then scroll", reconsider.
3. **Test the reachability, not just the logic.** `test/tools_shell.test.tsx` (jsdom) and
   `test/app_shell.test.ts` are the pattern. A green unit suite says the code runs; it
   says nothing about whether a player can get to it.

## Where things live

| Area | Path |
|------|------|
| DAG engine (framework-agnostic) | `packages/dag/src/` (`engine.ts`, `types.ts`, `registry.ts`, `recorder.ts`, `clock.ts`, `applier.ts`, `merge.ts`) |
| Node library | `src/nodes/{sources,features,mapping,music,output}/` |
| Default graph wiring + the `SLOTS` table (role-typed swap points) | `src/app/graph.ts` |
| **Slot contracts** — what a candidate must declare to fill a slot | `src/nodes/slot_contract.ts`, `src/nodes/mapping/mapping_contract.ts`, `src/nodes/sources/source_contract.ts` |
| React↔DAG bridge (webcam, AudioContext, recorder, slot selection) | `src/app/useEngine.ts` |
| Live frame loop — an `Applier` config: `RealtimeClock`, the React bridges as sinks (through the seconds→ms converter), `disposed` as the stop condition | `src/app/useEngine.ts` (the effect), `packages/dag/src/applier.ts` |
| Live control store (zustand+persist) — the hot per-tick mirror | `src/app/store.ts` |
| Music theory + **sounds** (timbre presets) | `src/music/` (`theory.ts`, `sounds.ts`, `voicing.ts`, `expression.ts`) |
| Overlay (compose elements here) | `src/nodes/output/canvas_overlay.ts` |
| **Command registry** (#87) — the single write path, guarded by `test/dials_write_path.test.ts` | `src/app/commands/` (`registry.ts`, `dials.ts`, `perDial.ts`, `paths.ts`, `instruments.ts`, `confirmation.ts`) + the panel dispatchers in `src/app/dispatchDial.ts` |
| **Dispatch middleware** (#127) — one seam on `registry.dispatch`; undo/redo, telemetry and export/replay are three readings of it. Order is stated as data in `registry.ts` (gate outermost) | `src/app/commands/` (`middleware.ts`, `history.ts`, `journal.ts`) + the ⌘Z/⌘⇧Z bindings in `src/app/keyboardShortcuts.ts` |
| **Dials** — settings schema store + named **instruments** (saved profiles) | `src/app/dials/` (`settingsStore.ts`, `instruments.ts`, panels) |
| Dials schema / presets SSOT | `src/settings/` (`schema.ts`, `dials.ts`, `presets.ts`) |
| **Feature catalog** (#119) — data-driven features, safe formula compiler, online normalizer | `src/features/` (`catalog.ts`, `formula.ts`, `normalizer.ts`) |
| **Feature Lab** (#119/#136) — config SSOT, the shell panel, saved views (zodal collection) | `src/features/labConfig.ts`, `src/app/LabPanel.tsx`, `src/app/LabControls.tsx`, `src/app/lab/` |
| **Shell tools** (#136; Round 4 #271) — the registry of non-instrument surfaces (Zod `ToolSchema`, the SSOT) as a zodal collection with declared affordances; the Tools launcher that renders it; the player's pins (a `DataProvider`, localStorage) deciding which tools keep a bar button; the bottom-right take cluster (Annotations + Record) is in `App.tsx` | `src/app/tools.ts`, `src/app/toolsCollection.ts`, `src/app/toolsCatalog.ts`, `src/app/toolPins.ts`, `src/app/ToolsLauncher.tsx`, `src/app/ToolsBar.tsx`, `src/app/toolsStore.ts`; hit-tested by `smoke/tests/occlusion.smoke.ts` |
| **Instrument library** (#113/#114/#115) — favorites, tags, system tags, summaries; the derived **classes** (`INSTRUMENT_CLASSES`: `field` = "Field instruments", `air`; #249) with label, emoji and colour that group the Instruments view — air instruments are instruments, never shell tools | `src/app/library/` (`category.ts`); per-air-instrument UI in the air extension's manifest, `src/extensions/air/ui.tsx` |
| **The Instruments view** (Round 4, #272; Decision 8 of `docs/design/instrument-library.md`) — a zodal collection over the `InstrumentSpec` (declared affordances, a read-only specs `DataProvider`, `@zodal/ui`'s query slice), rendered as a list (one line per instrument, class colour, collapsible classes) or a gallery (cards with pictures); one search over what an instrument is, facet chips counted by `@zodal/groups-core`; the remembered view choices (a `DataProvider` record, the stand-in for i2mint/zodal#15) | `src/app/library/` (`instrumentsCollection.ts`, `instrumentsCatalog.ts`, `instrumentsListing.ts`, `instrumentsFacets.ts`, `instrumentsViewPrefs.ts`, `InstrumentPicture.tsx`), `src/app/dials/InstrumentsPanel.tsx` |
| **Air bass** (#249) — the neck (fretting hand's distance from the plucking hand, quantised to the scale) and the predicted pluck; plucked notes on the audio clock | `src/extensions/air/nodes/air_bass.ts`, `src/extensions/air/nodes/pluck_out.ts`, `src/extensions/air/nodes/note_events.ts`, `src/extensions/air/panels/airBass.tsx`, `src/extensions/air/app/airBassStatus.ts` |
| **Air flute** (#249) — enrolled finger lifts of both hands (named by note) choose the note; an enrolled blowing mouth (the face's mouth groups, claimed while on) gates one sustained voice into the synth merge | `src/extensions/air/nodes/air_flute.ts`, `src/music/notes.ts`, `src/extensions/air/app/airFluteDemand.ts`, `src/extensions/air/app/airFluteStatus.ts`, `src/extensions/air/panels/airFlute.tsx`, `src/extensions/air/app/VocabularyEnrolment.tsx` |
| **Air guitar** (#249) — the player's ENROLLED chord shapes (samples are the SSOT in a zodal collection; the classifier is derived), classified live, a predicted strum voiced as an open chord on six strings | `src/extensions/air/nodes/air_guitar.ts`, `src/extensions/air/lib/vocabulary.ts`, `src/extensions/air/lib/hand_shape.ts`, `src/extensions/air/lib/guitar.ts`, `src/extensions/air/app/vocabularyStore.ts`, `src/extensions/air/panels/airGuitar.tsx`, `src/extensions/air/app/airGuitarStatus.ts` |
| **Recording v2** (#88) — session, plan, naming, manifest, sinks, feature tap | `src/app/recording/` + `src/app/RecordButton.tsx` |
| **Annotations** (#92) — thoremin glue for the tagging tool | `src/app/tagging/` |
| **taglog** — the extraction-ready annotation package (no thoremin imports) | `packages/taglog/src/` (see its own `README.md`) |
| **AI assistant** (#87 Phase 3) — chat that operates the instrument | `src/plugins/assistant/` |
| Keyboard shortcuts (#90) — tinykeys → command dispatch | `src/app/keyboardShortcuts.ts` |
| **Gesture dispatch** (#129) — discrete hand poses → command dispatch (edge-triggered, held, cooled) | `src/app/gestureDispatch.ts` |
| **Trainer** (#160/#163) — learn a player's OWN categories. Pure core over `FeatureVector` (never a face type): `cue.ts` (Zod cues/routines), `noise.ts` (every distance in multiples of a feature's own jitter), `sampler.ts`, `sufficiency.ts` (the `SufficiencyEvaluator` seam), `runner.ts`, `session.ts`, `cluster.ts`, `classify.ts`. Host glue: starter face cues + the two zodal collections + the store | `src/enroll/`, `src/app/enroll/` (`starterCues.ts`, `cueStore.ts`, `store.ts`), `src/app/TrainerPanel.tsx` |
| **Feature demand** (#163) — a non-Lab consumer claims feature GROUPS; the vector nodes (and the face-model gate) compute them with the Lab closed | `src/features/demand.ts`, `src/app/featureDemand.ts` |
| Legacy app (**frozen**) | `src/App.tsx`, `src/components/`, `src/hooks/`, `src/plugins/ai-dj/` |
| Fixtures + replay | `test/fixtures/`, `scripts/record_stream.ts`, `packages/dag/src/recorder.ts`, `test/helpers/fixtures.ts` (the one loader) |
| **ictus** (#178/#187) — musical time from low-rate gesture: ictus detector, adaptive oscillator (`RhythmPrior`), dynamics/articulation, beat metrics. Pure, causal, no DAG/React imports (a package-in-waiting; tests import only `@thoremin/ictus`). Consumed by the conductor node (#187) and the body pacer (#186) | `packages/ictus/src/` (see its `README.md`), `test/fixtures/conducting_*/` (70 bpm conducting-pattern clips), `scripts/build_conducting_fixture.ts` |
| **Sub-frame impact prediction** — the impact predictor (a strike predicted before the frame that shows it: quadratic approach extrapolated to a known or learned plane, commit-then-confirm), the timing magnet (actuality ↔ intent dial), the trend prior (tempo-rate `RhythmPrior`); the `an.impacts` scoring harness and its numbers | `packages/ictus/src/impact.ts`, `magnet.ts`, `trend_prior.ts`; `scripts/subframe/` (clip sets, scorer, fixture builder; see its `README.md`); `test/subframe/`, `test/fixtures/subframe_*`; [`docs/research/subframe-impact-prediction.md`](docs/research/subframe-impact-prediction.md) |
| **Air drum** (#233/#246/#245) — the tracked point (a stick tip estimated from the grip, its stroke gates counted in reaches, the hand's own units), the pads (fixed slots `p1..p8` inside the `airDrum` dial, so every pad field is a command-path leaf), hit to pad from the fitted landing point, how hard from the stroke's speed over the slowest stroke, centre-to-rim and hardness shading the drum voice; the pad editor in the air drum's settings; saved pad layouts (zodal collection); pads and virtual sticks on the video | `src/extensions/air/nodes/air_drum.ts`, `src/nodes/music/drum_anchor.ts` and `src/nodes/music/drum_pads.ts` (in core: the overlay draws them too), `src/extensions/air/nodes/drum_out.ts`, `src/extensions/air/panels/airDrum.tsx` + `airDrumPads.tsx`, `src/extensions/air/app/padLayouts.ts`, the `drumPads` overlay element; footage scoring in `scripts/air/` (`lib_drum_strokes.ts`, `eval_drum_*.ts`), numbers in `docs/research/air-instruments.md` §7.3 |
| **Latency probe** (#227) — `?probe=latency`: an engine tap timing each stage camera → speaker, a panel, `window.thoreminLatency`, and the microphone strike test (glass-to-air onset latency); the measured budget and the "would Rust/WASM help?" answer | `src/latency/` (pure: `probe.ts`, `stats.ts`, `onsets.ts`, `strike.ts`), `src/app/latencyProbe.ts`, `smoke/latency/measure.mjs`, [`docs/research/latency-budget-and-browser-realtime.md`](docs/research/latency-budget-and-browser-realtime.md) |
| **Frame capture stamps** (#225/#226) — the webcam sources stamp frames with the camera's capture time (`t`, `tSource`, `tOrigin`, `lag`); consumers sample at the stamp only in real time at speed 1 and only for this document's stamps (`frameTime`); the conductor feeds ictus once per camera frame | `src/nodes/sources/frame_pump.ts`, `src/nodes/domain.ts` (`FrameTiming`, `frameTime`), `test/subframe/frame_pump.test.ts`, `test/subframe/conductor_frame_dedupe.test.ts` |
| **Score pipeline** (#187 PR 3) — `ScoreDoc` (Zod SSOT: parts, notes in beats, tempo map, time signatures, dynamics, fermatas), lazy loaders (`@tonejs/midi`, `musicxml-io` via its MIDI export + timing sidecar; neither in the main chunk), the shipped demos (`public/scores/`, licences in `LICENSES.md` there) and the `scores` zodal collection; the app-side `ScoreLoader` resolves `conductor.piece` into the transient `scoreDoc` store field that `store-controls` feeds to the `score` node | `src/score/`, `src/app/resolvePiece.ts`, `src/app/ScoreLoader.tsx`, `src/app/scoreStatus.ts` |
| **Trainer take → fixture** — the cue interval is the ground truth a clip cannot supply; refuses landmark geometry | `scripts/lib_trainer_take.ts` (logic) + `scripts/trainer_take_to_fixture.ts` (CLI), `docs/TESTING.md` |
| **Real-vs-air takes** (#247) — paired, labelled takes: `performance` cues with a `clicked` sufficiency (`pairing: {phrase, surface}`), two starter routines, the trainer's own click, the recorder's raw `microphone` stream, the cue specs in the manifest's `meta`; offline, onsets/level/chroma per beat, the air half labelled by the click plus the player's real-half lag (`npm run pair`, output under the app-data dir only) | `src/app/enroll/realVsAirCues.ts`, `src/app/enroll/click.ts`, `scripts/cue/` (see its `README.md`), `test/cue/` |
| **Fingering charts, the fingering prior and scripted sequences** (#263) — seven winds' charts as data (which fingers are down per note, `T123|12-4` notation); the chart as a conjugate prior over the air flute's enrolled vocabulary (an expected curl per finger, anchors calibrated from whatever is enrolled, blanks where the chart has no opinion, the fingering the guide must draw, the wrong-note check); a sequence of targets with lead-in, countdown, settle and hold, run on the caller's clock like the cue runner, a sibling of a routine and not a cue | `src/music/fingerings.ts`, `src/extensions/air/lib/fingering_prior.ts`, `src/enroll/sequence.ts`, `test/air/fingerings.test.ts`, `test/air/fingering_prior.test.ts`, `test/enroll_sequence.test.ts`, [`docs/research/fingering-priors-and-sequence-training.md`](docs/research/fingering-priors-and-sequence-training.md) |
| **Drum pattern training** (#269) — short patterns as a grid (`kick x...x...`) compiled to a percussion `ScoreDoc`, General MIDI drums onto the kit's six sounds; the pure fit of a take to a pattern (a tempo scan then a line, hits assigned same-sound-first, the feel per event against each pass's own line, the pad and centre per drum, recall and precision); the model a zodal record | `src/music/drum_patterns.ts`, `src/music/gm_drums.ts`, `src/drums/pattern_fit.ts`, `test/drums/`, [`docs/research/drum-pattern-training.md`](docs/research/drum-pattern-training.md) (the cursor / metronome / feedback decisions) |
| **Workspace packages** (ADR PR 6) — npm workspaces; four pure leaves consumed as TypeScript source through the workspace, imported as `@thoremin/<name>` (never `@/dag` etc.); `test/packages_purity.test.ts` keeps each package to its own files and its declared dependencies; an `exports` entry per module; the root `npm ci && npm run build` is unchanged | `packages/{dag,ictus,taglog,lazy}/` (`package.json`, `src/`, `README.md`), the root `package.json` `workspaces` |
| **Extension injection** (ADR PR 6) — `extensions.json` names the extensions a build ships; a Vite plugin turns it into the virtual modules the two list modules import; `THOREMIN_EXTENSIONS` selects another manifest. The list is typed per build too: `npm run extensions` regenerates `src/extensions/virtual.d.ts` (a tuple of the listed manifests' types) and the `Settings` type is computed from it, so leaving an extension out removes its code from the bundle. **Run `npm run extensions` after editing `extensions.json`** (a test fails when the declaration is stale) | `extensions.json`, `vite.extensions.ts`, `scripts/gen_extensions.ts`, `src/extensions/virtual.d.ts` (generated), `src/app/extensions/virtual.d.ts`, `test/instruments/extensions_manifest.test.ts` |
| **Extensions** (ADR PR 5a) — the manifest in two halves: `Extension` (pure: nodes, branches, dial slices, transient ports, `derive`) and `ExtensionUi` (editor sections, status hooks, mount effects); the lists `EXTENSIONS` / `EXTENSION_UIS`; every former hand-listed registry is a fold over them (`createAppRegistry(extensions)`, `makeStoreControlsNode(extensions)`, `ALL_BRANCHES`, `branchIdsFor`, the settings schema, `DialsControlsPanel`, `useEngine`, `App`); the air instruments are the first extension and live in `src/extensions/air/{nodes,lib,app,panels}` (5b); the boundary is a test in both directions, and its `SDK_SURFACE` list is the SDK contract as data | `src/instruments/extension.ts`, `src/extensions/` (`index.ts`, `air/{index,dials,branches}.ts`, `air/ui.tsx`), `src/app/extensions/`, `test/extensions_boundary.test.ts`, `test/instruments/extensions.test.ts` |
| **Instruments as declared graphs** (ADR PRs 1, 3, 4: #276, #278) — `GraphBranch` (a named, sparse piece of graph with owned edges, voices by role, overlay elements, implied-by demands), `composeGraph` (four rules; order-independent), the branch table; the pure `deriveBranchIds` (dials + demand + Lab → the branch set, given the build's table; an explicit set still unions a tool's demand) and `assembleSpecWith`, bound to this build's extensions as `branchIdsFor` / `assembleSpec` in `src/app/graph.ts`; the live graph is composed in `useEngine` and re-applied on instrument switch; the overlay draws only the composed element set (on the `graphElements` port); the `InstrumentSpec` (a join of the profile store's Layer, the library's metadata record and the derivation: class cache, explicit branches, training route, image reference, `features` facet), exposed by `useLibrary().specOf` | `src/instruments/` (`branch.ts`, `compose.ts`, `branches.ts`, `derive.ts`, `spec.ts`), `src/app/useEngine.ts` (`liveGraph`, `applyLive`), `src/app/library/` (`derive.ts`, `useLibrary.ts`, `model.ts`), `test/instruments/`, `test/fixtures/graph/` |
| **Training routes** (#263/#269) — where "train this instrument" goes: the spec's `training.route` when declared, else the air branch it composes (flute/guitar sequence, drum patterns, each in its own settings section by DOM anchor), else the Trainer tool; the link at the top of every instrument's editor | `src/app/training/routes.ts`, `src/app/training/TrainingLink.tsx`, `test/training_routes.test.ts` |
| Conceptual model | `docs/design/component-model.md` |
| **Instruments as declared graphs + extensions** (ADR, accepted 2026-09-27 after an independent review: trunk + branches composed by four rules, `InstrumentSpec`, the `Extension` manifest with a generated `store-controls` port list, the package cut, the seven-PR sequence; class id `field` = "Field instruments", #274) | `docs/design/instruments-as-graphs-and-extensions.md` |

## Roadmap & tracking

`docs/ROADMAP.md` + GitHub issues. **#87 and #126 are both closed** — the command
write path is done and guarded. The live tracking issues are **#101** (Stream Applier
epic), **#5** (the umbrella DAG roadmap) and **#146** (the standing live-verification
list: everything that can only be confirmed with a webcam and human eyes).
Discussions #3 (architecture) and #4 (mapping spectrum) are the design record.
Per-subsystem SSOT design docs live in `docs/design/`.

**Timing beyond the frame rate.** [`docs/research/intent-and-subframe-timing.md`](docs/research/intent-and-subframe-timing.md) verifies the perceptual thresholds and the pipeline's real frame rate (30 fps, not 44) and states the actuality / intent / sounding-good principle; [`docs/research/subframe-impact-prediction.md`](docs/research/subframe-impact-prediction.md) is the working answer with numbers. Read both before touching anything that turns a stroke into an onset.

**Rhythm from gesture (#178).** Melody and timbre tolerate a 30-60 Hz control
rate; rhythm does not — perceptually meaningful timing lives at 1-20 ms, under a
frame period. So rhythm has to be *inferred* against a musical prior, never
measured frame-to-onset. The research map is
[`docs/research/rhythm-from-gesture-research-map.md`](docs/research/rhythm-from-gesture-research-map.md)
(signal theory, Bayesian rhythm models, entrainment, conducting-gesture systems,
21 references). #178 proposes extracting the engine as a shared package
(`ictus`) since `muvid` needs the same latent state from dancer motion — read §1
and §6 of the map before touching anything timing-related.
