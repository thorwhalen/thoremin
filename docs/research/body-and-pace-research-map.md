# Body as a source, and pacing a song from the dancer's pulse: a research map

*thoremin epic [#186](https://github.com/thorwhalen/thoremin/issues/186) — 2026-09-09*

**Verification legend.** **[measured]** = run in this session on this Mac (M-series, Node 23, the numbers in the text are the numbers the terminal printed, scripts in the session scratchpad). **[from docs]** = read from a README, paper or model card, not executed. **[inferred]** = judgement; argue with it.

## 0. What this map answers

The maintainer's direction (verbatim on #186): body movements should control sound *and* control the pace of a song; movement should be **featurized** so it maps onto sound generation the way hand and face features do today; and a pre-existing song should be **paced** by the inherent rhythm of the dancer. Everything must run client-side, lazily loaded.

That is two problems joined by one signal:

1. **Body as a source.** A full-body pose stream (33 landmarks at camera rate) and a **body feature group** — angles, velocities, energy, shape, effort, periodicity — that the mapping contract, the Feature Lab meters and the trainer's cues can consume without knowing it is a body.
2. **Pace from pulse.** A song loaded in the browser, its beat grid inferred once, then played back with pitch preserved at a rate that follows the dancer's inferred pulse, in phase when possible.

The joining signal is the dancer's **pulse**: period, phase and confidence of the body's repeating motion. #178 (`docs/research/rhythm-from-gesture-research-map.md`) already established why that pulse has to be *inferred against a musical prior* rather than measured frame-to-onset: perceptual timing lives at 1-20 ms, under a frame period, and an onset train is a finite-rate-of-innovation signal recoverable below Nyquist only with a prior [R1]. The engine that does that inference is `ictus`, owned by the conductor epic (#187). This epic **consumes** it: the body half supplies anchors (impact candidates with confidence) and the pace half reads `MusicalTimeState`. Until `ictus` lands, an interim estimator sits behind the same seam (§4.4).

The Python precedent is the `paces` project (`t/paces`): its `measure.py` composes `mixing.audio.beat_grid` (librosa) with a speech/music split to measure a metric grid from a dance-tutorial video, and its alignment research (`docs/alignment/02-*.md`, `03-visual-signals.md`) benchmarked beat trackers, pose backends and pose-derived periodicity on this same machine. §8 maps that pipeline, function by function, onto browser equivalents.

---

## 1. Headline findings (the things that change the design)

1. **Pose costs no new JavaScript.** `@mediapipe/tasks-vision` is already shipped and lazily loaded for hands and face (`src/nodes/sources/webcam_hands.ts`, `webcam_face.ts`); `PoseLandmarker` is a class in the same wasm fileset (`vision_wasm_internal.js` 0.3 MB + `vision_wasm_internal.wasm` 11.2 MB, the pair `FilesetResolver` fetches from jsDelivr on first use; the nosimd variant is 10.5 MB). The only new download is the `.task` model: **lite 5.8 MB, full 9.4 MB, heavy 30.7 MB** (the hand model is 7.8 MB, the face model 3.8 MB). **[measured]** Lite is the default; full is a param.
2. **The paces benchmark already measured this family.** MediaPipe pose *lite* ran 30 fps video at 22 s per minute of video on CPU in Python (1800/1801 frames detected); the GPU delegate was 2x *slower* on Apple Silicon. **[from docs: paces `03-visual-signals.md` §5.3, measured there]** In the browser the lite model is reported at 25-30 fps on a laptop CPU and 11-12 fps on a Pixel 5 [R2]. Budget accordingly: the body source is the most expensive node the graph can host, so it is **off by default** and loads nothing until asked. It cannot fill the hands `source` slot (that slot's output is `hands`, §9.1); it is the default of its own `body` slot, always wired like the face branch and gated like it. In v1 a player who turns the body on pays for hands and body together; shedding the hands (`?slot.source=synthetic-hands`) also skips the camera, so "body without hands" is a later host decision, stated here so nobody mistakes it for a config flip.
3. **Periodicity wants a position, not a speed, and one joint, not the whole body.** On real pose data, wrist-y autocorrelated at r = 0.37 where |Δwrist| gave 0.11, and whole-body motion energy gave 0.15 **[from docs: paces §6.3, measured there]**. Two independent pose backends agreed on the top ACF period to the sample. So the pulse estimator autocorrelates *per-channel positions and angles* and picks the strongest channel; motion energy is the fallback, not the primary.
4. **Never read tempo off inter-beat intervals; fit a line.** Neural trackers quantise beats to a 20 ms grid; the median IBI of `beat-this` on a 129.200 bpm loop read 130.43 bpm (1 % error) where a least-squares line through the same beats read 129.201 **[from docs: paces `02-*.md` §3.1, measured there]**. Every tempo in this design is a least-squares slope.
5. **The only pure-JS beat tracker returns 15 seconds of beats.** `music-tempo` (a BeatRoot [R3] port, MIT, 8.7 KB gzipped) gets tempo to 0.01 bpm on clean clicks but its `beats` array stops at ~14.9 s regardless of input length, and it octave-errs at 85.8 bpm (reports 171.7) and on hi-hat eighths (reports 172.3 for 129.2). **[measured]** A 40-line onset-flux + autocorrelation + low-band comb tracker written for this map got tempo within 0.1 bpm and 98 % of beats within 70 ms on five of six synthetic cases, failing only the 170 bpm octave trap. **[measured]** Ship the hand-rolled tracker behind a `beatTracker` seam; the neural upgrade (Beat This!, §5.3) is a later candidate.
6. **Tempo-octave ambiguity is the controller's problem, not the tracker's.** Both the song's tempo and the dancer's period are octave-ambiguous (beat vs. half-note vs. bar; step vs. stride). The pace controller therefore computes the rate as the **ratio nearest 1** over octave multiples of both, and clamps it to a quality range. That single rule removes the failure mode every tracker in §5 exhibits.
7. **Pitch-preserving time-stretch is free in the browser.** `HTMLMediaElement.playbackRate` with `preservesPitch = true` (the default) is Baseline since December 2023: Chrome 86, Firefox 101, Safari 17.2 (WebKit-prefixed since Safari 4) [R4]. Routed through `createMediaElementSource` it mixes into the existing `AudioContext`. That is the zero-dependency default. The upgrade seam is **Signalsmith Stretch** (MIT, 47 KB gzipped, a WASM `AudioWorkletNode` with `schedule({rate, semitones, input})` for sample-accurate rate changes) **[measured size; API from its README]** — the same algorithm the paces `derive` step would use in Python.
8. **D-Jogger is the design precedent for "music follows the mover", and it is quantified.** Moens et al. [R5] tested four strategies on runners: tempo-matching alone raised phase coherence to R = 0.17, starting in phase plus tempo-matching to R = 0.73, and additionally nudging tempo whenever phase drifted past ±30° to **R = 0.92**. Their stretch range was ±10 % (a phase vocoder); beyond it they changed song. Van Dyck et al. [R6] tested ±1 to ±3 % steps on runners: entrainment held to about ±2 % and dropped significantly from +2.5 % (and tended to drop at −3 %). For this epic the rule is: match period, start in phase, correct phase by nudging rate, clamp to ±10 % by default (widen as a dial), and never jump the audio.
9. **Kinematic beats are velocity minima; visual beats are decelerations.** AIST++ [R7] defines a dance's kinematic beats as local minima of the kinetic velocity and scores alignment with a Gaussian of the beat distance (σ = 3 frames at 60 fps, 0.05 s); `muvid` already ports that scorer as a per-beat track (`motionbeat_tracks` / `_bas_track` in `muvid/footage/scoring/motionbeat.py`, σ = 0.12 s). Davis & Agrawala [R8] define visual beats from the deceleration ("impact") envelope of motion. Pedersoli & Goto [R9] learned beats from OpenPose keypoints alone with a TCN and reached F = 0.69 — a ceiling to remember: pose alone will not give an audio-grade beat, which is exactly why the prior (`ictus`) is needed.
10. **The computable body-feature vocabulary exists and is small.** Larboulette & Gibet's review [R10] and Camurri's EyesWeb library [R11] give the low-level (velocity, acceleration, jerk, curvature), mid-level (quantity of motion, contraction index, centre of mass, bounding volume) and Laban Effort (Weight ≈ kinetic energy, Time ≈ acceleration magnitude, Space ≈ path-to-displacement directness, Flow ≈ jerk) descriptors [R12]. Müller's relational features [R13] (boolean geometric relations like "left hand above head") are the viewpoint-robust binary features the trainer's cues want. §3 turns these into a catalog.

---

## 2. Pose in the browser

### 2.1 Candidates

| model | keypoints | runtime | new JS to ship | model download | licence | browser rate (reported) | verdict |
|---|---|---|---|---|---|---|---|
| **MediaPipe `PoseLandmarker` lite** | 33 (+ world landmarks in metres, + visibility/presence) | `@mediapipe/tasks-vision` wasm, **already shipped** | **0** | **5.8 MB** [measured] | Apache-2.0 | 25-30 fps laptop CPU; 11-12 fps Pixel 5 [R2] | **default** |
| MediaPipe `PoseLandmarker` full | 33 | same | 0 | 9.4 MB [measured] | Apache-2.0 | fewer fps; less jitter on fast motion | a param (`model: 'full'`) |
| MediaPipe `PoseLandmarker` heavy | 33 | same | 0 | 30.7 MB [measured] | Apache-2.0 | ~5 fps in browser | not offered live |
| MoveNet Lightning (TF.js) | 17 (COCO) | `@tensorflow/tfjs-*` **already shipped** for the legacy hand model + `@tensorflow-models/pose-detection` | 21 KB gz [measured] | ~3 MB int8 (model card) | Apache-2.0 | 34 fps browser; 50+ fps laptop [R14] | not a seam (no second real implementation is needed yet); listed for the cost comparison. No world landmarks, no z |
| MoveNet Thunder (TF.js) | 17 | same | 21 KB gz | ~7 MB | Apache-2.0 | slower | not planned |
| YOLO11-pose (ONNX web) | 17 | `onnxruntime-web` (142 MB unpacked; several MB of wasm at runtime) | large | ~10 MB | **AGPL-3.0** weights/code | fast on GPU | **out** (licence; paces made the same call) |
| RTMPose (ONNX web) | 17 / 133 | `onnxruntime-web` | large | 5-30 MB | Apache-2.0 | unverified in browser | not for v1 |

### 2.2 What the 33 landmarks give and what they do not

BlazePose's 33 points are the COCO 17 plus face points (eyes inner/outer, ears, mouth), hand points (pinky, index, thumb tips) and feet (heel, foot index). `worldLandmarks` are root-relative metric coordinates with the hip midpoint as origin; `landmarks` are normalised image coordinates with a *relative* `z` [R2]. The metric set is what body angles and velocities want (scale-free), and it is "one attribute away" as paces noted (§5.5 there). Absolute depth is weak in both; nothing in §3 relies on it.

Two constraints from the Tasks API that shape the node: `detectForVideo(video, timestampMs)` needs strictly increasing timestamps (the existing hand/face nodes already thread the clock through), and the pose detector is a two-stage pipeline (person detector on the first frame or on tracking loss, then the landmark model on the crop), so the *first* frame after a loss is markedly more expensive than a tracked frame — the frame-drop guard in `src/app/engineLoop.ts` already handles a slow tick, and the node exposes `minTrackingConfidence` as a param so a player on a slow machine can trade stability for re-detections.

### 2.3 Cost discipline

The body source is the most expensive node the graph can host. Three rules follow:

- It is the default of a **`body` slot** (`webcam-body` / `synthetic-body` / `replay-body`), always wired and **gated off** until the `body.enabled` dial, the Lab or a trainer cue wants it — the face branch's rule. `?slot.body=synthetic-body` runs the whole body path with no camera and no model. Hands keep running when the body is on (v1 pays for both); the hands slot alone decides whether the camera is acquired.
- It runs at **camera rate but samples features at a declared rate**. The pulse estimator (§4) needs a stable sample period, so the feature node timestamps every vector and the estimator resamples; it must not assume 30 Hz.
- **Feature demand gates computation** exactly as it does for the face groups (`src/features/demand.ts`): with the Lab closed and no mapping or cue claiming a body group, the feature node computes only what is claimed.

---

## 3. Featurizing the body

### 3.1 The literature, compressed

Four sources cover what is computable from a skeleton, and they agree:

- **Larboulette & Gibet 2015** [R10] review the descriptors by level: *low-level* (position, velocity, acceleration, jerk, curvature per joint), *geometric* (distances, angles, bounding box/volume, centre of mass, contraction), *dynamic* (kinetic energy, quantity of motion), and *expressive* (Laban Effort and Shape). Their descriptor list is the basis of teaching implementations in Python, Processing, p5.js and Max [R15].
- **Camurri et al. 2003** [R11] (EyesWeb) established the two mid-level cues that survive every later paper: **Quantity of Motion** (QoM, the sum of body displacement per frame, a proxy for energy) and the **Contraction Index** (CI, how contracted the body is relative to its bounding hull), plus per-limb velocity/acceleration/fluidity.
- **Laban Effort** as computed from skeletons [R12, R16]: Weight = mean kinetic energy ½|v|²; Time = mean |a|; Space (directness) = path length / net displacement over a window; Flow = mean jerk |ȧ| (the literature names Flow but rarely writes it; jerk is the standard reconstruction). Window sizes of one to two seconds are typical (55 frames at 30 fps in [R12]).
- **Müller, Röder & Clausen 2005** [R13]: boolean *relational* features ("right hand in front of the torso plane", "feet apart wider than shoulders", "left knee bent") that are invariant to viewpoint and body size. These are exactly the vocabulary of a trainer cue ("raise your left arm") and cheap to threshold in noise units.

For dance specifically, AIST++ [R7] defines the **kinematic beat** (local minima of summed joint speed), and Davis & Agrawala [R8] the **visual beat** (peaks of the deceleration envelope). Both are *anchor detectors* in #178's vocabulary: they produce candidate instants with a confidence, not beats.

### 3.2 The proposed catalog groups

The feature catalog (`src/features/catalog.ts`) is data-driven: a feature is an id, a group, a formula over named inputs, and a normaliser. Body features follow the existing `hand.*` / `face.*` naming and add these groups. Every quantity is **scale-normalised by torso length** (|shoulder-mid − hip-mid|, in world coordinates when present) so a dancer walking toward the camera does not read as more energetic — the one omission paces flagged in kodokan's energy (§6.1 there).

| group | features (examples) | source columns | why |
|---|---|---|---|
| `body.angle` | elbow L/R, knee L/R, hip L/R, shoulder abduction L/R, torso lean (pitch/roll), head yaw vs. shoulders | world landmarks | the melodic/continuous controls; joint angles are the viewpoint-stable positions to autocorrelate (§4) |
| `body.pos` | wrist L/R x/y, ankle L/R y, hip-mid y (bounce), head y — all torso-normalised, root-relative | landmarks | raw positions for the Lab and for periodicity (positions beat speeds, finding 3) |
| `body.kin` | per-limb speed and acceleration (wrists, ankles, head), **QoM** (confidence-weighted, kodokan's formula ported), jerk | derived | energy → loudness/brightness; jerk → articulation |
| `body.shape` | **contraction index**, bounding-box aspect, **centre of mass** (x, y), sway (CoM lateral velocity), openness (wrist-wrist / shoulder-shoulder), stance width | landmarks | posture as a slow control; CI is the classic expressiveness cue |
| `body.effort` | Laban weight, time, space, flow over a 1 s window | kin | the four expressive axes; windowed so they are slow and smooth |
| `body.rel` | boolean relations: hand above head L/R, hands crossed, feet apart, knee bent L/R, leaning L/R | landmarks | trainer cue vocabulary; gesture dispatch triggers (#129) |
| `body.rhythm` | pulse period (s), pulse phase (0..1), pulse confidence, impact strength (deceleration envelope), kinematic-beat flag | from the pulse estimator (§4) | the signal the pace half consumes; visible in the Lab so a player can *see* their pulse |

As implemented (#186 PR C, `src/features/body_catalog.ts`, 51 features): the groups are `body.angle` (elbows, knees, hips, arm raise, torso lean, head tilt — no torso pitch or head yaw yet), `body.pos` (raw mirrored image positions plus `wrist.*.rise` in torso lengths), `body.kin` (speeds, wrist accelerations, QoM — no per-limb jerk), `body.shape` (extension, openness, stance, height, centre of mass, sway — no bounding-box aspect; `extension` stands in for the contraction index), `body.effort` (the four Laban factors over a 1 s window) and `body.rel` (fixed body-relative thresholds: 10° lean, 140° knee, shoulder width — the noise-unit thresholding happens downstream in the trainer, not in the catalog). One correction to §3.2's table: kinematic and effort features read the **image** landmarks divided by the image torso, not the world set, because MediaPipe's world coordinates are re-centred on the hips every frame and a velocity taken in them cannot see a step or a jump. `body.rhythm` arrives with the pulse (PR F).

Numbers to hold: 33 landmarks × (x, y, z, visibility) = 132 raw columns; the groups above are ~45 features. The catalog's online normaliser handles ranges; thresholds (relations, impact flags) are expressed in **noise units** (`src/enroll/noise.ts`: displacement divided by the feature's own frame-to-frame jitter), so a relation flips at the same perceptual margin for a 0..1 position and a degree-valued angle.

### 3.3 Mapping body features to sound

The mapping contract (`src/nodes/mapping/mapping_contract.ts`) is feature-agnostic: it consumes a `FeatureVector`. So "map one body feature to a sound dial" is the *existing* feature→dial path with a body feature id in it. The research question is only which defaults are musically sensible, and the descriptor literature suggests the natural pairs: QoM/weight → loudness; height of the higher hand → pitch (the theremin metaphor extended to the arm); contraction → filter cutoff/brightness; flow (jerk) → articulation/attack; sway → pan; pulse phase → a rhythmic gate or LFO phase. These are presets, not code paths.

---

## 4. The dancer's pulse

### 4.1 What is measurable, and what is not

A 30 Hz landmark stream cannot resolve a beat placement (33 ms frame; JND for asynchrony ~20 ms). It *can* resolve **period** to well under 1 % over a few seconds (autocorrelation interpolates across many cycles), and **phase** to about a quarter frame with parabolic interpolation of the impact envelope. That is enough for the pace half: tempo following needs period; phase correction needs only the *sign and rough size* of the error (D-Jogger's ±30° threshold is a twelfth of a cycle, 40 ms at 120 bpm). The precision that matters is the one paces §6.3 measured: two backends agreeing on a 0.767 s period to the sample.

### 4.2 The estimator that works (paces §6.3, kodokan)

Autocorrelate a smoothed, mean-removed motion curve; search lags between 0.3 s and 3 s; return the **top-k peaks**, not the argmax, because the harmonics (period, 2×, 4×) are the point — beat vs. bar vs. 8-count is the ambiguity the controller resolves (§6). On paces' synthetic ground truth the ACF recovered the 0.800 s period from frame-difference energy (r = 0.92 raw, 0.98 after de-glitching the cuts) and from Farneback flow (r = 0.985). The port is 20 lines. Three refinements from the same source: autocorrelate positions/angles, pick the channel with the highest peak, and treat cross-channel agreement as confidence.

### 4.3 Impacts: the phase anchors

Phase comes from *events*, and the event the literature agrees on is the impact: a deceleration peak (Davis & Agrawala's envelope [R8]), equivalently a velocity minimum (AIST++ [R7]). Concretely: smooth the chosen channel's speed, half-wave rectify its negative derivative, pick peaks above a robust threshold (median + MAD, as `muvid`'s `_motion_peaks` does) with a minimum spacing of 0.2 s. Each peak is an **anchor** with a confidence (its height in noise units). paces' §6.4 then sweeps an offset against the audio beat grid to maximise a Beat Alignment Score; here the same sweep runs *continuously* as the phase error the controller corrects.

### 4.4 The seam to `ictus` (#187)

#178 §6 fixes the shape: `AnchorDetector → RhythmInferenceEngine → MusicalTimeState`. This epic implements the **body `AnchorDetector`** (§4.3 is it) and consumes `MusicalTimeState` (period, phase, confidence, next-beat forecast). The engine in between is `ictus`. Until it lands, an **interim engine** with the same interface does: a causal windowed ACF for period (§4.2 on the last 4-6 s, updated every 250 ms) and a phase-locked-loop on the anchors for phase (predict the next anchor from period, correct the phase by a fraction of the residual — a degenerate Large-Kolen oscillator, which #178 notes is exactly what an oscillator is). Swapping in `ictus` is replacing one module behind one interface; nothing downstream sees it. This is a declared exception to the seam rule (a seam is declared only when its replacement already exists): `src/ictus/` does not exist yet, and the interface is fixed by #178 §6 and #187 rather than by code one can point at.

One rule carried from #178 verbatim: **anchors are observations with likelihoods, never onsets**. The body node emits candidates; it does not decide the beat.

---

## 5. The song's beat grid, in the browser

### 5.1 Decoding is free

`AudioContext.decodeAudioData` decodes MP3, AAC/M4A, WAV, OGG and FLAC natively in every current browser; a 4-minute song decodes in well under a second. No codec dependency is needed for the pace half — only the recording exporter (`src/app/recording/formats.ts`) needs `libflacjs`, and that pattern (lazy `import()` on first use) is the one every module below follows.

### 5.2 Candidates

| library | what it gives | size | licence | runs where | measured accuracy | verdict |
|---|---|---|---|---|---|---|
| **hand-rolled** flux + ACF + comb (this map) | tempo, beat list, phase | ~0 (40 lines) | ours | worker or main thread | tempo within 0.1 bpm, 98 % beats < 70 ms on 5/6 synthetic cases; octave error at 170 bpm **[measured]** | **default** |
| `music-tempo` (BeatRoot port) [R3] | tempo, beats | 8.7 KB gz **[measured]** | MIT | main thread, ~120 ms for 30 s **[measured]** | tempo 0.01 bpm on clean clicks; **beats stop at ~15 s**; octave errors at 85.8 and with hi-hat eighths **[measured]** | not usable for a full-song grid |
| `web-audio-beat-detector` | tempo + offset (`guess()`) | 12 KB tgz **[measured]** | MIT | worker via `OfflineAudioContext` (browser only) | not measurable in Node; author: "surprisingly good for electronic music", default range 90-180 bpm | not needed |
| `realtime-bpm-analyzer` | live BPM from a stream (AudioWorklet) | 7 KB gz **[measured]** | Apache-2.0 | browser | tempo only, no beats | not needed (the song is known, so offline is fine) |
| `aubiojs` (aubio wasm) | onsets, tempo, pitch | 71 KB gz **[measured]** | **GPL-3.0** | browser/Node | untested | out (licence) |
| `essentia.js` | RhythmExtractor2013 etc. | 10 MB unpacked **[measured]** | **AGPL-3.0** | browser | strong (paces measured the Python one) | out (licence, size) |
| **Beat This!** [R17] via `onnxruntime-web` | beats + downbeats, per-beat confidence | main model ~20 M params (the C++ port's ONNX export is 97 MB); the paper's **~2 M-param variant** scores 88.8 / 77.2 **[from docs]** and would be ~8 MB fp32 / ~2 MB int8 **[inferred: params × bytes; no export exists]**; `onnxruntime-web` wasm ≈ 10-20 MB at runtime | code + weights MIT; paper CC BY 4.0 | browser (WebGPU/WASM) | beat F1 89.1, downbeat 78.3 on GTZAN, without DBN **[from docs]** | the upgrade candidate for downbeats; needs an ONNX export of the small model (none exists today) and a browser mel front-end |

### 5.3 What the hand-rolled tracker is and why it is enough

Onset strength: per hop (256 samples at 22.05 kHz, 86 Hz), log-energy of the signal and of its first difference (a two-band proxy for low/high spectral flux), half-wave rectified difference. Tempo: autocorrelation of the mean-removed envelope over lags for 60-200 bpm, parabolic peak interpolation, then a least-squares line through the comb-picked beats (finding 4). Phase: a comb over one period against the **low-band** flux only, which is why hi-hat eighths and swung eighths do not pull it off the beat (finding 5) — the same lesson as paces' move of the sub-bass band away from the male vocal fundamental. The remaining failure is the octave (170 bpm read as 85), and §6 argues that failure must be absorbed by the controller anyway. It runs in a Web Worker on the decoded buffer, once per loaded song, in tens of milliseconds.

The grid it produces is the `paces` ruler, verbatim from `02-*.md` §1: `(phase_s, period_s, meter, beats[], confidence)`, with `beats` kept alongside the line because real songs drift and snapping to the nearest actual beat beats extrapolating for anything longer than ~30 s. Downbeats stay an empty array until Beat This! is wired, exactly as `mixing.audio.BeatGrid.downbeat_times` does.

---

## 6. Time-stretch in the browser, and the pace controller

### 6.1 Stretch options

| option | quality | rate range | live rate change | size | licence | verdict |
|---|---|---|---|---|---|---|
| **`HTMLMediaElement.playbackRate` + `preservesPitch`** [R4] | browser-native WSOLA-class; good within ~0.5-2×; artefacts grow outside | Chrome clamps to 0.0625-16; pitch preservation quality is browser-specific | yes, immediate | 0 | n/a | **default** (Baseline Dec 2023: Chrome 86, Firefox 101, Safari 17.2) |
| `AudioBufferSourceNode.playbackRate` | resampling — **pitch changes with rate** | any | yes | 0 | n/a | only as the `preservesPitch=false` mode (a "record player" effect) |
| **Signalsmith Stretch** (web) [R18] | polyphonic phase-vocoder variant; high perceived quality; formant options | wide (0.25-4× comfortably) | yes, sample-accurate via `schedule({output, rate})` | 47 KB gz **[measured]** | MIT | **upgrade seam**; also the answer for pitch-shift (`semitones`) if a body feature should bend the key |
| `soundtouchjs` | WSOLA (SoundTouch) | wide | yes | 5.8 KB gz **[measured]**, but ScriptProcessor-era design | LGPL-2.1 | not needed |
| `rubberband-wasm` / `rubberband-web` | excellent | wide | yes | 640 KB-1.4 MB | **GPL-2.0** | out (licence) |
| hand-rolled phase vocoder in an AudioWorklet | mediocre without transient handling | | | ~200 lines | ours | not worth it while Signalsmith is MIT |

The native path mixes into the existing graph through `audioContext.createMediaElementSource(el)`; the Signalsmith path is an `AudioNode` fed with the decoded channels through `addBuffers`. Both hide behind one `Stretcher` interface: `load(buffer)`, `setRate(r, at?)`, `position()`, `start/stop`.

### 6.2 The controller (what "follow their pulse" means)

D-Jogger [R5] is the tested design and its numbers are the acceptance test. Translating its strategy 4 to a song following a dancer:

1. **Period**: rate = song beat period / dancer period, choosing the octave multiple of each that brings the ratio **nearest 1**, then smoothed (a first-order filter with a ~1 s time constant) and **clamped to ±10 %** by default (a dial widens it; Signalsmith tolerates ±50 % musically, the native element less).
2. **Phase**: start playback so that the next audio beat lands on the next predicted anchor; thereafter, whenever phase error exceeds **±30°** (one twelfth of a cycle), nudge the rate by ±3 % until it closes, then release. Never seek the audio: a jump is audible, a nudge is not.
3. **Confidence gating**: below a pulse confidence threshold (ACF peak in noise units, and anchor agreement), hold the last rate. A dancer who stops does not stop the song; a dancer who wanders is not followed into noise. This is #178's "the engine decides whether an anchor confirms, changes tempo, or is noise", applied at the consumer.
4. **Two clocks** (#178 §6): the audio clock owns playback; the frame clock only *corrects* the estimate. The controller runs on the audio side at the tick rate, reading the latest `MusicalTimeState`.

Evaluation is D-Jogger's: the resultant vector length R of the phase between anchors and audio beats. Strategy 4 reached 0.92 on runners with 10 ms footfall sensors; with 30 Hz pose the honest target for a fixture replay is **R > 0.7** (their strategy 3 level), rising as `ictus` replaces the interim estimator.

---

## 7. Test material and fixtures

- **Synthetic click tracks** (as in this map's benchmark and paces' `click129.wav`): exact tempo, exact phase, optional hi-hat eighths and swing. These are the beat-tracker unit tests; a few seconds each, committed as generated-at-test-time, not as audio files.
- **Synthetic pose streams**: a `synthetic-body` source (the `synthetic-hands` pattern) that emits a skeleton bouncing at a known period with known impact instants, so the pulse estimator and the controller have ground truth with no video.
- **Dance videos** via `yb` into `~/.local/share/thoremin/videos/` (never the repo), run through a headless `scripts/video_to_pose.py` in the existing `media/.venv` (mediapipe 0.10.35 is installed there), committed only as small NDJSON pose streams under `test/fixtures/video_body_*/` in the existing `{tick,t,value}` shape. Choose clips whose music has a **known BPM** so the replayed pulse can be scored against a ground-truth grid; paces' Que Calor clip (129.2 bpm, origin 51.2 s) is one such.
- **The R-score replay test**: replay a pose fixture through body source → features → pulse → controller against the song's known grid, assert R and the rate stays within the clamp. This is the fixture-replay test the project rule demands ("new behaviour gets a fixture-replay test").

---

## 8. paces (Python) → thoremin (browser): the mapping

| paces / fleet | what it does | browser equivalent | status |
|---|---|---|---|
| `mixing.audio.beat_grid` (librosa `onset_strength` + `beat_track`) | tempo + beats + onset envelope, once, on the master song | hand-rolled flux + ACF + comb in a Worker (§5.3); `BeatGrid` shape preserved (`beats`, `downbeats: []`, `onsetEnv`, `hopS`, `tempoBpm`) | to build |
| `paces.measure.measure_grid` (speech/music split → tempo → origin, flagged confidences) | a `MetricGrid` with honest `None`s and flags | the same object as `SongGrid { phaseS, periodS, meter, beats, confidence, flags }`; no speech/music split (the player chose the song) | to build |
| `beat-this` (recommended in paces `02-*.md` §2.2, MIT) | downbeats + per-beat confidence | Beat This! small (2 M) via `onnxruntime-web`, lazily; empty `downbeats` until then | later |
| `librosa` least-squares tempo (paces §3.1) | tempo from a line through beats | same, in `SongGrid` | to build |
| `kodokan.segment.pose_motion_energy` | confidence-weighted QoM | `body.kin.qom` (+ torso normalisation) | to build |
| `kodokan.segment.estimate_period` (argmax) / the top-k `acf_periods` snippet in paces `03-visual-signals.md` §6.3 (a doc, not package code) | period(s) from ACF | the pulse estimator (§4.2), causal windowed | to build |
| paces §6.4 impact envelope + offset sweep + BAS | phase of the motion vs. the grid | anchors (§4.3) + the controller's phase error (§6.2); BAS as the test metric | to build |
| `muvid.footage.scoring.motionbeat` (`motionbeat_tracks`, `_bas_track`) | per-beat Gaussian alignment score | the R / BAS score in the replay test | to build (test only) |
| paces `derive` (ffmpeg loop clips) | media derivation | not applicable | — |
| MediaPipe Tasks `PoseLandmarker` (Python, `video_to_landmarks.py` pattern) | headless pose from video | `scripts/video_to_pose.py` for fixtures; `webcam-body` node in the app | to build |
| Elastique / phase vocoder (D-Jogger) | pitch-preserving stretch | native `preservesPitch` default; Signalsmith Stretch seam | to build |

---

## 9. How it lands in thoremin

Everything below is additive at an existing boundary; nothing changes `src/dag/`, `src/app/useEngine.ts`, `src/nodes/music/score.ts` or `src/ictus/` (owned by sibling sessions). Paths are the templates the survey found; the new files sit next to them.

### 9.1 The body source is a second slot, gated like the face

The `source` slot's contract output is literally `{ name: 'hands', kind: 'hands-frame' }` (`src/nodes/sources/source_contract.ts`), so a pose source cannot fill it, and it should not: hands and body are different instruments that a player may run together. The precedent for a second camera branch is `camFace` in `src/app/graph.ts`: always wired, **off by default**, its model fetched only when something claims it (`faceActive` in `webcam_face.ts`, reading the dial, the Lab, and feature demand). The body source copies that gate exactly, and additionally becomes the first entry in a new **`body` slot** (`SLOTS.body`, contract `BODY_SOURCE_CONTRACT`, output `{ name: 'body', kind: 'body-frame', schema: BodyFrameSchema }`), with candidates `webcam-body` (default), `synthetic-body` and `replay-body` — the same three-candidate shape as `source`, for the same reason: `?slot.body=synthetic-body` runs the whole body path with no camera and no model, and `test/source_slot.test.ts`'s candidate/determinism loops extend to it by adding a table row. `sourceNeedsVideo` is unchanged: whether a camera is acquired is still the hands slot's decision, and the body node is a no-op until `ctx.resources.video` exists and the gate is open.

New in `src/nodes/domain.ts`: `BodyFrame { width, height, present, landmarks: Keypoint[33] (pixels), world?: Keypoint[33] (metres, hip-origin), visibility: number[33] }` plus `BodyFrameSchema` and a `BLM` landmark index table (the `LM` pattern). The third copy of `TASKS_VISION_VERSION` / `WASM_BASE` is the moment to extract `src/nodes/sources/tasks_vision.ts`; hands and face import it (a two-line change each).

The dial: `'body.enabled'` (boolean, facet `Body`) and `'body.model'` (`lite` | `full`), added to `src/settings/dials.ts` and its two bijections. The gate is the face's mechanism, not MIDI's: a slot candidate declares no inputs, so the node reads the dial (and the Lab, and feature demand) off `ctx.resources.controls` through `bodyActive`, exactly as `faceActive` does; there is no `enabled` port to leave unconnected. The structural guard in `test/app_graph.test.ts` therefore checks what *can* go unconnected — the two edges that make the toggle visible (`camBody.body → overlay.bodyFrame`, `camBody.status → overlay.bodyStatus`) — and a lifecycle test drives the node through off → on → model swap → off against a mocked tasks-vision. Cold-load clicks to "select the body source": open the Body panel, one toggle. Two.

### 9.2 Body features are a third `FeatureSource`

`FeatureSource` (`src/features/types.ts`) grows a `'body'` member; `BODY_GROUPS` joins `FACE_GROUPS`/`HAND_GROUPS` in `src/features/catalog.ts`; `src/features/body_catalog.ts` holds the `FeatureDef`s of §3.2 over a `BodyCtx { frame, prev, dtS, torsoLen }`; `labConfig.ts` gains `BODY_GROUP_IDS`, `labWantsBody`, `demandWantsBody`, and `resolveLabGate` needs no change. The node is `body-feature-vector` (`src/nodes/features/body_feature_vector.ts`, the `hand_feature_vector.ts` template minus the handedness dwell) — `body → vector`, gated by the shared gate so nothing is computed with the Lab closed and no claim.

The vector reaches the Lab through a third overlay input (`bodyVector`, the additive-tap pattern at the end of `defaultGraph`'s edge list), the trainer through `FEATURE_VECTOR_EDGES` in `src/app/enroll/liveVector.ts` (its structural test then covers it), and recordings through `FeatureJsonlTap` unchanged. Trainer cues that say `groups: ['body.rel']` work with no trainer change: the trainer is pure over `FeatureVector`.

### 9.3 Mapping a body feature to sound reuses the hand-map effect vocabulary

There is no generic feature→dial mapper today; `handMap` routes fingers to the `EFFECTS` list (`brightness | vibrato | pan | pitchBend | octave | gate`, `src/nodes/mapping/hand_map.ts`) and `voice-mapping` applies them. The body version is the same shape one level up: a whole-object dial **`bodyMap`** (`routes: [{ feature: <catalog id>, target: EffectId | 'gain', inMin, inMax, invert, smoothing }]`), a `body-route` node (`vector` + the `bodyMap` snapshot → `mods: VoiceMods`), and one optional `mods` input on `voice-mapping`, added to `MAPPING_SLOT_INPUTS` so the slot's edge-stability guarantee keeps holding. The panel is the `hand.tsx` pattern (a select per route, writing through `dispatchDialSetIn`), which the AST guard in `test/dials_write_path.test.ts` already polices. A route's `feature` is any catalog id, so the same node routes a face or hand feature tomorrow; it is named `body-route` because that is who needs it first.

### 9.4 The pulse is a node with the `ictus` interface behind it

`body-pulse` (`src/nodes/features/body_pulse.ts`, roles `feature`): `vector → pulse: PulseState { periodS, phase, confidence, bpmEstimates: [{bpm, r}], lastAnchorT }`, with the §4.3 anchor detector inline and the estimator behind a `PulseEngine` interface (`push(anchor) / advance(dt) / state()`). The interim engine (§4.4) ships in `src/nodes/features/pulse_engine.ts`; when `src/ictus/` lands, the node's `make()` takes an `engine` param defaulting to it. The `body.rhythm` catalog features are read back from this node's output so the Lab shows the pulse.

As implemented (#186 PR F, `src/nodes/features/pulse_engine.ts` + `body_pulse.ts`): the node reads the raw `body` frame, not the vector (the channel is one landmark's height in torso lengths — the head's by default — and a position, not a speed, per §4.2); the seam is `push(t, value) / state() / reset()` rather than `push(anchor)`; anchors are the median-filtered **down extrema** of the channel (phase 0 = the landing) rather than deceleration peaks, timed by an extremum test — the same departure `src/ictus` makes and argues for at 30 Hz; the autocorrelation is normalised per lag by the overlapping energies so a slow dancer's peak is not crushed; a weak unrelated ACF winner lowers confidence instead of switching the tempo; and `PULSE_HOLD_CONFIDENCE` (0.2) is the measured threshold the pace controller holds below. Measured on the Que Calor fixture: above the threshold the head's period is on a harmonic of the beat 90 % of the time and its anchors are phase-coherent with the folded beat (R = 0.66); the hips are not (R = 0.18). `ictus` (#200) is on main; the adapter that seeds its oscillator from `createAcfPeriodEstimator` and feeds it `createExtremaAnchorDetector`'s anchors needs a `seed(period)` on its `RhythmPrior`, which #187 owns — until then the interim engine stays behind the seam.

### 9.5 The song lives in the hot store, the player is a node

Nothing in the repo plays an audio file (`playbackRate` has zero hits). The song's *runtime* state — a stable `SongHandle { id, buffer: AudioBuffer, grid: SongGrid, playing }` — is added to the hot store (`src/app/store.ts`) as a transient key that is **not** in `SettingsSchema`, not in `partialize` and not in `pickSettings` (the `muted` precedent): the store's `persist` middleware stringifies on every `set`, so a persisted `AudioBuffer` would rehydrate as `{}` and a persisted grid would drag tens of thousands of floats into localStorage and into every saved instrument. Only the scalar dials persist. `store-controls` emits the handle on a `song` port each tick as the *same* object reference until a new song loads (unlike `chordConfig`, which is a fresh literal per tick), so downstream nodes detect a new song by identity; fixture recording lists edges with `recordOnly`, so the handle never lands in an NDJSON. `playing` flips through a `song.play` / `song.stop` command (the #87 rule for a discrete control); the loader writes the handle directly, as the recorder writes its session, because a decoded buffer is not a param. This avoids touching `useEngine`'s resource bag. Loading is a shell tool: `song` in `src/app/tools.ts` (kind `panel`, hotkey), a `SongPanel.tsx` with a file input that decodes via `decodeAudioData`, runs the §5.3 tracker in a Worker (`src/song/beatTrack.ts`, pure, unit-tested on synthetic clicks) and writes the store; `test/tools_shell.test.tsx` / `test/app_shell.test.ts` prove it is reachable. Cold-load clicks to "load a song": tool button, file picker. Two.

`song-player` (`src/nodes/output/song_player.ts`, `BROWSER_NODES`, roles `synth`) consumes `song` and a live `rate` port, owns a `Stretcher` (`src/song/stretcher.ts`: `media-element` default via `createMediaElementSource` into `ctx.resources.masterGain`; `signalsmith` as a lazy `import('signalsmith-stretch')` candidate), and is a no-op without `audioContext` — the `webaudio_synth.ts` guard. Dials (scalar, persisted, per instrument): `'song.follow'`, `'song.rateMin'`, `'song.rateMax'`, `'song.stretcher'`.

### 9.6 The controller closes the loop

`pace-controller` (`src/nodes/music/pace_controller.ts`, `CORE_NODES`, roles `music`, `control`; pure, Node-testable): `pulse` + `song` (for the grid and playback position) → `rate`, implementing §6.2 (octave-nearest ratio, smoothing, clamp, ±30° phase nudge, confidence hold). Wiring: `bodyVec.vector → pulse.vector`, `pulse.pulse → pace.pulse`, `ui.song → pace.song`, `pace.rate → songPlayer.rate`, each with a structural guard. The replay test drives a `synthetic-body` fixture with a known period against a synthetic grid and asserts R > 0.7 and the rate inside the clamp.

Catalog: `webcam-body`, `synthetic-body`, `replay-body`, `body-feature-vector`, `body-pulse`, `body-route` file under a new **Body** section of `scripts/gen_catalog.ts`'s `CATEGORIES`; `song-player` and `pace-controller` under a new **Song** section (the catalog test fails on the "Other" catch-all). `test/app_graph.test.ts`'s node count moves from 18 to 24 across the series (`camBody`, `bodyVec`, `bodyRoute`, `pulse`, `songPlayer`, `pace`), one step per PR, on purpose.

### 9.7 What stays out of v1, by name

A player-facing dropdown for the `body` slot (a verification affordance, same ruling as `source`); MoveNet (a seam with no second real implementation yet); Beat This! and downbeats (an `onnxruntime-web` decision with a 10-20 MB runtime cost, taken when a bar-aware feature needs it); 3-D metric features beyond what `worldLandmarks` gives; multi-person; running hands and body together by default.

---

## 10. Search terms

`pose landmarker world landmarks browser`, `Laban effort computation skeleton kinetic energy jerk`, `quantity of motion contraction index EyesWeb`, `relational motion features Müller`, `kinematic beat velocity minima AIST++ beat alignment score`, `visual beat deceleration envelope Davis Agrawala`, `dance beat tracking visual only`, `D-Jogger phase alignment strategies`, `entrainment basin running cadence tempo`, `BeatRoot multi-agent beat tracking`, `spectral flux onset autocorrelation tempo`, `Beat This ONNX web`, `preservesPitch playbackRate`, `Signalsmith Stretch AudioWorklet`, `adaptive oscillator phase correction`.

---

## REFERENCES

[R1] Vetterli M, Marziliano P, Blu T. Sampling signals with finite rate of innovation. *IEEE Trans Signal Process*. 2002;50(6):1417–1428. [https://ieeexplore.ieee.org/document/1003065](https://ieeexplore.ieee.org/document/1003065) (and the fuller treatment in `docs/research/rhythm-from-gesture-research-map.md` §1–§2)

[R2] Google AI Edge. Pose landmark detection guide for Web. 2025. [https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js); model files at [https://storage.googleapis.com/mediapipe-models/pose_landmarker/](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task); browser rates from Dunham K, *Real-Time Body Tracking in Your Browser* (2025) [https://medium.com/@creativeaininja/real-time-body-tracking-in-your-browser-what-mediapipe-actually-does-and-how-to-use-it-b31aa96a5071](https://medium.com/@creativeaininja/real-time-body-tracking-in-your-browser-what-mediapipe-actually-does-and-how-to-use-it-b31aa96a5071)

[R3] Dixon S. Automatic extraction of tempo and beat from expressive performances. *J New Music Res*. 2001;30(1):39–58. [http://www.eecs.qmul.ac.uk/~simond/pub/2001/jnmr.pdf](http://www.eecs.qmul.ac.uk/~simond/pub/2001/jnmr.pdf); JS port: `music-tempo` [https://www.npmjs.com/package/music-tempo](https://www.npmjs.com/package/music-tempo)

[R4] MDN. HTMLMediaElement: preservesPitch property (browser-compat data: Chrome 86, Firefox 101, Safari 17.2, Baseline 2023-12). [https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch)

[R5] Moens B, Muller C, van Noorden L, Franěk M, Celie B, Boone J, Bourgois J, Leman M. Encouraging spontaneous synchronisation with D-Jogger, an adaptive music player that aligns movement and music. *PLoS ONE*. 2014;9(12):e114234. [https://pmc.ncbi.nlm.nih.gov/articles/PMC4260851/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4260851/)

[R6] Van Dyck E, Moens B, Buhmann J, Demey M, Coorevits E, Dalla Bella S, Leman M. Spontaneous entrainment of running cadence to music tempo. *Sports Med Open*. 2015;1:15. [https://sportsmedicine-open.springeropen.com/articles/10.1186/s40798-015-0025-9](https://sportsmedicine-open.springeropen.com/articles/10.1186/s40798-015-0025-9)

[R7] Li R, Yang S, Ross DA, Kanazawa A. AI Choreographer: music conditioned 3D dance generation with AIST++. In: *Proc. ICCV*. 2021. [https://arxiv.org/abs/2101.08779](https://arxiv.org/abs/2101.08779)

[R8] Davis A, Agrawala M. Visual rhythm and beat. *ACM Trans Graph*. 2018;37(4):122. [https://openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w49/Davis_Visual_Rhythm_and_CVPR_2018_paper.pdf](https://openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w49/Davis_Visual_Rhythm_and_CVPR_2018_paper.pdf); code [https://github.com/abedavis/visbeat](https://github.com/abedavis/visbeat)

[R9] Pedersoli F, Goto M. Dance beat tracking from visual information alone. In: *Proc. ISMIR*. 2020. [https://program.ismir2020.net/static/final_papers/144.pdf](https://program.ismir2020.net/static/final_papers/144.pdf)

[R10] Larboulette C, Gibet S. A review of computable expressive descriptors of human motion. In: *Proc. MOCO*. 2015:21–28. [https://hal.science/hal-01196267v1](https://hal.science/hal-01196267v1)

[R11] Camurri A, Mazzarino B, Volpe G. Analysis of expressive gesture: the EyesWeb expressive gesture processing library. In: *Gesture-Based Communication in Human-Computer Interaction (GW 2003)*. LNCS 2915. Springer; 2004:460–467. [https://link.springer.com/chapter/10.1007/978-3-540-24598-8_42](https://link.springer.com/chapter/10.1007/978-3-540-24598-8_42)

[R12] Ahn, Kong, Jung. Appearance-invariant detection of suggestive motion via Laban movement descriptors on SMPL skeletons. *arXiv*. 2026. [https://arxiv.org/abs/2605.24488](https://arxiv.org/abs/2605.24488) (the Effort formulas used here: Weight = mean ½|v|², Time = mean |a|, Space = Σ|P(t)−P(t−w)| / |P(T)−P(t₁)|, Flow = mean jerk)

[R13] Müller M, Röder T, Clausen M. Efficient content-based retrieval of motion capture data. *ACM Trans Graph*. 2005;24(3):677–685. [https://dl.acm.org/doi/10.1145/1073204.1073247](https://dl.acm.org/doi/10.1145/1073204.1073247)

[R14] TensorFlow Blog. Next-generation pose detection with MoveNet and TensorFlow.js. 2021. [https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html](https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html); package [https://www.npmjs.com/package/@tensorflow-models/pose-detection](https://www.npmjs.com/package/@tensorflow-models/pose-detection)

[R15] SMC-AAU-CPH. Laban descriptor calculations on various platforms (based on [R10]). [https://github.com/SMC-AAU-CPH/smc8-courses-embodied-lma-github](https://github.com/SMC-AAU-CPH/smc8-courses-embodied-lma-github)

[R16] Aristidou A, Charalambous P, Chrysanthou Y. Emotion analysis and classification: understanding the performers' emotions using the LMA entities. *Comput Graph Forum*. 2015;34(6):262–276. [https://onlinelibrary.wiley.com/doi/10.1111/cgf.12598](https://onlinelibrary.wiley.com/doi/10.1111/cgf.12598)

[R17] Foscarin F, Schlüter J, Widmer G. Beat this! Accurate beat tracking without DBN postprocessing. In: *Proc. ISMIR*. 2024. [https://arxiv.org/abs/2407.21658](https://arxiv.org/abs/2407.21658); a C++/ONNX port (main model only, 97 MB) [https://github.com/mosynthkey/beat_this_cpp](https://github.com/mosynthkey/beat_this_cpp)

[R18] Signalsmith Audio. Signalsmith Stretch: C++ polyphonic pitch/time library, with a Web Audio (WASM/AudioWorklet) release. [https://github.com/Signalsmith-Audio/signalsmith-stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch); design notes [https://signalsmith-audio.co.uk/writing/2023/stretch-design/](https://signalsmith-audio.co.uk/writing/2023/stretch-design/); npm `signalsmith-stretch`

[R19] Cutler R, Davis LS. Robust real-time periodic motion detection, analysis, and applications. *IEEE Trans Pattern Anal Mach Intell*. 2000;22(8):781–796. [https://ieeexplore.ieee.org/document/868681](https://ieeexplore.ieee.org/document/868681)

[R20] Large EW, Kolen JF. Resonance and the perception of musical meter. *Connect Sci*. 1994;6(2–3):177–208. [https://www.tandfonline.com/doi/abs/10.1080/09540099408915723](https://www.tandfonline.com/doi/abs/10.1080/09540099408915723) (the oscillator the interim estimator degenerates to; see #178 §4)

[R21] Guttandin C. web-audio-beat-detector. [https://github.com/chrisguttandin/web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector); Realtime BPM Analyzer [https://www.realtime-bpm-analyzer.com/guide/introduction](https://www.realtime-bpm-analyzer.com/guide/introduction)

[R22] Whalen T. paces alignment research: `docs/alignment/02-music-rhythm-and-structure.md` and `03-visual-signals.md` (measured on this machine, 2026). [https://github.com/thorwhalen/paces](https://github.com/thorwhalen/paces)
