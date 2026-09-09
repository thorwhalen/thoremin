# Generative AI inside instruments, and lazy loading as a catalogued pattern

> Status: design record (2026-09-09), issue [#188](https://github.com/thorwhalen/thoremin/issues/188). Answers two maintainer directions at once: *"start more seriously thinking of AI aspects (music gen) that can be incorporated in some instruments"* and *"think of lazy loading — only what is needed, when it's needed."* Builds on [`component-model.md`](component-model.md) (roles, elements, slots), [#141](https://github.com/thorwhalen/thoremin/issues/141) (the gesture-steered generative layer) and [#169](https://github.com/thorwhalen/thoremin/pull/169) (its headless prerequisite). Every cost below was **measured on 2026-09-09** with the repo's own toolchain unless marked otherwise; the method is in §7.

## TL;DR

- **Generative AI belongs *inside* an instrument, not beside it as a DJ.** The legacy AI-DJ (retired to `?engine=legacy` by #128) is slider-steered; the thing worth building is a generator whose *latent* (prompt weights, density, brightness) is a mapping target for the same hand/face features that play notes. That is exactly the `indirect-map → lyria` pair already in the registry, and it costs nothing new architecturally: it is an additive parallel branch in `graph.ts`, off by default.
- **Three places a generator can sit in the DAG, and each one earns a node only under a specific test** (§3): as a `mapping`+`generate` node (features steer a latent: **build now**, cloud-backed), as a `music`+`generate` node (accompaniment following what is played or conducted: **feasible in-browser at ~12–18 MB per checkpoint**, second), and as a *sound* (a generated timbre: **not a node**, a lazily-decoded sample set behind the existing `sounds.ts` registry, later).
- **In-browser generation is realistic only for small symbolic models.** Magenta.js MusicRNN/MusicVAE/GrooVAE checkpoints are 5.6–18.5 MB (Piano Genie 1.2 MB) and the library is ~300–400 kB gzipped per model family, but it pins TensorFlow.js 2.x while thoremin ships 4.22 (two TF.js registries that fight), and the project is frozen. ONNX Runtime Web is 110 kB of JS plus a 13.6–27.1 MB wasm, and no small steerable music model ships in ONNX today. Audio-domain generation in the browser (MusicGen-class) is out of budget for a live instrument. Details and the recommendation in §4.
- **Lazy loading becomes one catalogued pattern**, extracted from the three sites that already do it by hand (`webcam_hands.ts` / `webcam_face.ts`, `recording/formats.ts`, `midi_out.ts`): a **loader seam** (a host-injectable factory whose default is a dynamic `import()`), a **status port** (one `phase` vocabulary for every heavy node), and a **UI affordance** (the status-dot readout the MIDI panel already renders). §5 specifies it; `src/lazy/` implements it; every heavy node adopts it. Adopting it for `lyria` moved the main chunk from 1,193 kB to 929 kB (338 kB to 286 kB gzip), measured before/after: `@google/genai` and what it drags in now live in an on-demand chunk fetched only when the layer is enabled.
- **The PR plan is five small PRs** (§8). Everything that needs a Gemini key or ears is listed for the maintainer under #146 / #168, not blocked on.

## 1. What exists, and what the maintainer actually asked for

Two things are in the tree today, on opposite sides of the app split:

| Piece | Where | State |
|---|---|---|
| `GenerativeEngine` facade + `WeightedPrompt`/`GenerativeConfig`/`GenerativeSteer` types | `src/nodes/output/generative.ts` | types only, Node-safe |
| `lyria` node (lifecycle, throttled + diffed steering, tempo reset) | `src/nodes/output/lyria.ts` | in `CORE_NODES`, mock-tested, never run in a browser |
| `LyriaEngine` (WebSocket session, 48 kHz stereo PCM scheduled ahead through Web Audio) | `src/nodes/output/lyria_engine.ts` | type-checked, **never constructed** |
| `indirect-map` (hand/face features → weighted prompts + config dials, with a live `steerConfig` port since #169) | `src/nodes/mapping/indirect_map.ts` | fixture-tested; 11/11 mutants caught per #169's review comment |
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

- **No `generative` slot, and `indirect-map` does not fill the `mapping` slot.** #141 already settled the second half: `indirect-map` deliberately fails the mapping contract (its output is a `generative-steer`, not `synth-params`), so it is an *additive branch*, not a swap. As for a slot of its own: the governance rule says a slot *may* surface a dropdown at two or more real candidates, and a slot can exist with one (the `mapping` slot does), but a slot is machinery for choosing among candidates and there is exactly one engine, behind a facade that is already the seam a second one plugs into. Building the slot before the second candidate is the hypothetical-swap machinery the rule exists to stop.
- **No new role.** `generate` already exists as a modifier tag and does the one job a role must do here: flag edges as non-reproducible for replay.
- **No port of the legacy `AiDjOverlayPanel`.** Its transport/volume/countdown is rebuilt small as a settings section (#147's MIDI section is the template); `VibeEditor` ports as the editor for the `steer.config` dial.

## 4. In-browser generation: what is realistic client-side

Measured on this machine (esbuild `--bundle --minify`, gzip; checkpoints as bytes on the wire, from an HTTP HEAD of every shard in each `weights_manifest.json`). Library gzip figures are what the *lazy chunk* would cost a player on first enable; the checkpoint is a second, larger download.

| Option | Library (raw / gzip) | Model / runtime download | Notes |
|---|---|---|---|
| **Lyria RealTime** via `@google/genai` (cloud) | 207 kB / 38 kB | none (stream) | Already a dependency. **Currently in the main chunk** (§5). BYO key, `v1alpha`, 48 kHz stereo PCM, ~2 s lead. |
| **Magenta.js MusicRNN** (`@magenta/music/es6/music_rnn`) | 1,251 kB / 298 kB | `basic_rnn` 13.0 MB, `melody_rnn` 13.9 MB, `drum_kit_rnn` 11.9 MB, `chord_pitches_improv` 5.6 MB | Melody/drum continuation, per-bar. Pins `@tensorflow/tfjs ^2.7`; thoremin ships 4.22, and the ES6 bundles deliberately do not bundle TF.js, so a host on 4.x gets two TF.js registries that fight (`magenta-js` #628, #356) [10]. |
| **Magenta.js MusicVAE / GrooVAE** (`…/music_vae`) | 1,263 kB / 302 kB | `mel_2bar_small` 17.7 MB, `drums_2bar_lokl_small` 18.5 MB, `groovae_2bar_humanize` 16.3 MB, `tap2drum_2bar` 16.3 MB, `mel_4bar_med_q2` 68.5 MB | Latent-space *interpolation* is the gesture-friendly operation (a 2-D hand position → a point between two saved bars). GrooVAE humanises a quantised drum pattern and `tap2drum` turns a tapped rhythm into a groove: the natural partners for #187's beat. |
| **Magenta.js Piano Genie** (`…/piano_genie`) | (core + 0.25 MB) | **1.2 MB** | Eight buttons → plausible 88-key piano, in real time. The smallest neural model here, and exactly the "few gesture axes → many notes" shape a theremin has. |
| **Magenta.js Coconet** (`coconet/bach`) | (core 1,681 kB / 404 kB) | 2.2 MB | Four-part harmonisation of a melody. The smallest useful checkpoint by far. |
| **ONNX Runtime Web** (`onnxruntime-web`) | 403 kB / 110 kB (`/webgpu` entry 113 kB / 37 kB) | wasm 13.6 MB (simd-threaded), 15.7 MB (jspi), 27.1 MB (jsep/WebGPU) [25] | A runtime, not a model. No small steerable symbolic music model is published in ONNX; exporting one is a research task, not an integration. Threaded builds need COOP/COEP headers the static host does not set. |
| **transformers.js** (`@huggingface/transformers`) | 9.5 MB unpacked | MusicGen-small ≈ 656 MB (q8) | Audio-domain generation; seconds per clip. Not a live instrument. |
| **Rule-based / tiny** (Tonal.js harmoniser, Euclidean/Markov rhythm, n-gram melody) | < 20 kB | none | Already have `tonal` as a dependency. Not "AI" in the maintainer's sense, but the honest baseline any model must beat, and the right *fallback* voice when a model has not loaded yet. |

### 4a. The cloud option is real, experimental, and drifting

Lyria RealTime (`models/lyria-realtime-exp`) is the only streaming, continuously steerable *audio* generator with a public API. It is still labelled experimental (model page last updated 2026-04-28) [2]; the docs (2026-09-04) specify weighted prompts, `bpm` 60–200, `density`/`brightness` 0–1, `guidance` 0–6, `temperature` 0–3, and a control-to-effect latency of at most two seconds, with `bpm`/`scale` changes needing a context reset [1][2]. Two things have moved since `LyriaEngine` was written: the official client samples now pass `apiVersion: "v1beta"` while the WebSocket endpoint is still the `v1alpha` path [1][3], and the SDK builds the URL from whatever version the client is given [8]. The pricing page (2026-09-08) lists Lyria 3 / 3.5 per song and has **no row at all** for RealTime, so its quota and cost posture is unverified [4]. Lyria 3 and 3.5 (2026) are offline song generators, not successors to the stream [5]; Google's own camera-steered demo (Lyria Camera, 2025-12) steers RealTime through Gemini *captions*, not a continuous latent [7]. Consequence for PR 3: treat the vendor call as the one thing that *will* have drifted, keep it behind the facade, and confirm the version string at first construction (a #146 item).

### 4b. Magenta.js: small, useful, and frozen

`@magenta/music` 1.23.1 was published 2021-11-01; the JS repo's last non-bot commit is 2024-03-25 and the Python parent was archived 2026-01-06 [9][10][12]. Its checkpoints are the only ready-made, permissively licensed (Apache-2.0) symbolic models small enough to lazy-load: 5.6–18.5 MB for the useful ones, 1.2 MB for Piano Genie [11]. Measured on a CPU backend in Node (no WebGL), a 2-bar MusicRNN continuation takes 0.75–1.55 s and a MusicVAE 2-bar sample 0.45–0.63 s; the browser WebGL backend is normally several times faster, so "a few hundred milliseconds per two bars" is the defensible estimate, and either way it is a *per-bar, ahead-of-time* budget, never per-frame. The blocking cost is the dependency: it pins TF.js 2.7 and thoremin ships 4.22, and the ES6 bundles leave TF.js to the host, so the honest options are to pin the whole app back to 2.x (no), or to load Magenta with its own TF.js in a separate bundle (a second ~1 MB runtime, feasible behind the lazy pattern but ugly), or to re-export the two or three small checkpoints to a runtime we already have (TF.js 4 Graph models, an engineering task with no published artefact) [10]. This is why §3b is *second*, not now.

### 4c. Magenta RealTime 2 is the thing to watch, not to ship

Magenta RealTime v1 (2025-06) showed the shape at 800 M parameters and two-second chunks [13][46]; MRT2 (2026-06-04) is open-weights (Apache-2.0 code, CC-BY-4.0 weights) with a 230 M-parameter `small` variant, 40 ms frames, about 200 ms control latency, and frame-aligned MIDI conditioning [14][15][16]. Officially it streams in real time on Apple Silicon only [14]. A community browser port exists (jax-js on WebGPU for the language model, onnxruntime-web wasm for the codec, ~1.7 GB fp32 fetched on first use, COOP/COEP required) but claims generation, not sustained real time [17][18]; an iPhone Neural Engine port reaches ~14 ms per 40 ms frame, which bounds what a laptop WebGPU might do [19], and a bit-exact PyTorch port is the natural base for a future transformers.js export that does not yet exist [20]. Nothing here is a static-site deliverable in 2026: the download is three orders of magnitude over the lazy budget and the host would need cross-origin isolation headers. The `GenerativeEngine` facade is where it plugs in the day that changes; nothing else in this design would move.

### 4d. ONNX Runtime Web and transformers.js: runtimes without a model

`onnxruntime-web` 1.29.0 ships 13.6–27.1 MB wasm binaries (a custom op-reduced build gets to ~8 MB [25]); multithreading needs `crossOriginIsolated` (COOP + COEP headers the static host does not set), WebGPU is in every major browser since early 2026, WebNN is still behind a flag, and Safari 26 had a severe JSEP regression closed only in late 2025 [21][22][23][24][26][47]. No permissively licensed symbolic music model under 50 MB is published in ONNX: the smallest (`musiclang-4k-onnx`, 56 MB quantized) is GPL-3.0; the rest are 0.5–8 GB, and exporting Magenta's own Music Transformer is an open request rather than an artefact [30][31][32][33][34]. `@huggingface/transformers` 4.2 can run MusicGen-small, but that is a 656 MB, non-commercial, offline text-to-audio model with a known WebGPU defect [27][28][29]. So "an ONNX model" is not an integration but a training or distillation project; the design records that so the next session does not re-survey it.

### 4e. The tiny baseline is not nothing

`tonal` (already a dependency, 43 kB minified) gives scales, chords, progressions and voicings [36]; Euclidean rhythms are 15 kB [37]; a first-order Markov melody (the shape Tone.js once shipped as `CtrlMarkov` [38]) or a rule-based harmoniser is a few hundred lines, and Tone.js itself (345 kB) buys nothing over the raw Web Audio the synth already uses [35]. Rule-based accompaniment is microseconds per event, needs no download, and is the *fallback voice* the `music`+`generate` node should play while a checkpoint downloads, so that enabling the layer is never a silent wait. It is also the baseline a 15 MB model has to audibly beat before its download is justified; recording the comparison is a #146 item, not an assumption.

### 4f. What the literature says about gesture-steered generation

The canonical browser "conducting" demo (Google's Semi-Conductor, 2018) drives tempo, volume and instrumentation of a *fixed* score from pose [39]; MediaPipe-hands controllers in the browser drive Web Audio, MIDI and OSC, not a generator [40]; recent gesture-to-music work (GestAlt at NIME 2025, Gesture2Music 2025–26) maps landmark sequences to note-level events with adaptive or learned models at ~30 ms inference, still triggering predefined samples rather than a generative audio model [41][42]. CHI 2026's design-space survey of live music agents is the right citation for positioning [43]. Nobody has published MediaPipe hands steering Lyria RealTime or Magenta RT in a browser; the closest thing in Google's own material is "mapping human actions to musical controls" with MIDI sliders [6][44], and the closest hobby project drives Web Audio chords from two hands with no model at all [45]. That is the space #141 sits in, and the reason its feel is an ears question (#146) and not a literature question.

### 4g. Recommendation

1. **Build the cloud branch now** (§3a, §6): it is wiring, the nodes exist, and it is the only steerable audio generator available. It ships behind the lazy pattern, BYO key, off by default, and honest about its two-second lead.
2. **Do not add Magenta.js as a dependency today.** Its TF.js pin is a runtime conflict, not a version nit. Prototype §3b as a *headless* experiment (Node, the fixtures, `tap2drum`/`groovae_2bar` conditioned on #187's beat) before any bundle decision; the fixture-replay harness makes that cheap.
3. **Keep the `GenerativeEngine` facade vendor-shaped and the `music`+`generate` node contract symbolic** (voices in, voices out), so MRT2-in-the-browser or an in-house small model plugs in without touching the graph.
4. **Ship the tiny baseline with §3b**, not after it: rule-based accompaniment is the fallback voice and the control.

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
  load: (ctx) => Promise<LoadResult<T>>,   // the seam: the injected factory, or the default import()
  unload: (t) => void,                     // close/dispose the held thing (also a late arrival)
  label: 'generative engine',
});
res.want(enabled);    // the per-tick line: request() when enabled, release() otherwise
res.request();        // off → loading, once; a failed load is not retried until release()
res.release();        // drop the held thing; a load still in flight is discarded on arrival
res.current();        // T | null, synchronously
res.status();         // { phase, message, reason?, progress? } — the status port's value
res.dispose();        // release, and refuse every later arrival
```

It encodes, with tests, the five behaviours the table in §5a lists: request-once, discard-late-arrivals, no-rehammer, retry-on-re-enable, never-throw. `lazyResource` is what the `lyria` node adopts first (PR 3), and what #186's body model and #187's conductor assets are asked to adopt rather than each inventing a fourth copy. `midi-out` and `webcam-face` stay as they are until a change touches them (both are mutation-verified; a refactor for its own sake is not in scope).

`src/lazy/status.ts` exports the shared `LoadPhase` / `LoadStatus` types; `src/app/LoadStatusReadout.tsx` is the shared dot + message component (the MIDI panel's `PHASE_DOT` generalised).

`docs/design/lazy-loading.md` is the catalogued pattern's own short page (the rule, the three parts, the adopters table), linked from `component-model.md`.

### 5d. What it buys, measured

- `@google/genai` leaves the main chunk. Before PR 3 the `GoogleGenAI` identifier is in the main chunk (observed by grep on the built asset); after it, the main chunk is 929 kB / 286 kB gzip against 1,193 kB / 338 kB before (−263 kB raw, −52 kB gzip, more than the SDK's standalone 207 kB because of what it pulls in), and the SDK lives in a 269 kB / 54 kB chunk that only `lyria_engine.ts` and the frozen legacy app import, on demand.
- A future in-browser generator's ~300 kB gzip of library and 12–18 MB of checkpoint are downloaded by *no one* who did not turn it on, and the download shows a progress bar rather than a frozen instrument.

## 6. The #141 headless build, concretely

Vocabulary decision: the play/pause dial is **`steer.playing`**, not "transport". `transport` is already the conductor's beat-clock node (#180/#187); reusing the word for an unrelated on/off would collide in the catalog, the palette and the docs.

### 6a. Dials (the SSOT, `src/settings/dials.ts`)

| dial | type | default | facet | notes |
|---|---|---|---|---|
| `steer.enabled` | boolean | false | AI | The layer exists in this instrument. Off → nothing loads, nothing connects. |
| *(not a dial)* `steerPlaying` | transient store flag | false | — | The transport. **Deliberately not a dial**, on the `muted` precedent (#91): a dial rides saved instruments, and an instrument saved while playing would start a paid cloud stream on load; it would also flip the instrument dirty on every play/pause. It lives in the hot store un-persisted, is toggled by the panel button and a keyboard shortcut directly (as `m` toggles mute), and reaches the node through a `steerPlaying` port. Not a command, for the same reason `muted` is not one; recorded as the same deliberate exception. #141's ADR said "a dial"; this overrides it, and says so. |
| `steer.volume` | number 0..1 | 0.7 | AI | The generative bus gain (`LyriaEngine.out`), live via a `volume` input port. |
| `steer.config` | structured (`SteerConfigSchema` from `indirect_map.ts`, 1:1) | one starter strain | AI | What the gestures mean. Whole-object dial like `handMap`; edited by scalar domain commands (6c). |

`SettingsSchema.steer` (defaulted; `enabled`, `volume`, `config`) → persist v10 → v11 (additive, healed by `mergeControls`, `normalizeLayer` default-fills pre-existing instruments automatically; regression test as in #147). A persisted `steer.enabled: true` loads the SDK and constructs the engine on the next visit but connects nothing until the player presses play, so a reload costs bytes, never quota.

### 6b. Ports and the branch (`store-controls` → `graph.ts`)

`store-controls` gains `steerEnabled` (boolean), `steerPlaying` (boolean, from the transient flag), `steerVolume` (number), `steerConfig` (`steer-config`). The `lyria` node gains `enabled` (boolean, default false), `volume` (number), and a `status` output (§5b), and drops the string `state` output; the `GenerativeEngine` facade gains an optional `setVolume(gain)`, which a mock may omit. `test/lyria_node.test.ts` is rewritten against the factory seam (its old cases injected a pre-built engine and asserted the `state` string; injecting `resources.generativeEngine` stays supported). The branch:

```
feat.features ──▶ imap.features        ui.steerConfig ──▶ imap.steerConfig
faceFeat.features ─▶ imap.face          imap.steer ──────▶ gen.steer
ui.steerEnabled ─▶ gen.enabled          ui.steerPlaying ─▶ gen.playing
ui.steerVolume ──▶ gen.volume
```

Additive fan-out off edges that already exist; no existing edge changes; `?slot.source=synthetic-hands` drives the whole branch headlessly. The structural guard in `test/app_graph.test.ts` asserts `gen.enabled`, `gen.playing` and `imap.steerConfig` are connected (the #147 template, mutation-verified by deleting the edge).

### 6c. Engine construction without touching `useEngine`

`lyria`'s loader seam: `ctx.resources.createGenerativeEngine?: (opts: { audioContext, destination }) => Promise<LoadResult<GenerativeEngine>>`. The default factory (in `lyria.ts`, one line) dynamically imports `./lyria_engine`, which reads the Gemini key and returns `{ resource: null, reason: 'no-key' }` when absent. The key store is the one #133 shipped, **moved** to a neutral `src/keys/providerKeys.ts` (same storage keys, re-exported by the assistant's `providers.ts` so nothing there changes) rather than imported from `src/plugins`: the node library must not depend on a React plugin, and no firewall test guards that direction today. So the host injects nothing new: `audioContext` and `masterGain` are already on `resources`. Tests inject a mock factory exactly as `midi-out` tests inject `createMidiSink`. The engine module is the one place the vendor call lives, and it is the place §4a says has drifted (`v1alpha` → `v1beta` in the official samples): PR 3 aligns the client to the documented version and the first live construction confirms it (#146).

### 6d. The write path for a collection of prompts

`steer.config.strains` is an array, and `commands/paths.ts` derives `dial.setIn` leaves only for objects and records, so an editor cannot address one strain by path, and the generic verbs refuse whole-object values (an object-typed param breaks Gemini's tool schema). The design that keeps #87's invariant: a `commands/steer.ts` module of **scalar-parameter domain commands** (`steer.strain.add {text}`, `steer.strain.remove {text}`, `steer.strain.bind {text, source, hand, feature}`, `steer.strain.range {text, weightMin, weightMax}`, `steer.dial.bind {name, …}`) that each compute the next config and write it through `applyDialSet('steer.config', next)`, the same validated path `dial.setIn` uses. The vibe editor, the palette and the AI assistant all dispatch these; "add a strain called warm pads driven by my left hand's openness" becomes a real assistant capability rather than a JSON blob.

### 6e. Surface

A **Generative** section in the settings panel (the MIDI section is the template): enable, play/pause, volume, the shared status readout (`no-key` renders a key prompt reusing the assistant's provider-key UI; `loading`/`ready`/`active` render the dot), and the strain editor beneath. Clicks from a cold load: Tap to play → Settings → Generative → enable, play. Reachability is pinned by a jsdom test the way `test/midi_panel.test.tsx` pins MIDI.

This **deviates from #141's definition of done, item 5** ("an entry point in the shell's tools bar") on purpose. #141 predates the shipping rule's classification (`tools.ts` for things you use *on* the instrument, a dial for an *instrument parameter*); the generative layer is instrument identity, it lives in the preset, and the dial route is what gives it the panel control, palette entry, per-dial command and AI tool surface at once, exactly as MIDI got in #147. If the strain editor grows past a settings section, a tools-bar entry that opens it is a one-line registration then. Also different from the ADR: it put the dials lap first; here the dials, the ports and the branch land in one PR, because #169's own scope note is right that a dial with nothing in the graph to steer is the #137 trap.

## 7. Method (so the numbers can be re-measured)

- Library sizes: `esbuild --bundle --minify --format=esm --platform=browser` of an entry importing the package, then `gzip -c | wc -c`. `@google/genai` measured at the repo's installed version; `@magenta/music@1.23.1` and `onnxruntime-web@1.29.0` installed into a scratch directory outside the repo.
- Checkpoints: bytes on the wire, from an HTTP HEAD of every shard listed in each `weights_manifest.json` under `storage.googleapis.com/magentadata/js/checkpoints/<name>/` (a float32 sum of the declared shapes agrees for the RNN/VAE-small models and overstates the quantised `mel_4bar_med_q2`, which is why the wire figure is the one reported). Magenta CPU-backend latencies: Node v23, `@tensorflow/tfjs` 2.7.0, no WebGL.
- App chunks: `npm run build` on main at `e207ad0`; sizes from Vite's report.
- Registry: `npm view <pkg> version dist.unpackedSize` (2026-09-09).

## 8. PR plan

| PR | Scope | Verification | Needs the maintainer? |
|---|---|---|---|
| **1** | This document. | — | no |
| **2** | `src/lazy/` (`resource.ts`, `status.ts`) + tests + `docs/design/lazy-loading.md`; `LoadStatusReadout`. Announced to the sibling sessions (#186, #187) for adoption. | unit tests for the five behaviours; typecheck; build | no |
| **3** | `lyria` node on the pattern: `enabled`/`volume` inputs, `status` port, `createGenerativeEngine` seam with the lazy default, `setVolume` on the facade, the key store moved to `src/keys`; `LyriaEngine` dropped from `browser.ts`'s static exports; `test/lyria_node.test.ts` rewritten. `npm run catalog`. | mock-factory tests (no-key, loading discarded on disable, re-enable retries, never throws), a source-level guard that the registries never re-export the engine; measured main-chunk delta (§5d) | no |
| **4** | The switch: `steer.enabled` / `steer.volume` / `steerConfig` dials + schema + persist bump + `mergeControls` heal + `normalizeLayer` regression test; the transient `steerPlaying` flag (cleared when the layer is switched off or the engine is rebuilt, so a stale transport can never auto-start a stream); `store-controls` ports; the graph branch + structural guard; the Generative settings section + jsdom reachability test; the status bridge beside `reportMidi` in `useEngine.ts`; the transient-unavailable (`retry`) rule in `src/lazy` so a pasted key or a tap to play makes the layer come alive without toggling it. `npm run catalog`. | fixture replay with `synthetic-hands` through `imap → gen` against a mock engine; guard mutation check | no |
| **5** | `commands/steer.ts` — seven scalar-parameter verbs (`steer.strain.add` / `remove` / `rename` / `bind` / `range`, `steer.dial.set` / `remove`) writing the whole `steerConfig` through `applyDialSet` (§6d); the steering editor inside the Generative section on those verbs (the legacy `VibeEditor` rebuilt small); the `p` transport shortcut (a no-op while the layer is off, so it can never leave a stale flag); the starter strains promoted to the settings default so the editor always sees a complete config. | command unit tests, jsdom editor tests, the keymap test | no |
| **live** | First construction of `LyriaEngine` streams PCM; steering feel; the fire-and-forget never stalls the tick loop. | ears + a Gemini key | **yes** → #146 B-list, #168 item 6 |

Out of scope, recorded so nobody re-derives it: the in-browser `music`+`generate` node (§3b) is a separate epic that should start after #187's beat state exists to condition on; a generated timbre (§3c) waits for a client-side audio model worth its download.

## References

1. [Real-time music generation using Lyria RealTime — Gemini API docs (updated 2026-09-04)](https://ai.google.dev/gemini-api/docs/realtime-music-generation)
2. [Lyria RealTime experimental — model page (updated 2026-04-28)](https://ai.google.dev/gemini-api/docs/models/lyria-realtime-exp)
3. [Live Music API — WebSockets API reference (updated 2026-09-04)](https://ai.google.dev/api/live_music)
4. [Gemini API pricing (updated 2026-09-08)](https://ai.google.dev/gemini-api/docs/pricing)
5. [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)
6. [Introducing Lyria RealTime API — Google Magenta (2025-06-12)](https://magenta.withgoogle.com/lyria-realtime)
7. [Lyria Camera — Google Magenta (2025-12-03)](https://magenta.withgoogle.com/lyria-camera-announce)
8. [googleapis/js-genai — src/music.ts](https://github.com/googleapis/js-genai/blob/main/src/music.ts)
9. [@magenta/music on npm (1.23.1, 2021-11-01)](https://www.npmjs.com/package/@magenta/music)
10. [magenta-js/music README](https://github.com/magenta/magenta-js/blob/master/music/README.md)
11. [magenta-js checkpoints.json](https://github.com/magenta/magenta-js/blob/master/music/checkpoints/checkpoints.json)
12. [magenta/magenta (archived 2026-01-06)](https://github.com/magenta/magenta)
13. [Magenta RealTime: An Open-Weights Live Music Model (2025-06-20)](https://magenta.withgoogle.com/magenta-realtime)
14. [Magenta RealTime 2: Open & Local Live Music Models (2026-06-04)](https://magenta.withgoogle.com/magenta-realtime-2)
15. [magenta/magenta-realtime — README and MODEL.md](https://github.com/magenta/magenta-realtime)
16. [google/magenta-realtime-2 — Hugging Face](https://huggingface.co/google/magenta-realtime-2)
17. [blanchon/magenta-realtime-2-onnx — Hugging Face (2026-06-08)](https://huggingface.co/blanchon/magenta-realtime-2-onnx)
18. [blanchon/magenta-realtime-2-demo — in-browser Space](https://huggingface.co/spaces/blanchon/magenta-realtime-2-demo)
19. [mattmireles/magenta-realtime-2-iphone — Core ML port (2026-08-25)](https://huggingface.co/mattmireles/magenta-realtime-2-iphone)
20. [magenta-community/magenta-realtime-2-small — PyTorch port](https://huggingface.co/magenta-community/magenta-realtime-2-small)
21. [onnxruntime-web on npm (1.29.0, 2026-08-24)](https://www.npmjs.com/package/onnxruntime-web)
22. [ONNX Runtime Web: env flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
23. [ONNX Runtime Web: Using WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
24. [ONNX Runtime Web: Using WebNN](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)
25. [microsoft/onnxruntime discussion #24161 — WASM size with the WebGPU backend](https://github.com/microsoft/onnxruntime/discussions/24161)
26. [WebGPU hits critical mass: all major browsers now ship it (2026)](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)
27. [@huggingface/transformers on npm (4.2.0, 2026-04-22)](https://www.npmjs.com/package/@huggingface/transformers)
28. [Xenova/musicgen-small — Hugging Face](https://huggingface.co/Xenova/musicgen-small)
29. [transformers.js issue #1308 — WebGPU error running musicgen-small](https://github.com/huggingface/transformers.js/issues/1308)
30. [transformers.js issue #1223 — Music/Piano Transformer to ONNX](https://github.com/huggingface/transformers.js/issues/1223)
31. [musiclang/musiclang-4k-onnx — Hugging Face](https://huggingface.co/musiclang/musiclang-4k-onnx)
32. [skytnt/midi-model — Hugging Face](https://huggingface.co/skytnt/midi-model)
33. [stanford-crfm/music-small-800k (Anticipatory Music Transformer)](https://huggingface.co/stanford-crfm/music-small-800k)
34. [loubb/aria-medium-base — Hugging Face](https://huggingface.co/loubb/aria-medium-base)
35. [Tone.js](https://github.com/tonejs/tone.js/)
36. [tonal on npm (6.4.3)](https://www.npmjs.com/package/tonal)
37. [euclidean-rhythms on npm](https://www.npmjs.com/package/euclidean-rhythms)
38. [Tone.CtrlMarkov (Tone.js r13 docs)](https://tonejs.github.io/docs/r13/CtrlMarkov)
39. [googlecreativelab/semi-conductor (2018)](https://github.com/googlecreativelab/semi-conductor)
40. [An Accessible, Browser-Based Gestural Controller for Web Audio, MIDI, and OSC — Computer Music Journal 47(3), 2023](https://direct.mit.edu/comj/article/47/3/6/125444/An-Accessible-Browser-Based-Gestural-Controller)
41. [Adaptation and Perceived Creative Autonomy in Gesture-Controlled Interactive Music (GestAlt) — NIME 2025](https://nime.org/proc/nime2025_55/index.html)
42. [Gesture2Music: A Low-Latency Real-Time Framework for Continuous Gesture-Driven Music Generation — arXiv 2511.00793](https://arxiv.org/abs/2511.00793)
43. [A Design Space for Live Music Agents — arXiv 2602.05064 (CHI 2026)](https://arxiv.org/abs/2602.05064)
44. [Jump to play: Building with Gemini & MediaPipe — Google Developers Blog (2026-03-24)](https://developers.googleblog.com/jump-to-play-building-with-gemini-mediapipe/)
45. [JayusAsterion/hand-music-controller](https://github.com/JayusAsterion/hand-music-controller)
46. [Google DeepMind — Lyria RealTime](https://deepmind.google/models/lyria/lyria-realtime/)
47. [microsoft/onnxruntime issue #26827 — Safari/WebKit 26 in JSEP mode](https://github.com/microsoft/onnxruntime/issues/26827)
