# DAG Node Catalog

Every node declares typed ports + a Zod params schema. **Pure** nodes are
Node-safe (no DOM/audio) and unit-tested headlessly; **browser** nodes touch
DOM/audio/webgl only inside `init`/`process` and are registered by the app
shell, not the test registry.

Build a registry with `createCoreRegistry()` (pure nodes) or `createAppRegistry()`
(pure + browser), then construct an `Engine(graphSpec, registry)`.

## Sources (input layer)

| Node `type` | Pure? | Outputs | Params | Purpose |
|-------------|-------|---------|--------|---------|
| `synthetic-hands` | ✅ | `hands: HandsFrame` | width, height, sweepPeriod, opennessPeriod, pinchPeriod, hands(`right`/`left`/`both`), yNorm, scale | Camera-free animated hand source for tests/demos/fixtures. |
| `replay-source` | ✅ | `value` | values[], loop | Emits a recorded value stream, one per tick — stand-in for an expensive upstream subgraph. |
| `webcam-hands` | browser | `hands: HandsFrame` | modelType(`lite`/`full`), maxHands | MediaPipe Hands on a `<video>` (lazy-loads TF.js); async detection cached per tick. |
| `keyboard-source` | browser | `held`, `pressed`, `released` (string[]) | preventDefaultKeys | Global keyboard → key-state + edge events. |
| `store-controls` | (Node-safe) | `scaleRight`, `scaleLeft` (number[]), `instrumentRight`, `instrumentLeft` | — | Bridges the live UI control store into the graph (reads `ctx.resources.controls`). |

## Features (feature layer)

| Node `type` | Pure? | Inputs | Outputs | Purpose |
|-------------|-------|--------|---------|---------|
| `hand-features` | ✅ | `hands: HandsFrame` | `features: HandFeatures` | Landmarks → per-hand normalized `{present, x, y, openness, pinch}`. openness/pinch are scaled by per-hand size for camera-distance invariance. |
| `face-features` | ✅ | `face: FaceFrame` | `features: FaceFeatures` | 52 blendshapes → normalized expression controls `{present, smile, mouthOpen, browRaise, browFurrow, eyeBlink}`, with gain + smoothing. Tested against the `video_face_expressions` fixture. (Browser `webcam-face` source feeds it; M4 wiring.) |

## Mapping (mapping layer — the direct↔indirect spectrum)

| Node `type` | Pure? | Inputs | Outputs | Purpose |
|-------------|-------|--------|---------|---------|
| `voice-mapping` | ✅ | `features`; live overrides: `magnetism`, `octaveShift`, `mute`, `scaleRight`, `scaleLeft`, `instrumentRight`, `instrumentLeft` | `params: SynthParams` | **Direct** mapping: x→pitch (scale-snapped by magnetism), y→volume. Two voices (0=right, 1=left). |
| `keyboard-control` | ✅ | `pressed: string[]` | `octaveShift`, `magnetism`, `mute` | Interprets key presses (arrows, `m`) into musical control values. |
| `indirect-map` | ✅ | `features` (hand), `face` (expressions) | `steer: GenerativeSteer` | **Indirect** mapping: hand features AND/OR face expressions → weighted text prompts + config dials (density/brightness/bpm), with optional smoothing + throttle. Each strain/dial picks its `source` (`hand`/`face`) + `feature`. Steers a generative engine. |

## Music-logic (tonal guidance — Tonal.js)

| Node `type` | Pure? | Inputs | Outputs | Purpose |
|-------------|-------|--------|---------|---------|
| `chord` | ✅ | `chord` (symbol, e.g. "Cmaj7"), `gain` | `params: SynthParams` | Voices a chord symbol into one synth voice per chord tone (stacked ascending from `baseOctave`), so it drives `webaudio-synth` directly. Lets you *express harmony*. |
| `progression` | ✅ | `position` (0..1) | `chord` (symbol), `index` | Holds a diatonic progression (Roman numerals in a `key`, correct qualities via `Key.majorKey().triads`) and selects the current chord from a continuous position — keeps harmony in-key while the player moves freely. Pair with `chord`: gesture → position → chord → notes. |

## Synthesis / output

| Node `type` | Pure? | Inputs | Outputs | Purpose |
|-------------|-------|--------|---------|---------|
| `webaudio-synth` | browser | `params: SynthParams` | — | One oscillator+gain voice per `SynthParams` voice, smoothed ramps. Uses `ctx.resources.audioContext` + `masterGain`; silent no-op until the host wires audio. |
| `lyria` | ✅ (node) | `steer: GenerativeSteer`, `playing: boolean` | `state: string` | Drives a generative engine (Lyria RealTime) — lifecycle + throttled/diffed steer + tempo-reset. The engine is injected via `ctx.resources.generativeEngine` (the browser-only `LyriaEngine` implements the `GenerativeEngine` facade in `src/nodes/output/`). The node logic is unit-tested with a mock engine. |
| `canvas-overlay` | browser | `hands`, `features` | — | Draws mirrored video + landmark dots + control markers (openness=ring, pinch=fill) + feature HUD onto `ctx.resources.canvas`. |

## Domain types (`src/nodes/domain.ts`)

- `Keypoint {x,y,z?,name?}`, `Hand {handedness, keypoints[]}`, `HandsFrame {width,height,hands[]}` — MediaPipe Hands 21-landmark layout (indices in `LM`).
- `SingleHandFeatures {present, x, y, openness, pinch}` (all 0..1); `HandFeatures {left, right}`.
- `FaceFrame {present, blendshapes: Record<string,number>}` (52 MediaPipe blendshapes); `FaceFeatures {present, smile, mouthOpen, browRaise, browFurrow, eyeBlink}` (all 0..1).
- `VoiceParams {id, present, freq, gain, instrument}`; `SynthParams {voices[]}`.
- `makeHandKeypoints(spec)` builds a plausible 21-point hand for synthetic data/tests.

## Planned nodes (see ROADMAP)

`webcam-face` (browser FaceLandmarker source), `pose-features`, `gesture-classifier`
(discrete events), `voicing` (smarter voice-leading), `score` + `performance`
(conductor mode), `midi-in`/`midi-out` (WEBMIDI.js), signal conditioners
(one-euro filter, hysteresis, debounce), and a small adapter to feed a scalar
feature (e.g. hand x) into `progression.position`.
