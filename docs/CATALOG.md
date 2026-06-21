# Thoremin — Capabilities Manual

_Auto-generated from the node registry (`scripts/gen_catalog.ts`). Do not edit by hand._

Thoremin turns live sensor streams (webcam hand gestures, facial expressions, computer keyboard, later MIDI) into a live audiovisual stream — musical audio plus the captured video with overlaid guides. You build instruments by wiring small, typed **nodes** into a dataflow graph (DAG): inputs → features → mapping → music-logic → synthesis/generation → output. Every edge can be recorded and replayed.

The mapping layer spans a spectrum: **direct** (a gesture *is* a note/parameter — e.g. hand position → scale-snapped pitch) through **indirect** (a gesture expresses a high-level idea — e.g. openness → musical density steering an AI model), including **conductor** mode (direct a fixed piece's tempo and dynamics).

This page catalogs the engine's building blocks — every node and how they connect. Some already run in the deployed app; wiring the full graph into the live instrument is in progress.

## Example pipelines

- **Theremin (direct)** — `webcam-hands → hand-features → voice-mapping → webaudio-synth ( + canvas-overlay)`  
  Hand x → scale-snapped pitch, y → volume. Two hands = two voices.
- **Gesture → harmony** — `hand-features → pick('right.x') → progression → chord → webaudio-synth`  
  Hand position walks an in-key chord progression.
- **Conductor** — `control → performance → transport → score → webaudio-synth`  
  A control signal directs a fixed piece's tempo + dynamics (accelerando/crescendo…).
- **Indirect / AI (gesture or expression)** — `hand-features / face-features → indirect-map → lyria`  
  Openness/smile/etc. steer weighted prompts + dials of Google Lyria RealTime.
- **Discrete triggers** — `hand-features → gesture-classifier → (events)`  
  Fist/open/pinch poses emit enter/exit events to trigger scale changes, stabs, mutes.

## Nodes (21)

### Inputs (sources)
_Where signals enter the graph._

#### `webcam-hands` — Webcam Hands
MediaPipe hand landmark detection from a webcam video element.

- **in:** —
- **out:** hands:hands-frame
- **params:** modelType (enum(lite | full)="full"), maxHands (number=2)

#### `keyboard-source` — Keyboard Source
Global keyboard input → held / pressed / released key events.

- **in:** —
- **out:** held:string[], pressed:string[], released:string[]
- **params:** preventDefaultKeys (array=["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "])

#### `store-controls` — UI Controls
Reads the live UI control store → scale + instrument port values.

- **in:** —
- **out:** scaleRight:number[], scaleLeft:number[], instrumentRight:instrument, instrumentLeft:instrument
- **params:** —

#### `synthetic-hands` — Synthetic Hands
Camera-free animated hand landmark source for tests & demos.

- **in:** —
- **out:** hands:hands-frame
- **params:** width (number=640), height (number=480), sweepPeriod (number=4), opennessPeriod (number=3), pinchPeriod (number=2.5), hands (enum(right | left | both)="right"), yNorm (number=0.5), scale (number=80)

#### `replay-source` — Replay Source
Emits a recorded value stream, one value per tick.

- **in:** —
- **out:** value
- **params:** values (array=[]), loop (boolean=false)

### Features
_Raw sensor data → normalized control signals._

#### `hand-features` — Hand Features
Landmarks → normalized per-hand position, openness, pinch.

- **in:** hands:hands-frame
- **out:** features:hand-features
- **params:** mirrorX (boolean=true), mirrorHandedness (boolean=true), opennessMin (number=1.3), opennessMax (number=2.3), pinchTouch (number=0.25), pinchApart (number=1.2)

#### `face-features` — Face Features
Face blendshapes → normalized expression controls (smile, mouthOpen, brow, blink).

- **in:** face:face-frame
- **out:** features:face-features
- **params:** gain (number=1), smoothing (number=0)

#### `gesture-classifier` — Gesture Classifier
Hand features → discrete poses (fist/open/pinch) + enter/exit edge events.

- **in:** features:hand-features
- **out:** poses:poses, events:gesture-events
- **params:** pinchOn (number=0.6), pinchOff (number=0.45), fistBelow (number=0.25), openAbove (number=0.6), hysteresis (number=0.05)

### Mapping (direct ↔ indirect)
_Features → engine parameters, across the expression spectrum._

#### `voice-mapping` — Voice Mapping
Hand features → tonal synth parameters (x→pitch w/ scale snap, y→volume).

- **in:** features:hand-features, magnetism:number, octaveShift:number, mute:boolean, scaleRight:number[], scaleLeft:number[], instrumentRight:instrument, instrumentLeft:instrument
- **out:** params:synth-params
- **params:** magnetism (number=0.8), maxGain (number=0.5), opennessGatesGain (boolean=false), opennessControlsBrightness (boolean=true), right (object={"scale":{"root":0,"type":"major","octaves":2,"baseOctave":3},"instrument":"sine"}), left (object={"scale":{"root":0,"type":"major","octaves":2,"baseOctave":3},"instrument":"triangle"})

#### `indirect-map` — Indirect Map
Gesture features → weighted prompts + config dials (steers a generative engine).

- **in:** features:hand-features, face:face-features
- **out:** steer:generative-steer
- **params:** strains (array=[]), dials (array=[]), smoothing (number=0), throttleSec (number=0)

#### `keyboard-control` — Keyboard Control
Keyboard key-press events → octave shift, magnetism, mute.

- **in:** pressed:string[]
- **out:** octaveShift:number, magnetism:number, mute:boolean
- **params:** magnetismStep (number=0.1), magnetismStart (number=0.8), octaveMin (number=-2), octaveMax (number=2)

#### `pick` — Pick
Extract a scalar from a structured input by dotted path (e.g. right.x).

- **in:** in:any
- **out:** value:number
- **params:** path (string=""), default (number=0)

#### `one-euro` — One-Euro Filter
Adaptive jitter smoothing for a noisy control value (smooth at rest, responsive when fast).

- **in:** value:number
- **out:** value:number
- **params:** minCutoff (number=1), beta (number=0.01), dCutoff (number=1), fallbackDt (number=0.016666666666666666)

### Music logic (tonal guidance)
_Harmony kept in-key._

#### `chord` — Chord
Chord symbol (e.g. Cmaj7) → voiced synth params (one voice per chord tone).

- **in:** chord:chord-symbol, gain:number
- **out:** params:synth-params
- **params:** baseOctave (number=4), maxVoices (number=4), instrument (enum(sine | triangle | square | sawtooth | warmPad | glass | bell | organ | voice | softLead | strings | flute | brass | choir)="sine")

#### `progression` — Progression
Roman-numeral progression in a key + position (0..1) → current chord symbol.

- **in:** position:number
- **out:** chord:chord-symbol, index:number
- **params:** key (string="C"), romanNumerals (array=["I","IV","V","vi"])

### Conductor mode
_Direct a fixed piece with gesture (tempo + dynamics)._

#### `transport` — Transport
Beat clock: integrates BPM over time into a running beat position.

- **in:** bpm:number
- **out:** beat:number
- **params:** startBeat (number=0)

#### `score` — Score
An immutable piece performed live: beat + velocityScale → sounding synth voices.

- **in:** beat:number, velocityScale:number
- **out:** params:synth-params
- **params:** notes (array=[]), loopBeats (number=8), baseGain (number=0.4), instrument (enum(sine | triangle | square | sawtooth | warmPad | glass | bell | organ | voice | softLead | strings | flute | brass | choir)="triangle")

#### `performance` — Performance
Control signal → tempo (bpm) + dynamics (velocityScale), with optional humanization.

- **in:** control:number
- **out:** bpm:number, velocityScale:number
- **params:** bpmMin (number=60), bpmMax (number=160), dynMin (number=0.4), dynMax (number=1), humanizeBpm (number=0), humanizeVel (number=0)

### Synthesis & generation
_Make sound — direct synthesis or steered AI music._

#### `webaudio-synth` — Web Audio Synth
Renders synth params to instrument-preset voices (browser only).

- **in:** params:synth-params
- **out:** —
- **params:** freqGlide (number=0.03), gainGlide (number=0.08)

#### `lyria` — Lyria Generative
Steers a generative engine (Lyria RealTime) from weighted prompts + config dials.

- **in:** steer:generative-steer, playing:boolean
- **out:** state:string
- **params:** throttleSec (number=0.2)

### Output
_Audio + the captured video with overlaid guides._

#### `canvas-overlay` — Canvas Overlay
Draws mirrored video + landmarks + control markers + HUD.

- **in:** hands:hands-frame, features:hand-features
- **out:** —
- **params:** showLandmarks (boolean=true), showVideo (boolean=true), videoAlpha (number=0.35)

