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

## Nodes (25)

### Inputs (sources)
_Where signals enter the graph._

#### `webcam-hands` — Webcam Hands
MediaPipe hand landmark detection from a webcam video element.

- **roles:** source
- **in:** —
- **out:** hands:hands-frame
- **params:** modelType (enum(lite | full)="full"), maxHands (number=2)

#### `webcam-face` — Webcam Face
MediaPipe FaceLandmarker blendshapes from the shared webcam (lazy-loaded, off by default).

- **roles:** source
- **in:** —
- **out:** face:face-frame, status:face-status
- **params:** delegate (enum(GPU | CPU)="GPU")

#### `keyboard-source` — Keyboard Source
Global keyboard input → held / pressed / released key events.

- **roles:** source
- **in:** —
- **out:** held:string[], pressed:string[], released:string[]
- **params:** preventDefaultKeys (array=["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "])

#### `store-controls` — UI Controls
Reads the live UI control store → scale + instrument + overlay port values.

- **roles:** source, control
- **in:** —
- **out:** scaleRight:number[], scaleLeft:number[], instrumentRight:instrument, instrumentLeft:instrument, overlay:overlay-config, rightSpec:scale-spec, faceMapping:face-mapping, chordConfig:chord-config
- **params:** —

#### `synthetic-hands` — Synthetic Hands
Camera-free animated hand landmark source for tests & demos.

- **roles:** source
- **in:** —
- **out:** hands:hands-frame
- **params:** width (number=640), height (number=480), sweepPeriod (number=4), opennessPeriod (number=3), pinchPeriod (number=2.5), hands (enum(right | left | both)="right"), yNorm (number=0.5), scale (number=80)

#### `replay-source` — Replay Source
Emits a recorded value stream, one value per tick.

- **roles:** source
- **in:** —
- **out:** value
- **params:** values (array=[]), loop (boolean=false)

### Features
_Raw sensor data → normalized control signals._

#### `hand-features` — Hand Features
Landmarks → normalized per-hand position, openness, pinch.

- **roles:** feature
- **in:** hands:hands-frame
- **out:** features:hand-features
- **params:** mirrorX (boolean=true), mirrorHandedness (boolean=true), opennessMin (number=1.3), opennessMax (number=2.3), pinchTouch (number=0.25), pinchApart (number=1.2)

#### `face-features` — Face Features
Face blendshapes → normalized expression controls (smile, mouthOpen, brow, blink).

- **roles:** feature
- **in:** face:face-frame
- **out:** features:face-features
- **params:** gain (number=1), smoothing (number=0)

#### `face-expression` — Face Expression
Face blendshapes → softmax over 7 expressions (happy/sad/angry/surprised/fearful/disgusted/neutral) with smoothing + hysteresis.

- **roles:** feature
- **in:** face:face-frame
- **out:** expression:face-expression
- **params:** smoothing (number=0.4), temperature (number=0.12), holdMargin (number=0.06)

#### `gesture-classifier` — Gesture Classifier
Hand features → discrete poses (fist/open/pinch) + enter/exit edge events.

- **roles:** feature
- **in:** features:hand-features
- **out:** poses:poses, events:gesture-events
- **params:** pinchOn (number=0.6), pinchOff (number=0.45), fistBelow (number=0.25), openAbove (number=0.6), hysteresis (number=0.05)

### Mapping (direct ↔ indirect)
_Features → engine parameters, across the expression spectrum._

#### `voice-mapping` — Voice Mapping
Hand features → tonal synth parameters (x→pitch w/ scale snap, y→volume).

- **roles:** mapping
- **in:** features:hand-features, magnetism:number, octaveShift:number, mute:boolean, scaleRight:number[], scaleLeft:number[], instrumentRight:instrument, instrumentLeft:instrument, face:face-features
- **out:** params:synth-params
- **params:** magnetism (number=0.8), maxGain (number=0.5), opennessGatesGain (boolean=false), opennessControlsBrightness (boolean=true), pinchControlsVibrato (boolean=true), faceControlsExpression (boolean=true), panByPosition (boolean=true), panSpread (number=0.5), right (object={"scale":{"root":0,"type":"major","octaves":2,"baseOctave":3},"instrument":"sine"}), left (object={"scale":{"root":0,"type":"major","octaves":2,"baseOctave":3},"instrument":"triangle"})

#### `indirect-map` — Indirect Map
Gesture features → weighted prompts + config dials (steers a generative engine).

- **roles:** mapping
- **in:** features:hand-features, face:face-features
- **out:** steer:generative-steer
- **params:** strains (array=[]), dials (array=[]), smoothing (number=0), throttleSec (number=0)

#### `keyboard-control` — Keyboard Control
Keyboard key-press events → octave shift, magnetism, mute.

