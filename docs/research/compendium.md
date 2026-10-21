# thoremin: a research compendium

*What the project is trying to do, what it has built, what its research found, and what lies ahead. Written in October 2026 from the repository's own research notes, design records, issues and the literature they cite.*

## How to read this compendium

thoremin is a musical instrument that runs in a web browser and is played with the body: a webcam watches the player's face, hands and body, and the instrument turns what it sees into sound. This document collects the best of the project's research in one place, in the context of the project itself. It is meant to be read straight through or listened to, and also to be asked questions of, so every chapter explains its own terms and says where its facts come from.

The first two chapters say what thoremin is for and what works today. Chapters 3 to 14 are the research, one area per chapter: for each area, the question, what the literature says, what thoremin measured or built, what was decided and why, and what is still open. Chapter 15 is what lies ahead: the roadmap, the open questions and the decisions the owner still holds. A glossary and the numbered references close the document.

Three kinds of statement appear throughout, and the text says which is which. A *measurement* is a number the project obtained by running something, and it is reported with what it was measured on. A *decision* is a design choice the project made, reported with its reason. A *hypothesis* or *open question* is something not yet tested. Numbers in square brackets, such as [12], point to the references at the end: papers, datasets and libraries, and the repository files, issues and pull requests where each result is recorded. Issue and pull request numbers (written #613, for example) refer to the public tracker of the [thorwhalen/thoremin](https://github.com/thorwhalen/thoremin) repository unless another repository is named.

## Contents

1. What thoremin is trying to do
2. What works today
3. Latency and browser real time
4. Sub-frame timing, impact prediction and the air instruments
5. Rhythm and pulse from gesture: ictus, body pace and dance
6. Conducting, meter and the virtual orchestra
7. Face categorizers: carving personal categories, lighting and distance
8. Hand and body pose categories
9. Trainer mode
10. Sign language (ASL) recognition: models, datasets and licences
11. Fingering priors and sequence training
12. Datasets and licences
13. Harmony: chord layouts, relations, navigation and realization
14. Generative instruments
15. What lies ahead
16. Glossary

References

## 1. What thoremin is trying to do

### 1.1 The instrument in one paragraph

Thoremin is a musical instrument that lives in a web page. You open it, allow the camera, tap once so the browser agrees to make sound, and hold up a hand: left and right changes the pitch, up and down changes the loudness, and a second hand plays a second voice [1]. Beyond that first minute, the same page reads your face, the shape of each hand and the pose of your whole body, and turns any of them into music: an expression can play a chord, a fist can mute a voice, a mimed drum stroke can sound a drum, a fingerspelled letter can name a chord, and a beating arm can conduct an orchestra. The app is public [2], with a player guide beside it [3], and so is the source [4].

Everything happens on the player's device. Camera images are processed in the browser by MediaPipe, Google's on-device landmark models for hands, faces and bodies [5]; sound is synthesized by the browser's Web Audio system; the video and its guides are painted on a canvas. No server does any computation: the app is a static bundle of files [6], and the guide states the consequence plainly: "nothing you play is uploaded" [1]. The exceptions are features the player switches on with their own key, the assistant and the generative layer, which then talk directly to the provider the player chose.

### 1.2 Why: the theremin idea, extended to "anything to music"

The name plays on the theremin, the early electronic instrument played without touch, where one hand's distance from an antenna sets the pitch and the other hand sets the volume. The README calls thoremin "a generalized, software-defined theremin" with the motto "from anything to music": a real-time sonification platform (a system that turns live data streams into sound) mapping "live sensor streams (webcam hand gestures, facial expressions and head pose, computer keyboard, MIDI out)" to "a live audiovisual stream: musical audio plus the captured video overlaid with visual guides" [4]. It grew out of a sibling Python project called theremin [7].

The generalization runs in two directions. The first is the input. A camera that sees landmarks (named points on the body, such as the 21 points of a hand or the 478 points of a face mesh) gives far more than two distances, so the question becomes which of hundreds of features a person can control on purpose. The project built a measuring tool for exactly that, the Feature Lab, with live meters over more than 300 features, each marked easy, moderate or involuntary [8] (chapter 7). The second direction is the output: a gesture need not be a note. The design record calls this the direct-to-indirect mapping spectrum [9][10]. At the direct end a gesture is a note or a parameter: the hand's position becomes pitch, pulled toward the notes of a scale by a setting called magnetism (0 is a free glide, 1 a hard snap). In the middle a gesture names a musical intent ("this chord") and the music logic realizes it in key. At the indirect end a gesture is an idea that a system interprets: a conducting beat sets the tempo of a score, or a smile steers the brightness of an AI generator. The record states a hypothesis: beginners can start at the indirect end, where small gestures give large, always-musical results, and move toward the direct end as they gain skill, and the same graph supports both by swapping the mapping stage, which is why the architecture is a re-wirable graph [9]. Whether players actually travel that path is open; it has not been measured.

### 1.3 Who it is for

The documents imply several audiences. The first is anyone with a webcam: the default instrument, Pentatonic, snaps toward a five-note scale "so it is hard to play a wrong one" [11]. The second is musicians, who can play along with a MIDI keyboard or a guitar heard through the microphone, drive an external synthesizer over MIDI, or record a real instrument beside the air one [12][13][14]. The third is learners and teachers of harmony, for whom the chord maps name every move between chords and draw famous progressions as a trail to follow [15]. The fourth is people who want gestures of their own, which is what the personal categorizers of section 1.7 are for.

Accessibility is a natural angle for a touchless instrument, and the project's chord-layout research names accessible and gaze-controlled instruments as thoremin's nearest relatives. It cites Frid's review of 83 accessible digital musical instruments, which found touchless controllers to be one of ten interface types and vibrotactile feedback in only 14.5 % of instruments [16], and the EyeHarp, a gaze-played instrument whose authors avoided dwell because "dwell-time does not allow triggering events in tempo" [17][18]. Thoremin has not been evaluated with disabled players: accessibility is a design consideration, not a measured claim.

### 1.4 The instrument model: a typed dataflow graph

The core of thoremin is the engine all instruments run on. The README says it bluntly: "The DAG engine (this *is* the product)" [4]. A DAG, or directed acyclic graph, is a set of boxes (nodes) joined by one-way arrows (edges) with no loops. Each node is a small typed computation: it declares named input and output ports, each carrying a declared kind of data, and a parameter schema written in Zod, a TypeScript library for runtime-validated types. Each tick, the engine evaluates every node once in dependency order, so camera frames flow through feature extraction, mapping, music logic and synthesis to sound and pictures [19]. The engine deliberately mirrors meshed, a Python library for the same kind of graph [20], so a Python backend could later sit behind the same interfaces; the first version was decided to be frontend-only because the live loop must stay on the device for the lowest latency [21].

Two properties shape everything else. The engine has no dependence on the browser page, React or audio, so it runs in plain Node for fast tests. And every edge can be recorded and replayed, so any downstream stage can be tested later from a recording, with no camera [21][22].

The first description of the engine was "six layers" (input, feature, mapping, music logic, synthesis, output) [21]. A June 2026 design record retired it, observing that the production graph was never a stack: the hand stream fans out to both the feature extractor and the overlay, and the overlay draws from a source, a feature extractor, a mapping and the controls at once [23]. The decided vocabulary: a **component** is a node wired into the graph; a **role** is a descriptive tag it carries (source, feature, mapping, music, synth, overlay), possibly several; a **slot** is a named swap point that configuration fills with one of several compatible nodes. A role earns a swap menu only when at least two real implementations exist [23]. Three slots exist: the mapping, the hand source (webcam, a scripted synthetic hand, or a replayed recording) and the body source; `?slot.source=synthetic-hands` in the address runs the whole instrument with no camera [6]. A running engine can adopt a new graph in place, keeping every node whose identity and validated parameters are unchanged, so a swap does not reload the hand model or rebuild the audio [23].

### 1.5 Instruments as graphs: trunk, branches, seeds, extensions, slices

For the player, an **instrument** is a named saved set of every setting, and a **sound** is just a timbre, such as a bell or a pad [1]; the project treats the distinction as fixed vocabulary [6]. The instruments the app ships are **seeds**, the starting entries of the player's library, which the player can star, tag, edit and save under new names.

Underneath, an instrument is also wiring. A September 2026 ADR (architecture decision record) turned each instrument from a settings profile over one monolithic graph into a declared graph [24]. Its inventory found one graph of 32 nodes and 100 edges running every instrument, with nodes switched off by hand-written checks, and a real defect: the Air Flute, which needs mouth features for its breath gate, also drew the full face mesh and expression bars. The decision introduces a **trunk** (the nodes every instrument shares: hand source, hand features, the bridge from the settings store, the voice merge, the synthesizer, the overlay) and **branches** (named, reusable pieces of graph that attach to the trunk, declare their voices and overlay elements, and may require other branches). A pure function composes an instrument's branches into one graph, and switching instruments re-applies the graph in place, so the trunk keeps its models and audio. In the ADR's words, "branches say what runs, the layer says with which values".

The same ADR made thoremin a core with **extensions**. Before it, the Air Flute had touched 21 source files across 6 hand-listed registries. An extension is now one manifest that brings its nodes, branches, seeds, settings slice and editor panels, and a file, `extensions.json`, names which extensions a build ships [24]. A second ADR added **lazy extensions**, fetched only when a player first picks one of their instruments. The American Sign Language (ASL) reader was the first: it lives in its own public repository and only small stubs ship in the main bundle (chapter 10) [25][26]. The October 2026 refactor carried the idea to the built-in features: each is now a **vertical slice**, one directory holding everything from its nodes to its panels, contributing through the same contract as an external extension [27][28].

### 1.6 The command registry: one write path

Every change to a setting is a **command**: a named, typed, validated action in one registry, into which the settings panels, keyboard shortcuts, the Cmd/Ctrl-K palette, the AI assistant and bound hand gestures all dispatch. A command changes sound only by writing a **dial**, the project's word for one validated setting; the per-tick audio path is never a command [29]. The reasons are decided. Human-speed edits (a click, a keypress, an assistant turn) stay on one path with undo, while the real-time loop cannot even see the registry, so dispatch overhead never reaches the audio. And because dials were already Zod schemas, per-setting commands are generated, so every new setting gets a palette entry and an assistant tool for free. Tests enforce the boundary: an import firewall keeps commands away from the live store, graph and audio, and a syntax-tree analysis fails the suite if a panel control writes a setting directly. The one named exception is a slider being dragged, which writes directly because a validated write per pointer movement costs audible latency [29][6].

### 1.7 Personal categories and the trainer

Fixed categories such as "smile" or "fist" work for some players and fail for others, so thoremin lets the player teach their own. Your faces, Your hand shapes and Your poses share one workflow, called the **carve**: record a few seconds at rest, make your faces (or shapes, or poses) one after another, let the app group the holds, then choose how many groups, move holds between them, name them and test them; the saved model can then play chords or fire commands [30][31]. This is interactive machine learning for music in the tradition of Wekinator, where the performer gives examples, trains, and immediately hears and corrects the result [32][33]. The mapping record anticipated a trainable mapping in that style [9]; personal categorizers shipped under #330 [34].

The **trainer** is the older, guided form: a one-minute take built from cues (one request to the player) and routines (saved lists of cues) [35][36]. Both serve the vision of this chapter: the instrument adapts to the person's gestures rather than the reverse. Chapter 7 describes the carve, chapter 8 its hand and body forms, and chapter 9 the trainer.

## 2. What works today

This chapter describes thoremin as deployed in October 2026, with the player guide as the source of truth [1]. The guide has a page for each of the 38 seed instruments and each tool, and the test suite fails if one ships without its page [6]. This chapter groups the instruments by how they are played.

### 2.1 The instrument families

**Continuous, theremin-like instruments.** The field instruments descend from the theremin: the hands play the air, position for pitch and height for loudness, and each instrument changes what the fingers, face and open hand add. Pentatonic is the gentle default; Wrist Theremin follows the steadier wrist and mutes a hand closed into a fist [11][37]. Split Voices and Bell & Strings give each hand its own sound and range, and Open Air Pad makes the hand's openness the brightness of a pad. The finger instruments treat each finger as a control measured by how close its tip is to the thumb: in Finger FX each finger drives one effect (brightness, vibrato, pan, pitch bend), and any finger can be rerouted, continuously or as a trigger that fires at a threshold [38]. Finger Gate, Pitch Bender, Trigger Octaves and Finger Cues are variations, and Everything switches it all on at once.

The face plays chords here too. In Glass Bells and Pulse Organ an expression chooses which chord of the key sounds, as a rising arpeggio or a pulsing organ; in Head Chords the head's turn is cut into one slice per chord, the open mouth sounds it, and expression only colours it, so it can be played "with a straight face" [39][40]. Hand-shape Chords and Pose Chords play four chords from four hand shapes or body poses (chapter 8) [41][42].

**Chord instruments.** The largest family, the harmonic-layers extension [43], replaces "point at a note" with "point at a chord". The Chord Map lays a key's seven chords on the video as a honeycomb in which each chord's six neighbours are the other six; the left hand chooses a chord by holding its palm over it, each change is voice-led (every voice moving as little as it can), and the right hand plays a melody on the chord's notes [44]. Variants draw a trail of famous progressions with captions (Chord Map Paths), let the face colour the chord (Chord Map + Face), strum it (Chord Map Strum), or use a pentatonic scale's five chords (Pentatonic Map) [15][45]. The Chord Wheel puts the current chord in the middle and the moves away from it around it; the player pushes toward one and the wheel recentres [46]. Face Wheel, Wheel Walk, Tonnetz Wheel and Next-Chord Wheel change what the moves are and how they are chosen, and the wheel always names the tension model behind its numbers, because the models disagree [47][48][13]. Chapter 13 covers the layouts and the research behind them.

**Play-along instruments.** Play Along (MIDI) and Play Along (microphone) take their chords from a MIDI keyboard, in any inversion, or from a guitar, piano or recording heard through the microphone, counted only after about a quarter of a second so passing notes do not change it, while a hand plays over them (section 13.4). The MIDI one needs Chrome or Edge, since Safari has no Web MIDI [12][49].

**Air instruments.** The air instruments mime a real instrument at nothing. Air Drum estimates a stick tip from the hand and predicts the hit from how the stroke approaches, so it sounds when the player meant it rather than a camera frame late; stroke speed sets loudness, and pads on the video give regions their own drums [50]. Air Bass reads the distance between the hands as a position on the neck and sounds when the other hand plucks; Air Guitar plays an enrolled chord shape when the other hand strums; Air Flute chooses the note from the lifted fingers, with charts for seven wind instruments as a guide, and gates the sound with a mouth shape enrolled as "blowing" [51][52][53]. Here timing matters most; chapter 4 covers it.

**Body and conducting.** With body tracking on (the most expensive thing the app runs, so off until asked for [13]), the whole body can lead. Conduct the Chords loads a Haydn string quartet and plays the chord of the moment, voice-led and arpeggiated, on each beat the player gives, under the first violin's tune; the Body version reads the beating arm and the trunk's bounce, with a raised still arm to pause and a dropped arm to stop [54][55]. Both sit on the Conductor tool below; chapter 6 covers them.

**Sign instruments.** The lazy ASL extension provides four. ASL Viewer writes the recognised sign large on the video; ASL Chords, Sign Map and Sign Wheel let a fingerspelled letter from A to G choose the chord of the key with that root. J, Z and "sorry", which involve movement, are not read reliably yet, because too few openly licensed recordings show them [56][57]. Chapter 10 describes them and the recogniser.

**Generative.** Generation is a layer any instrument can switch on, not a seed. It steers Google's Lyria RealTime music model with the player's hand and face features; it is off by default, needs the player's own Google key, and "says plainly when it cannot connect" [13][58]. Chapter 14 covers it, along with the original slider-steered "AI-DJ", now frozen behind `?engine=legacy` [59].

### 2.2 The tools

Each instrument is edited in sections (sound, hand, face, overlay, and one per feature), and saving over a seed asks first [13][1]. The tools are things used on an instrument.

**Record** captures any of six streams into one take: the audio, the video with overlays, the raw camera, the overlays alone on transparency, every feature value, and the room's raw microphone, with a manifest placing each on a shared clock [14]. **Annotations** lets the player tap labels during a take to mark intervals and instants on the same clock, exported to Audacity, WebVTT, CSV, Praat or OTIO [60]. Together they are how the project collects its own data (chapter 12). **Feature Lab** shows every feature on one normalized scale and accepts user formulas (chapter 7) [8]. **Patcher** draws the instrument as currently wired, a box per node and a line per edge, showing each box's live outputs and settings; it can change settings but not yet rewire [61], the narrowed realization of a long-planned milestone [62][63].

**Your faces**, **Your hand shapes** and **Your poses** are the carving tools of section 1.7; a shape model can be the Air Guitar's chords and a pose model can start, hold and cut off the conductor [64][65]. **Gestures** binds a hand pose, or a group of a saved model, to a command, refusing commands that could lose work [66]. The **Trainer** runs guided takes from cues and routines [35].

**Conductor** plays a MIDI or MusicXML score through an optional sampled orchestra that follows the player's tempo and loudness, conducted by hand or body, or led by a dancer (chapters 5 and 6) [67][68]. **Song** plays an audio file at any tempo without changing pitch and can let its tempo follow the player's pulse [69]. **Commands** is the Cmd/Ctrl-K palette, with undo and redo of setting changes [70]. **Assistant** is a chat that operates the instrument through the same commands, so it "can only do things you could have done yourself"; it is bring-your-own-key, the key stays in the browser and goes only to the chosen provider, and anything that could lose work stops and asks [71].

The troubleshooting page records the platform's limits: Chrome and Edge work best, Safari lacks Web MIDI, Bluetooth audio adds noticeable delay, and `?probe=latency` shows where the time goes [72].

### 2.3 The architecture as built

The roadmap's engine milestones, M0 to M8, are done except for a full patcher (M6) and an optional Python feature service (M7); chapter 15 lists them [73].

The latest architectural work is the vertical-slices epic, closed on 20 October 2026 [28]. Its review found the extension system sound but the core hand-wired: the overlay was one 2,300-line node with 31 fixed ports that extensions could not extend, the conductor, body and song were spread over 58, 74 and 32 files, and contracts lived inside implementations [27]. It proposed five layers (kernel, contracts, shared pure libraries, feature slices, app shell) and twenty steps, all of which landed. The closing comment reports the architecture ratchet, a test whose numbers may only go down, measured [28]:

| Measure | Before | After |
|---|---|---|
| Node implementations imported only for their schemas | 43 | 0 |
| Hand-written ports on the settings bridge | 42 | 23 |
| Places where contributions are folded in | 15 | 2 |
| Import cycles | 7 | 0 |
| Largest file (lines) | 2,301 | 1,395 |

MIDI output, generation, the song, the Feature Lab, the trainer, body tracking and the conductor now each live in a slice directory listed in `extensions.json`, while air, harmony, faces, the patcher and ASL are packages. A "core alone" build with no extension must typecheck, pass the suite and build without any extension's node types, as its own CI job [6]. Every step that touched stored data went expand, migrate, contract under golden snapshots of each historical save version, and the written data stayed byte-identical [28]. Leftovers were filed [74][75][76]; splitting extensions into separate repositories waits on a decision about what to open-source [77].

### 2.4 Testing

Testing follows from the recordable edges. Re-running the pipeline from video is slow and non-deterministic, so the project taps every edge, saves what flowed as NDJSON (one JSON record per line: a tick, a time, a value) and tests downstream stages by replaying it, with no camera, GPU or audio [22]. The tiers are pure-function unit tests; node-from-replay tests, feeding a recorded stream into one node; headless graph tests, ticking the real production graph with synthetic or replayed sources to catch bad ports, fan-in and cycles; and rare end-to-end runs from real video, which produce the fixtures the other tiers replay. Fixtures cover hands, faces, head pose, body pose, dance and conducting, the last scored with standard beat-tracking metrics (chapter 12 lists their sources) [22]. The test directory holds more than 500 test files [78].

Some tests guard decisions rather than behaviour. **Golden** fixtures pin the composed default graph for each source slot, a conductor run, and each historical version of saved state [27]. The **write-path guard** of section 1.6 is one [29]. Reachability tests check that every tool and section can be reached, a rule adopted after two features shipped green but unreachable: "a feature nobody can find is not shipped" [6].

The **smoke** harness builds the production bundle, boots it in headless Chromium with the synthetic hand, and asserts that the engine ticks, audio runs with non-zero gain, voices sound, the overlay changes, no page error fires, and every tool and section opens from a cold load [22]. Its cost is measured: the main CI run averages 89 s and the smoke 84.5 s, about $5 a month together if the repository were private (it is public, so free). The smoke runs on pushes to main and on code-touching pull requests, a policy adopted after two regressions sat red on main across six merges while every pull request was green [79]. The stated gap: browser capture, the live audio loop and MIDI devices still need a real browser and a person [22][80].

### 2.5 What the research chapters cover

What works today rests on research carried out beside the code, and the rest of this compendium follows it. Chapter 3 covers latency and browser real time: the time from a movement to its sound. Chapter 4 covers sub-frame timing, impact prediction and the air instruments: sounding a strike that happens between two camera frames. Chapter 5 covers rhythm and pulse from gesture (ictus, body pace and dance), and chapter 6 conducting, meter and the virtual orchestra. Chapter 7 covers the face categorizers (carving personal categories, lighting and distance), chapter 8 hand and body pose categories, and chapter 9 trainer mode. Chapter 10 covers sign language (ASL) recognition, with its models, datasets and licences. Chapter 11 covers fingering priors and sequence training, chapter 12 datasets and licences, chapter 13 harmony (chord layouts, relations, navigation and realization), and chapter 14 generative instruments. Chapter 15 gathers what lies ahead.

## 3. Latency and browser real time

### 3.1 The question: where does the lag come from?

Latency here means the time from a movement of the hand to the sound it causes reaching the ear. A camera instrument builds it up in a chain: the camera delivers a frame, a model finds the hand in it, the instrument's graph maps landmarks to sound parameters, and the audio system turns those into air pressure. The project asked where exactly the lag is made, and whether rewriting thoremin in a faster language, Rust or WebAssembly, would cut it [81][82].

The answer was measured stage by stage on the built app with a latency probe (`?probe=latency`), on an M1 Max laptop in Chrome 153, with real hand footage fed through Chromium's fake camera device, so every stage from the browser onward is real:

| Stage | Measured mean |
|---|---|
| Waiting for the frame that contains the movement (30 fps) | 16.7 ms (0 to 33) |
| Capture stamp to the frame reaching inference | 4.1 ms |
| Hand landmark inference, GPU | 20.5 ms |
| The whole graph tick, overlay included | 0.27 ms |
| Parameter write to loudspeaker | 31.9 ms |
| Output compressor look-ahead | 6.0 ms |
| Pitch glide to half of a new pitch | 20.8 ms |

From movement to the pitch being half-way to its new value is about 100 ms, plus whatever the camera hardware adds before the browser sees the frame, which no web page can observe. Published glass-to-glass tests of webcams, which also include a frame wait and a display, measure 50 to 108 ms [83][84]. To size that stage on a given machine the probe has a strike test: the player slaps a table, the app beeps when it sees the hand stop, and the microphone hears both, so its own delay cancels.

The row that answers the language question is the fourth (measured): everything thoremin's own code does per tick costs 0.3 ms out of 100. The hand model is already Google's C++ compiled to WebAssembly plus GPU shaders [85], and its pure WebAssembly path on the CPU, which is what "rewrite it in a compiled language" amounts to, measured twice as slow as the GPU: 42.4 ms against 21. The lag lives in the camera, the model, the operating system's audio buffers and a deliberate smoothing constant, none of which a language change touches.

### 3.2 What a player notices

The literature gives a family of thresholds, depending on whether the player strikes or glides and whether the question is detection, annoyance or timing accuracy [86]. For the case most like thoremin, Mäki-Patola and Hämäläinen had 16 people play a real theremin through a variable delay: 10 and 20 ms went undetected and 30 ms was detected in 60 % of comparisons, so the just-noticeable difference lies between 20 and 30 ms, and slow vibrato hid more [87]. For striking the bar is lower: 20 ms, and 10 ms with 3 ms of jitter (event-to-event variation of the delay), were rated significantly worse than none on a percussive instrument [88], and the field's target is Wessel and Wright's 10 ms with under 1 ms of jitter [89].

Detectability is not playability. Drummers without tactile feedback keep time until about 40 ms of delay and compensate by striking early up to about 55 ms [90]; good ensembles show 30 to 50 ms of onset scatter [91]. And people anticipate rather than react: in paced tapping, taps precede the beat by 20 to 100 ms [92]. So a 100 ms reactive pipeline misses a 10 to 30 ms budget by a factor of four or more; trimming recovers tens of milliseconds, and the rest can only be recovered by producing the sound before the event is observed, the subject of chapter 4. The same document corrected a remembered figure that nothing in the code produces: the camera runs at a nominal 30 frames per second, not 44, while the engine ticks at the display rate and re-reads the last camera result between frames.

### 3.3 What the browser allows

**The camera.** A page cannot touch the sensor or the operating system's capture stack. It can ask for more frames (`frameRate: {ideal: 60}` halves the mean frame wait) and learn when each frame was captured: `requestVideoFrameCallback` reports a `captureTime` for camera sources [93]. Before #226 every landmark frame was stamped with the moment inference ran, one to two frame periods of variable offset that no interpolation can remove; now one frame pump stamps every frame with its capture time and carries the measured lag [94]. In Chrome on macOS and in Safari that stamp is the frame's arrival in the capture service, not the exposure, so it removes the browser's jitter but not the camera's constant delay. Safari had a trap: its camera player reports `currentTime` as a wall clock and `mediaTime` as 0, so the old new-frame test fired on every animation frame (182 deliveries for 91 frames), inferring each frame twice. The pump now reads a rise in the callback's `presentedFrames` counter as a new frame.

**Inference and threads.** WebAssembly runs 45 to 55 % slower than native code on standard benchmarks [95], which is why the GPU path wins; a faster runtime would need WebGPU, which MediaPipe Tasks does not offer. The structural problem is the main thread: the engine ticks on `requestAnimationFrame`, and a synchronous 21 ms inference does not fit an 8.3 ms frame at 120 Hz, so tick intervals measured 12.1 ± 12.4 ms instead of 8.3. A Web Worker, a background thread a page can start, attacks that jitter.

**Audio.** Web Audio renders on its own real-time thread in blocks of 128 samples (2.9 ms at 44.1 kHz), and `baseLatency` and `outputLatency` are the browser's and the operating system's buffers [96]. An AudioWorklet, a script on the audio thread, fixes jitter and main-thread stalls; it does not cut latency for voices built from native nodes [97]. The `latencyHint` option bought 9 ms at most (2.9 + 23 ms at the lowest setting against 5.8 + 29 for `interactive`). Bluetooth output has been measured at 178 ms [98], more than every other stage together, which is why the troubleshooting page tells players to use a wired speaker [72].

**Clocks and loading.** The Stream Applier design separates where data comes from, when the engine advances and what happens to outputs: a `RealtimeClock` on animation frames for live play, a deterministic `BatchClock` for the headless replays every benchmark here runs on [99]. Lazy loading (chapter 14) keeps heavy things, MediaPipe included, out of the main bundle until a player asks for them [100]; at run time the app reconfigures rather than rebuilds, since creating a hand landmarker costs 278 ms and changing its options 10 to 14 ms.

### 3.4 What thoremin measured

**Which processor runs the model.** On a machine with no usable GPU, a software WebGL renderer makes MediaPipe's GPU delegate the CPU emulating a GPU: 713 ms per hand frame against 99 ms on the CPU delegate (measured). The old rule fell back only when the GPU delegate threw, and the software renderer does not throw; choosing the delegate from the renderer took capture-to-tick from 790 to 112 ms at 30 fps [101]. A proposal to capture at 640x360 found the CPU delegate seeing no hands, traced to Chromium's crop-and-scale upload holding the wrong region on that renderer; a 2D canvas copy found hands in 25 of 25 frames [102].

**One hand or two.** Looking for one hand cuts the model's cost by 40 % (98 to 59 ms on the CPU delegate), because with a second allowed the palm detector runs every frame; in the app median capture-to-tick fell from 116 to 71 ms [103]. But told to find one, the landmarker keeps whichever it found first, and switched about once a second on a conducting clip. A governor experiment tried to keep both the saving and the right hand: look for two while the wrong hand is tracked, drop back once the wanted hand is alone [104]. Over 450 frames, plain one-hand mode read the wrong hand in 66 % of frames for an instrument wanting the right one; the governor brought that to 0 % but escalated on 446 frames, costing 97 to 98 ms, as much as two hands, and dropping back sooner rebuilt the search and found the wrong hand 28 to 32 % of the time. Verdict negative; nothing was wired in.

**A worker for the model.** In a Web Worker the tick period went from a median 108 ms (p95 165, standard deviation 51.7) to 19 / 30 / 5.4 ms on the CPU delegate, while median capture-to-tick grew from 120 to 130 ms: a bitmap copy, a message each way, and the wait for the next tick [105]. Queueing frames for a busy worker cost 19 ms more, so a busy worker drops the frame. The plan's bar of p95 under 20 ms was not met headless.

**The clock stamp shortfall.** Where no capture time exists, a stamp is the moment the animation loop noticed the frame, moved back by a learned lag; the worry was an error of up to a display period. On Chromium it measured 0.7 ms (p95 0.9), because both callbacks fire in the same rendering update, so nothing changed [106]. WebKit, where this path matters, was not measured.

### 3.5 Decisions and open items

Decided: no rewrite in another language; request 60 fps; choose the delegate from the renderer; stamp frames with their capture time; derive the hand count from what the instrument reads, so a one-hand instrument looks for one hand (the owner's decision D13, its wrong-hand cost accepted); keep the worker behind a seam, the main thread the default [107]. Waiting on the owner (D11a and D11b): a linear pitch ramp over the measured frame period, clamped to 8 to 50 ms, in place of the 30 ms glide (about 7 ms to half-pitch), and a zero-look-ahead soft clip in place of the compressor (6 ms). Decided (D11c): `latencyHint: 0` stays opt-in until a glitch counter has run on real hardware. Whether the worker becomes the default (D14) is also open.

Open issues: #226 closes only when a real webcam, on Safari too, is confirmed to deliver capture stamps [94]; #592 asks for the stamp shortfall on Safari hardware [108]; #784 asks that a one-hand instrument with both hands in view get the hand it reads, which the sign-language plugin needs [109]; #793 notes that a conductor beating with the body still asks the hand model for a hand nothing reads [110]; and #737 records that if the worker dies while the main thread cannot load the model, the hands freeze for the session with only a console message, for which a bounded retry and a status line are recommended [111]. Beyond these, the frame wait, the model and the audio buffers remain, and the only lever on them is anticipation.

## 4. Sub-frame timing, impact prediction and the air instruments

### 4.1 The problem: a beat inside a 33 ms frame

Pitch and brightness tolerate a control period of tens of milliseconds; rhythm does not. A drum hit has to land within about 10 ms of its intended time, a 30 fps camera delivers a picture every 33 ms, so a hit almost always falls between two frames, and the frame that shows it arrives after chapter 3's 100 ms chain. The timing research separates three problems inside "beyond the frame rate" [86]: resolution (locating an event that already happened to a fraction of a frame), prediction (producing the sound at the event, so committing before the frame that shows it exists) and intent (when the event was meant to be).

The framing principle, from the owner's brief, is that actuality (the sound reflects what the body did), intent (what the player meant) and sounding good (a musical prior) conflict, and the instrument should expose the trade-off as a dial. Actuality is what Wessel and Wright call control intimacy [89]; intent inference is formalised by Dragan and Srinivasa's policy blending, where confidence in a prediction sets how far it may override the raw input [112]; sounding good is a DAW's quantise strength applied live, which Desain and Honing modelled as inference [113].

Prediction is possible because strokes are stereotyped. The minimum-jerk model says a reach's speed profile is fixed by its start, end and duration [114]; Sofia Dahl found each drummer's stroke shape consistent across dynamics, tempi and surfaces [115]; people judge time to contact from the approach [116]. Head-motion prediction works for horizons under about 80 ms [117], and a 30 Hz depth camera has predicted juggled balls [118]. The commercial camera air drum, Aerodrums, takes the hardware route instead: 125 to 132 fps [119].

### 4.2 The harness and the baseline

The numbers here are scored on synthetic ground truth from the `an.impacts` harness [120]: clips of a stick or ball striking a surface, or turning in mid-air with no contact, on a known tempo grid with humanised timing, sampled by a camera model with a shutter and capture-time jitter [121]. The benchmark is 288 clips (two objects, surface and air, 24, 30 and 60 fps, two shutters, four capture-timing regimes, three seeds) at a 96 to 132 bpm accelerando with 12 ms of timing jitter, 3,456 events per stroke kind. Three scores mirror the three objectives: actuality (estimate minus the executed impact; its standard deviation, the spread, is what the player feels as jitter), intent (estimate minus the intended grid time) and lead (how long before the impact the estimate was committed).

The bar is the frame-snapped baseline: the deepest sample of a stroke, confirmed by the next, at that sample's time. Its spread is 10.8 ms on surfaces and 10.7 in the air, and it reports 27 to 31 ms after the impact. An early finding: the beat detector's median-of-three prefilter replaced the extremum sample exactly where its parabolic fit needs it, leaving it worse than the baseline (12.4 ms); dropping it gave 7.3 ms, and at 15 fps took missed strokes from 1,732 to none [122].

### 4.3 Predicting the impact

**The method.** The approach to an impact is close to constant acceleration, so a least-squares quadratic through the last 150 ms of samples is the state estimate. A surface impact happens where that curve reaches a plane, known while the stick is still above the table: time to contact, done by machine. An air stroke has no plane, but the depth at which a player's strokes turn is consistent, so the floor is learned from confirmed turns, and the braking into the turn, which the quadratic cannot see, is learned as a per-player lag. The predictor commits once per stroke, at the last sample that still leaves the required lead (audio latency plus a margin), and never moves a committed event; later estimates feed the floor and lag for the next stroke. Networked games call this client-side prediction with reconciliation [123].

**The numbers.** On surfaces the prediction commits 53 ms before the impact with a 7.1 ms spread, where the baseline reports 27 ms after it with 10.8: 80 ms earlier and a third tighter, and 6.0 ms with the plane known (measured). The 213 unpredicted strokes are mostly each clip's first, before a floor exists; they sound one frame late on confirmation. Air was the weak case: as early, but 9.8 ms of spread. Decomposing the error showed the cause was the reference the lag was learned from, a quadratic through departure samples that at 24 and 30 fps span 70 to 125 ms. Switching to the three-sample vertex took the air spread from 9.7 to 6.5 ms, and at 30 fps with truthful stamps and the app's 77 ms effective lead from 7.6 to 5.3, meeting the target of 6.5 [124]. The stated cost: the mean moves from 4.8 ms early to 2.2 ms late, growing with lead and with slower cameras, a few more strokes go unpredicted, and the lead shrinks by about 6 ms. That late mean was decomposed into the commit's crossing, the vertex's own bias (about +3 ms at 24 and 30 fps) and the lag's trail; a learned correction for the commit offset helped where the bias was largest and hurt elsewhere, so it was not shipped [125].

**What else moves the error.** The baseline's spread scales with the frame period (13.8, 11.8, 5.4 ms at 24, 30, 60 fps), the known-plane prediction's goes 7.8, 6.0, 2.9; at 60 fps that is under the 4 ms intrinsic variability of human tapping. An open shutter makes every estimator see the object half an exposure early (8.3 ms at 30 fps), a constant a calibration removes. Timestamps matter far more: 4 ms of noise on the stamps doubles the known-plane spread (4.3 to 8.5 ms) and makes the predictor decline one stroke in fourteen, while an irregular camera reported truthfully costs nothing; that is the value of chapter 3's capture stamps. For browsers with no capture time, a gated de-jitter fits stamp against frame index over 30 frames and moves clock-derived stamps onto the line, never touching a real capture stamp; on noisy stamps it took the known-plane spread from 9.1 to 4.6 ms. Committing earlier costs little, and 1 to 2 pixels of tracker noise degrade the prediction gracefully with no spurious events.

**A template bounded before it was built.** A per-player stroke template could predict the brake from the stroke's start. Instead of building it, a clip set where each stroke draws its own fall and brake was generated and each error regressed on the stroke's true shape, an oracle no template could beat: perfect knowledge of fall and speed would gain at most 0.6 ms at 24 fps and 0.8 ms at 30, because the brake comes after the commit [126]. The template was not built [127]. What could reopen it is real strokes whose brake follows their approach, which needs one recorded real-versus-air take, a task for the owner [128]. Every number rests on an ideal tracker plus Gaussian noise and strokes shaped like the predictor's own model, so the absolute numbers are an upper bound and the comparisons are what should carry over.

### 4.4 Intent: rhythm priors and the timing magnet

A rhythm prior models where the next beat should fall. The shipped one was an adaptive oscillator, a Large-Kolen circle map [129] with Large and Jones's attentional window [130]. Under the accelerando its grid ran 65 to 75 ms late (mean absolute error 68 and 77 ms, surface and air): its period is a running mean and its phase correction halves each error, so it settles behind a moving tempo. A trend prior, the plainest form of Cemgil's Kalman tempo tracker [131], fits a quadratic of anchor time against beat index over twelve anchors, so a changing tempo is a state; it reached 16 and 17 ms. The default since #232 is a blend: the oscillator until three successive errors share a sign, then moving toward the trend, at 18 and 20 ms against the issue's bound of 20 [132]. On steady playing the switch fires on about 14.7 % of anchors, at the margin of its 15 % bound, but moves the grid under 1 ms. A review's double-tempo failure after sudden slowdowns was fixed with resets. Saved instruments keep the oscillator; new ones get the blend.

The timing magnet pulls a predicted time toward the prior's nearest expected beat by a strength from 0 to 1, through a gate scaled by the prior's confidence. At 0.5 toward the trend prior the sounded onset moved about 10 % closer to the intended time at a 60 % cost in fidelity to the executed one (intent error 11.3 to 10.1 ms, actuality 5.6 to 8.9, on surfaces); toward the oscillator's late grid both got worse. On the live air drum, 0.5 lowered intent error from 11.9 to 9.0 ms with no pipeline delay but made both errors worse at 40 ms (about 20 ms each). The first suspect, a pull toward a beat already past being cut to "now", was tested and ruled out: the cause is the grid, a follower that hears its own pulled hits and lags behind late anchors (an oracle grid gave 9.5 ms at 40 ms). With the app's conductor as the follower, a pull of 0.5 made intent worse at every delay, zero included (11.9 to 17.3 ms) [133]. So the dial defaults to 0. The rules that follow: commit at the audio latency plus a frame before the predicted impact; snap by the prior's confidence, not a fixed strength; and after a wrong prediction change nothing scheduled, correct the next stroke.

### 4.5 The air drum: which point, which pad

Footage settled what to track. On real drumming videos the pose model's wrists saw about half of a roll's hits, with a best F-measure (the harmonic mean of precision and recall) of 47 % at 70 ms tolerance after removing a lag of 51 ms behind the sound [134]. A roll is played from fingers and rebound; the stick tip travels, the wrist barely moves. Luke Dahl's 200 fps study agrees: the velocity reversal comes after the audio onset and drifts with tempo, while the acceleration peak comes 14 to 33 ms before it and holds [135]. So the live air drum tracks an estimated stick tip, the line from the heel of the hand through the thumb-index fulcrum extended by a stick length in the hand's own units [136]. On synthetic wrist strokes the wrist landmark found none and the stick tip all, with a 7 ms median error; on footage it beat the pose wrist by 9 points of F. Because the stick is a lever that amplifies every pinch, its gates count in reaches (stick lengths): gestures moved the tip at most 0.35 reach, strokes at least 0.55, so the gate sits at 0.45.

Pads, places on the video with their own sounds, needed more. Reading the landing point along the stick's arc put 13 of 13 demo strokes on their pads, against 10 [137]. Per-pad floors took a take with kick and snare stacked at one horizontal position from 9 to 15 of 16 strokes on the right pad and its sounding error from 17.0 to 13.2 ms [138]. Choosing the pad by where a stroke starts (the fall's top and the gripping hand's depth) fixed takes where stroke height varies and let seven soft snare strokes that had been silent be heard [139]. The first stroke on a stacked pad never struck is still read against the learned one, because every cue tried traded that one wrong stroke for repeated late ones [140]. The guide's summary: strike at nothing and the drum sounds, on time [50].

### 4.6 Air guitar, bass and flute: what footage could and could not teach

The air-instrument research asked whether models learned from footage of real instruments could drive air ones [134]. The pipeline extracts landmarks from videos and labels frames from the audio: chroma templates with Viterbi decoding over each video's few declared chords for guitar, in Fujishima's tradition [141], pitch tracking for flute and bass, onsets for drums. The held-out unit is always the player.

**Guitar.** Published landmark chord recognisers report 95 to 98 % on random splits of their own frames; the few that held out capture conditions got 83 to 85 %, and none held out players. Hrybyk and Kim had found that audio names the chord (98.6 %) while video names the voicing, how it is fingered (94.4 %), video alone naming the chord only 34 % [142]. On 31,137 labelled frames from three players, six chords and 40 hand features, thoremin's model scored 96 % within a player and 24 % across players, chance being 17 % (measured). Leaving one video out within one player still gave 94.8 %, ruling out a pipeline bug. The cause was musical: one player's G had the pinky extended, another's curled, and the audio called both G. A chord is not a shape. Two seconds of a player's own hand per chord gave 97.5 % and 89.4 % on the two well-tracked players; adding the others' 30,000 frames lowered that to 72.3 % and 58.5 %. Tracking was the other limit: a close-up on the neck found the fretting hand in 94 % of frames, a whole-body shot in 8 to 11 %. So the air guitar enrols the player's own shapes, two seconds each and named by them, classifies them with the trainer's nearest-centroid classifier (within a few points of the softmax, no training loop in the browser), and plays an open voicing on six strings when the impact predictor predicts a strum of the other hand [143][52]. The shift from guitar to air is unmeasured; it needs labelled air footage from a cued session.

**Bass.** Pitch class scored 10.2 % across six players against 8 % chance, and 32 % even within a player: a pitch is a fret and a string, and the fretting hand looks the same at every fret. So the air bass is a mapping: the note is the horizontal distance between the wrists in palm spans, quantised to the scale, smoothed and held with a hysteresis of 0.3 of a step (unsmoothed, 3 pixels of jitter put 10 of 16 plucks on the wrong note), and the pluck is the impact predictor on the plucking fingertip [51].

**Flute.** Fingering was at chance across four players (9.6 % against 7 %) and 27 to 45 % even with ten seconds of a player's own footage per note: a key press moves a joint a few degrees, seen edge-on, while MediaPipe's finger-angle error against motion capture is about 11 degrees [144]. On 181 notes from rest the mouth started moving a median 300 ms before the sound and settled 110 to 130 ms before it, with 100 to 300 ms of spread, and inside a phrase moved as often up as down [145]; the best causal detector found 48 % of onsets at 10 % precision. The mouth is an arming signal, not a timing anchor. The air flute therefore reads large, deliberate, enrolled finger lifts, guided by fingering charts for seven winds (chapter 11) [146], and gates the sound on an enrolled blowing mouth, held through a lost face for 0.3 s [53]. A microphone breath onset as the gate is open [147].

### 4.7 Drum pattern training: a prior from the player

Pattern training gives the magnet a prior worth pulling toward, the player's own pattern [148][149]. A pattern is a one-line grid per drum (`x` a hit, `X` an accent) compiled to a percussion score: a rock beat, a half-time feel, four on the floor, a fill. After a count-in the player plays it a few times, and an offline fit recovers their tempo (a scan from 70 to 130 % of the stated tempo, then a line per pass to follow drift), their feel (each event's mean offset from the grid and its spread) and their positions (which pad, and where on it, they use for each drum). A take under 0.7 recall or precision is refused, since any take fits some grid. In playback the trend prior follows the hits, each predicted hit is assigned at commit time, about 50 ms ahead, to the nearest score event, and sounds at its grid time plus the learned offset, magnetism fully on; an offset whose spread exceeds its mean is dropped as noise. Three decisions were made with reasons: a cursor on the strip, since nobody keeps a two-bar pattern with a fill in their head; a metronome for the count-in and first pass only, since the fit needs an anchor but the question is the player's tempo; the raw hit as feedback in training, the snapped one in playback. Whether it sounds good is the owner's live check.

### 4.8 What is still open

The main gap is real hands: the predictor's acceptance, its late mean and the template question all wait on one recorded take [128]. While the conductor leads a piece, air strikes are muted so the score is the music; an opt-in to drum along is open [150]. A review of audio scheduling found that in the bass's plucked-string output a late note scheduled before an already-committed later one damps it before it starts, reversing the heard order; the fix changes what players hear, so it is filed, not made [151]. The shift from real instruments to air (section 4.6) is unmeasured.

## 5. Rhythm and pulse from gesture: ictus, body pace and dance

### 5.1 The question: musical time below the frame rate

Melody, harmony and timbre are near-continuous controls, and 30 to 60 updates per second is enough for them. Rhythm is different (chapter 4): the timing a listener hears lives at roughly 1 to 20 milliseconds, while one video frame lasts 16.7 to 33 milliseconds, so mapping each frame to a note onset cannot place a beat where the player meant it [152]. The project's rhythm research map, written for issue #178 [153], reframes the problem. The project does not try to measure onsets from frames. It treats them as a hidden, high-rate timing process and infers that process from sparse, noisy observations under a strong musical prior.

Signal theory gives the licence: an onset train is a finite-rate-of-innovation signal, recoverable below the Nyquist rate as long as sampling exceeds the rate of genuinely new timing decisions [154]. Because a performer cannot wait for future frames, the inference must be causal: filtering and forecasting, not smoothing.

The proposed engine is `ictus`, named after the conductor's term for the instant a beat lands. An anchor detector turns gesture into sparse timing candidates with confidences. An injected rhythm prior holds phase and tempo. A single musical-time state (phase, tempo, meter, next-beat forecast) is what every consumer reads. One rule recurs in every later document: **anchors are observations with likelihoods, never onsets**. Status (decided 2026-10-05): `@thoremin/ictus` is a pure workspace package with three in-tree consumers (the conductor, the body pulse and pace controller, the air drum). It is deliberately not published, and a Python port is to be validated by shared fixtures [153].

### 5.2 What the beat-tracking literature offers

Two literatures meet here. The first is probabilistic tempo tracking. Cemgil and Kappen pose tempo tracking and rhythm quantisation as filtering in a switching state-space model with a discrete score position and a continuous tempo, solved by sequential Monte Carlo [155]. The bar-pointer model infers position in the bar, tempo and rhythmic pattern jointly [156], and Krebs, Böck and Widmer made its state space efficient enough for real time [157]. The second is entrainment. Large and Kolen's adaptive oscillator corrects its phase and period on each event, and its mode-locking at small integer ratios is where metrical levels come from [129]. Dynamic Attending Theory adds an attentional pulse that predicts when the next event is due [130]. The map reads the oscillator as a degenerate particle filter, a point estimate with a predictive window. The project starts with the oscillator for latency and keeps the particle filter as the upgrade for carrying several meter hypotheses.

For the audio side, a song to be paced by a dancer, the body map measured the browser options [158]. The only pure-JavaScript port of Dixon's BeatRoot [159] got tempo to 0.01 beats per minute (bpm) on clean clicks. But its beat list stopped at about 15 seconds, and it made octave errors (85.8 bpm read as 171.7). A 40-line hand-rolled tracker (onset flux, autocorrelation, a low-band comb) got tempo within 0.1 bpm and 98 % of beats within 70 ms on five of six synthetic cases (measured). It ships as `trackSongGrid` in ictus. The neural Beat This! tracker [160] is the upgrade for downbeats, but at 2 to 8 MB of weights plus a 10 to 20 MB runtime it is recommended not to build yet [161]. Every tempo here is a least-squares slope through beats, never a median inter-beat interval: in a sibling project's measurement, the median read a 129.200 bpm loop as 130.43 and the line read 129.201.

### 5.3 The body as a source, and the dancer's pulse

Issue #186 asked for two things joined by one signal [162]. Body movement should be featurised so it can control sound the way hands and face do. A pre-existing song should also be paced by the inherent rhythm of the dancer. The joining signal is the dancer's **pulse**: the period, phase and confidence of the body's repeating motion.

MediaPipe's Pose Landmarker [5] lives in the WebAssembly bundle already loaded for hands and face; the only new download is the model, 5.8 MB lite or 9.4 MB full (measured). It is still the most expensive node the graph can host, so it is off by default. The body feature catalog, drawn from Larboulette and Gibet's descriptor review [163] and Camurri's EyesWeb cues [164], holds 51 features: joint angles, positions, speeds, quantity of motion, shape, the four Laban effort factors and boolean relations such as "hand above head".

The pulse estimator follows a finding from the sibling project: periodicity wants a position, not a speed, and one joint, not the whole body (wrist-height autocorrelation r = 0.37, against 0.11 for wrist speed and 0.15 for whole-body energy). A 30 Hz stream cannot place one beat, but autocorrelation over several cycles resolves the period to well under 1 %. The pulse follower in ictus therefore takes the period from an autocorrelation level over an 8-second window, with no octave assumed, and the phase from a least-squares sinusoid. Its default channel is the **stride**, the ankles' signed horizontal distance, not a height. On the Que Calor dance fixture the stride repeats once per bar (1.86 s, autocorrelation strength 0.76), while the head and hips sit at the noise floor (measured) [158].

### 5.4 Pacing a song from the pulse

The design precedent is D-Jogger, an adaptive music player for runners [165]. Matching tempo alone gave a phase coherence R of 0.17 (R is the length of the mean phase vector: 1 is perfect locking, 0 none). Starting in phase as well raised R to 0.73, and also nudging the tempo whenever phase drifted past ±30 degrees reached 0.92. Van Dyck and colleagues found that runners' entrainment held for tempo changes up to about ±2 % and dropped from +2.5 % [166]. Pitch-preserving time-stretch is free in the browser: the media element's `playbackRate` with `preservesPitch` is the fallback, and Signalsmith Stretch [167] became the default stretcher once the conductor's audio pacer landed [168].

The pace controller in ictus departs from the plan in measured ways. The ratio of the dancer's cycle to the song's beat is an **integer** one (1 to 8 song beats per cycle, or the reverse), since cycles need not be powers of two. A ratio is followed only after persisting 3 seconds, which takes the controller's following of red noise (trusted in about 2 % of ticks) to none. The song's period is averaged over 8 seconds, the rate clamped to ±10 %, and phase corrected by a 3 % nudge, never a seek. On Que Calor played against click songs 6 % slow, on tempo and 6 % fast, the controller locks on four beats at about 9 seconds and the anchors' R in the song's beat is 0.71, 0.67 and 0.67, against 0.45, 0.09 and 0.23 without following (measured). The map's target was R above 0.7 [158].

Follow-ups are tracked in #346 [169]. A real song's grid (interval spread 2.1 % of the period) is followed as steadily as a click (R 0.69 to 0.71 against 0.67 to 0.71, measured). "Start on your step" shipped off by default [170], and pausing keeps the lock. Open: the phase target (where in the stride a dancer puts the beat, which needs a dance clip with its own audio), and the R ceiling, which a 2026-10-20 test traced to the dancer's own ±5 % wander rather than the phase fit or nudge.

### 5.5 Which body channels carry the beat

Before choosing defaults for the whole-body work (epic #386 [171]), sub-issue A1 measured which body channel marks the beat, and at which metrical level [172][173]. The literature predicted a split. Burger and colleagues found, across 60 participants, that vertical movement locks at the beat and horizontal movement at the bar, and that the phase (down or up on the beat) differs between people, so it must be learned per player [174]. Toiviainen, Luck and Thompson found eigenmodes at one, two and four beats [175]. The ceiling from dance video is low: Pedersoli and Goto's learned tracker over 13 pose keypoints reached an F-measure of 0.61 at best [176]. Pose alone does not give an audio-grade beat, which is why every design here puts a prior behind the anchors.

The measurement used three Commons videos of a choir conductor beating 4, 3 and 2 patterns, the Budots street-dance clip (143.5 bpm), Que Calor and a synthetic control. It scored 14 channels by four event types (speed deceleration, acceleration peak, directional impact, the channel's own turning point) by three levels, computing F within ±70 ms, F after a fitted lag, and the circular resultant R with a Rayleigh test (whether phases cluster more than chance). Every cell is in the committed CSV [177]. The conductor clips' grid is the conductor's own beating wrist. The best other channels, all at their turning point:

| clip | channel, level | R | Rayleigh p | F after lag |
|---|---|---|---|---|
| conductor, 4-pattern | trunk centroid height, beat | 0.77 | 2e-7 | 0.49 |
| conductor, 4-pattern | beating elbow, beat | 0.92 | 4e-11 | 0.69 |
| conductor, 2-pattern | trunk centroid height, beat | 0.68 | 5e-5 | 0.37 |
| conductor, 3-pattern | trunk centroid height, beat | 0.35 | 0.08 | 0.27 |
| conductor, 4-pattern | shoulder rotation, bar | 0.98 | 3e-5 | 0.38 |
| Que Calor | lateral sway, beat | 0.59 | 4e-4 | 0.47 |
| Que Calor | shoulder rotation, bar | 0.77 | 0.002 | 0.20 |

What it decided: a conductor's trunk marks the hand's beat on the 4- and 2-patterns but not the slow 3-pattern hymn, with a lag of +85 ms on one clip and -112 ms on the other, so the lag must be learned. The head is weaker than the trunk everywhere and is not a default. Shoulder rotation marks the bar, partly because the beating arm pulls the shoulder (the pelvis locks less, 0.68 and 0.65). The turning point won 31 of 32 significant cells, and the multi-joint envelope never beat the best single channel, because a sum mixes joints moving at different levels. For dancers, the stride repeats at the bar (3.95 and 4.07 beats), Que Calor's sway carries the beat, and no dancer's head, hips or trunk height locks at the beat.

The dancer's `auto` channel (#416 [178]) follows the strongest trusted of stride, sway, yaw and trunk height, switching only after 3 seconds. On Que Calor the stride is trusted 98 % of the time, sway 77 %, trunk height never; on Budots, ankles mostly out of frame, nothing is. The hope that sway and yaw would carry the pulse without feet is not borne out (measured negative), so the stride stays the default.

### 5.6 Tempo steps and red noise

Issue #339 recorded two weaknesses of the pulse follower [179]. After a tempo step the 8-second window is still half full of the old tempo. A second autocorrelation over only the last 4.5 seconds now acts as a step detector: on a synthetic step from 1.2 to 1.0 seconds, settling fell from 10.6 to 3.6 seconds and untrusted time from 4.9 to 0.1 seconds. It does not reach levels of 1.5 seconds or more, such as Que Calor's 1.9-second bar, and steps of about 10 % or less settle as slowly as before (measured, shipped on).

Red noise is harder. A slowly wandering channel is trusted as a pulse in 1.4 to 7.8 % of ticks, at slow levels whose strengths overlap a real bar's. Four discriminators were measured (measured negative or traded off): phase coherence across window halves and a harmonic ratio (0.87 for Que Calor, 0.84 for noise) fail. An autoregressive surrogate test cut noise trusts from 7.16 % to 2.53 % but real dancers' trusted ticks by 40 %. A 12-second window for slow levels was the best trade (noise trusts 7.35 % to 3.08 %, at a cost of 13 % of real dancers' trusted ticks) but delays a dancer entering a slow level by 2 to 8 seconds, so it shipped off [180]. The controller's 3-second persistence remains the defence.

### 5.7 Dance: fixtures, Dance the orchestra, and the AIST++ decision

Dance material is the project's weakest evidence. Que Calor has a stated tempo (129.2 bpm) but no recorded audio, so its grid's phase is unknown. Budots, the only bouncing dance found on Wikimedia Commons, has three dancers and cuts every few seconds, and its bounce did not survive the pose model at 30 frames per second [173]. AIST++ is the obvious large source [181]: real dancers, music of known tempo, and a kinematic beat defined as a local minimum of joint speed. Its keypoints are CC BY 4.0, but the download requires accepting the parent database's research-only terms. Issue #415 asks the owner for one of three things: a self-recorded take bouncing and then conducting with the body to the trainer's click, a Creative Commons clip, or a decision on whether AIST++ may be measured on, committed from, or neither [182]. As of October 2026 that decision is open, and the dancer defaults stay provisional until such a clip is measured.

The dancer can nevertheless lead more than a song. "Dance the orchestra" (A8, #380 [183]) makes the score follow the dancer's cycle, related to the marked tempo by a held integer ratio and kept within 10 % of it. On Que Calor against a 4/4 demo at 128 bpm, bar R from 25 seconds on is 0.75 when following, against 0.04 with the score held at its marked tempo (measured). Following only once the period has settled cut the mean offset from the dancer's cycle starts from 0.38 to 0.20 beat (#464 [184]). Keeping the ratio across a leader switch cut the resume time from 3.23 to 1.17 seconds (#506 [185]). The guide presents all of this to the player as "Conduct and dance" [68].

### 5.8 What is open

Open items: the dancer's phase target and the R ceiling (#346); red-noise rejection as research (#339); one clip of a single person bouncing to a known tempo, and the AIST++ decision (#415); and the live checks that need a webcam and ears (#146 [80]).

## 6. Conducting, meter and the virtual orchestra

### 6.1 The question and the lineage

Epic #187 asked for methods and models for conducting movements, and for a virtual orchestra those movements control, including the pacing of a pre-existing recording [168]. The research map that answers it distils three sub-problems: understanding conducting gesture from a 30 to 60 Hz trajectory, a client-side score pipeline, and a sampled orchestra with tempo-following playback [186].

Machine conductor-following has a forty-year lineage. Max Mathews' Conductor Program advanced a stored score each time the Radio Baton crossed a virtual plane [187]. Marrin Nakra's Conductor's Jacket moved the emphasis from beat to expression, correlating muscle tension and gesture size with dynamics [188]. The Borchers and Lee family is the most thoroughly documented museum line: Personal Orchestra, You're the Conductor and the conga framework, all using an infrared baton and a time-stretched recording [189][190][191]. Kolesnik and Wanderley put hidden Markov models on camera-tracked hands for right-hand beat patterns and left-hand expression [192]. The closest precedent is a 2026 KTH system [193] that runs MediaPipe Pose on nine upper-body keypoints at 20 Hz into a hierarchical LSTM (a recurrent neural network) regressing bar phase. It reports a beat-to-bar synchronisation error of 0.19 ± 0.13 seconds, and it needs 2 to 4 beats to react to a tempo change, which a professional tester described as "they are not listening". The map's lesson: a phase regressor with interval averaging has no model of tempo as a state, so it cannot predict between beats.

### 6.2 Where the ictus is

Rule-based systems almost all reduce the ictus to the lowest point of the stroke, a sign change of vertical velocity, where Personal Orchestra fires [189]. conga gates that zero crossing by requiring vertical movement to be a multiple of horizontal movement [191]. VirtualPhilharmony lets the player set a lag between beat point and sounding beat [194]. Perception says something subtler. Luck and Toiviainen found ensemble onsets align with periods of maximal deceleration along the baton hand's path [195]. Luck and Sloboda found absolute acceleration along the trajectory to be the dominant cue [196]. Wöllner and colleagues found that averaged, smoother conducting gestures improve synchronisation [197]. Meals measured real ensembles sounding 31 to 51 ms behind the ictus on average, with a standard deviation of about 95 ms [198]. Pedagogy supplies geometric priors: Rudolf's *Grammar of Conducting* separates the sharp stop of a staccato beat from the smooth pass of a legato one [199]. Green's *The Modern Conductor* places every ictus on one horizontal plane, with beat one downward [200].

Decided: the ictus is the braking into the turning point, refined to a fraction of a frame by a three-point parabolic fit, with a confidence in noise units (displacement divided by the tracked point's own frame-to-frame jitter) and a refractory window of about a quarter period, so the rebound is not counted. The offset between that instant and the intended beat is a per-player calibration constant of tens of milliseconds. A 33 ms frame is about the size of a real ensemble's own lag scatter, so the anchor feeds a tempo model and never the sequencer directly. The detector now times the raw samples. Dropping the median prefilter that cost a frame on every sharp turn is the fix described in section 4.2. Confirmation latency on a real 3-pattern clip is 35 to 97 ms (mean 59) [161].

### 6.3 From anchors to tempo

The map collects the update rules the literature reports. In the adaptive oscillator (section 5.2) [129], each anchor moves phase and period through a von Mises attentional window, a bell-shaped weighting on the circle of phase. McAuley and Jones fitted human gains of about 0.5 for phase and 0.4 for period [201]. Pardo's single-oscillator tracker reached about 23 ms mean phase error on piano performances but lost a jump from 54 to 65 bpm for good [202]. Antescofo's tempo agent adapts the window's sharpness from the dispersion of recent errors, so a stray event barely moves a confident state [203]. Raphael's Music Plus One adds a rule: an uncertain onset is better left unreported than reported badly [204].

Decided: v1 is the adaptive oscillator with Antescofo's adaptive sharpness and human-fitted gains. With these gains a tempo step is about two-thirds absorbed after two anchors and seven-eighths after four, the same order as the KTH lag, but the oscillator also predicts between beats. A later measurement added a trend prior and a blend (section 4.4), which cut the accelerando grid error from about 70 ms to about 20. The blend also restored the lock on the 2/4 fixture (F 0.400 to 0.667), and it is the default for new instruments. Keeping the beat-agnostic fallback is decided too. When You're the Conductor was tried with 20 children, their beats were so often out of time with the music that the authors gave up beat detection for a mapping from gesture speed to tempo [190]. The conductor node therefore blends toward a speed-and-size mapping when its confidence is low.

### 6.4 The conductor tool and the hand conductor

The Conductor tool plays a loaded MIDI or MusicXML score, or a built-in demo, at the conductor's tempo and loudness. The orchestra is optional and downloads on first use [67]. The conductor node wraps ictus and publishes one `MusicalTime` object: beat, phase, tempo, confidence, next-beat forecast, and a state of ready, running or hold. Dynamics come from the vertical size of the last stroke against the player's own recent range. Articulation comes from the sharpness of the braking. Both are per-player by construction, as Sarasúa and Guaus' finding that subject-specific loudness models differ from pooled ones demands (reported in the map). Two instruments build on it, Conduct the Chords and its body version (chapter 2) [54][55].

Issue #320 asks for a measurement only a real take can give [205]. An earlier fix split the conductor's old lag of about 31 ms into the prior's share, removed by the blend, and the servo's, about 4 ms. A third suspected cause remains: the conductor tracks the wrist while the air drum tracks the stick tip. The synthetic clips cannot show it, because their stick pivot never moves. If the offset is a steady few milliseconds, the existing per-point lag gate absorbs it. If it is larger, the conductor could read the drum's tracked point while the drum is on (open).

### 6.5 The body conductor

Epic #386 generalised hand conducting to the whole body [171]. Its design keeps `MusicalTime` as the one contract every leader publishes and adds an `AnchorDetector` interface inside ictus. The hand's stroke detector, the body's impact detector and the dancer's pulse follower all become sources of anchors behind one prior. Leaders are chosen per instrument by a dial (`conductor.source`: hands, body or dancer), with no automatic switching. Track A of the epic, items A1 to A8, is merged; A7, meter from the body, closed as measured and not viable.

From A1's channel table (section 5.5), the body conductor reads the beating arm's wrist through the stroke detector when it is visible, with the elbow as fallback. It reads the trunk centroid's height at its turning point as the body's own beat channel, and shoulder rotation for the bar only. Start, hold and stop come from a pure state machine over two per-frame numbers. The first is how raised the beating wrist is on the torso (0 at the hips, 1 at the shoulders). The second is its motion in noise units, which reads 1.5 to 2.5 at rest, 5.5 to 16 for gentle beating and 8 to 43 for full strokes on the 4-pattern clip. The player raises the arm and holds still for 0.4 seconds to get ready, gives an upbeat, and the next anchor is the downbeat. Holding still while raised for 1.5 stroke periods is a fermata (a held pause). Dropping the arm and holding still for one period is a cut-off. On the 4-pattern clip the transport sees the upbeat at 0.77 seconds and starts on an anchor at 0.90 seconds, against a first grid beat at 0.888 seconds (measured) [173].

Three body follow-ups remain open. **The upbeat (#485)** [206]: noise units are a signal-to-noise ratio, so on a very clean tracker a slow adjustment of the raised arm crosses the upbeat threshold and starts the piece early, and no speed threshold separates the two, since both move about 0.3 torso lengths per second. A shape rule (a rise, then a fall below the ready height) ships as an option [207] and the default stays speed; the failing cases need a tracker cleaner than 0.1 pixel on a 150-pixel torso, which no real webcam is known to reach, so the issue waits on a live check. **The trunk's lead offset (#504)** [208]: "Learn my timing" measures each joint's lag against a 16-click count-in and keeps an offset only when the take locks, its standard error is under 20 ms and the take's two halves agree within 40 ms (#427 [209]). The subtraction works (in-sample, the trunk-alone follower lands within 2 ms of the grid), but a take cannot measure the trunk: its anchors scatter about ±100 ms, and on the 4-pattern clip its lag moved from 81 ms in the first half to 18 ms in the second, so the take refuses the trunk on every clip, while the wrist's offset is under 15 ms everywhere (measured, mixed). Whether a real player's trunk holds a lag from one take to the next is open. **The shaping hand (#514)** [210]: since #457 [211], a non-beating hand shapes loudness by its height and palm orientation, the conducting left hand of the literature, but its stroke floor is measured in frame heights, so a hand resting on a bouncing trunk reads as stroking 17 % of the time on the 4-pattern clip. The proposed fix, measuring the hand against the trunk in torso lengths, cannot be shown better on the committed footage, where both of the conductor's hands beat, so it waits on the #415 take.

### 6.6 Meter recognition: a measured negative

Can the hand pattern say 2, 3 or 4? The plan followed conga's profile competition and Green's geometry: lateral-direction profiles per pattern, the downbeat taken as the most vertical approach, and promotion after two consistent bars [212]. Two anchor features were fitted. One was stroke strength, on the idea that the downbeat is the biggest stroke. The other was the verticality of the approach. Each was scored as the share of variance explained by splitting strokes by bar position, against a chance level from 400 shuffles. Six clips were tried: three hand-tracker clips of 7 to 13 strokes and three pose clips of a different conductor with 24 to 45 strokes. Strength classified one clip of three above chance on each source, and verticality none. The best-fitting bar length was right in 7 of 18 cells and above chance in 3. On the 3- to 4-bar hand clips, a correct 4/4 fit of 0.62 could not be told from chance at 0.63. On the longer pose clips the legato 4 and 3 patterns had strokes of near-equal size. Lateral travel depended on which hand was tracked and on the camera side.

The body route failed too. The ratio of a lateral period to a vertical one gave the meter on two of three conductor clips (3.73 for a 4-pattern, 2.04 for a 2-pattern) and nothing on the third. On the synthetic control it read 2 for a 4-beat bar, because a half-bar channel outscored the bar channel [173]. Decided: #187's PR 6 and A7 closed as measured-not-viable [213], and nothing was added to ictus. The bar length comes from the score's time signature or the conductor's `beatsPerBar` dial. A retry needs several conductors per meter, at least 8 bars each, with annotated beats and downbeats, so that a classifier can be tested on clips it was not designed on (#561 [214]).

### 6.7 The score and the virtual orchestra

The score pipeline loads MIDI with `@tonejs/midi` [215] and MusicXML, including compressed `.mxl`, with `musicxml-io` [216]. Both load lazily and sit behind the project's own Zod-validated `ScoreDoc`, which holds notes in beats, a tempo map, time signatures, dynamics and fermatas, so either parser can be swapped. Rendering was deferred, and the cursor seam is designed so that OpenSheetMusicDisplay or Verovio can drop in later. Scheduling follows what forty years of accompaniment systems settled. Dannenberg and Raphael put it plainly: a system that waits to hear a note before responding "will always be late" [217]. The pure scheduler in ictus therefore keeps one pending event per part and recomputes its predicted time every frame. It commits the event to the audio engine only inside a short horizon and never moves a committed note. Tempo reaches it through a servo with a convergence horizon, the one knob that trades responsiveness against jitter.

The orchestra is `spessasynth_lib` [218], a SoundFont synthesizer running in an AudioWorklet (chapter 3), whose note and controller calls are schedulable at exact audio-clock times. Its expression and volume controllers change notes already sounding, which gives per-section dynamics on held notes. The bank is the MIT-licensed MuseScore_General cut to the orchestral programs, now 6.0 MB (3.68 MB when first merged), self-hosted under the owner's rule of self-hosting anything under 15 MB (decided) [219]. From a cold load the first orchestral note is four clicks away [220][168]. The same beat servo paces recordings: "Conduct a recording" reuses the song player, the beat grid and the pace-controller node from #186. A dancer and a conductor share one transport, one grid and one servo, with Signalsmith Stretch as the default stretcher [221]. Several defaults ship off, awaiting a listening check. The KTH final-ritard tempo prior, used when the gesture is unsure, is covered by unit tests only. The fade and slowdown of a song on a hold ship at zero, with 0.4 seconds and 0.5 recommended once heard.

### 6.8 What is open

Open items: annotated multi-conductor footage for meter (#561); the wrist-versus-stick-tip offset (#320); the three body follow-ups of section 6.5 (#485, #504, #514); and defaults recommended but not yet switched (the shape upbeat, the ritard prior, the hold fade), which wait on the owner's call in the decision inbox (#168 [107]). Most wait on a real person in front of a webcam (#146) or the self-recorded conducting take requested in #415.

## 7. Face categorizers: carving personal categories, lighting and distance

### 7.1 The question: what can a face control on purpose?

MediaPipe's face model gives thoremin 478 landmarks and 52 blendshapes per frame [5]. A blendshape is a score from 0 to 1 for one named facial movement, such as jaw open or left brow raised. The first face instruments read these scores and decided which of seven emotions the player was showing. The roadmap issue on face control dimensions [222] argues that emotions are the wrong handle for an instrument, for two reasons drawn from the literature. First, volitional facial movement and spontaneous emotional expression run on different neural pathways, and clinical lesions can remove one while sparing the other [223]. A player cannot summon fear on demand; they can only pose a face they hope the classifier reads as fear. Second, the emotions that are hard to produce are also hard to detect. Voluntary production of single facial action units leaks co-activations, with brow lowering the hardest to isolate [224], and the model under-reports the channels those emotions lean on: the nose-sneer and eye-wide scores stay near zero even when clearly activated [225]. Prior face instruments such as the Mouthesizer used mouth shape as a continuous controller rather than emotion [226].

The issue's direction is a small set of deliberate control axes (head pose, jaw open, brow raise, smile or frown). It is still open as a roadmap. Its open question about per-player calibration was answered differently: rather than calibrate fixed axes, let each player teach the instrument the faces they can actually make.

To see which features a player can move at all, the project built the Feature Lab (chapter 1) [227][8]. The Lab is a measuring instrument, not a sound: a live grid of meters over more than 300 features of face, hands and body, each normalized as the player moves, so a blendshape, a finger curl and a head angle read as comparable levels. Every feature carries a controllability hint (easy, moderate or involuntary). The normalizer uses a slowly decaying minimum-maximum envelope rather than percentiles (decided), because the top of a player's reach is the musically interesting part, and percentiles would compress it.

### 7.2 Carving your own face categories

The answer shipped as "Your faces" [31], built under the personal-categorizer issue [34] and its second version, the carve redesign [228]. A categorizer is a small model, saved in the browser, that maps a feature vector to one of the player's own named categories or to "none of these". Carving is the process that makes one from a recording.

A take goes like this. The player opens the tool and sees live feature bars, measured in noise units. A noise unit (NU) is a feature's own frame-to-frame jitter at rest; a distance of 8 NU means "eight times this feature's own noise", which makes a blendshape and an angle comparable [229]. The take first asks for a few seconds of rest, which sets the noise and the rest point. Then the player makes faces one after another. A still-point sampler keeps a face only when the feature vector has stayed still for a dwell, 220 milliseconds by default, and stores the mean of that window as one hold [230]. Transitions are thrown away, because clustering every frame finds the middle of the motion, not the faces (chapter 9 gives the research behind this). A ring shows when a face was taken; the space bar pauses.

When the player stops, the holds are clustered. The clusterer builds an average-linkage hierarchy once and cuts it at whatever number of groups the "How many" slider asks for, so changing the count never needs a new recording. In the code this hierarchy is called the forest: a constrained forest, because every move a player makes becomes a constraint. Dragging a hold into a group, or into the Neutral or Set-aside bins, stores a must-link or cannot-link pin, so a later re-cut keeps it where it was put [231]. Neutral is a class taught by example ("this face should do nothing"); Set aside keeps holds without training on them. These bins were the recommended answer to the design-choices issue and now stand as decided [232]. So does the unit a player moves: holds, not frames, because clustering frames brings back the dwell-time bias the sampler exists to prevent, and a frame grid is ten times longer to scan.

Each group gets a default name from the general expression model, assigned globally with the Hungarian algorithm so that no two groups get the same name, and a group the general model does not believe gets a fallback name such as "expression 3" [233]. The player renames everything.

The forest's cost was measured and reduced. The first constrained re-cut was cubic in the number of holds: 0.49 seconds at 400 holds and 18 seconds at 2000 (measured, [234]). A per-row nearest-neighbour cache made it quadratic with the same tree bit for bit, so a re-cut is now offered up to 2000 holds instead of 600 (measured). A later change moved merging and the re-cut into a Web Worker and raised the file bound to 3000 samples. Timing the first re-cut on a real tablet is still open [235].

A saved categorizer can play chords on an instrument, fire commands through the Gestures tool [66], or be exported as a file. Two questions remain open: whether an exported instrument should carry its categorizer inline rather than by id [236], and recording two shared starter categorizers ("Seven expressions" and "Easy four"), which needs the owner's own face [237].

### 7.3 Quality chips against the live readout

Each group shows a quality chip: the distance to its nearest neighbouring group divided by its own spread, graded close below 2, OK below 3 and distinct above [238]. The question was whether the chip predicts what the live readout (the "Trying" view) shows frame by frame [239].

The check used a 97-frame recording of one face: rest, a smile, and a smile with the mouth open. Measured before the fix, the chip overshot the frames' own separation by 0.3 to 1.3, and the overshoot grew with hold length, because a longer dwell averages more noise away. Taking each group's spread from the holds' supporting frames brought the chip within about 0.2 of the frames' own separation at every hold length. On the open smile, two of four hold lengths had read distinct and now read OK, which is honest: the live readout reads the open smile as itself in only 43 to 67 % of its frames, against 90 to 93 % for the smile.

The chip still missed one failure: frames that wander outside a group's reject radius and read as "none of these". A share of supporting frames past the reject radius is now reported, and a group above 0.25 is worded as "often none of these" [240]. That share tracks the live readout within 0.15, flags the open smile at 33 to 57 % and never flags the smile (7 to 10 %). The 0.25 line is provisional: any value from 0.10 to 0.33 separates the two on this single recording. A related option, taking the reject radius from frames rather than holds, cut "none of these" frames from 19 to 7 of 66 on the same recording; it is off by default so saved categorizers classify as before, and making it the default is an open decision.

### 7.4 Lighting and distance, measured

Before building live dials, the project measured how far lighting and camera distance move the categorizer's 94 features, compared with the distances between categories [241].

For lighting, one studio-lit clip of four people making five expressions [242] was re-rendered under nine lighting variants and run through the app's own face pipeline. The reference distances were: frame to frame 12.5 NU, happy against sad for one person 104.7 NU. Ordinary changes (one stop darker, overexposed, low contrast, warm or cool light, half the face in shadow) moved the mean vector by 5.7 to 13.1 NU, about what sensor noise alone does (7.8 NU). Five-category accuracy stayed between 91 and 93 % against a 92 % baseline. Only a dim, noisy room mattered: 28.5 NU and 88 % accuracy at about 1.5 stops under, 59.3 NU and 85 % at about 2.5 stops. That shift differs by feature, person and frame, so subtracting the best constant per-feature offset (the most a dial could do) removes only 14 to 19 % of it.

The decision: no lighting dial. Instead the tool warns when the room is too dark [243]. The warning reads the mean brightness of the face crop once a second and flags the room below 65 (on a 0 to 255 scale), clearing above 75 after three readings in a row, so a passing hand does not trigger it [244]. It appears in the take and in the live test as a status line, never a pop-up [245]. An instrument playing a personal categorizer has no camera pixels to read yet, so that part of the issue stays open.

Distance behaved differently. On a recorded camera dolly from 35.5 to 17.6 cm with a smile held, far against near moved 63.7 NU, more than that fixture's reject radius of 52.7 NU: distance alone can carry a held face out of its category (measured). The effect sits in about a dozen features, since eyes look wider and brows higher as the camera gets closer. It fits the log of face scale better than raw distance, but weakly for most features, and the slope differs by 1.3 to 6 times between moving in and moving out. So one global correction would not be sound. The decision: a distance dial learned per player. The categorizer fits each feature's slope against log face scale from its own samples, keeps it only where r² is at least 0.5, and subtracts it live. A take recorded at one distance teaches nothing, and the dial says so.

The evidence has limits, stated in the doc: one clip with synthetic lighting (real auto-exposure and blur are not modelled) and one 80-frame dolly with head pose mixed in.

### 7.5 Dynamic gestures: the plan

The carve finds held poses. A wave, a nod or a sweep is nothing but transition, which the sampler discards. The design [246], from the issue on moving categories [247], decides that a dynamic category is a different kind of thing, not a flag on a static one. It has its own capture (a named gesture repeated a few times, cut out by a motion segmenter that is the sampler's complement), its own classifier (a window matcher over the same feature stream), its own quality measure (how well the repetitions agree), and its own output (an event carrying progress and variation, not a held membership). It shares the session, the categorizer file, the cue routine, the bindings and the sorting grid with static categories.

The reference algorithm is the Gesture Variation Follower (GVF), a causal particle filter that recognises a gesture before it ends and estimates its phase, speed, scale and rotation [248]. The plan starts lower: dynamic time warping (DTW, a distance that tolerates the same shape performed at different speeds) over a sliding window, in the lineage of the $-family template recognisers [249]. The five phases are filed and open: a motion segmenter that cuts repetitions into traces (acceptance: five scripted waves give five traces, stillness none) [250], the DTW window matcher behind a seam [251], the file section and quality [252], the tool surface with event bindings, which needs a set of real takes [253], and the causal GVF matcher [254]. Nothing is built yet.

## 8. Hand and body pose categories

### 8.1 One mechanism, three body parts

The trainer research recommended training on the feature vector rather than on the face, so any modality would work from the start [255]. The carve redesign made that concrete as the modality seam [228]: one contract, `CarveModality`, for the body part a player carves categories from [256]. A modality is a small object that says which feature groups to claim, how to read its vector out of the merged live vector, which keys a stored sample keeps, which general model proposes names, which nuisances the take should demonstrate, and the words the tool uses ("pose", "hand shape"). Sessions, noise units, clustering, matching and the categorizer file stay modality-free. Face, hand and body are three implementations, and the tools "Your hand shapes" and "Your poses" are the same tool as "Your faces" [64][65]. All personal models live in one collection keyed by modality (decided, [232] choice C5), so command bindings and instruments pick from one list.

### 8.2 Hand shapes

A hand categorizer reads the shape of one hand, side-relative, so either hand makes the same category, with an option to choose left, right or either (decided, choice C4; shipped as phase E8, [257]). Its feature space is chosen by the catalog's declared invariances: every hand feature declared invariant to scale, position and the three rotations, which leaves flexion, spread, pinch and openness [258]. That is the same space the air guitar's chord shapes use, under the same feature ids, so a carved hand categorizer can be offered as the air guitar's chords without translation. Its general model, which proposes default names, is the hand's three rule poses: open, fist and pinch.

Two extensions are open [259]: palm orientation as an option, and a joint two-hand categorizer. The recommendation on palm orientation is "not now": there is no data that it separates shapes, and it would need recording the same shapes at several orientations first.

The Hand-shape Chords instrument plays four shapes (open hand, fist, pointing finger, pinch) as four chords of the key, with hand height still playing the melody [41]. It ships an example categorizer made from the app's scripted hand, so the guide tells players it may not read their hand well and points them to teach their own.

### 8.3 Body poses

Body poses are the second half of the body-movement epic [171]; the first half, conducting with the body, is in chapter 6. The pose research [173] draws on three lines of literature. MediaPipe's pose-classification guide normalises each pose by torso size, rotates it upright, uses k-nearest neighbours with outlier removal, smooths class probabilities and uses enter and exit thresholds, with a few hundred samples per class [260]. thoremin already had the hysteresis and noise-unit distances; it took the torso normalisation. Interactive machine learning tools (section 9.2) set the record, train, test loop. Invariance work, from Procrustes alignment [261] to one-shot skeleton recognition, frames the "few examples per category" regime a personal carve lives in.

The pose feature space (B1, [262]) is the static, body-relative part of the body catalog: joint angles, segment directions in the torso's own frame, body-relative positions and shape ratios [263]. Motion features (speed, effort, pulse) are left out because they belong to dynamic gestures. True-or-false relations are left out because their jitter at rest is exactly zero, so their first flip would be an infinite distance in noise units. Every feature not declared invariant to where the player stands is left out automatically. The segment directions were first specified as two angles each, but every two-angle chart has a pole or a wrap at a common pose (arms hanging, arms up). Three bounded elevations were used instead (decided in review, [264]). Measured on a scripted body: every feature labelled invariant moved less than one noise unit under scale, translation and a 10° turn.

Visibility matters more for a body than for a face. On the committed real clips, the share of the whole pose space present per frame was 0.52 to 0.71 for waist-up conductors and 0.78 to 0.85 for dancers (measured). So the "in view" bar is set against the features a categorizer was trained on, not the whole space: 80 % of them, below which the live test says "Cannot see you" rather than guessing (decided, [265]). Between 80 and 100 % coverage, a missing feature used to make a pose look closer to every category; pose distances are now renormalised over the features present, as an option that leaves faces and hands unchanged [266].

The pose take adds three nuisance demonstrations after the rest, about 4 seconds each: closer and further, a step aside, a slight turn [267]. Whatever moves during them is down-weighted, so where the player stands never decides a pose. A bug fix followed: the deliberate motion of these cues had been feeding the noise estimate, inflating early noise units 1.95 times; after the fix the noise at capture start sits within 0.8 to 1.25 times its value at rest (measured, [268]).

Three further choices stand as decided [232]. Mirror: "left arm up" and "right arm up" are distinct by default, giving a player more categories, with a per-categorizer toggle to merge them. Pictures: a stick figure drawn from the segment directions, not a camera still, because a whole-body photo shows the room and the person while the skeleton carries what sorting needs; camera stills are opt-in. Names: a hand-written prototype vocabulary by context (standing, seated, conductor) assigned one-to-one, with "pose n" as the fallback [269]. Poses are static only; dynamic gestures follow the plan in section 7.5.

Acceptance on a scripted body of four held poses was measured: the take carves into four groups at the suggested count, each holding exactly one scripted pose, with rest as Neutral [270]. On a real dance clip, the dancer's held moments carve and the categorizer reads its own holds back. No real-player evaluation of pose categories exists yet (open).

A pose categorizer can start, hold and cut off the conductor, overriding the default rule-based transport through a stated seam [271], and the Pose Chords instrument plays four poses (both arms up, left arm out, right arm out, crouch) as four chords [42]. Like the hand example, its shipped categorizer comes from a scripted body.

## 9. Trainer mode

### 9.1 The question: tune the model, or let the player teach it?

The trainer began with the owner's complaint that the shipped expression model did not match their faces. The research note [255] diagnoses it as a known problem rather than a tuning failure. Expression recognisers carry identity bias, a subject-dependent accuracy gap, because expressions and identities are entangled [272]. The field's answer is personalisation, which usually stalls because it "depends on subject-specific labels, which are often unavailable" [273]. In an instrument that blocker is gone: the player is present, motivated and willing to spend a minute making faces. The note concludes that a population model is the wrong object and a per-player model is cheap here (decided, [274]).

### 9.2 What the literature offers

Interactive machine learning is the tradition: the user supplies examples in a tight loop and steers the model by demonstration. In music its canonical tool is Wekinator [32], whose point is that retraining is fast enough to be part of playing. IRCAM's mapping-by-demonstration work learns the joint relationship between motion and sound and outputs continuous parameters rather than a class per frame [275]. Teachable Machine is the user-experience benchmark, with classes named up front [276].

The note takes four design moves from this. Cluster still-points, not frames, because a free-motion stream is mostly transitions. Build a hierarchy once and cut it at any count, so "how many categories" can be chosen before or after recording [277]; the dendrogram literature warns that it over-suggests structure, so a suggested count is shown as a suggestion. Give "none of these" first-class status as open-set rejection [278], set by demonstrating a rest face. Get invariance mostly from what the catalog already declares: about 70 % of the invariance request was already built, since every feature declares which nuisances (camera distance, position, head turn) should not move it. The rest comes from demonstration: "hold one face and move closer and further", then down-weight whatever moved.

### 9.3 Cues, routines and sufficiency

Trainer v2 [36] turned a fixed four-step ritual into data. A cue is one thing the system asks the player to do ("look to your left", "hold any face and move closer"); a routine is a saved, ordered list of cues [279]. A cue names the feature groups it attends to, never a modality, which is what later made the hand and body carves possible. Two wording rules are fixed: never show a target face to imitate, since prescribed expressions are the failure the trainer exists to escape; and let the player choose the face.

The runner does not step on a timer. A sufficiency evaluator returns one of four verdicts: need more, need variation (say something such as "a bit further, if you can"), enough, or cannot, which moves on so a player who physically cannot do a cue is not trapped [280]. Every verdict must be computable from data the sampler already captures. Instructions are always written and optionally spoken from pre-generated clips, never live text-to-speech, so a player with sound off loses nothing. The Trainer tool now runs a one-minute guided take [35]; "Your faces" is the newer, easier way to teach faces, and the Trainer is where cues and routines live.

A sibling, the scripted sequence [146], is the opposite case: the player already knows the labels (D5, a G chord) and shows each in turn, as chapter 11 describes [281]. A trainer routine for paired real and air takes followed [282].

### 9.4 Scoring and practice: teaching the player

A categorizer is only useful if the player can find each category again. The quiz names each group twice in random order and watches the settled reading: a group entered within 2 seconds and held for 1 second is a hit, one entered before 5 seconds is slow, and anything later is a miss, recorded with what was read instead [283]. A face already held when the prompt comes does not count until it is released and made again. Results are kept with the categorizer so a later quiz shows drift. The everyday check counts accidental entries during a minute of talking and looking around [284]. Both follow MAGIC, a motion-gesture design tool that measured a gesture's consistency with itself and tested it against a library of everyday movement [285]. The quiz's prompts can also be spoken [286]. Scoring thresholds are defaults, not calibrated on players (open).

The same idea reaches harmony: "Rate this move" lets the player rate chord moves from dark to bright and settled to tense, building a personal model in place of fixed emotion labels (section 13.8) [287].

### 9.5 Personal enrolment

The owner later asked for a guided enrolment "like what Apple does". The research separates what transfers from Face ID [288]. The goal does not: Face ID enrols head pose to factor it out, while an instrument often plays pose as the signal. The ritual does: a ring that works as a coverage meter, steering the user to fill gaps, and a bounded ritual that ends. Biometric practice adds three to five captures per category and quality checks with immediate re-capture before the subject leaves. The proposed ritual is rest, range, nuisance and vocabulary, about 60 to 90 seconds. Much of it shipped in the carve take: the rest, the hold ring, the nuisance cues for poses, and quality chips during sorting rather than after binding.

One rule from the note stands as decided: enrolment must never be a gate. Every instrument plays with no enrolment, and teaching it is an offer that should visibly pay for itself [30]. Continuous learning while playing, which adaptive resonance theory clustering would suit, is kept on the shelf (open).

## 10. Sign language (ASL) recognition: models, datasets and licences

### 10.1 Why signs belong in an instrument

A fingerspelled letter is a hand shape with a name, and seven of those names (A to G) are also the names of notes. That small fact is what brings American Sign Language (ASL) into a music instrument: a player who can spell can choose a chord by spelling its root. thoremin's Instruments view groups four of them as "Sign instruments". **ASL Viewer** is video only: it writes the sign being made in large type and draws a bar per sign it knows [56]. **ASL Chords** is the face-expression chords instrument with letters in place of faces: each letter from A to G plays the chord of the current key whose root has that letter name, with the key's accidentals applied, so in D major F plays F-sharp minor (iii) and C plays C-sharp diminished (vii°) [289]. **Sign Wheel** steers the chord wheel by letters: a letter held for about six readings in a row (a fifth of a second) turns the wheel to its chord, voice-led, and the wedges show which move each letter made from the last chord [57]. **Sign Map** splits the hands: the higher hand spells a letter, which lights its chord on the chord map, and the other hand's height plays a melody on that chord's notes [290].

The letter-to-chord rule (`letterDegree`) lives in core's music theory, and the overlay's generic category cues (`categoryLabel`, `categoryBars`, which draw any classifier's per-class scores) are core too. Everything that reads signs is a plugin [6].

### 10.2 A plugin in its own repository

Since 2026-10-13 the recogniser, its weights, the Python training pipeline, the research write-up and the data's licences live in a separate public repository, thoremin-asl; thoremin's own research page for ASL is now a pointer to it [291]. thoremin depends on the plugin as a git dependency pinned by commit sha, never by branch name, so a deploy builds exactly what was tested [26]. It is a lazy plugin (decided; chapter 1): the bundle carries only about 5 kB of stubs (the `asl` dial, the branches as data, the instruments) and fetches the rest, about 150 kB, on first use [26].

### 10.3 The question and the options surveyed

The question was: can thoremin recognise the fingerspelled alphabet and a few common words (yes, no, hello, thank you, please, sorry, bye) live in the browser, next to the MediaPipe hand model it already runs [5], with a score per class on every frame [292]?

Image classifiers published on Hugging Face (ResNet, CLIP-vision, YOLO) were not adopted and not benchmarked: each is a second full-frame network per frame, tens to hundreds of megabytes, trained on single-background photos. Sign Language MNIST's 28-by-28 crops are too small for a hand detector, and MediaPipe's GestureRecognizer would add a second model for the same idea. The **chosen** route is a small classifier over the hand landmarks thoremin already computes: about 0.1 ms per frame for letters, and weights that fit in kilobytes of JSON [292]. The two Kaggle competitions of 2023 (Google's ASL Fingerspelling and Isolated Sign Language Recognition, 250 signs) are named as the best route to better motion signs, since they are large landmark corpora from many signers, but they need Kaggle credentials and tens of gigabytes, so they are **open** [293][294].

### 10.4 Data, and the licence rule

The rule (decided): **train only on permissively licensed data; data with no licence, or a research-only or non-commercial one, is used only for held-out testing** [295]. The second round (2026-10-13) recorded every licence and fixed the test sets before training.

| Corpus | Licence | Role |
|---|---|---|
| PopSign ASL v1.0 | CC BY 4.0 | words: 32 training, 8 validation, 8 test signers |
| ASL-HG; ASL Alphabet Gestures | CC BY 4.0 | letters: train |
| om192006 keypoints; ASLNow! | MIT | letters: train |
| StudioGalt mocap archive | CC0 | letters, J, Z, some words: train (one avatar signer, low weight) |
| Aslense | MIT on its card, doubtful | letters, J, Z, words: train, minus 238 clips |
| SignAlphaSet | CC BY 4.0 | test only, by choice |
| Marxulia v03 | none stated | test only |
| ASL Citizen | Microsoft research-only | test only |
| WLASL | C-UDA (computational use only) | test only |

The sources are PopSign [296], ASL-HG [297], the ASL Alphabet Gestures images [298], om192006 [299], ASLNow! [300], StudioGalt [301], Aslense [302], SignAlphaSet [303], Marxulia [304], ASL Citizen [305] and WLASL [306]. SignAlphaSet is trainable but held out on purpose: it is the one permissive source no model sees, and the only held-out source for Z.

The audit found a real leak (measured). Aslense contains all 214 ASL Citizen clips of the seven words (208 byte-identical, 6 matched by file name) and 24 more clips byte-identical to WLASL. The models shipped before 2026-10-13 had trained on them, so their ASL Citizen scores were not held out. The current models exclude those 238 clips [292]. The rest of Aslense is still used, although several clips are named like WLASL downloads or dictionary-site videos; keeping it is a recorded, reversible choice awaiting the owner, because Aslense is the only reachable source of J, Z and SORRY training clips [307].

### 10.5 Letters: one frame, one hand shape

Twenty-four letters are static (J and Z are drawn in the air). The features, called `geo`, are 66 numbers: finger flexion (a cosine at each joint), finger spreads, fingertip distances, thumb-to-knuckle distances and the hand's orientation to the camera. Raw coordinates overfit their corpus; geometric features carry across sources (measured: 0.43 to 0.50 top-1 across sources for raw landmarks, 0.625 for `geo`) [292].

Recipes were selected by **leave-one-source-out** validation (train on four training corpora, score on the fifth, average), never on a test set. Mean top-1 rose from 0.729 for the first round's logistic regression to 0.834 for the shipped model, a small multilayer perceptron (MLP) of 66 inputs, 64 hidden units and 24 outputs, trained on 33,717 hands (at most 400 per source and letter, sources weighted equally), about 122 kB of JSON. Held out, the shipped model scores 0.712 top-1 and 0.903 top-3 on all 7,692 Marxulia hands (0.609 and 0.811 for the first round), 0.775 and 0.896 on 9,361 SignAlphaSet stills (0.507 and 0.718), and 0.945 top-1 on 236 SignAlphaSet letter videos when frames vote (0.809).

The hard letters remain the closed fists (M, N, S, T, which differ by where the thumb sits under the fingers, which landmarks see poorly) and the two-finger family (R, U, H, K, V). The model over-reads H on Marxulia, which costs B (recall 0.68 down to 0.47), and on SignAlphaSet reads G as Q (the same hand shape pointing another way) and M as S. For the chord instruments the useful fact is that A to G are among the most reliable letters, G against Q excepted [292].

### 10.6 Motion signs: a window over time

Every one of the words is a movement, so no single frame can read it. A second MLP (146 inputs, hidden layers of 128 and 32, ten outputs) reads windows of the last 0.6, 0.9, 1.3 and 1.8 s of the signing hand: the letter model's output at four times (the hand shape over time), the paths of the wrist and the index and little fingertips in palm lengths at eight times, the path length and the duration. The most confident sign over all windows wins if it reaches the threshold carried in `motion.json`. Because it reads the letter model's output, the two models ship as a pair (decided) [292]. A "none" class, trained on held-letter windows and 848 PopSign clips of 15 other signs, matters: without it a third of held-letter clips fired a word as the hand moved in or out. Both models fuse into one distribution with smoothing, a confidence floor, hysteresis and a one-second latch [308].

Measured at threshold 0.9, the shipped pair detects 0.948 of 919 PopSign clips from eight unseen signers (0.838 for the first round), 0.972 of 36 unseen WLASL clips and 0.869 of 84 ASL Citizen test clips, now genuinely held out. Its weaknesses, all on held-out data: Z is never recognised (0 of 10); J is 5 of 14, down from 10 of 14; HELLO signed as a wave reads as BYE on SignAlphaSet's single signer; SORRY rests on six Aslense clips; and false signs on held letters rose from 12.5% to 19% of clips [292]. The player guide says this plainly: J, Z and sorry are not read reliably yet, because too few openly licensed recordings show them [56].

Cost (measured, first-round models): 0.08 ms per frame for letters, 1.24 ms with the motion windows, about 4% of a 30 fps frame.

### 10.7 Open

Permissive J, Z and SORRY data from many signers, with acceptance "J and Z each detected on at least half of a held-out multi-signer set" [309]. Fewer false motion signs on held letters, by a two-frame rule or a 0.98 threshold, back to 12.5% or below [310]. Location: THANK YOU (from the chin) and HELLO (from the forehead) are told apart by movement alone, and the face landmarks thoremin already has could add where the hand is (hypothesis). Personal calibration of hard letters through the trainer, and a live check with a signer [80]. The ASL branch could ask the hand model for one hand, about 40% cheaper, but the model would then keep whichever hand it found first rather than the higher one [311]. The plugin has no licence until thoremin's own is decided [312][77].

## 11. Fingering priors and sequence training

### 11.1 The question

The air flute plays a note chosen by which fingers are lifted, and it learns each player's fingers by enrolment: type a note name, hold the shape, press Learn. That works but is slow. The owner asked for three things: a scripted sequence (the next target visible, a countdown per target, a lead-in), a picture of how to finger each note, and a prior, "something that could act a bit like a Bayesian prior", so the instrument already knows roughly what each note looks like and training only tunes it to the player and catches a wrong note [313]. The owner also claimed the fingerings are "pretty much the same" across the winds, which the design record checks. The work is issue #263, shipped in three PRs [146][314][315][316].

The background measurement is in section 4.6: on footage of real flautists, key presses are under the tracker's angular noise, so the air flute reads **large, deliberate finger lifts**, not a real flautist's key presses, and air instruments are enrolled per player [134].

### 11.2 The charts as data

A **fingering chart** is a table of which fingers are down for each note. Seven are encoded in one notation (`T123|12-4`: thumb and three fingers of the left hand, then the right hand), with named auxiliary keys and common alternates: the Boehm flute, the baroque and German soprano recorders, the B-flat clarinet, the alto saxophone, the oboe and the tin whistle in D [313]. Sources are the Woodwind Fingering Guide [317][318][319], Yamaha's instrument guides [320] and others listed in the record. No open, machine-readable dataset maps notes to keys; LilyPond's woodwind diagrams are a drawing format and MusicXML's fingering element is a single label [321], so the charts are hand-encoded.

What matters to a camera is the number of distinct shapes, not notes: the flute's 37 notes are 24 shapes, the saxophone's 32 are 25, and the clarinet's 33 are only 9, because its throat tones and its upper register differ by side keys and the register key, which a webcam cannot see. An independent review corrected three charts written from memory (the saxophone's low B-flat and B, the oboe's right hand, the baroque recorder's F and F-sharp), which is recorded as a measure of how far a chart from memory can be trusted.

Is the owner's claim true? Largely, for the six-finger main line: lifting the six fingers in turn from a closed low D gives the D major scale on flute, oboe, saxophone, recorder and whistle alike, and a test checks it degree for degree. It breaks at F and its forked fingerings, at F-sharp, and above all at the clarinet, whose cylindrical bore overblows at the twelfth rather than the octave [322]. So the prior reads only which fingers are down and never the register or auxiliary keys (decided).

### 11.3 From a chart to a prior

On an air instrument a chart's one bit per finger becomes flexion: down is curled, up is straight. The prior therefore speaks only on each finger's flexion features (its curl, and the three joint angles the curl sums) and leaves spreads and pinches alone. Two **anchors** turn bits into numbers: how curled "down" is and how straight "up" is. The defaults (up 0.5, down 2.4 radians summed over three joints; the thumb 0.4 and 1.2) are a guess at a deliberate lift (hypothesis), and `calibrateAnchors` replaces them from whatever the player has enrolled, so one enrolled note calibrates the chart for every other note [313].

The fusion is a **conjugate update**: each note's centroid is a Gaussian mean whose prior sits at the chart's expectation and is worth a fixed number of pseudo-samples, so the posterior mean is `(strength × chart + n × x) / (strength + n)` for n enrolled samples averaging x [323]. The default strength is 10 (decided): with no enrolment the chart plays alone, and since an enrolled note keeps at most 40 samples, the player's own shape outvotes the chart four to one. The fused model is an ordinary trained model, so the classifier and tracker did not change.

One finding came from measurement rather than design. The first version scored an enrolled note on the whole hand vector and a chart-only note on nine curls. That is not one distance. Filling the blanks with the enrolment's mean let an enrolled note steal its neighbours (a synthetic player's unseen notes fell to 74%); leaving them blank made the enrolled note pay its own jitter on seventy features its rivals never paid, and the reviewer measured an enrolled G read as A, F or G-sharp in 29 frames of 30 at twice the test jitter. The fix (decided): every class is scored on the same flexion features, nine curls before enrolment and up to thirty-six once joint angles are calibrated. Both failures are now tests.

What the hand cannot see is handled openly. Notes that use the same fingers on different keys are one class (the flute's low C, C-sharp and E-flat), separated by an alternate fingering where one exists: the flute's B-flat is shown "one and one" so a camera can tell it from B. Octaves are one shape. The fingering the guide draws and the one the prior expects come from one function, `expectedFingering`, so they cannot disagree. A **wrong-note check** (`checkTake`) compares each held sample's distance to the target class and to the nearest other, as a scale-free fraction, against a margin of 0.5; a G held when A was asked is reported as a mismatch.

### 11.4 The sequence

A **sequence** is a list of targets with a lead-in, a countdown before each target, a short settle that is not captured (the hand is still arriving), and a hold. Defaults: 3 s lead-in, 3 s countdown, 0.3 s settle, 2.3 s hold, so a twelve-note scale takes a minute. It runs on a caller-driven clock like the trainer's cue runner, and speaks from a finite set of phrases ("Next: D5.", "Hold D5.", "That looked like G5.") so voice clips can be cached. It is deliberately a sibling of the trainer's routines, not a cue (decided), because a cue never names what to produce (section 9.3) while a sequence is nothing but named targets [255].

The UI shipped in PR #277: the sequence trainer in the air flute's and air guitar's settings, with starter sets, saved sequences as a collection and Skip, Redo and Stop; a fingering guide of two schematic hands; and the chart as a dial (`airFlute.prior`: on or off, chart, weight, range). It is three clicks from a cold load [315].

### 11.5 What was verified, and what is open

Verified on a synthetic flautist (measured): the chart alone names more than 95% of frames for a player who matches the defaults; after enrolling two notes, a "lazy" player who curls less has recalibrated anchors and unseen notes above 90%; an enrolled G reads as G in at least 28 of 30 frames at twice the jitter and under drift. This is a check of the plumbing, not of the defaults: the synthetic hand has no self-occlusion, and its textbook player is defined by the default anchors. A real hand is still untested, tracked on the live-verification list [80]. Open questions for the owner: whether to ship one real player's calibrated anchors as the default, how to make the thumb (the weakest finger for a camera) visible, and whether a sequence should loop twice by default.

## 12. Datasets and licences

### 12.1 The rule and the catalog

thoremin is a public repository, and much of what it measures comes from other people's footage. Two standing rules govern that data. First, the **video-data rule** (decided by the owner on 2026-10-14): every video downloaded to train, test, measure or build a fixture is decoded into all its landmark streams (body pose, hands, face), compressed as gzipped NDJSON (one JSON record per frame), and kept with a `meta.json`; the video itself may be deleted, the streams may not [324]. Landmarks are small and reusable for features nobody has thought of yet; the palm's sign per handedness label was later measured from kept ASL landmarks [211]. Second, the **provenance rule**: a stream enters the repository only when its source licence permits redistribution (CC0, CC BY, CC BY-SA, MIT), with attribution beside it. Streams from standard-YouTube-licence or research-only sources stay local however small, and only numbers measured on them may be committed.

The catalog of every dataset and clip set is one table, `docs/research/datasets.md`, with a row per source: where it came from, its licence, what used it, which derived streams exist and where, and whether the raw media is kept. A new source adds its row in the same PR [325].

### 12.2 Where data lives

The catalog names three places. A **committed fixture** lives under `test/fixtures/` and is allowed only for redistributable sources. The **app-data directory** is outside the repository (set by `THOREMIN_DATA_DIR`, else the platform's per-user data folder), laid out as `<kind>/<corpus>/` with kinds such as `videos` (deletable), `landmarks` (streams and metadata), `labels`, `datasets`, `models` and `results`; it is never committed. **Regenerable** data is rebuilt from code and seeds and need not be kept. The ASL corpus lives in the plugin repository's own app-data directory, as one JSON record per clip [324].

A clip's `meta.json` records the source, its licence with its URL, the source's own description verbatim, the labels and where each came from, the fetch date, the video's hash and format, and per stream the extractor, model version and thresholds. One tool (`scripts/video_streams.py`) runs the three extractors: pose first, then hands on the whole frame and on a square around each pose wrist, then the face on a head crop, because the face detector misses a face much under a tenth of the frame.

### 12.3 What the project uses

The catalog holds 14 rows. By licence class: five Creative Commons, two with the licence not recorded, two generated by code, two the owner's or a player's own, one made for the repository with AI video generation, one standard YouTube licence kept local, and the ASL corpus licensed per source [161].

The **choir conductor** clips (Wikimedia Commons, CC BY 3.0) and the **Budots dance** video (CC BY 3.0) became committed fixtures: pose excerpts with a body feature vector and a beat grid in the meta, used for the channel-by-level measurement and the body conductor. A **Budots soundtrack** fixture holds 115 beats from thoremin's own beat tracker, explicitly not ground truth. Six other Commons body clips (licences from CC0 to CC BY-SA 4.0) were fetched as candidates and kept only in the app-data directory. Running the hand model on pose-guided wrist crops raised hand detection (measured): Beethoven 5 from 32% to 49% of frames, Budots 41% to 54%, the twerk choreography 22% to 42%, the conductor clips to 91 to 100%; dark or tiny hands stayed near 0 to 7% [326].

The **AI-generated gesture clips** (hand sweep, open and close, pinch, face expressions) were made for the repository, and the prompts are in the generating script. A **head-pose recording** is the owner's own, with face landmarks deliberately stripped. Six hands from the ASL Alphabet Gestures set (CC BY 4.0) became the `hand_palm_forward` fixture, landmarks only. The **synthetic impact bench** and the **synthetic hands and body** are generated and regenerable. The **air instruments footage** (guitar, flute, bass and drum lessons from YouTube) is standard-licence: its streams stay in the app-data directory and only numbers are committed in the research doc. **Real-vs-air takes** are a player's own recordings and never leave the app-data directory [325].

### 12.4 What still needs recording

Several gaps can only be closed by a person, and each is a `manual-task` issue. The **Que Calor** choreography and the **conducting-pattern** clips came from YouTube with no recorded licence, yet both feed committed fixtures (`video_body_que_calor` and `conducting_{44,34,24}`); the server cannot read the YouTube pages, so the owner must look up each licence and decide whether a stream derived from a standard-licence video may stay public [327] (the earlier issue that raised it, #417, was closed in its favour [328]). The impact predictor's real-hand acceptance needs one recorded "Real vs air: taps" take, because synthetic strokes cannot show whether a faster stroke brakes harder [128]. Microphone chord detection is tested only on synthesised chords and needs a few labelled five-second clips of guitar, piano, silence and speech [329]. The body work needs one clip of a person bouncing to a known tempo, and the AIST++ decision of section 5.7 [182]. Shared face categorizers ("Seven expressions" and "Easy four") need the owner to record and export them; the file holds blendshape numbers, not pictures [237].

Two recording inconsistencies are worth naming. The catalog's ASL row still says training uses "only MIT sources", and the plugin's recogniser page speaks of "MIT-licensed corpora", but since the 2026-10-13 retraining the training set also includes CC BY 4.0 and CC0 corpora; the plugin's attributions file is the current source of truth [295][308]. And the licence gaps on the plugin side are open too: whether to keep the doubtful Aslense clips [307], whether to rewrite history to drop old ASL Citizen landmarks [330], and the repositories' own licence, which waits on the owner's open-source strategy [77].

## 13. Harmony: chord layouts, relations, navigation and realization

The chord instruments turn a gesture into a choice of harmony: which chord sounds, when it changes, and how it is voiced. This chapter follows that work from a single video, through the music-theory and interface literature, to a design that splits every chord instrument into seven reusable parts.

### 13.1 The question and the starting point

The question, as the owner put it, was whether thoremin could have an instrument like the "Motion Capture Harmonic Map" shown in a video by the creator Pur Pasteur [331][332]. The video could not be downloaded, so the project's research note works from the page's description, its chapter list and four published frames, and marks everything about the tool's behaviour in time as inferred from stills [18].

What the frames show is a webcam app. The left hand points into a hexagonal lattice of the seven diatonic triads of one key (the triads built on each note of the scale: C, Dm, Em, F, G, Am and B° in C major). The right hand picks notes of the current chord from a vertical ladder. Measured on one frame, the lattice has three axes: across a row each step is a diatonic fourth up, the down-right diagonal is a third up and the down-left diagonal a second down, which is +3, +2 and -1 scale steps modulo 7. These are the video's "three dimensions of harmonic movement". Each edge around the selected chord carries an emotion label such as "Sad resolution, Acceptance".

The research note derives one property the video does not state. The six neighbours of any cell sit at offsets ±1, ±2 and ±3, which are all six non-zero residues modulo 7. So every cell touches one copy of each of the other six chords: the plane is a seven-colouring of the hexagonal tiling, a seven-cell torus unrolled. Distance on this map carries no information, since every chord is one step from every other; what the layout encodes is the direction of a move, that is, which interval the roots move by. Later issues name the structure: the complete graph on seven vertices drawn on a torus, Heawood's map [333]. This property turns out to be the main reason the layout works for a camera, as section 13.4 explains.

### 13.2 Chord spaces and layouts in the literature

The research note sorts prior instruments into families [18].

**Chord-button grids** give one control per chord and split a chord into which (a button) and when (a strum). The Omnichord holds a chord button while a finger slides along a strum plate [334]. The Stradella bass of the accordion orders 20 columns by the circle of fifths, so a key's I, IV and V are adjacent columns [335]. Autoharp chord bars damp every string outside the chord; one layout designer warns that relearning a layout "can be expensive in terms of time and effort" [336]. Modern pad controllers and apps (Ableton Push, Launchpad's Chord Mode, InstaChord, GarageBand's chord strips) put a key's diatonic chords on a handful of buttons [337][338]. Novice chord instruments stay small: 7, 8 or 9 chord targets.

**Isomorphic note layouts** give one control per note, laid out so that every interval has the same shape everywhere, so a chord fingered once moves to any key unchanged. Examples are Wicki-Hayden, the Jankó keyboard and the harmonic table, which puts a fifth up each column and major and minor thirds on the diagonals, so every root-position triad is a triangle of three adjacent keys [339]. Maupin, Gerhard and Park enumerated these layouts and judged them on paper only [340].

**The Tonnetz.** Euler's 1739 lattice of pitches, later developed by Oettingen and Riemann, has one axis per consonant interval (fifth, major third, minor third). Major and minor triads are triangles that tile the plane, and two triangles that share an edge share two notes [341]. Neo-Riemannian theory names the three moves across a triangle's edges: P (parallel, C major to C minor), R (relative, C major to A minor) and L (leading-tone exchange, C major to E minor). Each keeps two common tones, each is its own inverse, and together they generate a dihedral group of order 24 that acts on the 24 major and minor triads [342]. Cohn's hexatonic cycles, Douthett and Steinbach's "Cube Dance" and "Power Towers", and Hook's uniform triadic transformations extend this vocabulary [343][344][345]. Hook's result matters for the design: every triadic move can be written as a sign (keep or flip the mode) plus two transpositions modulo 12, one for major roots and one for minor. That makes a move one row of data.

**Voice-leading geometry.** Tymoczko models an n-note chord as a point in an orbifold (a space quotiented by octave and order) and a voice leading as a path between points [346], generalised with Callender and Quinn [347]. Two of his findings shape thoremin. First, adjacency on a lattice is not voice-leading distance: on the Tonnetz C to F is two steps and C to f three, although C to f needs less total motion [348]. Second, between two chords of the same size a minimal voice leading with no crossed voices always exists [349]. Inside one key, the seven triads form the "diatonic circle of thirds" (I, vi, IV, ii, vii°, V, iii), each between its two smoothest neighbours [350].

**Circles and functional maps.** Steinberg's Chord Assistant puts the twelve major chords around a circle of fifths with their minors inside [351]. Hooktheory's Trends ranks next chords by a Markov analysis of its song database [352].

**Learnability evidence is thin and mixed.** The claim that isomorphic layouts ease learning dates from the nineteenth century and was barely tested until recently. MacRitchie and Milne (24 musicians) found that placing major seconds side by side improved accuracy [353]. Stanford, Milne and MacRitchie (68 participants, preregistered) found isomorphism helped musicians transfer learning in the trained key, while for non-musicians "the results were mixed" [354]. Holland's Harmony Space and the camera-tracked Harmonic Walk floor report learning gains in small studies that do not separate the layout from the novelty of the setting [355][356]. The research note infers that in-key layouts sidestep the transfer problem: with one key on the surface, a pattern of degrees is already key-independent.

### 13.3 Relations, distance, tension and emotion

The second research note, the evidence for the design, treats harmony as relations between chords and asks what each relation means [357].

**Root motion.** Meeus reduces tonal syntax to two classes of root progression [358]. Dominant progressions move a fifth down, or as substitutes a third down or a second up. Subdominant progressions do the reverse. In Bach's chorale BWV 321, 23 of 25 progressions (92 %) are dominant. The research note reads the video's six directions through this lens: three are dominant moves and three subdominant. It also observes that in a major key a step of two (a third) keeps two common tones, a step of three (a fourth) keeps one and a step of one (a second) keeps none. The video's three cycles are therefore at once three interval classes, three levels of common-tone retention and a forward/backward split. This gives the design a theory-derived edge weight that needs no data.

**Tension models.** Lerdahl's tonal pitch space defines a chord distance δ = i + j + k: moves of the key region on the circle of fifths, moves of the chord root on the diatonic circle of fifths, and the pitch classes new against the reference chord [359][360]. The values are small integers (V to I is 5), and de Haas and colleagues restate the rule in a form ready for code [361]. Chew's spiral array places pitches on a helix of fifths, and Herremans and Chew derive three tension measures from distances in it [362][363]. Bigand, Parncutt and Lerdahl found that perceived tension in short sequences rises as shared pitches fall and as voices move further [364]. The research note concludes that two tension models are cheap enough for a browser: Lerdahl's integer distance (a table lookup) and the spiral array's distances (a few Euclidean distances per tick).

**Corpus statistics depend on style.** In Beethoven's quartets, progressions are directed: V to I is 14.7 % of transitions and I to V 10.9 % [365]. In de Clercq and Temperley's rock corpus, root motion is nearly symmetric (a fourth up 2,266 times, a fourth down 2,220) [366]. A weighted chord space therefore needs a named prior, not one global table. Licences also differ across corpora, and the research note flags this as a decision for the owner.

**Emotion.** Lahdelma and Eerola's 269 listeners rated single chords. Valence (pleasantness) was highest for the major triad (4.04 of 5) and lowest for diminished and augmented triads, and inversion changed valence too [367]. Major-positive and minor-negative is robust, but without a single accepted explanation [368]. Context changes a chord's reading, because a major chord ending a stable progression is rated more pleasant than one ending an unstable one [369]. Specific chromatic moves carry learned film-music meanings, such as the major tritone progression for outer space [370]. The research note found no study that assigns emotions to diatonic root movements by interval class. Its status for the video's labels is plain: unsupported, and the creator's own.

### 13.4 Navigating by gesture

A camera hand is not a button, and three problems follow from that.

**Precision.** With marker tracking, absolute ray-casting at a large display had a 56 % error rate on targets 0.3 % of the display wide, but under 1.1 % on targets about 3 % wide [371]. MediaPipe adds its own noise. Against a marker system, its finger joint angles had a mean root-mean-square error of 22.5° [372]. thoremin measured the frame-to-frame jitter of a still hand at about 2 px at 640 px width, about 0.3 % of the frame [18]. A seven-cell lattice filling most of the frame is an order of magnitude larger than either limit, so cell size is not the constraint. What matters is the cell edges and what the hand crosses on its way.

**Transit, the Midas touch problem.** Jacob named this problem for gaze: if looking acts, "everywhere you look, another command is activated". He found dwells of 150 to 250 ms "excellent" for selections that are easy to undo [373]. A hand that selects by position triggers every cell it passes. Chord-button instruments avoid this by construction, because choosing makes no sound until the strum. The EyeHarp separates aiming from triggering for the same reason (chapter 1) [17]. On the video's lattice every chord has a copy adjacent to the current cell (13.1), so any change can be one move across a shared edge with no other chord on the way. This is the derived property's practical value.

**Latency.** Chapter 3 gives the thresholds and thoremin's measured path, about 100 ms from hand to speaker plus the camera hardware [81]. A theremin player stops noticing high latencies in slow passages with vibrato [87], so a sustained chord tolerates the camera's latency, while a percussive strum must be predicted ahead of the frame that shows it (chapter 4).

**Relative layouts.** A wheel centred on the current chord is a radial menu. Pie menus were about 15 % faster than linear menus [374]. In Kurtenbach and Buxton's tests, reliable expert selection held for 8-item marking menus up to two levels deep, but not for 12 items [375]. In a study of 88 people, reading a Tonnetz at first sight required music-theory skill [376]. A raw Tonnetz is therefore a poor surface to aim at, while an egocentric wheel asks only "which direction".

**What thoremin built and decided.** The chord map chooses a chord after two camera frames over it (about 67 ms at 30 fps, under Jacob's dwell range). It switches only once the hand is nearer the new cell's centre than the sounding cell's by 0.12 cell widths, a hysteresis that keeps a hand resting on an edge from flickering between chords. It keeps a chord sounding 0.3 s after the hand is lost. The default hex is 0.2 frame heights wide. These are decided values; whether they feel right is a live check still pending on the owner's checklist [377][80]. The design adds one rule that ties layout to navigation. A dynamic layout, which moves its targets when the chord changes, must be navigated relatively (by direction or displacement), because an absolute pointer on it would be over a different target the moment its choice commits. The composer refuses the wrong pairing and names both parts in the error [378].

Commit timing is a policy with five forms: immediate, dwell, gated by a trigger, quantized to the beat, or predicted ahead of the frame. The fourth follows Ableton's launch quantization and Band-in-a-Box's anticipation marks [379][380]. Chords can also arrive from outside the camera. A MIDI keyboard's held notes are read as a chord in any inversion and committed after a short dwell, so passing tones do not flicker the harmony. A microphone's spectrum is folded into a 12-bin chroma (a pitch-class profile) and matched to chord templates, after Fujishima [141]. The key stays a setting, because key-finding from audio needs seconds [381].

### 13.5 Realization: from a chord to notes

Realization is the pipeline from an abstract chord in a key to sounding notes. The design splits it into five seams after the owner's list: coloration (extensions such as the seventh), reduction (which tones to drop), bass (inversion), voicing (vertical spacing, with memory of the previous chord) and figuration (block, strum, arpeggio). Splitting it this way is decided, and the strongest evidence for it is Chen and colleagues' finding that learned jazz reharmonization works better as two stages, colouring then voicing, than end to end [382]. The bass gets its own seam because it is expressive on its own: in Lahdelma and Eerola's ratings the major triad's valence rose from root position (3.91) to second inversion (4.32) [367].

The video's second chapter is "chord degrees with common-tone voice leading". thoremin's original renderer stacked every chord the same way from its root, so changes jumped. The voice-led voicer added in step H3 keeps the bass where the existing voicing styles put it, then moves the upper voices as little as possible from the previous chord's upper voices, holding common tones. Tymoczko's no-crossing result means a small exhaustive search is exact: at most three upper voices, each tried at two or three octaves. The search's cost function also penalises the faults an arranger avoids: drifting from home, a muddy low interval, and parallel fifths and octaves [383]. A smooth bass rule picks the chord tone nearest the previous bass, so C to G can become C to G/B. A diatonic-seventh coloration adds the seventh the key gives each chord. Voicing memory is forgotten after 4 s of silence, so the first chord after a rest starts from a neutral register rather than from a voicing heard a minute ago.

Strummed chords reuse the air guitar's predicted strum. The impact predictor commits the stroke ahead of the frame that shows it, the chord is latched at that moment and voiced as a guitarist would, and a stroke caught late still sounds, softer [384].

### 13.6 The harmonic layers design

After the chord map shipped [385], the owner asked for the video's map to be treated as one instance of many ways to relate and lay out chords, with reusable layers for every chord instrument, the face-expression chords included [43]. The design record answers with seven parts. Each is a pure TypeScript contract in `@thoremin/sdk/harmony/` with strategies behind it [378]:

| Part | Question it answers |
|---|---|
| Chord | what a chord is before any notes (root, quality with tone roles, optional bass) |
| Space | which chords exist and how named relations connect them (a labelled graph) |
| State | key, current chord, its function, history, and what is pending and when |
| Layout | where each chord or move appears on screen, possibly depending on the state |
| Navigation | how input features become a chosen chord or move, and when it commits |
| Realization | coloration, reduction, bass, voicing, figuration |
| Rendering | synth voices, timed note events, MIDI, the overlay |

Relations are data. Diatonic steps, P, L and R with their compounds, functional moves (dominant of, relative, parallel, borrowed from the parallel mode) and chromatic mediants all fit one catalogue. A space is built from relations by combinators (generated, diatonic, union, restrict, weighted, annotated). Distance lives in a separate module, kept apart from adjacency because of Tymoczko's warning that the two differ. Before this design, three chord vocabularies coexisted in the code, and five chord nodes held copies of one renderer; the design replaces both with one registry and one realizer.

**The decisions.** The chord-map issue recorded seven choices with recommendations, and the work proceeded on them [377]. Hold and strum ship as two instruments, with hold as the default because it is the video's tool. The video's emotion labels are not copied: each edge is captioned with the move it makes ("4th up"), because the labels are unsourced. The hex map is the default layout. Triads only for now, with a modifier gesture proposed if sevenths are wanted. Voice-led voicing goes into the shared renderer so every instrument gains it. The two still open, the video itself and a live check with webcam and ears, are in section 13.9.

The epic's eight choices followed the same pattern [386]: the harmony slice became its own package (#674); the emotion labels again stay out, replaced by interval captions plus a player-editable set; transition statistics start from a theory-derived prior, with an open corpus only once its licence is confirmed and never a network call in the tick; in combined instruments the face colours the chord rather than choosing it, because a hand chooses more reliably; the old chord nodes stay as wrappers over the shared libraries; a held chord changes at once by default, on the beat as an option; voice-led voicing is the default only for the Harmonic Map and new instruments, because existing saved settings say otherwise; and MIDI and audio input are gated on browser capability.

**What has landed.** By 20 October the plan's steps had landed, each with an independent review [43]. H6 lets categories target moves, functions or controls, not only degrees. H7 turns valence into a mode change and arousal into added tensions. H8 brings MIDI and microphone input, H9 the beat clocks and the chord chart, H10 tension with Piston's prior, H11 walking a cycle on the beat and H13 key and mode changes. Follow-ups closed since include scale-generic maps (#671), the wheel's surprise control (#672), the face's affect read from the player's own rest (#673), idiom paths drawn as ghost trails (#713) and computed move captions (#714).

Two rules from the research run through the shipped code. First, tension is always shown with the name of the model that measured it, because the models disagree. The functional ladder makes V tenser than ii, since a dominant pulls, while Lerdahl's distance and the Krumhansl-Kessler key profile both put ii further from home [387]. Second, the transition prior is Piston's table of usual root progressions (USUALLY, SOMETIMES, LESS OFTEN). This is a theory prior that raises no licence question [388][389]. Face affect follows the evidence. Valence maps to mode, the main valence rule of Livingstone's system [390]. Arousal maps to colour and density, not chord choice, because in AffectMachine "arousal had no influence on the chord progression selected" [391][392].

### 13.7 The instruments

The guide documents the chord instruments that embody these layers; chapter 2 introduces them, and this list gives what each takes from the design:

- **Chord Map**: the video's honeycomb in a key, with the left palm choosing and the right hand playing the chord's tones [44]. **Chord Map Strum** replaces the melody hand with a predicted strum.
- **Chord Map + Face**: the hands choose and the face colours. A smile held about a second turns the key to its parallel major, a frown back to minor, and an open mouth with raised brows adds the seventh, then the ninth. The face is read against the player's own resting face, and the instrument starts in A minor so the smile has somewhere to go [45].
- **Chord Map Paths**: the map as a teacher. A dashed ghost trail shows Pachelbel's ground or another idiom ahead of the current chord, computed captions describe each move ("smooth, darker, surprising"), and a turning torus shows the three cycles as loops [15].
- **Chord Wheel**: the current chord in the centre and the key's six moves at fixed angles around it. Push toward one and hold, and the wheel recentres [46]. **Next-Chord Wheel** ranks the moves by Piston's prior, writes a named tension value under each chord, and lets the other hand's height bring rarer moves to the top. This surprise control follows Manaris's Harmonic Navigator and Cheung's finding that pleasure peaks where surprise and uncertainty trade off [48][393][394]. **Tonnetz Wheel** swaps in P, L, R and their compounds, which leave the key while each step changes only one or two notes [47]. **Wheel Walk** makes a held push repeat its move on every beat, so a held fourth walks all seven chords and comes home [395].
- **Head Chords**: head yaw is split into one slice per chord, the open mouth gates the sound, raised brows add the seventh and a nod shifts the octave [40].
- **Conduct the Chords** (hand and body variants, chapter 6): a Haydn quartet reduced to its chords beat by beat, voice-led and arpeggiated on the conductor's beat [54][55].

### 13.8 Rate this move: the player's own model

The research left the video's emotion labels unsupported, and showed that context changes how a chord is heard. The honest alternative to fixed labels is a personal model, which issue #715 proposed [287]. PR #812 shipped it [396]. In the chord map's editor section, "Rate this move" plays a move between two chords as a soft sine triad, through its own audio context so it is heard whatever the instrument is doing. The player places the move on two sliders, dark to bright and settled to tense. Ratings are stored by scale degree and mode, so I to vi rated in C also reads on G to Em. There are 42 moves per mode, each keeps its last 12 ratings, and the mean becomes a word once it is a third of the way to either end. The ratings form a third caption set, "Yours", beside the interval and computed captions. The status is decided and shipped; whether the ratings are stable across sessions is open, since no measurement has been made.

The follow-up #809 is open [397]. It would offer the rated tension as a fourth tension model beside the functional ladder, Lerdahl's distance and the key profile, so the wheel's ranking and the captions' tension direction could read the player's own ears. The obstacle is architectural: the tension models are a static table chosen by id, so the ratings would have to reach the wheel through a port, with unrated moves falling back to a named model.

### 13.9 What is still open

- **Boundary blending** (#716, experimental): a hand on a hex vertex would sound the three adjacent chords cross-faded, since their union is the scale minus one note. There is no evidence yet that it sounds good, so it would start behind a dial [398].
- **A rotating 3-D torus for teaching** (#717, low priority): a display-only view of the seven-chord map as Heawood's map, lighting the three cycles as loops. Chord Map Paths already draws a turning torus; the issue remains open on the tracker [333].
- **A chord instruments group of its own** (#705): the chord instruments still sit under the air instruments' class in the Instruments view. Giving them their own class would remove the harmony slice's dependency on the air extension, at the cost of a visible change to the view [76].
- **Removing the deprecated `chord` and `progression` nodes** (#783): no instrument composes them, but saved graphs must be checked before removal [399].
- **Live checks** on #146: whether two frames of dwell and 0.12 cell widths of hysteresis feel right, whether strums land on time, and how voice-led changes sound [80]. Recordings for the microphone chord fixture also wait on the owner [329].
- **The video's middle chapters** (the 3-D map, the tension graph) remain unseen [377].

## 14. Generative instruments

### 14.1 The question

Can a generative music model sit inside a thoremin instrument, steered by the same hand and face features that play notes, rather than beside it as a separate DJ? The design record frames the gesture not as a note but as a musical intention: a point in the generator's control space (prompt weights, density, brightness) [58].

### 14.2 What the model offers, and what the literature says

Lyria RealTime is Google's experimental streaming music model. A client opens a persistent bidirectional WebSocket and steers it with weighted text prompts plus a generation config. It returns raw 16-bit PCM audio at 48 kHz in stereo, with a stated control latency of at most two seconds [400][401]. The config exposes `bpm` (60 to 200), `density` and `brightness` (0 to 1), `guidance` (0 to 6, default 4, where higher values follow the prompts more closely but make transitions more abrupt) and `temperature`. Changing `bpm` or `scale` needs a context reset, which is a hard transition. Every update must send the whole configuration, or the omitted fields reset to their defaults. The model is instrumental only, and safety filters can ignore a prompt [400].

The design record surveyed in-browser alternatives and measured their costs (measured, 9 September 2026). Magenta.js checkpoints are 5.6 to 18.5 MB (Piano Genie 1.2 MB), but the library pins TensorFlow.js 2.x while thoremin ships 4.22, and two copies of the runtime conflict. Magenta itself is frozen. ONNX Runtime Web is a runtime with no small, steerable, permissively licensed music model to run. MusicGen-small through transformers.js is about 656 MB and produces offline clips. Magenta RealTime 2 has an open-weights 230-million-parameter variant, but its community browser port fetches about 1.7 GB and needs cross-origin isolation headers. The record's conclusion is that only small symbolic models are realistic client-side, and live audio generation in the browser is out of budget [58]. On gesture-steered generation, it found published work driving fixed scores, samples or MIDI from pose and hands [402][403], but nobody steering Lyria RealTime or Magenta RealTime from MediaPipe hands in a browser. That is why the feel of the result is "an ears question, not a literature question".

### 14.3 What was decided and built

**The legacy AI-DJ (#128, decided).** The original app's Lyria AI-DJ, steered by on-screen sliders, was stranded by the switch to the DAG app, and #128 forced the choice: port it, or retire it. It was retired to the URL flag `?engine=legacy`, frozen but reachable, a fully reversible status decision [59]. The gesture-steered version, which had only ever existed as a node tested against a mock engine, was budgeted honestly as new work in #141 [404]. That issue's definition of done named the trap to avoid: a capability in the bundle with no way to switch it on.

**The branch (#141, shipped).** The generative layer is an additive parallel branch, `indirect-map` to `lyria`, off by default, and since the vertical-slices work it lives in its own slice [6]. The `indirect-map` node is pure and deterministic. It maps hand and face features to the weights of named prompts ("strains") and to config dials, with smoothing and a throttle, and Lyria wants steering updates roughly every 0.2 s. Its starter configuration binds "warm ambient pads" to the right hand's openness and "bright plucked arpeggios" to the left hand's height [405]. The `lyria` node fires and forgets. Audio never enters the DAG; the engine sums into the master bus out of band, as MIDI output does. Because the engine schedules about two seconds ahead, the design states plainly that this branch can only conduct, never play: a hand changes the character of the next phrase, not the next note.

**Switches and safety.** `steer.enabled` is a dial: off means nothing loads and nothing connects. The play/pause transport, `steerPlaying`, is deliberately not a dial and not a command. An instrument saved while playing would otherwise start a paid cloud stream on load, and no assistant tool or gesture should be able to start one. It is toggled by the Play button and the `p` key [58][6]. The player brings their own Gemini key, shared with the AI assistant. Scalar steering commands (`steer.strain.add`, `steer.dial.set` and others) let the editor, the command palette and the assistant edit the config without object-typed parameters, which Gemini's tool schema rejects.

**Lazy loading (measured).** The generative work turned lazy loading into a catalogued pattern. A heavy node imports its implementation only on demand, through a seam a host can inject, and reports one shared status vocabulary: off, unavailable, loading, ready, active, error. Applying the pattern to `lyria` moved the Google SDK out of the main chunk, shrinking it from 1,193 kB to 929 kB (338 kB to 286 kB gzipped) [58][406].

### 14.4 What is still open

The headless half is merged and live. Lyria itself has not yet been heard through thoremin. Item B8 of the owner's live checklist covers it: music arriving 2 to 4 s after Play, an honest amber prompt when no key is present, no auto-resume after a reload, and whether hand-steered strain weights "feel like conducting" [80][107]. The design also expects vendor drift: the official samples moved to API version `v1beta` while the WebSocket path is still `v1alpha`, and the pricing page has no row for RealTime, so cost and quota are unverified. The first live construction is meant to settle the version string.

One known defect is open. A 2026-10-20 adversarial review of audio scheduling found that the engine's `pause()` starts its fade-out ramp from a stale anchor. After a minute of play the gain drops almost to zero at once, a click, instead of fading. The fix, anchoring the ramp at the current value as the song slice already does, is recommended but not applied, because it changes what a player hears [407]. Further ahead, an in-browser symbolic accompaniment node (Magenta-class, about 12 to 18 MB per checkpoint) and generated timbres are recorded as later work, waiting on a runtime conflict and a model worth its download.

## 15. What lies ahead

This chapter describes what thoremin has not done yet: planned work, missing measurements, choices that only the owner can make, and directions recorded so that today's code does not shut them off. Its sources are the roadmap [408] and the open issues as of 21 October 2026. The roadmap was last swept on 13 October and several of its "next" items have closed since, so where the two disagree, this chapter follows the issue tracker.

### 15.1 The roadmap as it stands

The roadmap has two horizons: a list of next items by track, and an older arc of engine milestones, M0 to M8, tracked by an umbrella issue [73]. Seven of the nine are done: M0, the DAG engine and its node contract; M1, the first slice from video to sound; M2, record and replay with a CI gate; M3, the deployed app running through the DAG; M4, a broader feature and harmony surface; M5, the conductor; and M8, the Stream Applier [409].

M6 is partly done. MIDI out and deployment shipped, and the patcher shipped at its decided v1 scope: a read-only view of the live graph with a settings inspector, as a lazy extension [410]. Editing the graph is the rest of M6, now filed as patcher v2 [411]. M7 is an optional backend: a Python feature service and a self-hosted generative service. It has not been started. The decision behind it still holds: thoremin runs entirely in the browser, and node interfaces stay clean enough for a backend to plug in later (decided).

Most of the roadmap's "next" list has closed: the conductor epic, the impact-predictor refinements, the three hand-model issues (the CPU delegate, one hand for one-hand instruments, a worker), and the personal face categorizer epic. Still open from it are:

- live verification [80];
- the rhythm umbrella [153];
- the face-control roadmap [222];
- the configuration calculus [412];
- two zodal migrations [413][414];
- the accounts note [415];
- the open-source question [77].

The rhythm umbrella has three criteria for publishing `ictus` as its own package. One is met: the package README now states a supported frame-rate range (measured). That range is 24 to 60 fps supported, 15 to 20 fps degraded, and below 15 fps unsupported [416][417]. The other two are not met: the open-source question has no answer, and no consumer outside this repository uses the package.

### 15.2 Near term: work with a plan

**Dynamic gestures.** The largest planned addition is gestures that move, such as a wave or a sweep, which the carve's still-point sampler discards by design. Section 7.5 describes the design [246][247]: a dynamic category is a different kind of object, built in five filed issues from a motion segmenter [250] to the Gesture Variation Follower [254]. The note favours per-segment firing first, and records that the tool's thresholds need a set of real takes, which only a person can supply (open).

**Hands.** The two open hand-model issues, giving a one-hand instrument the hand it reads when both are in view [109] and sparing a body-only conductor the hand model [110], are described in section 3.5.

**Harmony.** The harmonic-layers epic [43], which split chord instruments into seven composable parts [378], has landed its planned steps and stays open only for follow-ups. Of its research ideas, idiom-path ghost trails [418], computed move captions [419] and "Rate this move" [287] are closed. The five still open are listed in section 13.9: the torus view, whose geometry and overlay have merged [333][420][421]; boundary blending (hypothesis) [398]; rated tension as a fourth tension model [397]; a chord-instrument group [76]; and removing the deprecated chord nodes [399].

**Conductor and body.** The conductor epic is closed. Two follow-ups are about scope: an opt-in to keep the air instruments sounding while a piece is conducted [150], and a retry of meter recognition with annotated footage from several conductors, after the first attempt was closed as measured-not-viable (section 6.6) [214]. Four are measurements that need real footage (section 6.5): the shaping hand's stroke floor [210], the trunk's lead offset [208], the upbeat on a very clean tracker [206] and the wrist-versus-stick-tip offset [205]. For the dancer's pulse (chapter 5), the faster response to tempo steps shipped on and the red-noise guard off [180]; whether the head and hip channels earn their place waits for a second dance fixture [179], and the pace controller still has no phase target [169].

**Timing, flute and patcher.** The timing plan is complete: #226's code shipped, and the issue closes only when a person runs the latency probe on a real webcam [94]. A microphone breath onset as the air flute's gate needs a self-recorded take [147]. Patcher v2 has three parts, each the owner's product-scope choice: swapping an implementation in a slot, editing the topology (does a hand-edited `GraphSpec` round-trip through the composer?), and saving an edited graph as an instrument [411].

**Reliability.** An adversarial review on 20 October filed a cluster of small bugs, each with a stated fix:

- new synth voices glide up from 440 Hz, so a 110 Hz note is still 2.4 semitones sharp after 90 ms [422];
- Lyria's pause clicks instead of fading [407];
- a late monophonic note damps one already committed [151];
- the hands freeze if the fallback runner fails to load [111];
- the store breaks on a full localStorage [423], or on a stale second tab [424];
- the sweep for orphaned stills gets stuck [425];
- four cases of stored data have no golden test [426].

The synth fix is one line. It waits only because it changes what a player hears.

### 15.3 Research questions still open

Most of the remaining research questions need a recording by a real person: synthetic data can bound an answer but cannot settle it. Each answer would unblock something specific:

- **One real-versus-air taps take** [128]. It would show whether real strokes brake in a way their approach predicts, which the synthetic bound of section 4.3 cannot, and would finish the predictor's last acceptance tests.
- **A real webcam's pose noise.** The fixtures sit at about 2.3e-3 torso lengths per step. A real reading would decide whether the body upbeat should be recognised by its shape [107].
- **A clip of someone bouncing to a known tempo** [182]. It would firm up the dancer defaults, which stay provisional because no head, hip or trunk channel locked to the beat in the dance clips measured so far.
- **A Safari timing run** [108]. The animation-frame stamp shortfall is 0.7 ms on Chromium (measured) and unknown on WebKit. If it is close to a display period, the default timing would change.
- **Labelled microphone clips** [329], since microphone chord detection has been tested only on synthesized chords (section 12.4).
- **Meter, trunk lag and wrist-versus-tip** (section 15.2), the **thresholds for dynamic gestures**, the **breath gate** and the **rated tension**.

Two smaller questions are open as well. One is how long the first re-cut of a 2,000-hold file takes on a real tablet: later re-cuts already run in a worker, but a cold cache still builds on the page (section 7.2) [235]. The other is the face-control roadmap [222], which keeps per-user calibration and making the emotion classifier opt-in. The yaw and roll signs there wait for one trainer run, which supplies the player's own frame of reference.

All of these converge on the live-verification issue [80], a ranked checklist. Part 1 is five-minute webcam checks. Part 2 is longer ones. Part 3 needs ears, a DAW or an API key. Part 4 is one-line decisions. New checks are appended as features ship, most recently the harmony series and the conductor's hold fade. Answering Part 1 changes what gets built next. The rest mostly confirms what already shipped.

### 15.4 Decisions the owner holds

The owner's judgments live in labelled manual-task issues, each phrased to be answered in one line and stating what each answer would do; agents proceed on a reversible recommendation and record it rather than wait. A decision pass on 20 October, at the owner's request, adopted the recommendations the owner had delegated and left the reserved items alone.

The decision inbox [107] holds most of them:

- **D7: the amended 15 fps acceptance for timing step 1.** At 30 fps every conducting row equals or beats the old code. At 15 fps one 4/4 row drops 0.087 in F-measure, about one anchor in twelve. The whole bench improves, as section 4.2 reports. Accepting closes it. Declining opens an issue to chase that anchor.
- **Q4: the handedness dwell default.** It shipped as a dial at 0 frames. An answer settles whether flicker in the hand labels is filtered by default.
- **Q6: running the generative layer live.** This needs a Gemini key and ears. It would settle the API version and whether the steering sounds right.
- **D11a and D11b: the two audible latency levers of section 3.5.** The pitch ramp reaches 90 % of a new pitch in about 23 ms instead of 69, and the soft clip saves 6 ms (measured offline). Both wait for ears.
- **D14: hand inference in a Web Worker by default** (section 3.4). A headed run on real hardware would decide it.
- **D15: recognising the body upbeat by its shape** (section 6.5). The option is built and off.
- **Torso visibility and the shaping hand.** One change would silence poses when the torso is mostly out of frame. The other would measure the shaping hand against the trunk. Both are built and off, waiting for a real take to set thresholds.
- **The final-ritard prior** of section 6.7 [427], off until a listening check.

Settled items are kept for the record. For example, the orchestra now follows a score's written dynamics, which landed in #743 (decided).

The decision pass also ratified as shipped the harmonic-layers choices [386] and five of the seven chord-map choices [377]. The two chord-map items left need the owner in person. One is the source video of the original harmonic-map tool, whose middle chapters on tension the research could not reach. The other is a live check of chord-change latency and edge hysteresis. Of the carve and body-movement choices [232], everything stands except B6: whether a full-body instrument may shed hand inference. That returns only if a profiler shows the hand model taking more than 20 % of the tick.

The other manual tasks ask for settings or material:

- **#388: branch protection on `main`, and whether deployment waits for CI** [428]. Today CI reports but does not gate, so a red pull request can be merged.
- **The licences, takes and recordings of section 12.4**: the AIST++ decision [182], the two YouTube licences behind the Que Calor and conducting fixtures [327], the two shared face categorizers [237], and the takes, clips and runs of section 15.3 (#684, #675, #592).

### 15.5 Longer horizon

Three directions are recorded so that current work does not paint them into a corner.

The first is composition. The configuration-calculus design treats an instrument as a sparse settings layer that can be stacked with others [412]. Its four design answers are unratified: precedence with visible shadowing, leaf-level deep merge, dangling references as no-op layers with a warning, and a free-form axis tag. It is kept design-only for now, because its first phase would add stored data to player profiles. Two questions wait on it: whether an exported instrument carries its face categorizer inline [236], and what a saved, hand-edited graph is [411].

The second is accounts and cloud save [415]. The owner's recorded direction is that authentication comes later, stays optional, and is needed only to save to the cloud. The app stays local-first and fully usable without an account. The issue sets four rules for current work:

- persistence goes through a data-provider seam;
- every record is portable, with a version, an id and JSON import and export;
- no feature assumes an account;
- tier checks will become one named capability seam.

Its open questions are the sign-in provider, where cloud data lives, the split between free, authenticated and paying users, and what a private repository would mean for the public demo.

The third is what to open-source and what to keep private [77]. It is an open business question, reserved to the owner and marked as not for agents. The repository split and the publication of `ictus` both wait on it [153].

## 16. Glossary

**Actuality, intent, sounding good**: Three conflicting timing objectives: reflect what the body did, what the player meant, and what fits the music.

**Adaptive oscillator**: A phase-and-period model that corrects itself on each event through an attentional window, after Large and Kolen.

**Anchor**: A timing candidate (time, confidence) emitted by a detector; the rhythm prior decides whether it confirms a beat, changes tempo or is noise.

**App-data directory**: The per-user data folder outside the repository where non-committable streams, videos, labels and models live.

**AudioWorklet**: A script that runs on the browser's real-time audio thread, immune to stalls of the page's main thread.

**Blendshape**: A score from 0 to 1 that MediaPipe gives each frame for one named facial movement, such as jaw open.

**Capture stamp**: The time a camera frame was captured, read from requestVideoFrameCallback's captureTime, used instead of the moment inference ran.

**Carve (carving)**: Turning a recorded take into personal categories by clustering its held moments and letting the player sort, merge, split, name and test them.

**Categorizer**: A small personal model, saved in the browser, that maps a feature vector to one of a player's named categories or to "none of these".

**Command / dial**: A dial is one validated setting; a command is a named, typed action in the single registry, and the only discrete way to write a dial.

**Conjugate prior**: A prior whose update with Gaussian samples gives a posterior mean that is a pseudo-count-weighted average of the prior mean and the sample mean.

**Cue and routine**: A cue is one thing the trainer asks the player to do; a routine is a saved, ordered list of cues.

**DAG (directed acyclic graph)**: A set of computation nodes joined by one-way edges with no loops, evaluated once per tick in dependency order; thoremin's engine.

**Diatonic triad**: A three-note chord built on a note of a scale from that scale's own notes, so a seven-note key has seven of them (in C: C, Dm, Em, F, G, Am, B°).

**Dynamic layout**: A layout whose targets move when the current chord changes (a recentred wheel), which must be navigated by direction rather than by absolute pointing.

**Dynamic time warping (DTW)**: A distance between two traces that tolerates the same shape performed at different speeds.

**Extension**: One manifest that contributes nodes, branches, seeds, settings and panels to the app; a lazy extension's code loads only on first use.

**Fingering chart**: A table of which fingers are down for each note of a wind instrument.

**Fingerspelling**: Spelling a word letter by letter with the hand shapes of a sign language's manual alphabet.

**Fixture replay**: Testing a node or graph by feeding it streams recorded from earlier runs, saved as NDJSON, with no camera.

**Held-out test set**: Data no model is trained or tuned on, used only to report accuracy.

**Hold**: One held face, hand shape or pose: the mean of a still window plus its supporting frames, the unit a player moves when sorting.

**Hysteresis**: A margin a new choice must exceed before it replaces the current one, so a hand on a boundary does not flicker between two cells.

**Ictus**: The instant within a conducting stroke where the beat lands, taken in thoremin as the braking into the stroke's turning point.

**Impact predictor**: The estimator that extrapolates a stroke's approach to a known or learned floor and commits a predicted impact time before any frame shows it.

**Instrument**: A named saved set of every setting, which the player loads from the library; distinct from a sound.

**Jitter**: The variation of latency from one event to the next; listeners judge it as harshly as the mean delay.

**Latency**: The time from a player's movement to the sound it causes reaching the ear.

**Leave-one-player-out**: An evaluation that trains on some players and tests on a player never seen, the honest test of transfer.

**Leave-one-source-out**: Validation that trains on all corpora but one and scores on the one left out, measuring transfer across sources.

**Lyria RealTime**: Google's experimental streaming music model, steered over a WebSocket by weighted text prompts and a config, returning 48 kHz stereo audio.

**Magnetism**: The 0-to-1 setting that pulls a continuous pitch toward the notes of the chosen scale, from free glide to hard snap.

**Modality seam**: The `CarveModality` contract that lets face, hand and body share one carve, differing only in features, words and nuisances.

**Motion sign**: A sign defined by movement (J, Z and every supported word), read from windows of 0.6 to 1.8 s rather than from one frame.

**MusicalTime**: The single state every leader publishes: beat, phase, tempo, confidence, next-beat forecast and transport state.

**Neo-Riemannian P, L, R**: The three triad moves (parallel, leading-tone exchange, relative) that keep two common tones and move one voice by a semitone or a tone.

**Node / component**: One small, typed, configurable computation in the graph, with declared input and output ports and a Zod schema for its parameters.

**Noise unit (NU)**: A feature's own frame-to-frame jitter at rest, used as the unit of every carve distance so different features are comparable.

**Pace controller**: The ictus control law that sets a song's playback rate from the dancer's pulse by a held integer ratio, clamp and phase nudge.

**Phase coherence R**: The length of the mean phase vector of anchors within a cycle: 1 means perfect locking, 0 none.

**Provenance rule**: Data derived from a source whose licence does not allow redistribution never enters the public repository; only numbers measured on it may.

**Pulse**: The period, phase and confidence of a dancer's repeating motion, inferred from one body channel's autocorrelation.

**Quality chip**: A per-category grade (close, OK, distinct) from the distance to the nearest other category over the category's own spread.

**Realization**: The pipeline from an abstract chord to sounding notes: coloration, reduction, bass, voicing and figuration.

**Red noise**: A slowly wandering, low-passed random signal that can masquerade as a slow periodic pulse.

**Reject radius**: The distance beyond which a reading belongs to no category and reads as "none of these".

**Rhythm prior**: A running model of where the next beat should fall, such as the adaptive oscillator, the trend prior or their blend.

**Seed**: One of the instruments the app ships with, the starting entries of the player's library.

**Slot**: A named swap point in the graph that configuration fills with one of several compatible nodes, such as a webcam, synthetic or replayed hand source.

**Sound**: A timbre preset, such as a bell, a pad or a reed.

**Stick tip**: An estimated point beyond the hand along the line of a held or imagined drumstick, tracked instead of the wrist.

**Still-point sampler**: The front end of the carve that keeps a frame window only when the feature vector has stayed still for a dwell (220 ms), storing its mean as a hold.

**Strain**: In thoremin's generative layer, a named text prompt whose weight a hand or face feature drives.

**Stride**: The ankles' signed horizontal distance, the default channel of the dancer's pulse.

**Timing magnet**: A dial from 0 to 1 that pulls a predicted onset toward the rhythm prior's nearest expected beat.

**Tonnetz**: Euler's lattice of pitches with one axis per consonant interval, on which major and minor triads are triangles and neighbouring triangles share two notes.

**Transit (Midas touch) problem**: When selecting by position, every target the hand or gaze passes through is selected on the way.

**Transition prior**: A model of how likely each next chord is after the current one; thoremin's is Piston's theory table, always named where it orders anything.

**Trunk and branch**: The trunk is the part of the graph every instrument shares; a branch is a named, reusable piece of graph an instrument declares and attaches to it.

**Vertical slice**: A feature kept in one directory, from nodes to panels, contributing through the extension contract.

**Video-data rule**: Every downloaded video keeps all its landmark streams with a meta.json; the video itself may be deleted.

**Voice leading**: How the individual notes (voices) of one chord move to the next; minimal voice leading moves them as little as possible, holding common tones.

## References

[1] thoremin. Player guide: home page. [guide/index.md](https://github.com/thorwhalen/thoremin/blob/main/guide/index.md)

[2] thoremin. The live app. [apps.thorwhalen.com/thoremin](https://apps.thorwhalen.com/thoremin/)

[3] thoremin. Player guide. [apps.thorwhalen.com/thoremin/guide](https://apps.thorwhalen.com/thoremin/guide/)

[4] thoremin. README. [README.md](https://github.com/thorwhalen/thoremin/blob/main/README.md)

[5] Google. MediaPipe Solutions: on-device hand, face and pose landmarkers. [ai.google.dev/edge/mediapipe](https://ai.google.dev/edge/mediapipe/solutions/guide)

[6] thoremin. Agent and contributor instructions (architecture summary, gates, vocabulary). [CLAUDE.md](https://github.com/thorwhalen/thoremin/blob/main/CLAUDE.md)

[7] thorwhalen. theremin: the sibling Python project thoremin generalizes. [github.com/thorwhalen/theremin](https://github.com/thorwhalen/theremin)

[8] thoremin. Player guide: Feature Lab. [guide/tools/lab.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/lab.md)

[9] thoremin. The direct to indirect mapping spectrum. [docs/MAPPING_SPECTRUM.md](https://github.com/thorwhalen/thoremin/blob/main/docs/MAPPING_SPECTRUM.md)

[10] thoremin discussion #4. The direct to indirect mapping spectrum and conductor mode. [thorwhalen/thoremin discussion #4](https://github.com/thorwhalen/thoremin/discussions/4)

[11] thoremin. Player guide: Pentatonic. [guide/instruments/pentatonic.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/pentatonic.md)

[12] thoremin. Player guide: Play Along (MIDI). [guide/instruments/play-along-midi.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/play-along-midi.md)

[13] thoremin. Player guide: settings. [guide/settings.md](https://github.com/thorwhalen/thoremin/blob/main/guide/settings.md)

[14] thoremin. Player guide: Record. [guide/tools/record.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/record.md)

[15] thoremin. Player guide: Chord Map Paths. [guide/instruments/chord-map-paths.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/chord-map-paths.md)

[16] Frid E. Accessible digital musical instruments: a review of musical interfaces in inclusive music practice. Multimodal Technologies and Interaction. 2019;3(3):57. [doi:10.3390/mti3030057](https://doi.org/10.3390/mti3030057); [PDF](https://mdpi-res.com/d_attachment/mti/mti-03-00057/article_deploy/mti-03-00057-v4.pdf)

[17] Vamvakousis Z, Ramirez R. The EyeHarp: a gaze-controlled digital musical instrument. Frontiers in Psychology. 2016;7:906. [frontiersin.org](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.00906/full)

[18] thoremin. Chord layouts research. [docs/research/chord-layouts.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/chord-layouts.md)

[19] thoremin. Architecture. [docs/ARCHITECTURE.md](https://github.com/thorwhalen/thoremin/blob/main/docs/ARCHITECTURE.md)

[20] i2mint. meshed: Python library for typed dataflow graphs (DAGs). [github.com/i2mint/meshed](https://github.com/i2mint/meshed)

[21] thoremin discussion #3. Architecture: the DAG spine and the six layers. [thorwhalen/thoremin discussion #3](https://github.com/thorwhalen/thoremin/discussions/3)

[22] thoremin. Testing strategy (DAG-aware record and replay). [docs/TESTING.md](https://github.com/thorwhalen/thoremin/blob/main/docs/TESTING.md)

[23] thoremin. Component model: superseding "the six layers". [docs/design/component-model.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/component-model.md)

[24] thoremin. ADR: instruments as declared graphs, and thoremin as a core with extensions. [docs/design/instruments-as-graphs-and-extensions.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/instruments-as-graphs-and-extensions.md)

[25] thoremin. Lazy extensions: a plugin's code loads when the player asks for it. [docs/design/lazy-extensions.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/lazy-extensions.md)

[26] thoremin-asl. README: American Sign Language for thoremin. [README.md](https://github.com/thorwhalen/thoremin-asl/blob/main/README.md)

[27] thoremin. Architecture review: vertical slices and one extension contract. [docs/design/vertical-slices.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/vertical-slices.md)

[28] thoremin issue #600. Epic: vertical slices and one extension contract (architecture refactor S1-S20). [thorwhalen/thoremin#600](https://github.com/thorwhalen/thoremin/issues/600)

[29] thoremin. Command dispatch: the single write path for param-mutations. [docs/design/command-dispatch.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/command-dispatch.md)

[30] thoremin. Player guide: teach it yourself. [guide/teach-it-yourself.md](https://github.com/thorwhalen/thoremin/blob/main/guide/teach-it-yourself.md)

[31] thoremin. Player guide: Your faces. [guide/tools/faces.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/faces.md)

[32] Fiebrink R. The Wekinator: a system for real-time, interactive machine learning in music. ISMIR 2010 late-breaking demo. [archives.ismir.net](https://archives.ismir.net/ismir2010/latebreaking/000012.pdf)

[33] Fiebrink R, Cook PR, Trueman D. Human model evaluation in interactive supervised learning. Proc. CHI. 2011. [doi:10.1145/1978942.1978965](https://doi.org/10.1145/1978942.1978965)

[34] thoremin issue #330. Personal facial-expression categorizers: record, carve into k, label, test, correct, reuse per instrument. [thorwhalen/thoremin#330](https://github.com/thorwhalen/thoremin/issues/330)

[35] thoremin. Player guide: Trainer. [guide/tools/trainer.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/trainer.md)

[36] thoremin issue #163. Trainer v2: cues and routines, spoken dynamic guidance, and a projection view you label categories in. [thorwhalen/thoremin#163](https://github.com/thorwhalen/thoremin/issues/163)

[37] thoremin. Player guide: Wrist Theremin. [guide/instruments/wrist-theremin.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/wrist-theremin.md)

[38] thoremin. Player guide: Finger FX. [guide/instruments/finger-fx.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/finger-fx.md)

[39] thoremin. Player guide: Glass Bells. [guide/instruments/glass-bells.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/glass-bells.md)

[40] thoremin. Player guide: Head Chords. [guide/instruments/head-chords.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/head-chords.md)

[41] thoremin. Player guide: Hand-shape Chords. [guide/instruments/hand-shape-chords.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/hand-shape-chords.md)

[42] thoremin. Player guide: Pose Chords. [guide/instruments/pose-chords.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/pose-chords.md)

[43] thoremin issue #613. Harmonic layers: chord spaces, layouts, navigation and realization as composable parts (epic). [thorwhalen/thoremin#613](https://github.com/thorwhalen/thoremin/issues/613)

[44] thoremin. Player guide: Chord Map. [guide/instruments/chord-map.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/chord-map.md)

[45] thoremin. Player guide: Chord Map + Face. [guide/instruments/chord-map-face.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/chord-map-face.md)

[46] thoremin. Player guide: Chord Wheel. [guide/instruments/chord-wheel.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/chord-wheel.md)

[47] thoremin. Player guide: Tonnetz Wheel. [guide/instruments/tonnetz-wheel.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/tonnetz-wheel.md)

[48] thoremin. Player guide: Next-Chord Wheel. [guide/instruments/next-chord-wheel.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/next-chord-wheel.md)

[49] thoremin. Player guide: Play Along (microphone). [guide/instruments/play-along-microphone.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/play-along-microphone.md)

[50] thoremin. Player guide: Air Drum. [guide/instruments/air-drum.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/air-drum.md)

[51] thoremin. Player guide: Air Bass. [guide/instruments/air-bass.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/air-bass.md)

[52] thoremin. Player guide: Air Guitar. [guide/instruments/air-guitar.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/air-guitar.md)

[53] thoremin. Player guide: Air Flute. [guide/instruments/air-flute.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/air-flute.md)

[54] thoremin. Player guide: Conduct the Chords. [guide/instruments/conduct-the-chords.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/conduct-the-chords.md)

[55] thoremin. Player guide: Conduct the Chords (Body). [guide/instruments/conduct-the-chords-body.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/conduct-the-chords-body.md)

[56] thoremin. Player guide: ASL Viewer. [guide/instruments/asl-viewer.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/asl-viewer.md)

[57] thoremin. Player guide: Sign Wheel. [guide/instruments/sign-wheel.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/sign-wheel.md)

[58] thoremin. Generative AI inside instruments, and lazy loading as a catalogued pattern. [docs/design/generative-instruments.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/generative-instruments.md)

[59] thoremin issue #128. Generative layer in the DAG app: port the Lyria AI-DJ into the default view, or formally retire it to ?engine=legacy. [thorwhalen/thoremin#128](https://github.com/thorwhalen/thoremin/issues/128)

[60] thoremin. Player guide: Annotations. [guide/tools/annotations.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/annotations.md)

[61] thoremin. Player guide: Patcher. [guide/tools/patcher.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/patcher.md)

[62] thoremin issue #14. M6: React Flow patcher UI driven by Zod node configs. [thorwhalen/thoremin#14](https://github.com/thorwhalen/thoremin/issues/14)

[63] thoremin issue #181. #14 patcher UI: decide the scope before the build is scheduled. [thorwhalen/thoremin#181](https://github.com/thorwhalen/thoremin/issues/181)

[64] thoremin. Player guide: Your hand shapes. [guide/tools/hand-shapes.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/hand-shapes.md)

[65] thoremin. Player guide: Your poses. [guide/tools/poses.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/poses.md)

[66] thoremin. Player guide: Gestures. [guide/tools/gestures.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/gestures.md)

[67] thoremin. Player guide: Conductor. [guide/tools/conductor.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/conductor.md)

[68] thoremin. Player guide: conduct and dance. [guide/conduct-and-dance.md](https://github.com/thorwhalen/thoremin/blob/main/guide/conduct-and-dance.md)

[69] thoremin. Player guide: Song. [guide/tools/song.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/song.md)

[70] thoremin. Player guide: Commands. [guide/tools/commands.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/commands.md)

[71] thoremin. Player guide: Assistant. [guide/tools/assistant.md](https://github.com/thorwhalen/thoremin/blob/main/guide/tools/assistant.md)

[72] thoremin. Player guide: troubleshooting. [guide/troubleshooting.md](https://github.com/thorwhalen/thoremin/blob/main/guide/troubleshooting.md)

[73] thoremin issue #5. Roadmap: DAG real-time sonification (M0-M7). [thorwhalen/thoremin#5](https://github.com/thorwhalen/thoremin/issues/5)

[74] thoremin issue #788. Core still names the air extension in six library and editor files (#600 residual). [thorwhalen/thoremin#788](https://github.com/thorwhalen/thoremin/issues/788)

[75] thoremin issue #659. Stores that bypass the storage seam (#600 S12 follow-up). [thorwhalen/thoremin#659](https://github.com/thorwhalen/thoremin/issues/659)

[76] thoremin issue #705. A Chord instruments group of its own in the Instruments view. [thorwhalen/thoremin#705](https://github.com/thorwhalen/thoremin/issues/705)

[77] thoremin issue #262. Strategy: what to open-source vs. keep private (commercialisation, extensions). [thorwhalen/thoremin#262](https://github.com/thorwhalen/thoremin/issues/262)

[78] thoremin. Test suite directory. [test/](https://github.com/thorwhalen/thoremin/tree/main/test)

[79] thoremin. What CI would cost if this repo were private. [docs/CI_COST.md](https://github.com/thorwhalen/thoremin/blob/main/docs/CI_COST.md)

[80] thoremin issue #146. Live verification needed (webcam and human eyes). [thorwhalen/thoremin#146](https://github.com/thorwhalen/thoremin/issues/146)

[81] thoremin. Where the lag comes from, and whether another language would cut it. [docs/research/latency-budget-and-browser-realtime.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/latency-budget-and-browser-realtime.md)

[82] thoremin issue #227. Measure end-to-end event-to-sound latency (camera to landmark to audio). [thorwhalen/thoremin#227](https://github.com/thorwhalen/thoremin/issues/227)

[83] Bachhuber C, Steinbach E. A system for high precision glass-to-glass delay measurements in video communication. In: Proc. IEEE ICIP 2016. [arXiv PDF](https://arxiv.org/pdf/1510.01134); doi:10.1109/ICIP.2016.7532735

[84] Tsao P. Webcam-Latency-Measurement. GitHub; the README's example run measures 108 ms for one USB webcam. [github.com/perrytsao/Webcam-Latency-Measurement](https://github.com/perrytsao/Webcam-Latency-Measurement)

[85] Hays M, Mullen T. MediaPipe on the Web. Google Developers Blog. 28 Jan 2020. [developers.googleblog.com](https://developers.googleblog.com/en/mediapipe-on-the-web/)

[86] thoremin. Intent, actuality, and sounding good: musical timing beyond the frame rate. [docs/research/intent-and-subframe-timing.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/intent-and-subframe-timing.md)

[87] Mäki-Patola T, Hämäläinen P. Latency tolerance for gesture controlled continuous sound instrument without tactile feedback. In: Proc. International Computer Music Conference (ICMC). Miami; 2004. [PDF](https://users.aalto.fi/~hamalap5/publications/icmcarticlefinal10.pdf)

[88] Jack RH, Stockman T, McPherson A. Effect of latency on performer interaction and subjective quality assessment of a digital musical instrument. In: Proc. Audio Mostly 2016. Norrköping; 2016. [doi:10.1145/2986416.2986428](https://doi.org/10.1145/2986416.2986428)

[89] Wessel D, Wright M. Problems and prospects for intimate musical control of computers. Computer Music Journal. 2002;26(3):11-22. [MIT Press](https://direct.mit.edu/comj/article-abstract/26/3/11/94758)

[90] Dahl S, Bresin R. Is the player more influenced by the auditory than the tactile feedback from the instrument? In: Proc. COST-G6 Conference on Digital Audio Effects (DAFx-01). Limerick; 2001. p. 194-197. [publications list](https://www.immm.hmtm-hannover.de/en/institute/alumni/sofia-dahl/publications/)

[91] Rasch RA. Synchronization in performed ensemble music. Acustica. 1979;43(2):121-131. Summarised in Wing AM et al. J R Soc Interface. 2014;11:20131125. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4196478)

[92] Repp BH. Sensorimotor synchronization: a review of the tapping literature. Psychon Bull Rev. 2005;12(6):969-92. [doi:10.3758/BF03206433](https://doi.org/10.3758/BF03206433)

[93] W3C WICG. HTMLVideoElement.requestVideoFrameCallback(), VideoFrameCallbackMetadata. [spec](https://wicg.github.io/video-rvfc/)

[94] thoremin issue #226. Stamp landmark frames with requestVideoFrameCallback captureTime, not inference time. [thorwhalen/thoremin#226](https://github.com/thorwhalen/thoremin/issues/226)

[95] Jangda A, Powers B, Berger ED, Guha A. Not so fast: analyzing the performance of WebAssembly vs. native code. In: Proc. USENIX ATC 2019. [USENIX](https://www.usenix.org/conference/atc19/presentation/jangda)

[96] W3C Audio Working Group. Web Audio API 1.1. Editor's Draft. [webaudio.github.io/web-audio-api](https://webaudio.github.io/web-audio-api/)

[97] Choi H. Audio worklet design pattern. Chrome for Developers. Updated 18 Jun 2018. [developer.chrome.com](https://developer.chrome.com/blog/audio-worklet-design-pattern)

[98] jamieonkeys. Keeping audio and visuals in sync with the Web Audio API. Jul 2022. [jamieonkeys.dev](https://www.jamieonkeys.dev/posts/web-audio-api-output-latency/)

[99] thoremin. Stream Applier: pluggable sources and batch or paced execution. [docs/design/stream-applier.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/stream-applier.md)

[100] thoremin. Lazy loading as a catalogued pattern. [docs/design/lazy-loading.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/lazy-loading.md)

[101] thoremin issue #240. Latency: the levers the measured budget points at (glide, compressor look-ahead, 60 fps, inference worker). [thorwhalen/thoremin#240](https://github.com/thorwhalen/thoremin/issues/240)

[102] thoremin issue #324. Hand model on the CPU delegate finds no hands at 640x360. [thorwhalen/thoremin#324](https://github.com/thorwhalen/thoremin/issues/324)

[103] thoremin issue #325. numHands: 1 for one-hand instruments (about 40 % off the hand model). [thorwhalen/thoremin#325](https://github.com/thorwhalen/thoremin/issues/325)

[104] thoremin issue #634. Hand count: with one hand allowed and both in view, prefer the hand the instrument reads, and the real-GPU before/after. [thorwhalen/thoremin#634](https://github.com/thorwhalen/thoremin/issues/634)

[105] thoremin issue #326. Timing step 5: hand inference off the main thread. [thorwhalen/thoremin#326](https://github.com/thorwhalen/thoremin/issues/326)

[106] thoremin issue #545. Clock stamps on the animation-frame path: the capture-lag shift is approximate. [thorwhalen/thoremin#545](https://github.com/thorwhalen/thoremin/issues/545)

[107] thoremin issue #168. Decisions needed from you: six answers that unblock four issues. [thorwhalen/thoremin#168](https://github.com/thorwhalen/thoremin/issues/168)

[108] thoremin issue #592. Run clock_stamp_shortfall.mjs on Safari/WebKit. [thorwhalen/thoremin#592](https://github.com/thorwhalen/thoremin/issues/592)

[109] thoremin issue #784. Hands: with hands: 1 and two hands in view, prefer the hand the instrument reads. [thorwhalen/thoremin#784](https://github.com/thorwhalen/thoremin/issues/784)

[110] thoremin issue #793. Hands: a conductor that reads the body still asks the hand model for a hand. [thorwhalen/thoremin#793](https://github.com/thorwhalen/thoremin/issues/793)

[111] thoremin issue #737. Hand runner: when the main-thread replacement after a worker death fails to load, the hands freeze for the session. [thorwhalen/thoremin#737](https://github.com/thorwhalen/thoremin/issues/737)

[112] Dragan AD, Srinivasa SS. A policy-blending formalism for shared control. Int J Robot Res. 2013;32(7):790-805. [doi:10.1177/0278364913490324](https://doi.org/10.1177/0278364913490324)

[113] Desain P, Honing H. The quantization of musical time: a connectionist approach. Computer Music Journal. 1989;13(3):56-66. [JSTOR](https://www.jstor.org/stable/3680012)

[114] Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed mathematical model. J Neurosci. 1985;5(7):1688-1703. [doi:10.1523/JNEUROSCI.05-07-01688.1985](https://doi.org/10.1523/JNEUROSCI.05-07-01688.1985)

[115] Dahl S. Playing the accent: comparing striking velocity and timing in an ostinato rhythm performed by four drummers. Acta Acustica united with Acustica. 2004;90(4):762-776. [PDF](http://www.sofiadahl.net/pdf/paper2-accents2.pdf)

[116] Lee DN. A theory of visual control of braking based on information about time-to-collision. Perception. 1976;5(4):437-459. [doi:10.1068/p050437](https://doi.org/10.1068/p050437)

[117] Azuma R, Bishop G. A frequency-domain analysis of head-motion prediction. In: Proc. SIGGRAPH 1995. p. 401-408. [doi:10.1145/218380.218496](https://doi.org/10.1145/218380.218496)

[118] Knibbe J, Benko H, Wilson AD. Juggling the effects of latency: motion prediction approaches to reducing latency in dynamic projector-camera systems. Microsoft Research Technical Report MSR-TR-2015-35; 2015. [PDF](https://www.hbenko.com/publications/2015/Juggling_Knibbe_MSR_TR.pdf)

[119] Aerodrums. Latency (forum thread stating 125 fps for Aerodrums 1 and 132 fps for Aerodrums 2). [aerodrums.com](https://aerodrums.com/forums/viewtopic.php?t=83)

[120] thorwhalen. an.impacts: a synthetic impact harness, in an, structured animation. 2026. [github.com/thorwhalen/an](https://github.com/thorwhalen/an)

[121] thoremin. Sub-frame impact prediction from body video: method, harness, numbers. [docs/research/subframe-impact-prediction.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/subframe-impact-prediction.md)

[122] thoremin issue #231. ictus detector: the median-of-three prefilter costs 5 ms and a frame on sharp turns. [thorwhalen/thoremin#231](https://github.com/thorwhalen/thoremin/issues/231)

[123] Bernier YW. Latency compensating methods in client/server in-game protocol design and optimization. In: Game Developers Conference 2001. [PDF](https://www.gamedevs.org/uploads/latency-compensation-in-client-server-protocols.pdf)

[124] thoremin issue #234. Impact predictor: air strokes at 24/30 fps predicted no tighter than the frame-snapped baseline. [thorwhalen/thoremin#234](https://github.com/thorwhalen/thoremin/issues/234)

[125] thoremin issue #352. Impact predictor: the air prediction's late mean after #234. [thorwhalen/thoremin#352](https://github.com/thorwhalen/thoremin/issues/352)

[126] thoremin pull request #686. Impact predictor: a stroke-variability clip set, and a per-player template bounded before it is built. [thorwhalen/thoremin#686](https://github.com/thorwhalen/thoremin/pull/686)

[127] thoremin issue #351. Impact predictor: a per-player stroke template, measured on the stroke-variability clips and a real-hand take. [thorwhalen/thoremin#351](https://github.com/thorwhalen/thoremin/issues/351)

[128] thoremin issue #684. Record one real-vs-air taps take, for the impact predictor's real-hand acceptance. [thorwhalen/thoremin#684](https://github.com/thorwhalen/thoremin/issues/684)

[129] Large EW, Kolen JF. Resonance and the perception of musical meter. Connection Science. 1994;6(2-3):177-208. [doi:10.1080/09540099408915723](https://doi.org/10.1080/09540099408915723)

[130] Large EW, Jones MR. The dynamics of attending: how people track time-varying events. Psychol Rev. 1999;106(1):119-159. [doi:10.1037/0033-295X.106.1.119](https://doi.org/10.1037/0033-295X.106.1.119)

[131] Cemgil AT, Kappen B, Desain P, Honing H. On tempo tracking: tempogram representation and Kalman filtering. J New Music Res. 2000;29(4):259-273. [doi:10.1080/09298210008565462](https://doi.org/10.1080/09298210008565462)

[132] thoremin issue #232. Rhythm prior: the adaptive oscillator runs 65-75 ms late under an accelerando; wire or blend the trend prior. [thorwhalen/thoremin#232](https://github.com/thorwhalen/thoremin/issues/232)

[133] thoremin issue #239. Air drum: magnetism helps at 0 ms delay, hurts at 40 ms. [thorwhalen/thoremin#239](https://github.com/thorwhalen/thoremin/issues/239)

[134] thoremin. Air instruments: prior art, a footage pipeline, and a first model (guitar chord shapes). [docs/research/air-instruments.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/air-instruments.md)

[135] Dahl L. Triggering sounds from discrete air gestures: what movement feature has the best timing? In: Proc. NIME 2014. [PDF](https://www.nime.org/proceedings/2014/nime2014_514.pdf)

[136] thoremin issue #246. Air drum anchors from hand landmarks / stick tip instead of wrists. [thorwhalen/thoremin#246](https://github.com/thorwhalen/thoremin/issues/246)

[137] thoremin issue #261. Air drum pads: straight-line landing fit throws wide-arc (hard) hits off their pads. [thorwhalen/thoremin#261](https://github.com/thorwhalen/thoremin/issues/261)

[138] thoremin issue #353. Air drum: a change of pad is read against the previous pad's floor (per-pad floors). [thorwhalen/thoremin#353](https://github.com/thorwhalen/thoremin/issues/353)

[139] thoremin issue #533. Air drum: the pad a stroke heads for is chosen by where it starts, which fails when stroke height varies. [thorwhalen/thoremin#533](https://github.com/thorwhalen/thoremin/issues/533)

[140] thoremin issue #538. Air drum: the first stroke on a never-struck stacked pad is still read against the learned pad. [thorwhalen/thoremin#538](https://github.com/thorwhalen/thoremin/issues/538)

[141] Fujishima T. Realtime chord recognition of musical sound: a system using Common Lisp Music. In: Proc. ICMC 1999. p. 464-467. [Semantic Scholar](https://www.semanticscholar.org/paper/c9a84645f0e9f3498bf8e4ebfdc1150a86faf78c)

[142] Hrybyk A, Kim YE. Combined audio and video analysis for guitar chord identification. In: Proc. ISMIR 2010. [PDF](https://ismir2010.ismir.net/proceedings/ismir2010-29.pdf)

[143] thoremin issue #249. Air instruments are instruments: an 'Air instruments' category in the Instruments view. [thorwhalen/thoremin#249](https://github.com/thorwhalen/thoremin/issues/249)

[144] Maggioni V, Coste C, Durand S, Bailly F. Optimisation and comparison of markerless and marker-based motion capture methods for hand and finger movement analysis. Sensors. 2025;25(4):1079. [doi:10.3390/s25041079](https://doi.org/10.3390/s25041079)

[145] thoremin issue #248. Embouchure onset timing: do mouth landmarks lead the flute's audio onset, and by how much? [thorwhalen/thoremin#248](https://github.com/thorwhalen/thoremin/issues/248)

[146] thoremin issue #263. Scripted sequence training, fingering guides and fingering-chart priors for the air winds. [thorwhalen/thoremin#263](https://github.com/thorwhalen/thoremin/issues/263)

[147] thoremin issue #720. Air flute: try a microphone breath onset as the note gate. [thorwhalen/thoremin#720](https://github.com/thorwhalen/thoremin/issues/720)

[148] thoremin. Drum pattern training: fit a player's tempo and positions to a short score, then play them back snapped and humanised. [docs/research/drum-pattern-training.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/drum-pattern-training.md)

[149] thoremin issue #269. Drum pattern training: short scores, fit tempo and per-drum positions, then play back snapped and humanised. [thorwhalen/thoremin#269](https://github.com/thorwhalen/thoremin/issues/269)

[150] thoremin issue #719. Conductor: opt-in to keep air drum, bass and guitar sounding while a piece is conducted. [thorwhalen/thoremin#719](https://github.com/thorwhalen/thoremin/issues/719)

[151] thoremin issue #736. pluck-out (mono): a late note scheduled before an already-committed later note damps that note before it starts. [thorwhalen/thoremin#736](https://github.com/thorwhalen/thoremin/issues/736)

[152] thoremin. Inferring rhythm and tempo from low-frame-rate gesture: a research map. [docs/research/rhythm-from-gesture-research-map.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/rhythm-from-gesture-research-map.md)

[153] thoremin issue #178. Infer rhythm from low-rate gesture: propose ictus, a shared musical-time inference package. [thorwhalen/thoremin#178](https://github.com/thorwhalen/thoremin/issues/178)

[154] Vetterli M, Marziliano P, Blu T. Sampling signals with finite rate of innovation. IEEE Trans Signal Process. 2002;50(6):1417-28. [IEEE Xplore](https://ieeexplore.ieee.org/document/1003065)

[155] Cemgil AT, Kappen B. Monte Carlo methods for tempo tracking and rhythm quantization. J Artif Intell Res. 2003;18:45-81. [arXiv:1106.4863](https://arxiv.org/abs/1106.4863)

[156] Whiteley N, Cemgil AT, Godsill S. Bayesian modelling of temporal structure in musical audio. In: Proc. ISMIR; 2006. [ISMIR archive](https://archives.ismir.net/ismir2006/paper/000044.pdf)

[157] Krebs F, Böck S, Widmer G. An efficient state-space model for joint tempo and meter tracking. In: Proc. ISMIR; 2015:72-8. [ISMIR 2015 PDF](https://www.ismir2015.uma.es/articles/239_Paper.pdf)

[158] thoremin. Body as a source, and pacing a song from the dancer's pulse: a research map. [docs/research/body-and-pace-research-map.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/body-and-pace-research-map.md)

[159] Dixon S. Automatic extraction of tempo and beat from expressive performances. J New Music Res. 2001;30(1):39-58. [doi:10.1076/jnmr.30.1.39.7119](https://doi.org/10.1076/jnmr.30.1.39.7119)

[160] Foscarin F, Schlüter J, Widmer G. Beat this! Accurate beat tracking without DBN postprocessing. In: Proc. ISMIR; 2024. [arXiv:2407.21658](https://arxiv.org/abs/2407.21658)

[161] thoremin. Research guide curation (experiments, decisions, charts). [scripts/research_guide/guide.json](https://github.com/thorwhalen/thoremin/blob/main/scripts/research_guide/guide.json)

[162] thoremin issue #186. Epic: body movement as a source, featurized body pose, and pacing a song from the dancer's pulse. [thorwhalen/thoremin#186](https://github.com/thorwhalen/thoremin/issues/186)

[163] Larboulette C, Gibet S. A review of computable expressive descriptors of human motion. In: Proc. MOCO; 2015:21-8. [HAL](https://hal.science/hal-01196267v1)

[164] Camurri A, Mazzarino B, Volpe G. Analysis of expressive gesture: the EyesWeb expressive gesture processing library. In: Gesture-Based Communication in Human-Computer Interaction. LNCS 2915. Springer; 2004:460-7. [doi:10.1007/978-3-540-24598-8_42](https://link.springer.com/chapter/10.1007/978-3-540-24598-8_42)

[165] Moens B, Muller C, van Noorden L, Franěk M, Celie B, Boone J, et al. Encouraging spontaneous synchronisation with D-Jogger, an adaptive music player that aligns movement and music. PLoS ONE. 2014;9(12):e114234. [PMC4260851](https://pmc.ncbi.nlm.nih.gov/articles/PMC4260851/)

[166] Van Dyck E, Moens B, Buhmann J, Demey M, Coorevits E, Dalla Bella S, et al. Spontaneous entrainment of running cadence to music tempo. Sports Med Open. 2015;1:15. [doi:10.1186/s40798-015-0025-9](https://sportsmedicine-open.springeropen.com/articles/10.1186/s40798-015-0025-9)

[167] Signalsmith Audio. Signalsmith Stretch: polyphonic pitch and time library, Web Audio release. [github.com/Signalsmith-Audio/signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)

[168] thoremin issue #187. Epic: conductor mode wired: conducting-gesture understanding (ictus TS core), a score pipeline, and a virtual orchestra. [thorwhalen/thoremin#187](https://github.com/thorwhalen/thoremin/issues/187)

[169] thoremin issue #346. Pace controller follow-ups: start alignment, phase target, pulse precision, real-song jitter, pause keeps lock. [thorwhalen/thoremin#346](https://github.com/thorwhalen/thoremin/issues/346)

[170] thoremin PR #654. Start on your step (song start alignment). [thorwhalen/thoremin#654](https://github.com/thorwhalen/thoremin/pull/654)

[171] thoremin issue #386. Body movement models: conduct with the whole body, and carve personal body poses (epic). [thorwhalen/thoremin#386](https://github.com/thorwhalen/thoremin/issues/386)

[172] thoremin issue #373. Body movement A1: body conducting fixtures and a channel-by-level measurement. [thorwhalen/thoremin#373](https://github.com/thorwhalen/thoremin/issues/373)

[173] thoremin. Body conducting and pose categories: which body channel carries the beat, and at which level. [docs/research/body-conducting-and-pose-categories.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/body-conducting-and-pose-categories.md)

[174] Burger B, Thompson MR, Luck G, Saarikallio SH, Toiviainen P. Hunting for the beat in the body: on period and phase locking in music-induced movement. Front Hum Neurosci. 2014;8:903. [doi:10.3389/fnhum.2014.00903](https://doi.org/10.3389/fnhum.2014.00903)

[175] Toiviainen P, Luck G, Thompson MR. Embodied meter: hierarchical eigenmodes in music-induced movement. Music Percept. 2010;28(1):59-70. [doi:10.1525/mp.2010.28.1.59](https://doi.org/10.1525/mp.2010.28.1.59)

[176] Pedersoli F, Goto M. Dance beat tracking from visual information alone. In: Proc. ISMIR; 2020:400-8. [ISMIR 2020 PDF](https://program.ismir2020.net/static/final_papers/144.pdf)

[177] thoremin. Body channel by event by level measurement table. [docs/research/data/body-channels.csv](https://github.com/thorwhalen/thoremin/blob/main/docs/research/data/body-channels.csv)

[178] thoremin issue #416. body-pulse: an auto channel (stride, sway, torso yaw, trunk height). [thorwhalen/thoremin#416](https://github.com/thorwhalen/thoremin/issues/416)

[179] thoremin issue #339. Body pulse: faster tempo-step following, and red-noise slow levels. [thorwhalen/thoremin#339](https://github.com/thorwhalen/thoremin/issues/339)

[180] thoremin PR #759. Pulse follower long-level window, off by default. [thorwhalen/thoremin#759](https://github.com/thorwhalen/thoremin/pull/759)

[181] Li R, Yang S, Ross DA, Kanazawa A. AI Choreographer: music conditioned 3D dance generation with AIST++. In: Proc. ICCV; 2021. [arXiv:2101.08779](https://arxiv.org/abs/2101.08779)

[182] thoremin issue #415. Supply one clip of a person bouncing to a known tempo (self-take or CC), decide AIST++. [thorwhalen/thoremin#415](https://github.com/thorwhalen/thoremin/issues/415)

[183] thoremin issue #380. Body movement A8: the dancer leads the score and the orchestra (Dance the orchestra). [thorwhalen/thoremin#380](https://github.com/thorwhalen/thoremin/issues/380)

[184] thoremin issue #464. Dance the orchestra: the lock transient. [thorwhalen/thoremin#464](https://github.com/thorwhalen/thoremin/issues/464)

[185] thoremin issue #506. Dance the orchestra: the leader switched back to the dancer waits about 5 s. [thorwhalen/thoremin#506](https://github.com/thorwhalen/thoremin/issues/506)

[186] thoremin. Conducting gestures and a virtual orchestra: a research map. [docs/research/conducting-and-virtual-orchestra-research-map.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/conducting-and-virtual-orchestra-research-map.md)

[187] Mathews MV. The Radio Baton and Conductor Program, or: pitch, the most important and least expressive part of music. Comput Music J. 1991;15(4):37-46. [doi:10.2307/3681070](https://doi.org/10.2307/3681070)

[188] Marrin Nakra T. Inside the Conductor's Jacket: analysis, interpretation and musical synthesis of expressive gesture [PhD thesis]. MIT Media Lab; 2000. [MIT Media Lab](https://www.media.mit.edu/publications/inside-the-conductors-jacket-analysis-interpretation-and-musical-synthesis-of-expressive-gesture/)

[189] Borchers J, Lee E, Samminger W, Mühlhäuser M. Personal Orchestra: a real-time audio/video system for interactive conducting. Multimedia Syst. 2004;9(5):458-65. [doi:10.1007/s00530-003-0119-y](https://doi.org/10.1007/s00530-003-0119-y)

[190] Lee E, Marrin Nakra T, Borchers J. You're the conductor: a realistic interactive conducting system for children. In: Proc. NIME; 2004:68-73. [NIME 2004 PDF](https://www.nime.org/proceedings/2004/nime2004_068.pdf)

[191] Lee E, Grüll I, Kiel H, Borchers J. conga: a framework for adaptive conducting gesture analysis. In: Proc. NIME; 2006:260-5. [NIME 2006 PDF](https://www.nime.org/proceedings/2006/nime2006_260.pdf)

[192] Kolesnik P, Wanderley M. Recognition, analysis and performance with expressive conducting gestures. In: Proc. ICMC; 2004. [ICMC archive](https://quod.lib.umich.edu/i/icmc/bbp2372.2004.139?rgn=main;view=fulltext)

[193] Mermerci M, Pascoe E, Edström F, Kjellström H. Real-time control of a virtual orchestra by recognition of conducting gestures. arXiv:2604.27957; 2026. [arXiv:2604.27957](https://arxiv.org/abs/2604.27957)

[194] Baba T, Hashida M, Katayose H. "VirtualPhilharmony": a conducting system with heuristics of conducting an orchestra. In: Proc. NIME; 2010:263-70. [NIME 2010 PDF](https://www.nime.org/proceedings/2010/nime2010_263.pdf)

[195] Luck G, Toiviainen P. Ensemble musicians' synchronization with conductors' gestures: an automated feature-extraction analysis. Music Percept. 2006;24(2):189-200. [doi:10.1525/mp.2006.24.2.189](https://doi.org/10.1525/mp.2006.24.2.189)

[196] Luck G, Sloboda JA. Spatio-temporal cues for visually mediated synchronization. Music Percept. 2009;26(5):465-73. [doi:10.1525/mp.2009.26.5.465](https://doi.org/10.1525/mp.2009.26.5.465)

[197] Wöllner C, Deconinck FJA, Parkinson J, Hove MJ, Keller PE. The perception of prototypical motion: synchronization is enhanced with quantitatively morphed gestures of musical conductors. J Exp Psychol Hum Percept Perform. 2012;38(6):1390-403. [doi:10.1037/a0028130](https://doi.org/10.1037/a0028130)

[198] Meals CD. The question of lag: an exploration of the relationship between conductor gesture and sonic response in instrumental ensembles. Front Psychol. 2020;11:573030. [doi:10.3389/fpsyg.2020.573030](https://doi.org/10.3389/fpsyg.2020.573030)

[199] Rudolf M. The Grammar of Conducting: a comprehensive guide to baton technique and interpretation. 3rd ed. Schirmer; 1994. [Internet Archive](https://archive.org/details/grammarofconduct0000rudo)

[200] Green EAH, Gibson M. The Modern Conductor. 7th ed. Pearson/Prentice Hall; 2004. [Google Books](https://books.google.com/books/about/The_Modern_Conductor.html?id=Q2MJAQAAMAAJ)

[201] McAuley JD, Jones MR. Modeling effects of rhythmic context on perceived duration: a comparison of interval and entrainment approaches to short-interval timing. J Exp Psychol Hum Percept Perform. 2003;29(6):1102-25. [doi:10.1037/0096-1523.29.6.1102](https://doi.org/10.1037/0096-1523.29.6.1102)

[202] Pardo B. Tempo tracking with a single oscillator. In: Proc. ISMIR; 2004. [ISMIR archive](https://archives.ismir.net/ismir2004/paper/000206.pdf)

[203] Cont A. A coupled duration-focused architecture for real-time music-to-score alignment. IEEE Trans Pattern Anal Mach Intell. 2010;32(6):974-87. [doi:10.1109/TPAMI.2009.106](https://doi.org/10.1109/TPAMI.2009.106)

[204] Raphael C. Music Plus One and machine learning. In: Proc. ICML; 2010:21-8. [ICML PDF](https://icml.cc/Conferences/2010/papers/904.pdf)

[205] thoremin issue #320. Measure the conductor's wrist-vs-stick-tip grid offset on a real take. [thorwhalen/thoremin#320](https://github.com/thorwhalen/thoremin/issues/320)

[206] thoremin issue #485. Body transport: on a very clean camera a slow adjustment of the ready arm reads as the upbeat. [thorwhalen/thoremin#485](https://github.com/thorwhalen/thoremin/issues/485)

[207] thoremin PR #652. Body transport: read the upbeat by its shape (option). [thorwhalen/thoremin#652](https://github.com/thorwhalen/thoremin/pull/652)

[208] thoremin issue #504. Body conductor: can a take measure the trunk's lead offset? [thorwhalen/thoremin#504](https://github.com/thorwhalen/thoremin/issues/504)

[209] thoremin issue #427. Body movement: learn the body conductor's per-player lead offset (trunk lag). [thorwhalen/thoremin#427](https://github.com/thorwhalen/thoremin/issues/427)

[210] thoremin issue #514. Conductor shaping hand: the stroke floor in torso units, a real-footage replay. [thorwhalen/thoremin#514](https://github.com/thorwhalen/thoremin/issues/514)

[211] thoremin issue #457. Conductor split role: the left hand's expressive gestures (height, palm) as dynamics, not strokes. [thorwhalen/thoremin#457](https://github.com/thorwhalen/thoremin/issues/457)

[212] thoremin. Can the conductor's hand pattern say 2, 3 or 4? [docs/research/conducting-meter.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/conducting-meter.md)

[213] thoremin PR #562. Meter from the hand pattern, measured not viable (#187 PR 6). [thorwhalen/thoremin#562](https://github.com/thorwhalen/thoremin/pull/562)

[214] thoremin issue #561. Meter recognition: retry with annotated conducting footage from several conductors. [thorwhalen/thoremin#561](https://github.com/thorwhalen/thoremin/issues/561)

[215] Tone.js. @tonejs/midi: MIDI file parser. [npm @tonejs/midi](https://www.npmjs.com/package/@tonejs/midi)

[216] musicxml-io: MusicXML parser for TypeScript. [npm musicxml-io](https://www.npmjs.com/package/musicxml-io)

[217] Dannenberg RB, Raphael C. Music score alignment and computer accompaniment. Commun ACM. 2006;49(8):38-43. [author PDF](https://www.cs.cmu.edu/~rbd/papers/accompaniment-cacm-06.pdf)

[218] spessasus. spessasynth_lib: SoundFont2/SF3 synthesizer for the Web Audio API. [github.com/spessasus/spessasynth_lib](https://github.com/spessasus/spessasynth_lib)

[219] thoremin. Orchestra soundfont licence and provenance. [public/soundfonts/LICENSE.md](https://github.com/thorwhalen/thoremin/blob/main/public/soundfonts/LICENSE.md)

[220] thoremin PR #336. The pending-event scheduler and the sampled orchestra (#187 PR 5). [thorwhalen/thoremin#336](https://github.com/thorwhalen/thoremin/pull/336)

[221] thoremin PR #395. Conduct a recording: the audio pacer (#187 PR 7). [thorwhalen/thoremin#395](https://github.com/thorwhalen/thoremin/pull/395)

[222] thoremin issue #76. Roadmap: controllable face/head control dimensions for face-to-music mapping (beyond emotion classification). [thorwhalen/thoremin#76](https://github.com/thorwhalen/thoremin/issues/76)

[223] Purves D, et al., editors. Neuroscience. 2nd ed. Sunderland (MA): Sinauer Associates; 2001. Box: Facial expressions: pyramidal and extrapyramidal contributions. [NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK10829/box/A2032/)

[224] Krippl M, Karim AA, Brechmann A. Neuronal correlates of voluntary facial movements. Front Hum Neurosci. 2015;9:598. [PMC4623161](https://pmc.ncbi.nlm.nih.gov/articles/PMC4623161/)

[225] MediaPipe GitHub issue #4450. eyeWiden/noseSneer blendshapes are always near 0. [google-ai-edge/mediapipe#4450](https://github.com/google-ai-edge/mediapipe/issues/4450)

[226] Lyons MJ, Haehnel M, Tetsutani N. Designing, playing, and performing with a vision-based mouth interface. NIME 2003. [NIME proceedings PDF](https://www.nime.org/proceedings/2003/nime2003_116.pdf)

[227] thoremin. Feature Instrumentation Lab design. [docs/design/feature-lab.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/feature-lab.md)

[228] thoremin issue #385. Carve-out v2: an easier "Your faces", then hands and body on one mechanism (a modality seam). [thorwhalen/thoremin#385](https://github.com/thorwhalen/thoremin/issues/385)

[229] thoremin. Noise units (SDK enrolment module). [packages/sdk/src/enroll/noise.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/noise.ts)

[230] thoremin. Still-point sampler. [packages/sdk/src/enroll/sampler.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/sampler.ts)

[231] thoremin. Faces extension README (sorting, pins, constrained re-cut). [packages/ext-faces/README.md](https://github.com/thorwhalen/thoremin/blob/main/packages/ext-faces/README.md)

[232] thoremin issue #387. Design choices for carve-out v2 (#385) and body movement (#386). [thorwhalen/thoremin#387](https://github.com/thorwhalen/thoremin/issues/387)

[233] thoremin. One-to-one default names for learned categories. [packages/sdk/src/enroll/match.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/match.ts)

[234] thoremin issue #420. Carve: faster constrained re-cut (O(n^2) or a worker) so the 600-hold cap can go. [thorwhalen/thoremin#420](https://github.com/thorwhalen/thoremin/issues/420)

[235] thoremin issue #499. Carve: time a 2000-hold re-cut on a tablet; move the forest to a worker if over 1 s. [thorwhalen/thoremin#499](https://github.com/thorwhalen/thoremin/issues/499)

[236] thoremin issue #358. An exported or shared instrument carries its personal face categorizer. [thorwhalen/thoremin#358](https://github.com/thorwhalen/thoremin/issues/358)

[237] thoremin issue #362. Record and export the shared face categorizers. [thorwhalen/thoremin#362](https://github.com/thorwhalen/thoremin/issues/362)

[238] thoremin. Carve quality chips and hints. [packages/sdk/src/enroll/quality.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/quality.ts)

[239] thoremin. Carve quality chips against the live readout. [docs/research/carve-quality-vs-live.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/carve-quality-vs-live.md)

[240] thoremin issue #564. Carve quality chip: account for the reject radius. [thorwhalen/thoremin#564](https://github.com/thorwhalen/thoremin/issues/564)

[241] thoremin. Lighting and camera distance vs a personal face categorizer. [docs/research/face-categorizer-lighting-and-distance.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/face-categorizer-lighting-and-distance.md)

[242] Livingstone SR, et al. Deficits in the mimicry of facial expressions in Parkinson's disease, video 1 [video]. Wikimedia Commons; CC BY 4.0. [File page](https://commons.wikimedia.org/wiki/File:Deficits-in-the-Mimicry-of-Facial-Expressions-in-Parkinsons-Disease-Video1.ogv)

[243] thoremin issue #348. Face categorizer: warn when the room is too dark (instead of a lighting dial). [thorwhalen/thoremin#348](https://github.com/thorwhalen/thoremin/issues/348)

[244] thoremin. Is the room too dark to carve in? [packages/sdk/src/enroll/light.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/light.ts)

[245] thoremin PR #711. The live test warns when the room is too dark (#348). [thorwhalen/thoremin#711](https://github.com/thorwhalen/thoremin/pull/711)

[246] thoremin. Dynamic gestures: moving categories beside the static carve (design). [docs/design/dynamic-gestures.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/dynamic-gestures.md)

[247] thoremin issue #718. Carve: dynamic (moving) gesture categories, separate from static pose carving. [thorwhalen/thoremin#718](https://github.com/thorwhalen/thoremin/issues/718)

[248] Caramiaux B, Montecchio N, Tanaka A, Bevilacqua F. Adaptive gesture recognition with variation estimation for interactive systems. ACM Trans Interact Intell Syst. 2014;4(4). [doi:10.1145/2643204](https://doi.org/10.1145/2643204)

[249] Wobbrock JO, Wilson AD, Li Y. Gestures without libraries, toolkits or training: a $1 recognizer for user interface prototypes. UIST. 2007. [doi:10.1145/1294211.1294238](https://doi.org/10.1145/1294211.1294238)

[250] thoremin issue #751. Dynamic gestures 1: motion segmenter and trace capture. [thorwhalen/thoremin#751](https://github.com/thorwhalen/thoremin/issues/751)

[251] thoremin issue #752. Dynamic gestures 2: window matcher (DTW) behind a WindowMatcher seam. [thorwhalen/thoremin#752](https://github.com/thorwhalen/thoremin/issues/752)

[252] thoremin issue #753. Dynamic gestures 3: file section, trace agreement and separation quality. [thorwhalen/thoremin#753](https://github.com/thorwhalen/thoremin/issues/753)

[253] thoremin issue #754. Dynamic gestures 4: Gestures section in the carve tool and event bindings. [thorwhalen/thoremin#754](https://github.com/thorwhalen/thoremin/issues/754)

[254] thoremin issue #755. Dynamic gestures 5: causal matcher (GVF) with progress and variation. [thorwhalen/thoremin#755](https://github.com/thorwhalen/thoremin/issues/755)

[255] thoremin. Research: trainer mode, learning a player's own control categories from a live stream. [docs/research/trainer-mode.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/trainer-mode.md)

[256] thoremin. The modality seam of the carve-out. [packages/sdk/src/enroll/modality.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/modality.ts)

[257] thoremin issue #448. Carve-out v2 E8: hands (handModality, Your hand shapes, command/degree targets). [thorwhalen/thoremin#448](https://github.com/thorwhalen/thoremin/issues/448)

[258] thoremin. The hand as a carve modality. [packages/sdk/src/features/modalities/hand.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/features/modalities/hand.ts)

[259] thoremin issue #452. Carve-out v2 hands: palm orientation as an option, and two-hand (joint) categorizers. [thorwhalen/thoremin#452](https://github.com/thorwhalen/thoremin/issues/452)

[260] Google. MediaPipe pose classification guide. [GitHub](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose_classification.md)

[261] Gower JC. Generalized Procrustes analysis. Psychometrika. 1975. [doi:10.1007/BF02291478](https://doi.org/10.1007/BF02291478)

[262] thoremin issue #381. Body movement B1: the pose feature space. [thorwhalen/thoremin#381](https://github.com/thorwhalen/thoremin/issues/381)

[263] thoremin. The body pose feature space. [packages/sdk/src/features/body_groups.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/features/body_groups.ts)

[264] thoremin PR #433. Body movement B1: the pose feature space (#381). [thorwhalen/thoremin#433](https://github.com/thorwhalen/thoremin/pull/433)

[265] thoremin issue #382. Body movement B2: body as a modality of the carve-out session. [thorwhalen/thoremin#382](https://github.com/thorwhalen/thoremin/issues/382)

[266] thoremin issue #458. Pose categorizer: renormalise distance over the features present. [thorwhalen/thoremin#458](https://github.com/thorwhalen/thoremin/issues/458)

[267] thoremin. The body as a carve modality. [packages/sdk/src/features/modalities/body.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/features/modalities/body.ts)

[268] thoremin PR #488. Enroll session: a nuisance cue's deliberate motion no longer feeds the noise estimate. [thorwhalen/thoremin#488](https://github.com/thorwhalen/thoremin/pull/488)

[269] thoremin issue #383. Body movement B3: default names, a general body-pose vocabulary. [thorwhalen/thoremin#383](https://github.com/thorwhalen/thoremin/issues/383)

[270] thoremin PR #462. Body movement B2: Your poses. [thorwhalen/thoremin#462](https://github.com/thorwhalen/thoremin/pull/462)

[271] thoremin issue #384. Body movement B4: body categories in the graph. [thorwhalen/thoremin#384](https://github.com/thorwhalen/thoremin/issues/384)

[272] Liu H, An R, Zhang Z, Ma B, Zhang W, Song Y, et al. Norface: improving facial expression analysis by identity normalization. 2024. [arXiv:2407.15617](https://arxiv.org/abs/2407.15617)

[273] Zeeshan MO, Pedersoli M, Koerich AL, Granger E. Progressive multi-source domain adaptation for personalized facial expression recognition. 2025. [arXiv:2504.04252](https://arxiv.org/abs/2504.04252)

[274] thoremin issue #160. Bind a learned category to the sound (trainer v1). [thorwhalen/thoremin#160](https://github.com/thorwhalen/thoremin/issues/160)

[275] Françoise J. Motion-sound mapping by demonstration [PhD thesis]. Paris: Université Pierre et Marie Curie; 2015. [HAL](https://theses.hal.science/tel-01206009v2/file/2015PA066105.pdf)

[276] Carney M, et al. Teachable Machine: approachable web-based tool for exploring machine learning classification. CHI EA. 2020. [doi:10.1145/3334480.3382839](https://doi.org/10.1145/3334480.3382839)

[277] Manning CD, Raghavan P, Schütze H. Introduction to information retrieval. Cambridge University Press; 2008. Hierarchical agglomerative clustering. [online edition](https://nlp.stanford.edu/IR-book/html/htmledition/hierarchical-agglomerative-clustering-1.html)

[278] Günther M, et al. Toward open-set face recognition. CVPR Workshops. 2017. [arXiv:1705.01567](https://arxiv.org/abs/1705.01567)

[279] thoremin. Cues and routines. [packages/sdk/src/enroll/cue.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/cue.ts)

[280] thoremin. Sufficiency: how the runner knows it has enough for a cue. [packages/sdk/src/enroll/sufficiency.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/sufficiency.ts)

[281] thoremin. Scripted sequence training. [packages/sdk/src/enroll/sequence.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/sequence.ts)

[282] thoremin issue #247. Self-recorded real-vs-air cue session. [thorwhalen/thoremin#247](https://github.com/thorwhalen/thoremin/issues/247)

[283] thoremin. The carve quiz. [packages/sdk/src/enroll/quiz.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/quiz.ts)

[284] thoremin. The everyday check. [packages/sdk/src/enroll/everyday.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/enroll/everyday.ts)

[285] Ashbrook D, Starner T. MAGIC: a motion gesture design tool. Proceedings of the SIGCHI Conference on Human Factors in Computing Systems (CHI). 2010.

[286] thoremin issue #445. Carve quiz: spoken prompts through the trainer's voice runtime. [thorwhalen/thoremin#445](https://github.com/thorwhalen/thoremin/issues/445)

[287] thoremin issue #715. Harmony: "Rate this move" practice mode for a personal caption and tension set. [thorwhalen/thoremin#715](https://github.com/thorwhalen/thoremin/issues/715)

[288] Apple Support. Use Face ID on your iPhone or iPad Pro. [support.apple.com](https://support.apple.com/en-us/108411)

[289] thoremin. Player guide: ASL Chords. [guide/instruments/asl-chords.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/asl-chords.md)

[290] thoremin. Player guide: Sign Map. [guide/instruments/sign-map.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/sign-map.md)

[291] thoremin. ASL recognition: moved. [docs/research/asl-recognition.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/asl-recognition.md)

[292] thoremin-asl. ASL recognition in the browser: what was tried, what ships, how good it is. [docs/asl-recognition.md](https://github.com/thorwhalen/thoremin-asl/blob/main/docs/asl-recognition.md)

[293] Google. Google - American Sign Language Fingerspelling Recognition (Kaggle competition, 2023). [kaggle.com](https://www.kaggle.com/competitions/asl-fingerspelling)

[294] Google. Google - Isolated Sign Language Recognition (Kaggle competition, 2023). [kaggle.com](https://www.kaggle.com/competitions/asl-signs)

[295] thoremin-asl. Data attributions. [ATTRIBUTIONS.md](https://github.com/thorwhalen/thoremin-asl/blob/main/ATTRIBUTIONS.md)

[296] Starner T, et al. PopSign ASL v1.0: an isolated American Sign Language dataset collected via smartphones. NeurIPS 2023 Datasets and Benchmarks. [data](https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/)

[297] Pranto MFI, Islam MR, Akbor MA, Ghosh N, Alam MR, Chaki S, Islam MM. ASL-HG: American Sign Language Hand Gesture Image Dataset. Mendeley Data; 2025. [doi:10.17632/j4y5w2c8w9.1](https://doi.org/10.17632/j4y5w2c8w9.1)

[298] Ahmed Sowrow AR, Iftekhar MIAS, Prova SI, Huq MR. Images of American Sign Language (ASL) Alphabet Gestures. Mendeley Data; 2024. [doi:10.17632/48dg9vhmyk.2](https://doi.org/10.17632/48dg9vhmyk.2)

[299] om192006. sign_language_keypoints (Hugging Face dataset, MIT). [huggingface.co](https://huggingface.co/datasets/om192006/sign_language_keypoints)

[300] sid220. ASLNow! asl-now-fingerspelling (Hugging Face dataset, MIT). [huggingface.co](https://huggingface.co/datasets/sid220/asl-now-fingerspelling)

[301] StudioGalt. Sign-Language-Mocap-Archive (CC0 1.0). [github.com](https://github.com/StudioGalt/Sign-Language-Mocap-Archive)

[302] ZahidYasinMittha. American-Sign-Language-Dataset (Aslense; Hugging Face, MIT on its card). [huggingface.co](https://huggingface.co/datasets/ZahidYasinMittha/American-Sign-Language-Dataset)

[303] Garg B, Kasar M, Kashyap A, Vats A, Sharma G, Hange A. SignAlphaSet. Mendeley Data; 2025. [doi:10.17632/8fmvr9m98w.3](https://doi.org/10.17632/8fmvr9m98w.3)

[304] Marxulia. asl_sign_languages_alphabets_v03 (Hugging Face dataset, no licence stated). [huggingface.co](https://huggingface.co/datasets/Marxulia/asl_sign_languages_alphabets_v03)

[305] Microsoft Research. ASL Citizen (research-only licence). [microsoft.com](https://www.microsoft.com/en-us/research/project/asl-citizen/)

[306] Li D, et al. WLASL: Word-Level American Sign Language dataset (C-UDA licence). [github.com](https://github.com/dxli94/WLASL)

[307] thoremin-asl issue #4. Aslense provenance: waive the licence rule for its doubtful clips? [thorwhalen/thoremin-asl#4](https://github.com/thorwhalen/thoremin-asl/issues/4)

[308] thoremin-asl. The recogniser (@thoremin/ext-asl/recognizer). [docs/recognizer.md](https://github.com/thorwhalen/thoremin-asl/blob/main/docs/recognizer.md)

[309] thoremin-asl issue #3. J, Z and SORRY need permissive multi-signer data. [thorwhalen/thoremin-asl#3](https://github.com/thorwhalen/thoremin-asl/issues/3)

[310] thoremin-asl issue #5. Fewer false motion signs while a letter is held. [thorwhalen/thoremin-asl#5](https://github.com/thorwhalen/thoremin-asl/issues/5)

[311] thoremin-asl issue #9. Declare hands: 1 on the ASL branch. [thorwhalen/thoremin-asl#9](https://github.com/thorwhalen/thoremin-asl/issues/9)

[312] thoremin-asl issue #2. Licence: follow thoremin's decision (thoremin#262). [thorwhalen/thoremin-asl#2](https://github.com/thorwhalen/thoremin-asl/issues/2)

[313] thoremin. Fingering-chart priors and scripted sequence training for the air winds. [docs/research/fingering-priors-and-sequence-training.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/fingering-priors-and-sequence-training.md)

[314] thoremin PR #275. Fingering charts, the fingering prior and the scripted sequence core. [thorwhalen/thoremin#275](https://github.com/thorwhalen/thoremin/pull/275)

[315] thoremin PR #277. Sequence trainer, fingering guide and the fingering-chart dial in the air winds' settings. [thorwhalen/thoremin#277](https://github.com/thorwhalen/thoremin/pull/277)

[316] thoremin PR #284. The training link: every instrument's editor points at its training. [thorwhalen/thoremin#284](https://github.com/thorwhalen/thoremin/pull/284)

[317] The Woodwind Fingering Guide. Flute and Piccolo Fingering Charts. [wfg.woodwind.org](https://www.wfg.woodwind.org/flute/)

[318] The Woodwind Fingering Guide. Chalumeau and Clarion Register Fingering Charts for Boehm-System Clarinet. [wfg.woodwind.org](https://www.wfg.woodwind.org/clarinet/cl_bas_1.html)

[319] The Woodwind Fingering Guide. Saxophone Fingering Charts. [wfg.woodwind.org](https://www.wfg.woodwind.org/sax/)

[320] Yamaha Corporation. Musical Instrument Guide: How to Play the Flute, fingering diagrams. [yamaha.com](https://www.yamaha.com/en/musical_instrument_guide/flute/play/play002.html)

[321] LilyPond Notation Reference. Woodwinds. [lilypond.org](https://lilypond.org/doc/v2.25/Documentation/notation/woodwinds)

[322] Wikipedia. Overblowing. [en.wikipedia.org](https://en.wikipedia.org/wiki/Overblowing)

[323] Murphy KP. Conjugate Bayesian analysis of the Gaussian distribution. Technical note, University of British Columbia; 2007. [cs.ubc.ca](https://www.cs.ubc.ca/~murphyk/Papers/bayesGauss.pdf)

[324] thoremin. Dev skill: downloaded video, keep the landmark streams, with metadata. [skills/thoremin-dev-video-data/SKILL.md](https://github.com/thorwhalen/thoremin/blob/main/skills/thoremin-dev-video-data/SKILL.md)

[325] thoremin. Datasets thoremin has trained, tuned or measured on. [docs/research/datasets.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/datasets.md)

[326] thoremin issue #527. video_to_landmarks.py: a pose-guided hand crop for hands too small for the detector. [thorwhalen/thoremin#527](https://github.com/thorwhalen/thoremin/issues/527)

[327] thoremin issue #685. Record the licences of the Que Calor and conducting source videos. [thorwhalen/thoremin#685](https://github.com/thorwhalen/thoremin/issues/685)

[328] thoremin issue #417. Body test material: synthetic-body's bounce cusp is at the top; Que Calor fixture lacks a licence. [thorwhalen/thoremin#417](https://github.com/thorwhalen/thoremin/issues/417)

[329] thoremin issue #675. Record a few labelled clips for the microphone chord fixture. [thorwhalen/thoremin#675](https://github.com/thorwhalen/thoremin/issues/675)

[330] thoremin-asl issue #7. Old replay fixture held ASL Citizen landmarks: rewrite history? [thorwhalen/thoremin-asl#7](https://github.com/thorwhalen/thoremin-asl/issues/7)

[331] Pur Pasteur. All Diatonic Chords and their Emotional Signatures Controlled by Hand Movement (no theory required) [video]. YouTube. [youtu.be/95u70uQfofQ](https://youtu.be/95u70uQfofQ)

[332] Pur Pasteur. Control Harmony With Your Bare Hands?? [YouTube Short]. [youtube.com/shorts/4avKOWkj34Y](https://www.youtube.com/shorts/4avKOWkj34Y)

[333] thoremin issue #717. Harmony: a rotating 3-D torus view of the chord map for teaching (low priority). [thorwhalen/thoremin#717](https://github.com/thorwhalen/thoremin/issues/717)

[334] Wikipedia. Omnichord (secondary). [Omnichord](https://en.wikipedia.org/wiki/Omnichord)

[335] Wikipedia. Stradella bass system (secondary). [Stradella bass system](https://en.wikipedia.org/wiki/Stradella_bass_system)

[336] Haisley L. Chromatic Standard Layout. Autoharp.org; 2018. [PDF](https://www.autoharp.org/articles/Chromatic_Standard_Layout.pdf)

[337] Ableton. Push manual: playing melodies and harmonies, layout and scale options. [ableton.com/en/push/manual](https://www.ableton.com/en/push/manual/)

[338] The Music Trades (Japan). InstaChord: an instrument for people with no musical training; 2023. [musictrades.co.jp](https://www.musictrades.co.jp/en_page?id=5660)

[339] Wikipedia. Harmonic table note layout (secondary). [Harmonic table note layout](https://en.wikipedia.org/wiki/Harmonic_table_note_layout)

[340] Maupin S, Gerhard D, Park B. Isomorphic tessellations for musical keyboards. Proc. Sound and Music Computing Conference (SMC); 2011. [PDF](https://wiki.shiverware.com/images/0/08/Isomorphic_Tessellations_For_Musical_Keyboards.pdf)

[341] Wikipedia. Tonnetz (secondary; for Euler L, 1739). [Tonnetz](https://en.wikipedia.org/wiki/Tonnetz)

[342] Crans AS, Fiore TM, Satyendra R. Musical actions of dihedral groups. American Mathematical Monthly. 2009;116(6):479-495. [arXiv 0711.1873](https://arxiv.org/pdf/0711.1873)

[343] Cohn R. Maximally smooth cycles, hexatonic systems, and the analysis of late-Romantic triadic progressions. Music Analysis. 1996;15(1):9-40. [doi:10.2307/854168](https://doi.org/10.2307/854168)

[344] Douthett J, Steinbach P. Parsimonious graphs: a study in parsimony, contextual transformations, and modes of limited transposition. Journal of Music Theory. 1998;42(2):241-263. [doi:10.2307/843877](https://doi.org/10.2307/843877)

[345] Hook J. Uniform triadic transformations. Journal of Music Theory. 2002;46(1-2):57-126 (dissertation abstract read). [mtosmt.org](https://www.mtosmt.org/classic/mto.02.8.3/dis.8.3.html)

[346] Tymoczko D. The geometry of musical chords. Science. 2006;313(5783):72-74 (search result and press release only). [collaborate.princeton.edu](https://collaborate.princeton.edu/en/publications/the-geometry-of-musical-chords/)

[347] Callender C, Quinn I, Tymoczko D. Generalized voice-leading spaces. Science. 2008;320(5874):346-348 (search result only). [collaborate.princeton.edu](https://collaborate.princeton.edu/en/publications/generalized-voice-leading-spaces/)

[348] Tymoczko D. Geometrical methods in recent music theory. Music Theory Online. 2010;16(1). [mtosmt.org](https://mtosmt.org/issues/mto.10.16.1/mto.10.16.1.tymoczko.html)

[349] Tymoczko D. Voice leadings as generalized key signatures. Music Theory Online. 2005;11(4). [PDF](https://mtosmt.org/classic/mto.05.11.4/mto.05.11.4.tymoczko.pdf)

[350] Tymoczko D. A Geometry of Music: Harmony and Counterpoint in the Extended Common Practice. Oxford University Press; 2011 (read through a secondary summary of §6.3.2). [harmonious.nfshost.com](https://harmonious.nfshost.com/p/b9/Diatonic-Modes-Chords)

[351] Steinberg. Chord Assistant: Circle of Fifths (Cubase/Nuendo documentation). [steinberg.help](https://archive.steinberg.help/nuendo/v8/en/cubase_nuendo/topics/chord_functions/chord_functions_chord_assistant_fifths_c.html)

[352] Hooktheory. Trends tool and API. [hooktheory.com/trends](https://www.hooktheory.com/trends)

[353] MacRitchie J, Milne AJ. Exploring the effects of pitch layout on learning a new musical instrument. Applied Sciences. 2017;7(12):1218. [mdpi.com](https://www.mdpi.com/2076-3417/7/12/1218/html)

[354] Stanford S, Milne AJ, MacRitchie J. The effect of isomorphic pitch layouts on the transfer of musical learning. Applied Sciences. 2018;8(12):2514. [mdpi.com](https://www.mdpi.com/2076-3417/8/12/2514)

[355] Holland S. Learning about harmony with Harmony Space: an overview. Open Research Online (abstract only). [oro.open.ac.uk](https://oro.open.ac.uk/59664)

[356] Mandanici M, Rodà A, Canazza S. The Harmonic Walk: an interactive physical environment to learn tonal melody accompaniment. Advances in Multimedia; 2016 (abstract only). [research.unipd.it](https://www.research.unipd.it/handle/11577/3172134)

[357] thoremin. Harmony as layers: chord relations, distances, layouts, navigation, realization and emotion. [docs/research/harmony-relations-and-realization.md](https://github.com/thorwhalen/thoremin/blob/main/docs/research/harmony-relations-and-realization.md)

[358] Meeus N. Toward a post-Schoenbergian grammar of tonal and pre-tonal harmonic progressions. Music Theory Online. 2000;6(1). [mtosmt.org](https://www.mtosmt.org/issues/mto.00.6.1/mto.00.6.1.meeus.html)

[359] Lerdahl F. Tonal Pitch Space. Oxford University Press; 2001 (search result only; not read). [academic.oup.com](https://academic.oup.com/book/32497)

[360] Lerdahl F, Krumhansl CL. Modeling tonal tension. Music Perception. 2007;24(4):329-366. [PDF](https://www.fredlerdahl.com/s/Modeling-Tonal-Tension.pdf)

[361] de Haas WB, Wiering F, Veltkamp RC. A geometrical distance measure for determining the similarity of musical harmony. Technical report UU-CS-2011-015, Utrecht University; 2011. [PDF](https://ics-archive.science.uu.nl/research/techreps/repo/CS-2011/2011-015.pdf)

[362] Chew E. Towards a mathematical model of tonality. PhD thesis, MIT; 2000 (search result only). [dspace.mit.edu](https://dspace.mit.edu/handle/1721.1/9139)

[363] Herremans D, Chew E. Tension ribbons: quantifying and visualising tonal tension. Proc. TENOR 2016; vol 2:8-18. [PDF](https://www.dorienherremans.com/sites/default/files/paper_tenor_dh_preprint_small.pdf)

[364] Bigand E, Parncutt R, Lerdahl F. Perception of musical tension in short chord sequences: the influence of harmonic function, sensory dissonance, horizontal motion, and musical training. Perception & Psychophysics. 1996;58(1):125-141. [PDF](https://lead.ube.fr/wp-content/uploads/2023/09/000093-perception-of-musical-tension-in-short-chord-sequences-the-influence-of-harmonic-function-sensory-dissonance-horizontal-motion-and-musical-training.pdf)

[365] Moss FC, Neuwirth M, Harasim D, Rohrmeier M. Statistical characteristics of tonal harmony: a corpus study of Beethoven's string quartets. PLoS ONE. 2019;14(6):e0217242. [journals.plos.org](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0217242&type=printable)

[366] de Clercq T, Temperley D. A corpus analysis of rock harmony. Popular Music. 2011;30(1):47-70. [PDF](https://rockcorpus.midside.com/2011_paper/declercq_temperley_2011.pdf)

[367] Lahdelma I, Eerola T. Single chords convey distinct emotional qualities to both naïve and expert listeners. Psychology of Music. 2016;44(1):37-54. [jyx.jyu.fi](https://jyx.jyu.fi/handle/123456789/48313)

[368] Parncutt R. The emotional connotations of major versus minor tonality: one or more origins? Musicae Scientiae. 2014;18(3):324-353. [PDF](https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/Parncutt2014EmotionalConnotations.pdf)

[369] Zhang J, Li L, Wei L, Wang H. Moderating effects of chord progressions on the emotional experience of major and minor chords. Acta Psychologica; 2025. [DOAJ](https://doaj.org/article/cfc4813ce0934d47a96ce33102be59d4)

[370] Murphy S. The major tritone progression in recent Hollywood science fiction films. Music Theory Online. 2006;12(2). [mtosmt.org](https://mtosmt.org/issues/mto.06.12.2/mto.06.12.2.murphy.html)

[371] Vogel D, Balakrishnan R. Distant freehand pointing and clicking on very large, high resolution displays. Proc. UIST; 2005:33-42. [PDF](https://www.dgp.toronto.edu/public_user/ravin/papers/uist2005_distantpointing.pdf)

[372] Sprague AH, Vogel C, Williams M, Wolf E, Kamper D. Evaluation of commercial camera-based solutions for tracking hand kinematics. Sensors. 2025;25(18):5716. [doi:10.3390/s25185716](https://doi.org/10.3390/s25185716); [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12473350/)

[373] Jacob RJK. The use of eye movements in human-computer interaction techniques: what you look at is what you get. ACM Transactions on Information Systems. 1991;9(3). [PDF](https://marcjohnson.fr/wp-content/uploads/2020/12/1991-Jacob-The-Use-of-Eye-Movements-in-human-computer-interaction-techniques.pdf)

[374] Callahan J, Hopkins D, Weiser M, Shneiderman B. An empirical comparison of pie vs. linear menus. Proc. CHI 1988:95-100. [doi:10.1145/57167.57182](https://doi.org/10.1145/57167.57182)

[375] Kurtenbach G, Buxton W. The limits of expert performance using hierarchic marking menus. Proc. INTERCHI 1993:482-487 (search result only). [billbuxton.com](https://www.billbuxton.com/MMExpert.html)

[376] Besada JL, Bisesi E, Guichaoua C, Andreatta M. The Tonnetz at first sight: cognitive issues of human-computer interaction with pitch spaces. Music & Science. 2024;7. [doi:10.1177/20592043241246515](https://doi.org/10.1177/20592043241246515)

[377] thoremin issue #602. Chord map instrument: seven choices, each with a recommendation. [thorwhalen/thoremin#602](https://github.com/thorwhalen/thoremin/issues/602)

[378] thoremin. Harmonic layers: chord spaces, layouts, navigation and realization as composable parts (design record). [docs/design/harmonic-layers.md](https://github.com/thorwhalen/thoremin/blob/main/docs/design/harmonic-layers.md)

[379] Ableton. Live manual: Launching clips. [ableton.com](https://www.ableton.com/en/manual/launching-clips/)

[380] PG Music. Band-in-a-Box manual, chapter 7. [pgmusic.com](https://www.pgmusic.com/manuals/bbw2023full/chapter7.htm)

[381] Temperley D. What's key for key? The Krumhansl-Schmuckler key-finding algorithm reconsidered. Music Perception. 1999;17(1):65-100 (search result only; via an implementation). [partitura](https://partitura.readthedocs.io/en/latest/_modules/partitura/musicanalysis/key_identification.html)

[382] Chen T-P, Fukayama S, Goto M, Su L. Chord jazzification: learning jazz interpretations of chord symbols. Proc. ISMIR 2020. [PDF](https://program.ismir2020.net/static/final_papers/90.pdf)

[383] thoremin. Voice-leading strategies (voiceLed, smooth, diatonicSeventh). [packages/sdk/src/harmony/voice_leading.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/harmony/voice_leading.ts)

[384] thoremin guide. Chord Map Strum. [guide/instruments/chord-map-strum.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/chord-map-strum.md)

[385] thoremin PR #609. Chord map: a key's chords on the screen, pointed at with one hand, held or strummed with the other. [thorwhalen/thoremin#609](https://github.com/thorwhalen/thoremin/pull/609)

[386] thoremin issue #614. Harmonic layers: eight choices, each with a recommendation. [thorwhalen/thoremin#614](https://github.com/thorwhalen/thoremin/issues/614)

[387] thoremin. Tension models, always named. [packages/sdk/src/harmony/tension.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/harmony/tension.ts)

[388] thoremin. Transition prior (Piston's table). [packages/sdk/src/harmony/prior.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/harmony/prior.ts)

[389] Piston W. Harmony. New York: W. W. Norton; 1941 (the table of usual root progressions, as encoded in the repository; not read directly).

[390] Livingstone SR, Muhlberger R, Brown AR, Thompson WF. Changing musical emotion: a computational rule system for modifying score and performance. Computer Music Journal. 2010;34(1):41-64. [research.bond.edu.au](https://research.bond.edu.au/en/publications/changing-musical-emotion-a-computational-rule-system-for-modifyin/)

[391] Agres KR, Dash A, Chua P. AffectMachine-Classical: a novel system for generating affective classical music. Frontiers in Psychology. 2023;14:1158172. [frontiersin.org](https://frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1158172/full)

[392] thoremin. Valence and arousal as harmonic controls. [packages/sdk/src/harmony/affect.ts](https://github.com/thorwhalen/thoremin/blob/main/packages/sdk/src/harmony/affect.ts)

[393] Manaris B, Johnson D, Vassilandonakis Y. Harmonic Navigator: a gesture-driven, corpus-based approach to music analysis, composition, and performance. Proc. AIIDE (AAAI); 2013 (search result only; year inferred). [ojs.aaai.org](https://ojs.aaai.org/index.php/AIIDE/article/view/12658)

[394] Cheung VKM, Harrison PMC, Meyer L, Pearce MT, Haynes JD, Koelsch S. Uncertainty and surprise jointly predict musical pleasure and amygdala, hippocampus, and auditory cortex activity. Current Biology. 2019;29(23):4084-4092. [cms.mus.cam.ac.uk](https://cms.mus.cam.ac.uk/publications/cheung-uncertainty-surprise/)

[395] thoremin guide. Wheel Walk. [guide/instruments/wheel-walk.md](https://github.com/thorwhalen/thoremin/blob/main/guide/instruments/wheel-walk.md)

[396] thoremin PR #812. Rate this move: the player's ratings of chord moves become their own move captions. [thorwhalen/thoremin#812](https://github.com/thorwhalen/thoremin/pull/812)

[397] thoremin issue #809. Harmony: the player's rated tension as a tension model. [thorwhalen/thoremin#809](https://github.com/thorwhalen/thoremin/issues/809)

[398] thoremin issue #716. Harmony: boundary blending, a hand on a hex vertex sounds the adjacent chords cross-faded (experimental). [thorwhalen/thoremin#716](https://github.com/thorwhalen/thoremin/issues/716)

[399] thoremin issue #783. Remove the deprecated chord and progression nodes. [thorwhalen/thoremin#783](https://github.com/thorwhalen/thoremin/issues/783)

[400] Google. Gemini API: music generation using Lyria RealTime (saved copy in docs/lyria-docs/music-generation.md). [ai.google.dev](https://ai.google.dev/gemini-api/docs/music-generation)

[401] Google. Lyria RealTime experimental model page (saved copy in docs/lyria-docs/lyria-realtime-exp.md). [ai.google.dev](https://ai.google.dev/gemini-api/docs/models/lyria-realtime-exp)

[402] Google Creative Lab. Semi-Conductor (2018). [github.com/googlecreativelab/semi-conductor](https://github.com/googlecreativelab/semi-conductor)

[403] Gesture2Music: a low-latency real-time framework for continuous gesture-driven music generation. arXiv 2511.00793; 2025. [arXiv](https://arxiv.org/abs/2511.00793)

[404] thoremin issue #141. Gesture-steered generative layer (hands conducting an AI), DAG-native, budgeted as new. [thorwhalen/thoremin#141](https://github.com/thorwhalen/thoremin/issues/141)

[405] thoremin. indirect-map steering schema and starter strains. [src/slices/generative/nodes/indirect_map.schema.ts](https://github.com/thorwhalen/thoremin/blob/main/src/slices/generative/nodes/indirect_map.schema.ts)

[406] thoremin PR #197. #188 PR 3: the lyria node on the lazy-loading pattern; the SDK leaves the main bundle. [thorwhalen/thoremin#197](https://github.com/thorwhalen/thoremin/pull/197)

[407] thoremin issue #735. Lyria engine: pause() ramps from a stale anchor, so the sound cuts at once (a click) instead of fading. [thorwhalen/thoremin#735](https://github.com/thorwhalen/thoremin/issues/735)

[408] thoremin. Roadmap. [docs/ROADMAP.md](https://github.com/thorwhalen/thoremin/blob/main/docs/ROADMAP.md)

[409] thoremin issue #101. Epic: Stream Applier — pluggable sources + batch/paced execution. [thorwhalen/thoremin#101](https://github.com/thorwhalen/thoremin/issues/101)

[410] thoremin pull request #799. Patcher v1 (#14): the live graph with React Flow and a settings inspector, as a lazy tool-only extension. [thorwhalen/thoremin#799](https://github.com/thorwhalen/thoremin/pull/799)

[411] thoremin issue #733. Patcher v2: swap a node, rewire, save a GraphSpec (the rest of #14 after the v1 of #181). [thorwhalen/thoremin#733](https://github.com/thorwhalen/thoremin/issues/733)

[412] thoremin issue #82. Design: a configuration calculus for composable "instruments" (partial configs that mix). [thorwhalen/thoremin#82](https://github.com/thorwhalen/thoremin/issues/82)

[413] thoremin issue #283. Migrate the in-repo zodal stand-ins (collection view rendering, persisted view state) to zodal. [thorwhalen/thoremin#283](https://github.com/thorwhalen/thoremin/issues/283)

[414] thoremin issue #322. Adopt @zodal/store-localstorage 0.3 (corrupt stores throw unless onCorrupt) once it is published. [thorwhalen/thoremin#322](https://github.com/thorwhalen/thoremin/issues/322)

[415] thoremin issue #331. Accounts, cloud save and tiers (future): optional auth, local-first, unauthenticated / authenticated / paying. [thorwhalen/thoremin#331](https://github.com/thorwhalen/thoremin/issues/331)

[416] thoremin. The ictus package (musical time from low-rate gesture). [packages/ictus/README.md](https://github.com/thorwhalen/thoremin/blob/main/packages/ictus/README.md)

[417] thoremin pull request #743. Orchestra dynamics default 'written' (#168 D12) and the ictus supported fps range (#178). [thorwhalen/thoremin#743](https://github.com/thorwhalen/thoremin/pull/743)

[418] thoremin issue #713. Harmony: an idiom paths library drawn as ghost trails on the chord map. [thorwhalen/thoremin#713](https://github.com/thorwhalen/thoremin/issues/713)

[419] thoremin issue #714. Harmony: computed move captions from measurable variables. [thorwhalen/thoremin#714](https://github.com/thorwhalen/thoremin/issues/714)

[420] thoremin pull request #744. Torus view of the chord map: pure geometry and drawer (#717). [thorwhalen/thoremin#744](https://github.com/thorwhalen/thoremin/pull/744)

[421] thoremin pull request #804. Chord map: the seven chords on a turning torus over the video; the Chord Map Paths seed (#745). [thorwhalen/thoremin#804](https://github.com/thorwhalen/thoremin/pull/804)

[422] thoremin issue #734. webaudio-synth: every new voice glides from 440 Hz to its pitch (an onset swoop on each score note, each hand appearance, each sound switch). [thorwhalen/thoremin#734](https://github.com/thorwhalen/thoremin/issues/734)

[423] thoremin issue #738. Hot store: a full localStorage makes every set() throw after the state changed, and the engine can fail to start. [thorwhalen/thoremin#738](https://github.com/thorwhalen/thoremin/issues/738)

[424] thoremin issue #739. Hot store: a stale tab's transient-only set() rewrites the whole persisted blob and reverts the other tab's saved prefs. [thorwhalen/thoremin#739](https://github.com/thorwhalen/thoremin/issues/739)

[425] thoremin issue #740. Orphan stills: after the IndexedDB copy, deleting any categorizer vetoes the sweep for good (its id stays in the frozen legacy copies). [thorwhalen/thoremin#740](https://github.com/thorwhalen/thoremin/issues/740)

[426] thoremin issue #741. Persisted goldens: no round-trip of what this build writes, no newer-than-code (rollback) blob, no invalid JSON envelope, no quota-throwing storage. [thorwhalen/thoremin#741](https://github.com/thorwhalen/thoremin/issues/741)

[427] thoremin issue #333. Scheduler: the KTH final-ritard prior when the conductor's confidence is low. [thorwhalen/thoremin#333](https://github.com/thorwhalen/thoremin/issues/333)

[428] thoremin issue #388. Make CI gate merges: branch protection with required checks on main (and decide whether deploy waits on CI). [thorwhalen/thoremin#388](https://github.com/thorwhalen/thoremin/issues/388)
