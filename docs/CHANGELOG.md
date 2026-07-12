# What's new

A dated log of what shipped, keyed to **pull requests** — not to versions.

thoremin has no release cadence: it is a continuously-deployed app (merge to `main`
auto-deploys), `package.json` stays at `0.0.0`, and nothing is published to a
registry. A semver changelog would be a fiction, so this file tracks PRs instead.
Newest first.

---

## 2026-07

### Annotations: export + the end of the "tags" collision — #125 (2026-07-12)
The last take's annotations can now be exported to **Audacity** label tracks,
**WebVTT**, **CSV**, **Praat TextGrid** and **OTIO**, with a raw-vs-lead-in-corrected
time choice. The `src/taglog/` adapters existed but nothing had ever called them;
this is the wiring. Also renames the user-facing feature from "tags" to
**annotations** (artifacts are now `<take>.annotations.jsonl`), because "tags" was
simultaneously meaning *live marks on a recording* and *keywords on an instrument*.

### Instrument library UX — #121 (epic #116; 2026-07-11)
Multi-star favorites, sort/filter, "default" moved out of the star into the
instrument's own settings. A tag model with **stable hidden ids and editable labels**
(a rename can never orphan an association), a tag manager, emoji search + auto-assign
from a curated dependency-free pool. Read-only **`sys:*` system tags** derived on
read from an instrument's parametrization. A per-instrument parametrization tooltip
sharing `summarizeInstrument()` with the system tags. (Closes #112, #113, #114, #115.)

### MIDI out — #120 (issue #13; 2026-07-11)
A `midi-out` node (WEBMIDI.js) taps the same merged voices as the synth, so an
external instrument or DAW plays what you play. Off by default and a no-op where Web
MIDI is unsupported (Safari/iOS gated), so it costs nothing until switched on.

### Annotations (live tagging) — #123 (issue #92; 2026-07-11)
Toggle annotations during a take → a time-aligned JSONL on the same absolute engine
clock as the feature stream, so it segments every other stream by construction.
Interval + point annotations, mutual-exclusivity groups, 1–9 keyboard toggles,
per-annotation lead-in + countdown, a burned-in corner overlay as in-band ground
truth. Built as an extraction-ready tool in `src/taglog/` (no thoremin imports) with
the glue in `src/app/tagging/`.

### Feature Instrumentation Lab — #122 (issue #119; 2026-07-10)
A live measuring instrument for face and hand features: a data-driven catalog of ~200
scalar features with per-feature **controllability** hints, two pure DAG feature-vector
taps, a live meter grid, an **online normalizer** that makes heterogeneous features
comparable, a **no-eval formula compiler** for user-defined derived features (jsep +
whitelist), and named lab views saved as a zodal collection.

### Scale/range decoupling — #124 (issues #75, #63; 2026-07-10)
Chords are drawn from a **decoupled chord-source scale** (auto-derived from the melody
scale, or custom), so a pentatonic melody still gets sensible chords and the
seven-note-scale friction on the chord/`controls` face modes is gone. Ships alongside
the **double-thumb octave-range slider** (1–3 octaves, locked middle) and per-voice
`rangeLow`/`rangeHigh`. Store persist v6.

### Recording v2 — #118 (issue #88; 2026-07-10)
Session-based multi-stream recorder. Recording settings move **out of the instrument**
into a transient sheet. Five capturable streams (audio, video+overlays, pure webcam,
overlay-only alpha, feature-JSONL), **one folder per take** with an info-carrying name
and a `manifest.json` as the cross-stream alignment SSOT, and a three-tier local sink
(directory handle / ZIP / per-file) that degrades rather than losing a take.

### AI assistant — #111 (#87 Phase 3; 2026-07-10)
An in-app chat that **operates the instrument** by dispatching the command registry.
Client-side, multi-provider, bring-your-own-key (OpenAI / Anthropic / Google — default
Gemini 3.5 Flash). A human-in-the-loop confirmation gate guards the destructive
`instrument.*` commands; the model can never self-approve. Lazy-loaded so the AI SDK
stays out of the initial bundle.

### Keyboard shortcuts → command dispatch — #110 (issue #90; 2026-07-09)
Shortcuts become an app-level `tinykeys` keymap that dispatches dial commands, and the
in-DAG `keyboard-control` node is retired. Keyboard is no longer part of the graph.

### Auto-deploy + version badge — #109, #108 (2026-07-08)
Merging to `main` deploys to thorwhalen.com. An unobtrusive in-app badge shows the
deployed commit + date (read from `/_meta`), so you can tell what is actually live.

### Command dispatch — #97, #98, #107 (issue #87; 2026-07-06 → 07-08)
The `acture` command registry: every param-mutation is a typed command
(**Phase 0**, #97). **Phase 2** (#98) generates one `dial.<key>.set` command per dial
from the dials SSOT and adds the **Cmd/Ctrl-K command palette** over them. **Phase 1**
(#107) starts routing discrete panel writes through `registry.dispatch`. An import
firewall test keeps commands out of the hot path and the hot path out of the registry.
(The write-path sweep is **not** finished — see issue #126.)

### Stream Applier: M-A + M-B — #105, #106 (issues #102, #103; 2026-07-08)
`?source=video` runs the instrument **camera-free** from a pre-recorded clip. A `Clock`
abstraction (`BatchClock` / `RealtimeClock`) makes pacing the only thing that differs
between headless batch runs and live play. Design: #100.

### Chord overlays + mute fix — #96, #95 (issues #89, #91; 2026-07-05)
A chord-name HUD cue and a keyboard-strip overlay with a layered visual-cue hierarchy.
And a real bug fix: mute only silenced the hands — the chord nodes merged in downstream
and bypassed it. Mute now lands at `synth-merge`, the single convergence point of every
sound producer, plus a "muted" cue.

### Head/face pose control — #86 (issue #76; 2026-07-04)
Head / jaw / brow pose axes become a chord instrument (the `controls` face mode) —
deliberate control, as opposed to the emotion classifier's inference.

## 2026-06

### Dials + named instruments — #74, #77, #79 (2026-06-30)
The settings panel is generated from a Zod dials schema (`@zodal/dials-*`), and
settings snapshots become named, saved **instruments**.

### Rename: timbre "instrument" → "sound" — #73 (2026-06-30)
The per-hand/chord timbre is now a **sound** (`src/music/sounds.ts`), freeing the word
"instrument" for a named saved profile. This is why the ports are `soundRight` /
`soundLeft`.

### Zod 4 migration — #72 (2026-06-25)

### Face expression → chords — #66 through #71 (2026-06-24 → 06-25)
A face-mapping chooser (none / timbre / chord / controls), expression → diatonic
triad with a per-expression chord editor, neutral abstention + per-class sensitivity,
a 7th "kiss" expression, an expression help panel, chord voicings and tempo-driven
renderings, and a per-device calibration wizard.

### The DAG view becomes the default — #58 (2026-06-23)
The DAG instrument view now loads at the bare URL; the original hand-theremin is
code-split behind `?engine=legacy`. **This is the moment the DAG stopped being "the
next step" and became the product.**

### Composable overlay, presets, live face source, node roles — #54, #55, #56, #57, #60, #61, #62 (2026-06-23)
Toggleable overlay elements; schema-first preset persistence via zodal; a lazily-loaded
`webcam-face` source; advisory node roles + `registry.listByRole`; recording output
formats + save location; the mapping-slot contract (a developer-facing node-swap seam).

### Component model supersedes "the six layers" — #53 (2026-06-23)
`docs/design/component-model.md`: components carrying **roles**, composed of elements,
swapped via slots. "Layer" is retired as a structural term.

### The DAG instrument, built out — #32 through #44 (2026-06-21 → 06-22)
`?engine=dag` opt-in view, then: video-first UX, instrument presets, HD fullscreen,
gesture expression (openness → brightness), note-name readout, pinch → vibrato,
mobile/touch fitness, pitch/scale guides, left-hand guide, face → expression surface,
performance recording to audio, stereo panning, persisted settings.

### Engine + node library — #17 through #31 (2026-06-15 → 06-21)
The DAG re-homed onto the deployable main; the `lyria` generative node +
`GenerativeEngine` facade; `face-features` (52 blendshapes); `indirect-map`;
music-logic (`chord` / `progression`, Tonal.js); the `pick` adapter; conductor mode
(`transport` / `score` / `performance`); `gesture-classifier`; the one-euro filter;
the offline synth renderer; from-video test fixtures; and the **generated capabilities
manual** (`npm run catalog` → `docs/CATALOG.md` + `/thoremin/manual.html`).

## 2026-03 and earlier

### Plugin system + AI DJ (was "[0.2.0]", 2026-03-04)
The plugin registry, lifecycle and settings persistence; the **AI DJ** plugin driving
Google Lyria RealTime with weighted text "strains" (vibes/strains CRUD, all generation
parameters, transport, 10-minute sessions); Settings drawer tabs; `Theremin.tsx`
refactored out of a 515-line monolith. Documented in `WHY_YOUR_API_KEY_IS_SAFE.md`.

**All of this now lives in the frozen legacy app** (`?engine=legacy`).

### Initial (was "[0.1.0]")
Hand-tracking polyphonic theremin with oscillator synthesis; major / pentatonic /
harmonic-minor scales; sine / square / saw / triangle waveforms; pitch magnetism;
independent left/right hand settings with a sync option.
