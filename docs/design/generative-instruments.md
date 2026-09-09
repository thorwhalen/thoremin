# Generative AI inside instruments, and lazy loading as a catalogued pattern

> Status: design record (2026-09-09), issue [#188](https://github.com/thorwhalen/thoremin/issues/188). Answers two maintainer directions at once: *"start more seriously thinking of AI aspects (music gen) that can be incorporated in some instruments"* and *"think of lazy loading — only what is needed, when it's needed."* Builds on [`component-model.md`](component-model.md) (roles, elements, slots), [#141](https://github.com/thorwhalen/thoremin/issues/141) (the gesture-steered generative layer) and [#169](https://github.com/thorwhalen/thoremin/pull/169) (its headless prerequisite). Every cost below was **measured on 2026-09-09** with the repo's own toolchain unless marked otherwise; the method is in §7.

## TL;DR

- **Generative AI belongs *inside* an instrument, not beside it as a DJ.** The legacy AI-DJ (retired to `?engine=legacy` by #128) is slider-steered; the thing worth building is a generator whose *latent* (prompt weights, density, brightness) is a mapping target for the same hand/face features that play notes. That is exactly the `indirect-map → lyria` pair already in the registry, and it costs nothing new architecturally: it is an additive parallel branch in `graph.ts`, off by default.
- **Three places a generator can sit in the DAG, and each one earns a node only under a specific test** (§3): as a `mapping`+`generate` node (features steer a latent: **build now**, cloud-backed), as a `music`+`generate` node (accompaniment following what is played or conducted: **feasible in-browser at ~12–18 MB**, second), and as a *sound* (a generated timbre: **not a node**, a lazily-decoded sample set behind the existing `sounds.ts` registry, later).
- **In-browser generation is realistic only for small symbolic models.** Magenta.js MusicRNN/MusicVAE/GrooVAE checkpoints are 12–18 MB each and the library is ~300–400 kB gzipped per model family, but it pins TensorFlow.js 2.x while thoremin ships 4.22 (a second TF.js copy, ~1 MB), and the project is in maintenance mode. ONNX Runtime Web is 110 kB of JS plus a 13.6–27 MB wasm, and no small steerable music model ships in ONNX today. Audio-domain generation in the browser (MusicGen-class) is out of budget for a live instrument. Details and the recommendation in §4.
- **Lazy loading becomes one catalogued pattern**, extracted from the three sites that already do it by hand (`webcam_hands.ts` / `webcam_face.ts`, `recording/formats.ts`, `midi_out.ts`): a **loader seam** (a host-injectable factory whose default is a dynamic `import()`), a **status port** (one `phase` vocabulary for every heavy node), and a **UI affordance** (the status-dot readout the MIDI panel already renders). §5 specifies it; `src/lazy/` implements it; every heavy node adopts it. Adopting it for `lyria` removes `@google/genai` (207 kB raw, 38 kB gzip) from the main bundle, where it sits today through a static re-export.
- **The PR plan is four small PRs** (§8). Everything that needs a Gemini key or ears is listed for the maintainer under #146 / #168, not blocked on.

## 1. What exists, and what the maintainer actually asked for

Two things are in the tree today, on opposite sides of the app split:

| Piece | Where | State |
|---|---|---|
| `GenerativeEngine` facade + `WeightedPrompt`/`GenerativeConfig`/`GenerativeSteer` types | `src/nodes/output/generative.ts` | types only, Node-safe |
| `lyria` node (lifecycle, throttled + diffed steering, tempo reset) | `src/nodes/output/lyria.ts` | in `CORE_NODES`, mock-tested, never run in a browser |
| `LyriaEngine` (WebSocket session, 48 kHz stereo PCM scheduled ahead through Web Audio) | `src/nodes/output/lyria_engine.ts` | type-checked, **never constructed** |
| `indirect-map` (hand/face features → weighted prompts + config dials, with a live `steerConfig` port since #169) | `src/nodes/mapping/indirect_map.ts` | fixture-tested, 11/11 mutants caught |
| The legacy slider-steered AI-DJ (`LyriaSession`, `VibeEditor`, `AiDjOverlayPanel`, `ApiKeyDialog`) | `src/plugins/ai-dj/` | frozen, reachable only at `?engine=legacy` |
| The BYO-key assistant (`getStoredKey`/`setStoredKey` per provider) | `src/plugins/assistant/providers.ts` | shipped (#133); the key store #141 says to reuse, not fork |

So the *cloud* half is a wiring problem: the nodes exist, the write path exists (#126), the live override port exists (#169). What does not exist is the branch in the graph, the dials that switch it on, and the honest status readout that says *why* it is silent (no key, loading, connecting, playing). #141's definition of done names the trap this doc must not repeat: a partial build reproduces #137 (a capability in the bundle with no way to switch it on).

The maintainer's direction adds a second axis the issues do not cover: **in-browser** generation, and the *rule* that nothing heavy loads before it is needed. §4 prices the in-browser options; §5 turns the rule into a pattern.

## 2. Principles this design holds itself to

1. **A generator is a node like any other; its network or model is a host resource.** The `lyria` node fires-and-forgets; audio never enters the DAG; the engine sums into `masterGain` out of band. `midi-out` has the same shape. #141 established that no new abstraction is needed and that #101's `Source` is not the home (a source is an input; a generator is the mirror image). This doc keeps that.
2. **Static params are the build-time default; input ports are the live override.** Everything a player can change while playing arrives on a port, fed from `store-controls`, so nothing rebuilds the graph (which would reload both MediaPipe models to change a string).
3. **A capability nobody can find is not shipped.** Every switch in this design is a dial in `src/settings/dials.ts` (so it gets a panel control, a palette entry, a per-dial command and an AI tool surface for free) or a tool in `src/app/tools.ts`, with a structural guard that fails when its port is left unconnected (#147's template).
4. **Nothing heavy in the main chunk; nothing heavy loaded until asked for.** This is a rule, not a preference: a player who never enables the generative layer must never download the vendor SDK, a model checkpoint or a wasm runtime. §5.
5. **Every headless thing gets a fixture-replay test; every ears-only thing gets a line on #146.** No design claim here about how something *sounds* is treated as verified.

## 3. Where a generator sits in the DAG (and which of these earns a node)

The component model's promotion rule: a piece is a node only when something *outside* it must consume, tap/record or re-rate its output; otherwise it is an element inside a node. Applied to generation:

### 3a. `mapping` + `generate`: features steer a latent — **a node, build now**

The gesture is not a note; it is a *musical intention* expressed as a point in the generator's control space (prompt weights, density, brightness, tempo). This is `indirect-map` (role `mapping`) feeding `lyria` (roles `synth`, `generate`). It earns two nodes, not one, because the steering payload is exactly what the recorder should tap: a `generative-steer` NDJSON stream is the fixture a future in-browser generator replays against, and a `generate`-tagged edge is the one the replay harness must treat as non-reproducible.

**Latency shape.** A cloud stream has a fixed lead: `LyriaEngine` schedules two seconds ahead and Lyria wants steering updates at roughly 200 ms cadence (the node's `throttleSec`). So this branch can only ever be *conducting*, never *playing*: a hand movement changes the character of the music over the next musical phrase, not the next note. That is the right expectation to put in the UI copy and in the maintainer's ears test (#146).

**What the gestures mean is a live input.** #169 made `steerConfig` a port; §6 turns it into a dial and a set of *scalar* commands (`steer.strain.add` / `remove` / `bind`) so a vibe editor, the palette and the AI assistant all go through the one write path (#87) without ever emitting an object-typed command param (which Gemini's tool schema rejects).

### 3b. `music` + `generate`: accompaniment that follows — **a node, second**

An in-browser symbolic model (a 2-bar melody continuation, a drum groove, a harmoniser) consuming the *played* melody (`merge.params`, or the conductor's beat from #187's `transport` node) and emitting extra `synth-params` voices into `synth-merge`. It earns a node for the same reason the chord instruments do: its voices must be merged, muted, recorded and MIDI-routed like any other voices, and the melody it conditions on is already a port.

**Latency shape.** Symbolic inference is per-bar, not per-frame: the model is asked for the *next* bar while the current one plays, so the perceptual constraint is "have the next bar ready before the downbeat" (hundreds of ms), which MusicRNN-class models meet on WebGL. The bar clock must come from a musical prior, never from frame-to-onset timing (the #178 rule); this is the first consumer of #187's `transport`/`ictus` state outside conductor mode, which is why it is second.

**Cost.** ~12–18 MB of checkpoint on first enable plus ~300–400 kB gzip of library (§4). Acceptable *only* behind the lazy pattern with a progress readout, and only as an explicit per-instrument opt-in.

### 3c. A generated *timbre* — **not a node**

"A sound the AI made" is a `SoundId` in `src/music/sounds.ts` whose synthesis recipe is a decoded sample set instead of an oscillator stack. Nothing outside `webaudio-synth` needs to consume it, so it is an *element* of the synth (a lazily-decoded sample bank behind the sound registry), not a DAG node. It is deferred: the value is real (a "vocal pad the model made from your humming" is a lovely instrument), but it needs an audio-domain model, which §4 rules out client-side for now. The seam is already there (`SOUNDS` is `as const satisfies Record<…>`; a sound entry may carry a `load()` exactly like a recording format does).

### 3d. What is *not* proposed

- **No `generative` slot.** A slot needs two real interchangeable implementations a *player* chooses between. There is one cloud engine and zero in-browser ones today; a slot would be machinery for a hypothetical swap. The `GenerativeEngine` facade is the seam a second engine plugs into when it exists.
- **No new role.** `generate` already exists as a modifier tag and does the one job a role must do here: flag edges as non-reproducible for replay.
- **No port of the legacy `AiDjOverlayPanel`.** Its transport/volume/countdown is rebuilt small as a settings section (#147's MIDI section is the template); `VibeEditor` ports as the editor for the `steer.config` dial.

## 4. In-browser generation: what is realistic client-side

Measured on this machine (esbuild `--bundle --minify`, gzip; checkpoints summed from each `weights_manifest.json` as float32). Library gzip figures are what the *lazy chunk* would cost a player on first enable; the checkpoint is a second, larger download.

| Option | Library (raw / gzip) | Model / runtime download | Notes |
|---|---|---|---|
| **Lyria RealTime** via `@google/genai` (cloud) | 207 kB / 38 kB | none (stream) | Already a dependency. **Currently in the main chunk** (§5). BYO key, `v1alpha`, 48 kHz stereo PCM, ~2 s lead. |
| **Magenta.js MusicRNN** (`@magenta/music/es6/music_rnn`) | 1,251 kB / 298 kB | `basic_rnn` 12.7 MB, `melody_rnn` 13.6 MB, `drum_kit_rnn` 11.6 MB | Melody/drum continuation, per-bar. Pins `@tensorflow/tfjs ^2.7`; thoremin ships 4.22 → a second TF.js copy unless aliased. |
| **Magenta.js MusicVAE / GrooVAE** (`…/music_vae`) | 1,263 kB / 302 kB | `mel_2bar_small` 17.3 MB, `drums_2bar_lokl_small` 18.1 MB, `groovae_2bar_humanize` 16.0 MB, `trio_4bar` 68.9 MB, `mel_4bar_med_q2` 133.8 MB | Latent-space *interpolation* is the gesture-friendly operation (a 2-D hand position → a point between two saved bars). GrooVAE humanises a quantised drum pattern: the natural partner for #187's beat. |
| **Magenta.js Coconet** (`coconet/bach`) | (core 1,681 kB / 404 kB) | 2.2 MB | Four-part harmonisation of a melody. The smallest useful checkpoint by far. |
| **ONNX Runtime Web** (`onnxruntime-web`) | 403 kB / 110 kB (`/webgpu` entry 113 kB / 37 kB) | wasm 13.6 MB (simd-threaded), 15.7 MB (jspi), 27.1 MB (jsep/WebGPU) | A runtime, not a model. No small steerable symbolic music model is published in ONNX; exporting one is a research task, not an integration. Threaded builds need COOP/COEP headers the static host does not set. |
| **transformers.js** (`@huggingface/transformers`) | 9.5 MB unpacked | MusicGen-small ≥ 300 MB | Audio-domain generation; seconds per clip. Not a live instrument. |
| **Rule-based / tiny** (Tonal.js harmoniser, Euclidean/Markov rhythm, n-gram melody) | < 20 kB | none | Already have `tonal` as a dependency. Not "AI" in the maintainer's sense, but the honest baseline any model must beat, and the right *fallback* voice when a model has not loaded yet. |

<!-- RESEARCH: §4 continues with the literature-backed assessment; filled from the research memo. -->

## 5. Lazy loading as a catalogued pattern

### 5a. What the three existing sites already agree on

Reading `webcam_hands.ts` / `webcam_face.ts` (MediaPipe), `recording/formats.ts` + `flac.ts` (encoders) and `midi_out.ts` + `midi_engine.ts` (WEBMIDI.js) side by side, the same skeleton appears three times, each time hand-written:

| Concern | webcam-face | recording formats | midi-out |
|---|---|---|---|
| The heavy import is a `() => import(...)` reached only on demand | `import('@mediapipe/tasks-vision')` inside `init`/gate | `load()` per format entry | `_defaultFactory` → `import('./midi_engine')` → `import('webmidi')` |
| The host can inject the implementation (tests, custom hosts) | — | — | `ctx.resources.createMidiSink` |
| Capability gate before importing anything | `faceMapping !== 'none'` / Lab demand | format selected | `webMidiSupported()` |
| A load resolving after disable/dispose is discarded, not attached | `loadGen` / `disposed` | — | `disposed || !wantSink || openedPort !== wantPort` |
| A failed load is not re-hammered every tick, but a re-enable retries | `failedGen === loadGen` | per call | `attempted` reset on disable |
| Status reported on a port, never thrown from `process()` | `status: {phase: idle/loading/ready/error}` | `blob: null` + `error` | `status: {phase: off/unsupported/connecting/ready/no-ports/denied/error, message}` |
| UI renders the phase honestly | face chip | "Couldn't encode FLAC" toast | `MidiControls` status dot + message; "not supported here" instead of a dead toggle |

Three copies of the same state machine is exactly the point at which a pattern is *extracted*, not invented. The bugs #147's review found (a superseded-port open attaching a sink; a disabled node keeping a port) are bugs in this state machine, and the next heavy node would re-make them.

### 5b. The pattern, in three parts

**1. Loader seam.** A heavy node never imports its implementation statically. It declares a *factory* type, reads it from `ctx.resources.<name>` when the host injects one (tests, headless runs, custom hosts), and otherwise uses a module-level default whose body is a dynamic `import()` of a browser-only sibling module (`midi_engine.ts`, `lyria_engine.ts`). The sibling module is the *only* static importer of the vendor library, and nothing in `src/nodes/index.ts` or `src/nodes/browser.ts` re-exports it (that is how `@google/genai` ended up in the main chunk today). Loading is *requested* synchronously from `process()` and never awaited there.

**2. Status port.** Every heavy node emits a `status` output whose `phase` comes from one shared vocabulary:

| phase | meaning |
|---|---|
| `off` | not requested (the enable input is false); nothing loaded, nothing held |
| `unavailable` | requested, but this host cannot provide it; `reason` says why (`unsupported`, `no-key`, `denied`, `no-ports`, …) — actionable, distinct from an error |
| `loading` | the implementation (SDK / model / wasm) is being fetched; `progress` 0..1 when the loader can report it |
| `ready` | loaded and usable (for a session-shaped resource: connected) |
| `active` | doing its job right now (playing, sending notes, detecting) |
| `error` | the load or the resource failed; `message` is human-readable; a later re-enable retries |

Node-specific phases (`connecting`, `no-ports`, `denied`) map onto these as `loading` / `unavailable` + `reason`, so one UI component can render any heavy node. Existing nodes keep their exact status shapes (they are guarded by tests); the shared type is what *new* nodes and the shared readout speak, and the two existing shapes are adapted in the readout, not rewritten in the node.

**3. UI affordance.** A shared status readout (dot colour + pulse per phase + message), rendered wherever the node's enable control lives, plus the rule the MIDI panel already follows: where the capability cannot exist on this host, render the reason instead of a dead toggle. A `loading` phase with progress renders a progress bar; a multi-megabyte download is *labelled as such* before the player triggers it (the FLAC/ffmpeg rule from `recording-v2.md`).

### 5c. The module: `src/lazy/`

`src/lazy/resource.ts` (pure, Node-safe, no DAG import) provides the state machine the three sites hand-roll, with a synchronous API a `process()` can call every tick:

```ts
const res = lazyResource<T>({
  load: (signal) => Promise<LoadResult<T>>,   // the seam: injected factory or default import()
  unload: (t) => void,                         // close/dispose the held thing
});
res.request();        // idle → loading (once; a failed load is not retried until release())
res.release();        // drop the held thing; a load still in flight is discarded on arrival
res.current();        // T | null, synchronously
res.status();         // { phase, reason?, message, progress? } — the status port's value
res.dispose();        // release + never accept a late arrival
```

It encodes, with tests, the five behaviours the table in §5a lists: request-once, discard-late-arrivals, no-rehammer, retry-on-re-enable, never-throw. `lazyResource` is what the `lyria` node adopts first (PR 3), and what #186's body model and #187's conductor assets are asked to adopt rather than each inventing a fourth copy. `midi-out` and `webcam-face` stay as they are until a change touches them (both are mutation-verified; a refactor for its own sake is not in scope).

`src/lazy/status.ts` exports the shared `LoadPhase` / `LoadStatus` types; `src/app/LoadStatusReadout.tsx` is the shared dot + message component (the MIDI panel's `PHASE_DOT` generalised).

`docs/design/lazy-loading.md` is the catalogued pattern's own short page (the rule, the three parts, the adopters table), linked from `component-model.md`.

### 5d. What it buys, measured

- `@google/genai` leaves the main chunk: −207 kB raw / −38 kB gzip for every player, including the ones who never enable the layer (main chunk today: 1,193 kB / 338 kB gzip).
- A future in-browser generator's ~300 kB gzip of library and 12–18 MB of checkpoint are downloaded by *no one* who did not turn it on, and the download shows a progress bar rather than a frozen instrument.

## 6. The #141 headless build, concretely

Vocabulary decision: the play/pause dial is **`steer.playing`**, not "transport". `transport` is already the conductor's beat-clock node (#180/#187); reusing the word for an unrelated on/off would collide in the catalog, the palette and the docs.

### 6a. Dials (the SSOT, `src/settings/dials.ts`)

| dial | type | default | facet | notes |
|---|---|---|---|---|
| `steer.enabled` | boolean | false | AI | The layer exists in this instrument. Off → nothing loads, nothing connects. |
| `steer.playing` | boolean | false | AI | The transport. **Never auto-resumes on reload** (healed to false in `mergeControls`): a paid cloud stream must not start because a tab was reopened. |
| `steer.volume` | number 0..1 | 0.7 | AI | The generative bus gain (`LyriaEngine.out`), live via a `volume` input port. |
| `steer.config` | structured (`SteerConfigSchema` from `indirect_map.ts`, 1:1) | one starter strain | AI | What the gestures mean. Whole-object dial like `handMap`; edited by scalar domain commands (6c). |

`SettingsSchema.steer` (defaulted) → persist v10 → v11 (additive, healed by `mergeControls`, `normalizeLayer` default-fills pre-existing instruments automatically; regression test as in #147).

### 6b. Ports and the branch (`store-controls` → `graph.ts`)

`store-controls` gains `steerEnabled` (boolean), `steerPlaying` (boolean), `steerVolume` (number), `steerConfig` (`steer-config`). The `lyria` node gains `enabled` (boolean, default false), `volume` (number), and a `status` output (§5b), and drops the string `state` output. The branch:

```
feat.features ──▶ imap.features        ui.steerConfig ──▶ imap.steerConfig
faceFeat.features ─▶ imap.face          imap.steer ──────▶ gen.steer
ui.steerEnabled ─▶ gen.enabled          ui.steerPlaying ─▶ gen.playing
ui.steerVolume ──▶ gen.volume
```

Additive fan-out off edges that already exist; no existing edge changes; `?slot.source=synthetic-hands` drives the whole branch headlessly. The structural guard in `test/app_graph.test.ts` asserts `gen.enabled`, `gen.playing` and `imap.steerConfig` are connected (the #147 template, mutation-verified by deleting the edge).

### 6c. Engine construction without touching `useEngine`

`lyria`'s loader seam: `ctx.resources.createGenerativeEngine?: (opts: { audioContext, destination }) => Promise<LoadResult<GenerativeEngine>>`. The default factory (in `lyria.ts`, one line) dynamically imports `./lyria_engine`, which reads the Gemini key through the assistant's `getStoredKey('google')` and returns `{ resource: null, reason: 'no-key' }` when absent. So the host injects nothing new: `audioContext` and `masterGain` are already on `resources`, and the key store is the one #133 shipped. Tests inject a mock factory exactly as `midi-out` tests inject `createMidiSink`.

### 6d. The write path for a collection of prompts

`steer.config.strains` is an array, and `commands/paths.ts` derives `dial.setIn` leaves only for objects and records, so an editor cannot address one strain by path, and the generic verbs refuse whole-object values (an object-typed param breaks Gemini's tool schema). The design that keeps #87's invariant: a `commands/steer.ts` module of **scalar-parameter domain commands** (`steer.strain.add {text}`, `steer.strain.remove {text}`, `steer.strain.bind {text, source, hand, feature}`, `steer.strain.range {text, weightMin, weightMax}`, `steer.dial.bind {name, …}`) that each compute the next config and write it through `applyDialSet('steer.config', next)`, the same validated path `dial.setIn` uses. The vibe editor, the palette and the AI assistant all dispatch these; "add a strain called warm pads driven by my left hand's openness" becomes a real assistant capability rather than a JSON blob.

### 6e. Surface

A **Generative** section in the settings panel (the MIDI section is the template): enable, play/pause, volume, the shared status readout (`no-key` renders a key prompt reusing the assistant's provider-key UI; `loading`/`ready`/`active` render the dot), and the strain editor beneath. Clicks from a cold load: Tap to play → Settings → Generative → enable, play. Reachability is pinned by a jsdom test the way `test/midi_panel.test.tsx` pins MIDI.

## 7. Method (so the numbers can be re-measured)

- Library sizes: `esbuild --bundle --minify --format=esm --platform=browser` of an entry importing the package, then `gzip -c | wc -c`. `@google/genai` measured at the repo's installed version; `@magenta/music@1.23.1` and `onnxruntime-web@1.29.0` installed into a scratch directory outside the repo.
- Checkpoints: `weights_manifest.json` from `storage.googleapis.com/magentadata/js/checkpoints/<name>/`, weight shapes summed as float32.
- App chunks: `npm run build` on main at `e207ad0`; sizes from Vite's report.
- Registry: `npm view <pkg> version dist.unpackedSize` (2026-09-09).

## 8. PR plan

| PR | Scope | Verification | Needs the maintainer? |
|---|---|---|---|
| **1** | This document. | — | no |
| **2** | `src/lazy/` (`resource.ts`, `status.ts`) + tests + `docs/design/lazy-loading.md`; `LoadStatusReadout`. Announced to the sibling sessions (#186, #187) for adoption. | unit tests for the five behaviours; typecheck; build | no |
| **3** | `lyria` node on the pattern: `enabled`/`volume` inputs, `status` port, `createGenerativeEngine` seam with the lazy default, key via the assistant's store; `LyriaEngine` dropped from `browser.ts`'s static exports. `npm run catalog`. | mock-factory tests (no-key, loading discarded on disable, re-enable retries, never throws); measured main-chunk delta | no |
| **4** | The switch: `steer.*` dials + schema + persist bump + `mergeControls` heal + `normalizeLayer` regression test; `store-controls` ports; the graph branch + structural guard; `commands/steer.ts`; the Generative settings section + jsdom reachability test. `npm run catalog`. | fixture replay with `synthetic-hands` through `imap → gen` against a mock engine; guard mutation check | no |
| **5** (optional, after 4) | `VibeEditor` ported onto the `steer.strain.*` commands. | jsdom | no |
| **live** | First construction of `LyriaEngine` streams PCM; steering feel; the fire-and-forget never stalls the tick loop. | ears + a Gemini key | **yes** → #146 B-list, #168 item 6 |

Out of scope, recorded so nobody re-derives it: the in-browser `music`+`generate` node (§3b) is a separate epic that should start after #187's beat state exists to condition on; a generated timbre (§3c) waits for a client-side audio model worth its download.

<!-- REFERENCES: appended from the research memo. -->