- **roles:** mapping, control
- **in:** pressed:string[]
- **out:** octaveShift:number, magnetism:number, mute:boolean
- **params:** magnetismStep (number=0.1), magnetismStart (number=0.8), octaveMin (number=-2), octaveMax (number=2)

#### `pick` — Pick
Extract a scalar from a structured input by dotted path (e.g. right.x).

- **roles:** mapping
- **in:** in:any
- **out:** value:number
- **params:** path (string=""), default (number=0)

#### `one-euro` — One-Euro Filter
Adaptive jitter smoothing for a noisy control value (smooth at rest, responsive when fast).

- **roles:** mapping
- **in:** value:number
- **out:** value:number
- **params:** minCutoff (number=1), beta (number=0.01), dCutoff (number=1), fallbackDt (number=0.016666666666666666)

#### `synth-merge` — Synth Merge
Union two synth-params voice streams into one (e.g. hand voices + face-chord voices).

- **roles:** mapping
- **in:** a:synth-params, b:synth-params
- **out:** params:synth-params
- **params:** —

### Music logic (tonal guidance)
_Harmony kept in-key._

#### `chord` — Chord
Chord symbol (e.g. Cmaj7) → voiced synth params (one voice per chord tone).

- **roles:** music
- **in:** chord:chord-symbol, gain:number
- **out:** params:synth-params
- **params:** baseOctave (number=4), maxVoices (number=4), instrument (enum(sine | triangle | square | sawtooth | warmPad | glass | bell | organ | voice | softLead | strings | flute | brass | choir)="sine")

#### `progression` — Progression
Roman-numeral progression in a key + position (0..1) → current chord symbol.

- **roles:** music
- **in:** position:number
- **out:** chord:chord-symbol, index:number
- **params:** key (string="C"), romanNumerals (array=["I","IV","V","vi"])

#### `expression-chord` — Expression Chord
Facial expression → a voiced, rendered diatonic chord on the current seven-note scale (active only in face "chord" mode).

- **roles:** music
- **in:** expression:face-expression, spec:scale-spec, faceMapping:face-mapping, octaveShift:number, chordConfig:chord-config
- **out:** params:synth-params, triad:number[]
- **params:** gain (number=0.22), instrument (enum(sine | triangle | square | sawtooth | warmPad | glass | bell | organ | voice | softLead | strings | flute | brass | choir)="triangle"), voicing (enum(spread | bassTriad | close | shell | power)="spread"), rendering (enum(sustained | strum | arpUp | arpDown | arpUpDown | pulse | alberti)="sustained"), bpm (number=100)

### Conductor mode
_Direct a fixed piece with gesture (tempo + dynamics)._

#### `transport` — Transport
Beat clock: integrates BPM over time into a running beat position.

- **roles:** music
- **in:** bpm:number
- **out:** beat:number
- **params:** startBeat (number=0)

#### `score` — Score
An immutable piece performed live: beat + velocityScale → sounding synth voices.

- **roles:** music
- **in:** beat:number, velocityScale:number
- **out:** params:synth-params
- **params:** notes (array=[]), loopBeats (number=8), baseGain (number=0.4), instrument (enum(sine | triangle | square | sawtooth | warmPad | glass | bell | organ | voice | softLead | strings | flute | brass | choir)="triangle")

#### `performance` — Performance
Control signal → tempo (bpm) + dynamics (velocityScale), with optional humanization.

- **roles:** music
- **in:** control:number
- **out:** bpm:number, velocityScale:number
- **params:** bpmMin (number=60), bpmMax (number=160), dynMin (number=0.4), dynMax (number=1), humanizeBpm (number=0), humanizeVel (number=0)

### Synthesis & generation
_Make sound — direct synthesis or steered AI music._

#### `webaudio-synth` — Web Audio Synth
Renders synth params to instrument-preset voices (browser only).

- **roles:** synth
- **in:** params:synth-params
- **out:** —
- **params:** freqGlide (number=0.03), gainGlide (number=0.08)

#### `lyria` — Lyria Generative
Steers a generative engine (Lyria RealTime) from weighted prompts + config dials.

- **roles:** synth, generate
- **in:** steer:generative-steer, playing:boolean
- **out:** state:string
- **params:** throttleSec (number=0.2)

### Output
_Audio + the captured video with overlaid guides._

#### `canvas-overlay` — Canvas Overlay
Mirrored video + composable overlay elements (guides, landmarks, markers).

- **roles:** overlay
- **in:** hands:hands-frame, features:hand-features, params:synth-params, scale:number[], scaleLeft:number[], chord:number[], faceFrame:face-frame, expression:face-expression, octaveShift:number, overlayConfig:overlay-config
- **out:** —
- **params:** video (object={}), scaleGuide (object={}), chordGuide (object={}), indexGuide (object={}), landmarks (object={}), markers (object={}), faceLandmarks (object={}), faceExpression (object={}), timbreLevels (object={})

