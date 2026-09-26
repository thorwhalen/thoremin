# Intent, actuality, and sounding good: musical timing beyond the frame rate

*Thor Whalen — 2026-09-26*

## 0. What this map answers

Thoremin turns a camera stream into music. Its melodic and timbral controls already work at the camera's rate, because pitch and brightness are continuous parameters that tolerate a control period of a few tens of milliseconds. Rhythm does not tolerate it: the timing a listener hears lives at a scale finer than a video frame. The earlier research maps established that this is a solvable inference problem, not a hardware limit ([rhythm-from-gesture-research-map.md](rhythm-from-gesture-research-map.md), [conducting-and-virtual-orchestra-research-map.md](conducting-and-virtual-orchestra-research-map.md), [body-and-pace-research-map.md](body-and-pace-research-map.md)), and `src/ictus/` implements the first version of the answer for conducting beats.

This map does three things the earlier ones did not.

1. It **verifies two numbers** the design keeps leaning on: the action-to-sound latency at which a player notices (§1), and the frame rate thoremin actually runs at, derived from the code rather than from memory (§2). Both matter because the whole argument for prediction rests on the gap between them.
2. It states the **design principle** that decides what "correct" timing even means for this instrument: *actuality*, *intent* and *sounding good* are three different objectives, they conflict, and the instrument's job is to make the trade-off between them a dial rather than a fixed choice (§3). The same principle explains the sensitivity / learning-curve / expressivity triangle (§4).
3. It separates the **three distinct technical problems** hiding inside "beyond the frame rate" (§5): locating an event that already happened to sub-frame precision, producing the sound *at* the event rather than a reaction time after it, and doing so for an "air" impact that has no surface to predict against. Each has its own literature and its own math, and conflating them is how a project ends up solving the easy one.

The ideas in §3 to §5 were dictated as a design brief. This document connects each to its existing name, its literature and, where one exists, a library, so that the follow-on work (a synthetic impact harness, sub-frame event prediction from body video, and the air instruments) starts from the field's vocabulary rather than re-deriving it.

---

## 1. The perception threshold, verified

The dictated recollection was "above 20 ms the human mind starts to tell the difference". That number is right for the one instrument that is most like thoremin, and wrong as a universal constant. The literature gives a *family* of thresholds, and which one applies depends on whether the player is striking or gliding, whether there is tactile feedback, and whether the question is detection, annoyance, or timing accuracy.

| Study | Task | Finding |
|---|---|---|
| Mäki-Patola and Hämäläinen, ICMC 2004 [1] | 16 subjects playing a real theremin through a variable delay; no tactile feedback; continuous sound | Just-noticeable difference **between 20 and 30 ms**. Latencies of 10 and 20 ms were not detected at all; 30 ms was detected in 60 % of comparisons. Slow passages with vibrato masked even high latencies. |
| Jack, Stockman and McPherson, Audio Mostly 2016 [2] | Percussive digital instrument; 0, 10, 20 and 10 ± 3 ms (jitter) | 0 and 10 ms rated the same. **20 ms, and 10 ms with 3 ms of jitter, were rated significantly worse** on six quality measures; jitter also raised the players' synchronisation error. |
| Jack, Mehrabi, Stockman and McPherson, Music Perception 2018 [3] | Same paradigm, professional percussionists versus amateurs | Professionals are more sensitive to both latency and jitter; the perceived quality of the instrument, not just timing accuracy, degrades. |
| McPherson, Jack and Moro, NIME 2016 [4] | Survey and platform measurements | Reaffirms Wessel and Wright's target of **10 ms latency with under 1 ms jitter** [5]; notes that steady tapping has about 4 ms of intrinsic variability and that a 6 ms asynchrony in a steady pulse is detectable by listeners, so "the ideal threshold may be much lower for percussive musical interactions". |
| Dahl and Bresin, DAFx 2001 [6] | Drumming without tactile feedback, sound delayed against a metronome | Timing accuracy degrades from about **40 ms**; players compensate by striking early up to about **55 ms**. |
| Lester and Boley, AES 2007 [7] | Live monitoring, several instruments and two monitoring setups | Accepted latency ranges from **1.4 ms to 42 ms** depending on instrument and setup. |
| Schmid, Ambros, Bogon and Wimmer, Audio Mostly 2024 [8] | Key press to click, 37 participants, adaptive staircase | Mean JND **49 ms** at zero base latency; lower for musically sophisticated participants. A key press is a poor proxy for an instrument, which is why this number is higher than the others. |
| Hirsh 1959 [9] | Temporal order of two sounds | About **20 ms** to report which came first. |
| Rasch 1979 [10] | Onset asynchrony inside small ensembles | Standard deviations of **30 to 50 ms** are normal in good ensemble playing. |
| Chafe and Gurevich 2004 [11] | Two players clapping together across a delay | Tempo stays stable up to about **11.5 ms** one-way; longer delays produce progressive deceleration. |
| Repp 2005 [12] | Paced tapping | Taps *precede* the beat by 20 to 100 ms (negative mean asynchrony): synchronisation is anticipatory, not reactive. |

What to carry away:

- **For the theremin-like gliding case that thoremin already does well, the threshold is 20 to 30 ms, and vibrato hides more.** This is the number the dictation remembered, and it is the number for continuous control [1].
- **For striking, the working target is 10 ms, and jitter matters as much as the mean.** A stable 10 ms passes; a jittery 10 ms fails [2,4]. The audio-thread scheduling discipline in §5.4 is about jitter, not just latency.
- **Detectability and playability are different thresholds.** Drummers keep playing in time at 40 to 55 ms by anticipating [6], and listeners tolerate 30 to 50 ms of ensemble scatter [10]. This is what makes the "sounds good" objective in §3 achievable at all: the bar for *not sounding off* is looser than the bar for *not feeling delayed*.
- **The player already predicts.** Negative mean asynchrony [12] and the 55 ms compensation [6] are the human half of the same problem this document assigns to the machine. A system that predicts can meet a player who predicts; a system that reacts fights them.

---

## 2. Thoremin's actual frame rate and latency chain, from the code

The dictated recollection was "the video frame rate is 44 per second". Nothing in the code produces 44. The evidence, with file references so it can be re-checked when the pipeline changes:

**The camera.** The DAG app asks `getUserMedia` for `width: {ideal: 1280}, height: {ideal: 720}, facingMode: {ideal: 'user'}` and nothing else (`src/app/useEngine.ts`, the stream setup). There is no `frameRate` constraint anywhere in the source, so the camera and browser pick the rate for that mode. A MacBook's built-in FaceTime HD camera, queried through AVFoundation, offers every mode (640x480 through 1920x1080) at a range of **15 to 30 fps**, with 30 the maximum. Every recorded fixture in `test/fixtures/` is 30 fps (a few iPhone clips are 24), and `test/ictus_detector.test.ts` pins `FPS = 30`. The legacy app asks for 640x480, also without a frame rate. **So the camera rate is nominally 30 fps, period 33.3 ms, and it is never measured or asserted at runtime.**

**The tick loop.** `RealtimeClock` (`src/dag/clock.ts`) schedules through `requestAnimationFrame`, so the engine ticks at the display refresh rate: 60 Hz on most screens, 120 Hz on ProMotion displays. `ctx.dt` is the real, jittery interval between animation frames (`src/dag/engine.ts`). The 60 Hz tick is not a second measurement of the hand: the source nodes (`src/nodes/sources/webcam_hands.ts`, `webcam_face.ts`, `webcam_body.ts`) each run their own animation-frame loop and call `detectForVideo` only when `video.currentTime` has changed, so inference runs **once per new camera frame**, and a tick between camera frames re-reads the cached last result. The effective control rate is therefore the camera rate, about 30 Hz, sampled by a 60 Hz tick.

**Timestamps.** *(Updated 2026-09-26: #226 is implemented.)* When this map was written, each inference was stamped with `performance.now()` at the moment inference *ran*, not the moment the frame was *captured*. The frame pump (`src/nodes/sources/frame_pump.ts`) now stamps every frame with `requestVideoFrameCallback`'s `captureTime`, which the spec says should be present for local cameras [13], and carries the capture-to-inference lag on the frame (`FrameTiming.lag`). That lag is the first measured term of the budget below.

**Inference cost.** MediaPipe Tasks Vision in `VIDEO` mode, GPU delegate with CPU fallback, float16 hand and face landmarkers, pose `lite` by default. `detectForVideo` is synchronous on the main thread inside the animation loop, so a slow inference drops display frames rather than camera frames. Published figures for the hand pipeline are on the order of 10 to 30 ms per frame on a laptop GPU [14].

**Audio.** One `AudioContext({latencyHint: 'interactive'})` (`src/app/useEngine.ts`), raw Web Audio, no Tone.js. The synth (`src/nodes/output/webaudio_synth.ts`) sets its targets at `ac.currentTime` on every tick, with `setTargetAtTime` and a 30 ms pitch time constant; there is **no look-ahead scheduling** and no use of `baseLatency` or `outputLatency`. Score-driven notes start on the tick that observes the beat crossing (`src/nodes/music/score.ts`), so a note onset is quantised to the 16.7 ms tick grid before it even reaches the audio output latency. MIDI is sent immediately with no timestamp. The `ictus` README states the goal of evaluating musical time at the audio output time; the conductor node currently evaluates `beatAt(state, ctx.time)` at tick time and nothing schedules audio against `nextBeatAt`. The look-ahead scheduler the conducting map recommends (§6.5 there) is not implemented.

**Two smaller findings worth an issue.** The conductor node stamps its samples with `ctx.time` and does not skip ticks on which the camera frame is unchanged (the body feature node does), so at a 60 Hz tick over a 30 fps camera the ictus detector receives duplicate positions at distinct times, which biases a three-point parabolic fit that assumes evenly spaced distinct samples. And the humanisation in `src/nodes/music/performance.ts` exists but is jitter added to tempo and velocity, not micro-timing on individual onsets; §3.3 explains why that distinction matters.

**Where "44" could have come from.** The 44.1 kHz audio sample rate mentioned in the FLAC exporter; the `conducting_44` fixture, where 44 means 4/4 time; or an observed animation-frame rate on a display whose 60 Hz loop was being dragged down by synchronous inference. None of these is the camera rate.

### 2.1 The latency budget that follows

The frame period is the *smallest* term in the chain, which is the point the dictation was reaching for. This section first held an *estimated* budget (about 80 to 150 ms). It is now **measured** on the running app (M1 Max MacBook Pro, Chrome 153, real hand footage through the camera path, built-in speakers), stage by stage, in [`latency-budget-and-browser-realtime.md`](latency-budget-and-browser-realtime.md) §1, which also says how to re-take it on any machine (`?probe=latency`, the microphone strike test, `smoke/latency/measure.mjs`). The short version:

| Stage | Measured (mean ± jitter) | Was estimated |
|---|---|---|
| Wait for the frame containing the event | 0 to 33 ms, mean 16.7 (period 33.3 ± 3.4 ms) | 0 to 33 ms |
| Sensor, readout, USB, OS capture | not measurable in a page; the strike test measures it glass to air | one to two frame periods |
| Capture stamp to inference | 4.1 ± 2.5 ms (fake camera) | not measured |
| Hand landmark inference (GPU, main thread) | 20.5 ± 4.1 ms; the CPU/WebAssembly delegate 42.4 ± 9.1 ms | 10 to 30 ms |
| Wait for the tick | ~0 ms (the pump happens to run first in each animation frame) | 0 to 16.7 ms |
| The DAG tick itself, overlay included | 0.27 ± 0.20 ms | not estimated |
| Parameter write to loudspeaker | 31.9 ± 1.6 ms (reported `baseLatency` 5.8, `outputLatency` 29) | 10 to 30 ms |
| Synth output compressor look-ahead | 6.0 ms | not known |
| Pitch glide, 30 ms constant | 20.8 ms to half, 69 ms to 90 % | 30 ms to 63 % |
| **Total, to half-way to the new pitch** | **about 100 ms plus the camera hardware** | 80 to 150 ms |

Against a 10 to 30 ms perceptual budget (§1), a reactive design still misses by a factor of four or more. The measurements move where the recoverable time is: shortening the glide and removing the compressor's look-ahead recover about 20 ms to half-way (about 50 ms to 90 %), and a different programming language recovers at most the 0.3 ms tick. The rest can only be recovered by **producing the sound before the event is observed**, which is prediction, §5.2. So the design consequence is unchanged, and now measured: not "we need a faster camera" or "a faster language", but "the instrument must anticipate, and the camera rate sets how far ahead it must anticipate".

---

## 3. Actuality, intent, and sounding good

The dictated principle: *what is the purpose of precision? To represent actuality faithfully. But intent matters more than actuality; and if we go further, sounding good matters more than faithfulness to intent; and yet if we only cared about sound we would play a recording. The point of thoremin is to be involved, in real time, in a resonance between intent and sound.* And the compromise: *if the system places a note that was neither intended nor reflected in the movement, that is acceptable as long as it does not sound off.*

This is a precise design position, and every part of it has an existing name.

### 3.1 Three objectives, not one

**Actuality** is the fidelity of the movement-to-sound map: the sound reflects what the body actually did. The field's word is **control intimacy**, coined by Moore [15] and made a design goal by Wessel and Wright [5]: the instrument responds so directly and reliably that it becomes an extension of the player's body. Latency and jitter (§1) are its enemies. Actuality is what an audio engineer would measure with a timing-error histogram against ground truth.

**Intent** is what the player *meant*, which the movement only approximates, especially for a beginner or under a noisy sensor. Inferring it is **intent inference**, and the cleanest formalism is Dragan and Srinivasa's **policy blending for shared control** [16]: the system predicts the user's goal from a partial trajectory, then *arbitrates* between the raw input and the assisted version, and the arbitration weight should depend on the system's confidence in its prediction and in the user. Their user study found that assistance which is too aggressive, or which corrects toward the wrong goal, is disliked even when it improves task performance, which is the risk on this axis. In music the same idea lives in score following and automatic accompaniment: Raphael's Music Plus One [17] and Cont's Antescofo [18] both maintain a belief about where the player *means* to be and let it override where the sensor says they are; Bevilacqua's Gesture Follower [19] does it for gesture, reporting *time progression within a known gesture* with a likelihood; Françoise's mapping-by-demonstration [20] learns the movement-to-sound relation itself from examples. Bayesian goal inference from a partial reaching trajectory [21] is the general-purpose version.

**Sounding good** is a musical prior, independent of what was meant or done. Thoremin already has one on the pitch axis: `magneticPitch` in `src/music/theory.ts` pulls a continuous position toward scale notes by a `magnetism` amount between 0 (free glide) and 1 (hard snap). The rhythmic equivalent is **quantisation strength**: every DAW's quantise has a strength (Logic's Q-Strength, Ableton's Amount) that moves an onset a percentage of the way to the grid rather than all the way [22], and Desain and Honing's connectionist quantiser [23] is the model of it as an inference. The learned version is GrooVAE [24], which maps a quantised drum score to humanised micro-timing and velocity, and its inverse. Rhythm games make the tolerance explicit: osu!'s documented hit windows put a top-grade hit within about ±20 ms at the hardest setting and a "great" drum hit in its taiko mode within ±34.5 ms at the middle setting [25], windows that are wider than the percussive thresholds of §1 because *sounding right* is more forgiving than *feeling immediate*. The psychology behind the axis is Huron's account of expectation [26]: a listener's sense that a note is "right" is a prediction being confirmed, so a system that satisfies the listener's prediction sounds right even when it departs from the player's action.

### 3.2 Why the compromise is defensible, and where it breaks

The claim that an unintended but well-placed note is acceptable has empirical support from the **sense of agency** literature. Delays between an action and its outcome reduce the felt sense of authorship [27]; conversely, outcomes that are congruent with what one would have wanted *increase* it, an effect large enough to show up in a meta-analysis [28]. People feel they caused good outcomes that plausibly follow from their actions. This is what lets a magnetised instrument feel *more* responsive than a literal one, and it is also the mechanism by which assistance can become an illusion of control: if the prior does all the work, the "resonance between intent and sound" the dictation describes is gone, and the player is conducting a jukebox.

So the principle is best read as a **lexicographic preference with a tolerance**, which is also how it was dictated: maximise actuality *within the limits of the sensor and of the chosen sensitivity*; within those limits maximise intent; within those limits be musical. A plain weighted sum of the three errors is the wrong formalisation, because the dictation's "as long as it does not sound off" is an asymmetric cost: a predicted note that lands on the grid costs little even if unintended, a late note costs a lot even if faithful, and a note that is both unintended and off-grid is the one outcome to avoid. In decision-theoretic terms this is minimising expected loss under a posterior over *what the player will do*, with the prior over musical time supplying the fallback when the posterior is diffuse; Dragan and Srinivasa's confidence-dependent arbitration is the same rule.

### 3.3 Three dials, not a fixed design

The consequence for thoremin is that the trade-off should be exposed the way pitch magnetism already is:

- **timing magnetism**, 0 to 1: how far a detected or predicted onset is pulled toward the rhythm prior's grid (§5.3). This is Q-Strength for a live instrument.
- **arbitration**, 0 to 1: how much a confident prediction is allowed to override the raw observation, and, symmetrically, how much a low-confidence prediction is suppressed. Policy blending's weight.
- **sensitivity**, the movement-to-sound gain of §4.

The existing `humanizeBpm` and `humanizeVel` in the performance node are the opposite operation (adding jitter to a mechanical render) and should not be confused with these; a humaniser is what one applies *after* magnetism to a score, not to a live player.

---

## 4. Sensitivity, learning curve, expressivity, and transfer

The dictated observation: *too much sensitivity (fine movement variations map to fine sound variations) means a long learning curve, because the body must be taught to be precise enough to match intent; and those fine motor learnings only partially transfer to comparable instruments. What sensitivity buys is expressive power.* And the ambition: *give the player less of a learning curve than a real instrument, while keeping far more real-time expressivity than a music generation model.*

This is the central tension of instrument design and it has a literature.

**Efficiency and the learning curve.** Jordà's *efficiency* of an instrument is the ratio of the complexity of the musical output, times the performer's freedom, to the complexity of the control input [29]. A kazoo has a flat learning curve and a low ceiling; a violin a steep curve and no ceiling; Jordà's point is that the *shape* of the curve is a design parameter. Wessel and Wright's phrase for the target is "low entry fee with no ceiling on virtuosity" [5]. Dobrian and Koppelman [30] add the uncomfortable half: expression is not a property of the interface but of the player's *mastery* of it, so an instrument that removes the need for mastery removes most of the expression with it. Hunt, Wanderley and Paradis [31] found that complex, cross-coupled mappings were more engaging and, over a session, more learnable than one-to-one ones, which cuts against the intuition that simple mappings are kinder to beginners.

**Sensitivity as gain.** In pointing-task terms sensitivity is **control-display gain**, and the speed-accuracy trade-off it induces is Fitts' law; Casiez et al. [32] found that very low gains hurt through clutching and the limb's maximum speed, while very high gains run into the hand's own precision and the sensor's resolution, with a broad usable band between. The Mäki-Patola study [1] adds a musical detail: the *style* of playing changes what is perceptible, since vibrato masked latency. Gain and latency interact: a sensitive instrument exposes the timing chain, an insensitive one hides it.

**Partial transfer.** Schmidt's schema theory [33] explains why fine motor learning transfers only partly: practice builds a *generalised* motor program plus parameters, and variable practice yields programs that transfer to related tasks, while constant practice yields *especial* skills that do not. Palmer and Meyer [34] showed it in pianists: experts transfer conceptual (melodic) structure regardless of the fingering, novices transfer only when both the movements and the concepts match. Baily [35] showed that the spatial layout of an instrument shapes the motor patterns a player forms. So the dictation's "partial transfer" is expected: what transfers between a theremin and an air-guitar is the musical concept and the timing, not the fine gain of the hand.

**The design lever: assistance that fades.** The **guidance hypothesis** [36] in motor learning says that feedback or physical guidance which is helpful during practice can *harm* retention if it is always present, because the learner comes to rely on it. Applied here: the timing magnetism and arbitration dials of §3.3 are training wheels, and the learning-curve argument only holds if they can be reduced as skill grows, either by the player or by the system noticing that the raw observation is now reliably close to the prior. A fixed high assistance level would give beginners a good first hour and cap them there.

**Where thoremin sits.** The instrument's existing mapping spectrum ([MAPPING_SPECTRUM.md](../MAPPING_SPECTRUM.md)) already spans from direct (a theremin's continuous gain) to indirect (steering a generative model). The timing work adds the same spectrum on the rhythmic axis: a fully actual instrument (report the impact where and when it was seen, with all the latency of §2.1), through a magnetised one, to a fully assisted one where the player only supplies tempo and dynamics and the grid supplies the placement. The trainer (`src/enroll/`) is the mechanism for the fading: it already measures a player's own jitter in noise units, which is the quantity the arbitration dial should read.

---

## 5. Beyond the frame rate: three problems, three literatures

The dictation: *the best response time we could ever get is one frame period, and that is not counting processing; so we need some trick, and there is definitely math for it. The system must predict so that responses are on time. A model of movement can predict an expected impact and act accordingly.* Then the critique: *a stick hitting a table can be predicted because the impact location is known even when no frame shows it; an air drum has no observable impact location, so the impact can only be inferred from the velocity before and after, and even one sample after the reversal is up to a frame late.* And the hope: *a model of the strokes that were happening before, plus an inferred tempo, would allow some skewing that still sounds good.*

There are three separate problems in this paragraph. The earlier maps solved the first for conducting beats and framed the third; the second is what an impact instrument adds.

### 5.1 Resolution: where in the frame interval did the event happen

This is estimation after the fact: the frames on either side of an extremum are observed, and the question is the extremum's time to a fraction of a frame. The rhythm map's finite-rate-of-innovation argument (its §2) is the license: a sparse event train needs a sampling rate above its rate of *innovation*, not above its rendering resolution. The tools:

- **Parabolic interpolation** of three samples around a peak [37]. `src/ictus/detector.ts` does this on position and the test suite pins it to under 8 ms error at 30 fps on synthetic strokes. The conducting map (§2.6) explains why it is fit to position and not to speed at 30 Hz.
- **Kalman smoothing** with a constant-acceleration model, which uses more than three samples and yields a covariance, so the estimate comes with a confidence the arbitration dial can read.
- **True capture timestamps.** With `performance.now()` at inference time (§2) the sample times carry one to two frames of variable offset, which no interpolation can remove. `requestVideoFrameCallback`'s `captureTime` [13] is the fix and costs nothing.
- **Sub-frame information hiding inside a frame.** A rolling-shutter sensor exposes rows at different instants, so a fast stick is sheared in proportion to its velocity; Ait-Aider et al. [38] recover pose *and* velocity from a single rolling-shutter image. Motion blur length encodes the same quantity. Neither is used by landmark models, which are trained to be invariant to them, but a dedicated stick or hand tracker could read them. Event cameras [39] report per-pixel changes with microsecond timestamps and would remove the problem entirely; they are not in a laptop.
- **A second sensor with better time resolution.** For the surface-impact case the microphone is a free sub-millisecond onset detector: a stick on a table makes a sound, and audio onset detection has resolution three orders of magnitude finer than the camera. Fusing a camera (which knows *which* hand and *how big* the stroke was) with the microphone (which knows *when*) is the cheapest route to sub-frame timing for anything that touches anything. It does nothing for air.

Resolution alone does not make the instrument feel immediate, because it operates on frames that have already arrived. It makes the *record* precise, which is what the synthetic harness (§6) will score, and it makes the rhythm prior's anchors precise, which is what §5.3 needs.

### 5.2 Latency: producing the sound at the event

This is prediction. The sound must begin before the frame showing the impact has been captured, let alone processed. The general form is **motion extrapolation under a movement model**, and the closest applied literatures are:

- **Predictive tracking in augmented and virtual reality.** Azuma and Bishop [40] showed that head-motion prediction is effective for horizons under about 80 ms and that prediction error grows fast with both horizon and motion frequency; LaValle et al. [41] built the Oculus Rift's predictor on the same principle and the field settled on 20 ms motion-to-photon as the target. The horizon thoremin needs (§2.1) is at the upper end of the effective range.
- **Projector-camera prediction with a 30 Hz sensor.** Knibbe, Benko and Wilson [42] predicted juggling balls and moving limbs from a single 30 Hz depth camera with software-only motion models, and improved projection alignment by 37 % on objects at up to 5 m/s. Their sensor rate is thoremin's.
- **Camera-based drum-hit anticipation.** Rosa-Pujazón et al. [43] built a Kinect drumkit that detects a stroke early from a linear predictor on the hand trajectory and classifies which drum from the arm pose, explicitly to hide the sensor's latency. Aerodrums, the commercial camera air-drum, avoids the problem instead by running its sensor at 125 to 132 fps [44], which puts the frame period under the 10 ms percussive threshold of §1: the hardware route, and the number a software route must match.
- **The player's own solution.** Time-to-contact perception (Lee's tau [45]) and the negative mean asynchrony [12] show that humans do not react to impacts, they predict them from the approach. Catching, hitting and drumming are all anticipatory. The machine is being asked to do what the player already does.

The movement model that makes prediction well-posed is the **stereotyped stroke**. Flash and Hogan's minimum-jerk model [46] says a point-to-point reach has a bell-shaped speed profile fixed by its start, end and duration; once a fraction of the stroke is observed the remainder, including its end time, is determined. Dahl [47] measured drummers and found each player's stroke shape consistent across dynamics, tempi and surfaces, with the preparatory height scaling the dynamic level: the *prefix* of the stroke predicts both *when* and *how loud*. Godøy, Jensenius and Nymoen name the parts, prefix, excitation and suffix [48], and observe that the action trajectory of a sonic event starts before the sound and continues after it, which is why a partial observation carries the information. Early action prediction from partially observed video [49] is the deep-learning version of the same problem, and Bevilacqua's Gesture Follower [19] is the classical one: an HMM that reports, in real time, how far through a *known* gesture the player is, and therefore how long remains.

### 5.3 The air-drum critique, taken seriously

The dictation's objection is correct and it sharpens the problem. A surface impact has a **constraint**: the stick will stop at the plane of the table, so the impact time is a time-to-contact problem, well-posed from position and velocity alone. An air impact has no plane; the "impact" is a **velocity reversal**, and a reversal is only observable after it: the first sample on the far side is up to one frame late, as the dictation says, plus the processing chain of §2.1.

What makes it tractable anyway:

1. **The reversal is preceded by braking.** A stroke that is about to reverse decelerates first, and the deceleration onset is observable one to several samples *before* the reversal. The conducting map (§1.4, §2.7) found that human followers place the beat at the peak deceleration as the hand brakes into the turning point, not at the turning point itself; `ictus` already measures the braking sharpness as an articulation axis. A detector that fires on braking *onset* and a stroke model that extrapolates the remaining deceleration to zero velocity predicts the reversal instead of observing it. This is the constraint the air drum does have: not a plane in space, but a *profile in time*.
2. **The stroke is the player's own and it repeats.** Dahl's finding [47] that stroke shape is consistent per player means a template can be learned in a few strokes, and then the Gesture Follower question, "how far through your stroke are you", has a sharp answer. The trainer (`src/enroll/`) is built to learn exactly this kind of per-player template from a cue.
3. **The rhythm prior says when a hit is expected.** This is the "inferred tempo" of the dictation and it is what `src/ictus/` implements: an adaptive oscillator [50,51] whose attentional window (Large and Jones' dynamic attending [52]) gives a likelihood over the next beat time before any stroke is seen. Bayesian fusion of that prior with the partial-stroke likelihood is a posterior over the hit time that sharpens as the stroke unfolds; the rhythm map's §3 and §4 lay out the switching state-space and oscillator forms of it.
4. **Commit early, correct on confirmation.** The decision rule is sequential: emit the sound when the posterior mass in a window around a predicted time exceeds a threshold (which the arbitration dial sets), then treat the observed reversal as a correction of phase and tempo for the *next* hit, not of the sound already played. Antescofo's tempo agent and Raphael's rule of not reporting doubtful onsets [17,18] are the two established ways to keep a wrong prediction from moving the state. Networked games call the same architecture **client-side prediction with server reconciliation** [53]: act on the predicted state, reconcile when the authoritative observation arrives, and design the visible result so that reconciliation is rarely noticeable.
5. **Design the sound so a small miss is inaudible.** This is the "skewing that still sounds good" of the dictation, and it is where §3 pays off. Two techniques compose. **Timing magnetism** pulls the emitted onset toward the prior's grid by a strength, so a stroke that is 20 ms early or late by the sensor's reckoning lands where the listener expects; the Rasch and rhythm-game numbers of §1 [10,25] say how much slack that buys, about ±30 ms, three times the frame-period error. **Anticipatory onset with confirmatory accent**: start the sound's prefix (a breath, a noise transient, a soft attack) at the predicted time and let the confirmed reversal set its accent and body; a missed prediction then yields a ghost note rather than a wrong one. Dahl's preparatory-height finding [47] means the accent can itself be predicted from the prefix.

What does *not* rescue the air drum is more frames alone: at 60 fps the reversal is still observed after it happens, and the reactive chain of §2.1 still adds 50 to 100 ms. The prediction is necessary at any frame rate a webcam offers; the frame rate only sets how far ahead it must reach.

### 5.4 Rendering: the clock the sound is scheduled on

A prediction accurate to 5 ms is wasted if the note then waits for the next 16.7 ms tick and a 30 ms smoothing constant (§2). The conducting map's two-clock discipline (its §6.3 and §6.5) is the fix, and #187 has already decided its shape for the conductor's next PR: a pending-event scheduler that fires at the predicted time with a commit horizon of `outputLatency` plus two frames, waiting for the observed ictus only on events the score marks as hard sync points. It is not implemented yet. Concretely: evaluate musical time at the *audio* time, schedule onsets with `AudioBufferSourceNode.start(when)` or `AudioParam` automation at `ac.currentTime + lead`, re-plan from the frame loop over a short look-ahead, and read `outputLatency` so the lead is real. An impact instrument needs the same scheduler with the stroke posterior of §5.3 in place of the score. This is also what removes the *jitter* that §1 found to be as damaging as latency [2,4]: a scheduled onset lands on a sample, a tick-driven one lands on whichever animation frame came first.

---

## 6. What this implies for the next steps

The three streams that follow this report each own one of the problems above, and the vocabulary here is what they should share.

- **A synthetic impact harness**, in the `an` animation package (public, `github.com/thorwhalen/an`), renders simple objects striking a surface or reversing in mid-air on a known tempo grid with controllable humanisation, at 24, 30 and 60 fps and with exposure blur and frame-time jitter, and ships a ground-truth sidecar with the intended grid time, the executed impact time and the trajectory. It is the *actuality* ground truth that §5.1 and §5.2 are scored against. The three objectives of §3 become three columns of one evaluation: error against the executed impact (actuality), error against the intended grid time (intent), and distance of the *emitted* onset from the inferred grid (sounding good). A method can win on the third while losing on the first, and that is the trade-off this report argues should be a dial.
- **Sub-frame event prediction from body video** implements §5.2 and §5.3 against that harness: a braking-onset detector, a per-player stroke template, fusion with the `ictus` prior, and the commit-and-correct rule, with the prediction horizon swept against §2.1's budget.
- **Air instruments** (guitar chords first, then flute, bass and drums) are the consumers. Chords need none of the timing machinery, which is why they go first; drums need all of it.

Two code changes are cheap and independent of the research: read `captureTime` from `requestVideoFrameCallback` instead of stamping at inference, and skip duplicate camera frames in the conductor node (§2). Both make every downstream timing estimate better.

---

## 7. Prior discussion in this repository and the ecosystem

The relevant record, so that none of it is re-derived. The original conversation that framed the problem as "frame rate too slow, solved by inference under an intent model, studied outside music" happened in a chat outside this repository and left one durable artifact: the rhythm map, drafted in July 2026 and committed in September 2026 with #178. The numbers "20 ms" and "44 fps" appear nowhere before the request this document answers; what existed was the rhythm map's "1 to 20 ms scale, well below the 16.7 to 33 ms frame period" and the body map's "33 ms frame; JND for asynchrony about 20 ms".

- **Issue #178** proposes extracting `ictus` as a package and fixes the vocabulary this document uses: anchors are observations with likelihoods, never onsets; the rhythm prior is injected; musical time is the single source of truth evaluated at the consumer's own time; the sampling rate must exceed the rate of *innovation*, not the rendering resolution. Its §6 architecture sketch is the shape the sub-frame prediction stream should extend, not replace.
- **Epic #187** (the conductor) shipped `src/ictus/`, the `conductor` node, the score pipeline and the Conductor tool, and recorded the decisions this document leans on: the ictus is the peak deceleration, sub-frame interpolated, with confidence in noise units and a quarter-period refractory window; the v1 prior is a Large-Kolen oscillator with Antescofo's coupling gate; the scheduler is a pending event that fires at the predicted time with a commit horizon of `outputLatency` plus two frames (§5.4). It also quotes the field's verdict that a purely responsive system is hopeless at 30 to 90 ms of detection latency, which §2.1 confirms for this pipeline.
- **Epic #186** (the body and the dancer's pulse) established the impact as the phase anchor (a deceleration peak, or a velocity minimum), the noise-unit confidence, and the measurement that a 30 Hz landmark stream resolves period to under 1 % and phase to about a quarter frame; its review is where the duplicate-frames-at-60-Hz-over-30-fps problem of §2 was first noticed.
- **Discussion #4** (the mapping spectrum) is the earlier statement of the learning-curve trade-off of §4: beginners start indirect, and dial toward direct as skill grows; pitch `magnetism` is the existing dial that §3.3 generalises to time. **Discussion #80** (hand control) collected the Hunt, Wanderley and Paradis finding that one-to-one mappings plateau fast and convergent ones must be practised, and the rate limits on sensorimotor synchronisation (it degrades above about 4 Hz).
- The Python predecessor's **theremin Discussion #3** holds the earliest frame-rate evidence on record here: a conducting-gesture recogniser at 30 fps that was perfect below 150 bpm and fell to about half at 200 bpm, which is the same limit §5 describes from the other side.
- **#146** is the standing list of what can only be verified with a webcam and ears; the latency budget of §2.1 belongs there as a measurement task, since nothing in the app measures its own end-to-end latency yet.

Elsewhere in the maintainer's ecosystem, and relevant to the follow-on streams: `an` already steps animations at a chosen rate ("on twos"), so the synthetic harness has a timing rig to start from; `muvid` has a beat-alignment scorer over motion onsets and a beat-snapped selector; `paces` has the least-squares tempo grid and the measured 30 fps pose costs; `antescofo` is a client for the score follower whose tempo agent §5.3 cites; `denote` and `mixing` wrap audio beat and onset detection, which is the microphone-side sensor of §5.1. No Python implementation of `ictus` exists; the TypeScript core is the only one.

The research maps this one builds on, and does not repeat: the rhythm map for the sparsity argument, the Bayesian rhythm models and the oscillator family; the conducting map for the ictus-detection lineage, sub-frame timing at 30 to 60 Hz, the human synchronisation literature and Web Audio scheduling; the body map for the pulse estimator and the impact anchor.

---

## REFERENCES

[1] Mäki-Patola T, Hämäläinen P. Latency tolerance for gesture controlled continuous sound instrument without tactile feedback. In: Proc. International Computer Music Conference (ICMC). Miami; 2004. [PDF](https://users.aalto.fi/~hamalap5/publications/icmcarticlefinal10.pdf); [ICMC archive](https://quod.lib.umich.edu/i/icmc/bbp2372.2004.032)

[2] Jack RH, Stockman T, McPherson A. Effect of latency on performer interaction and subjective quality assessment of a digital musical instrument. In: Proc. Audio Mostly 2016. Norrköping; 2016. [doi:10.1145/2986416.2986428](https://doi.org/10.1145/2986416.2986428); [PDF](https://andrewmcpherson.org/instrumentslab-data/data/andrew/jack_am2016.pdf)

[3] Jack RH, Mehrabi A, Stockman T, McPherson A. Action-sound latency and the perceived quality of digital musical instruments: comparing professional percussionists and amateur musicians. Music Perception. 2018;36(1):109–128. [journal](https://online.ucpress.edu/mp/article/36/1/109/62889)

[4] McPherson AP, Jack RH, Moro G. Action-sound latency: are our tools fast enough? In: Proc. NIME 2016. Brisbane; 2016. [PDF](https://www.nime.org/proceedings/2016/nime2016_paper0005.pdf)

[5] Wessel D, Wright M. Problems and prospects for intimate musical control of computers. Computer Music Journal. 2002;26(3):11–22. [MIT Press](https://direct.mit.edu/comj/article-abstract/26/3/11/94758); [PDF](https://cnmat.berkeley.edu/sites/default/files/attachments/2002_problems-and-prospects-for-intimate-musical-control-of-computers.pdf)

[6] Dahl S, Bresin R. Is the player more influenced by the auditory than the tactile feedback from the instrument? In: Proc. COST-G6 Conference on Digital Audio Effects (DAFx-01). Limerick; 2001. p. 194–197. [publications list](https://www.immm.hmtm-hannover.de/en/institute/alumni/sofia-dahl/publications/)

[7] Lester M, Boley J. The effects of latency on live sound monitoring. In: Audio Engineering Society Convention 123, paper 7198. New York; 2007. [AES e-library](https://aes.org/publications/elibrary-page/?id=14256)

[8] Schmid A, Ambros M, Bogon J, Wimmer R. Measuring the just noticeable difference for audio latency. In: Proc. Audio Mostly 2024. Milan; 2024. [doi:10.1145/3678299.3678331](https://doi.org/10.1145/3678299.3678331)

[9] Hirsh IJ. Auditory perception of temporal order. Journal of the Acoustical Society of America. 1959;31(6):759–767. [doi:10.1121/1.1907782](https://doi.org/10.1121/1.1907782)

[10] Rasch RA. Synchronization in performed ensemble music. Acustica. 1979;43(2):121–131. Summarised in Wing AM, Endo S, Bradbury A, Vorberg D. Optimal feedback correction in string quartet synchronization. J R Soc Interface. 2014;11:20131125. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4196478)

[11] Chafe C, Gurevich M. Network time delay and ensemble accuracy: effects of latency, asymmetry. In: Audio Engineering Society Convention 117. San Francisco; 2004. [AES e-library](https://www.aes.org/e-lib/browse.cfm?elib=12865); [CCRMA summary](https://ccrma.stanford.edu/~cc/shtml/ensDelay.shtml)

[12] Repp BH. Sensorimotor synchronization: a review of the tapping literature. Psychonomic Bulletin & Review. 2005;12(6):969–992. [doi:10.3758/BF03206433](https://doi.org/10.3758/BF03206433)

[13] W3C WICG. HTMLVideoElement.requestVideoFrameCallback(), VideoFrameCallbackMetadata (captureTime, expectedDisplayTime, presentedFrames). [spec](https://wicg.github.io/video-rvfc/); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)

[14] Zhang F, Bazarevsky V, Vakunov A, Tkachenka A, Sung G, Chang C-L, Grundmann M. MediaPipe Hands: on-device real-time hand tracking. arXiv:2006.10214; 2020. [arXiv](https://arxiv.org/abs/2006.10214). Per-frame figures of 12 ms (GPU) and 17 ms (CPU) for the full model are from the legacy MediaPipe Hands documentation. [docs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)

[15] Moore FR. The dysfunctions of MIDI. Computer Music Journal. 1988;12(1):19–28. [Semantic Scholar](https://www.semanticscholar.org/paper/32eb4e909d5b25c115eb0685f47a132eb3ced6f9)

[16] Dragan AD, Srinivasa SS. A policy-blending formalism for shared control. International Journal of Robotics Research. 2013;32(7):790–805. [doi:10.1177/0278364913490324](https://doi.org/10.1177/0278364913490324); [CMU RI](https://publications.ri.cmu.edu/a-policy-blending-formalism-for-shared-control)

[17] Raphael C. A Bayesian network for real-time musical accompaniment. In: Advances in Neural Information Processing Systems 14 (NIPS 2001). [PDF](http://papers.neurips.cc/paper/2035-a-bayesian-network-for-real-time-musical-accompaniment.pdf); Music Plus One: [project page](https://music.informatics.indiana.edu/~craphael/music_plus_one/what.html)

[18] Cont A, Schwarz D, Schnell N, Raphael C. Evaluation of real-time audio-to-score alignment. In: Proc. ISMIR 2007. Vienna; 2007. [PDF](https://ismir2007.ismir.net/proceedings/ISMIR2007_p315_cont.pdf)

[19] Bevilacqua F, Zamborlin B, Sypniewski A, Schnell N, Guédy F, Rasamimanana N. Continuous realtime gesture following and recognition. In: Gesture in Embodied Communication and Human-Computer Interaction (GW 2009), LNCS 5934. Springer; 2010. p. 73–84. [PDF](http://articles.ircam.fr/textes/Bevilacqua09b/index.pdf); [ISMM page](https://ismm.ircam.fr/gesture-follower/)

[20] Françoise J, Bevilacqua F. Motion-sound mapping through interaction: an approach to user-centered design of auditory feedback using machine learning. ACM Transactions on Interactive Intelligent Systems. 2018;8(2):16. [doi:10.1145/3211826](https://doi.org/10.1145/3211826); XMM library: [ISMM](https://ismm.ircam.fr/software/xmm-probabilistic-models-for-motion-recognition-and-mapping/)

[21] Ahmad BI, Murphy JK, Langdon PM, Godsill SJ. Bayesian intent prediction in object tracking using bridging distributions. IEEE Transactions on Cybernetics. 2018;48(1):215–227. [arXiv:1508.06115](https://arxiv.org/abs/1508.06115)

[22] Apple. Quantize parameters for MIDI regions (Q-Strength, Q-Swing), Logic Pro user guide. [Apple Support](https://support.apple.com/guide/logicpro-ipad/quantize-parameters-lpip70c8d20d/ipados); Sound On Sound. Logic: quantisation. [article](https://www.soundonsound.com/techniques/logic-quantisation)

[23] Desain P, Honing H. The quantization of musical time: a connectionist approach. Computer Music Journal. 1989;13(3):56–66. [JSTOR](https://www.jstor.org/stable/3680012)

[24] Gillick J, Roberts A, Engel J, Eck D, Bamman D. Learning to groove with inverse sequence transformations. In: Proc. ICML 2019. PMLR 97:2269–2279. [arXiv:1905.06118](https://arxiv.org/abs/1905.06118); [Magenta GrooVAE](https://magenta.tensorflow.org/groovae)

[25] osu! wiki. Overall difficulty (hit windows by judgement: a 300 within 19.5 ms at OD 10; an osu!taiko Great within ±34.5 ms at OD 5). [osu! wiki](https://osu.ppy.sh/wiki/en/Beatmap/Overall_difficulty)

[26] Huron D. Sweet Anticipation: Music and the Psychology of Expectation. MIT Press; 2006. [publisher](https://mitpress.mit.edu/9780262582780/sweet-anticipation/)

[27] Wen W, Yamashita A, Asama H. The influence of action-outcome delay and arousal on sense of agency and the intentional binding effect. Consciousness and Cognition. 2015;36:87–95. [doi:10.1016/j.concog.2015.06.004](https://doi.org/10.1016/j.concog.2015.06.004)

[28] Mariano M, Devoto F, Zapparoli L, et al. Feeling in control when things go well: a meta-analytical account of how action-outcome valence shapes the implicit sense of agency. Neuroscience & Biobehavioral Reviews. 2025;179:106443. [doi:10.1016/j.neubiorev.2025.106443](https://doi.org/10.1016/j.neubiorev.2025.106443)

[29] Jordà S. Digital instruments and players: part I, efficiency and apprenticeship. In: Proc. NIME 2004. Hamamatsu; 2004. p. 59–63. [PDF](http://www.nime.org/proceedings/2004/nime2004_059.pdf)

[30] Dobrian C, Koppelman D. The 'E' in NIME: musical expression with new computer interfaces. In: Proc. NIME 2006. Paris; 2006. p. 277–282. [PDF](https://www.nime.org/proceedings/2006/nime2006_277.pdf)

[31] Hunt A, Wanderley MM, Paradis M. The importance of parameter mapping in electronic instrument design. Journal of New Music Research. 2003;32(4):429–440. [doi:10.1076/jnmr.32.4.429.18853](https://doi.org/10.1076/jnmr.32.4.429.18853); NIME 2002 version: [PDF](https://www.nime.org/proceedings/2002/nime2002_088.pdf)

[32] Casiez G, Vogel D, Balakrishnan R, Cockburn A. The impact of control-display gain on user performance in pointing tasks. Human–Computer Interaction. 2008;23(3):215–250. [doi:10.1080/07370020802278163](https://doi.org/10.1080/07370020802278163)

[33] Schmidt RA. A schema theory of discrete motor skill learning. Psychological Review. 1975;82(4):225–260. [APA PsycNet](https://psycnet.apa.org/record/1975-26710-001)

[34] Palmer C, Meyer RK. Conceptual and motor learning in music performance. Psychological Science. 2000;11(1):63–68. [doi:10.1111/1467-9280.00216](https://doi.org/10.1111/1467-9280.00216)

[35] Baily J. Music structure and human movement. In: Howell P, Cross I, West R, editors. Musical Structure and Cognition. Academic Press; 1985. p. 237–258.

[36] Salmoni AW, Schmidt RA, Walter CB. Knowledge of results and motor learning: a review and critical reappraisal. Psychological Bulletin. 1984;95(3):355–386. [PubMed](https://pubmed.ncbi.nlm.nih.gov/6399752/)

[37] Smith JO. Quadratic interpolation of spectral peaks. In: Spectral Audio Signal Processing. CCRMA, Stanford. [online](https://ccrma.stanford.edu/~jos/sasp/Quadratic_Interpolation_Spectral_Peaks.html)

[38] Ait-Aider O, Andreff N, Lavest JM, Martinet P. Simultaneous object pose and velocity computation using a single view from a rolling shutter camera. In: Proc. ECCV 2006, LNCS 3952. Springer; 2006. p. 56–68. [doi:10.1007/11744047_5](https://doi.org/10.1007/11744047_5)

[39] Gallego G, Delbrück T, Orchard G, et al. Event-based vision: a survey. IEEE Transactions on Pattern Analysis and Machine Intelligence. 2022;44(1):154–180. [arXiv:1904.08405](https://arxiv.org/abs/1904.08405)

[40] Azuma R, Bishop G. A frequency-domain analysis of head-motion prediction. In: Proc. SIGGRAPH 1995. p. 401–408. [doi:10.1145/218380.218496](https://doi.org/10.1145/218380.218496); Azuma R. Predictive tracking for augmented reality [PhD thesis]. UNC Chapel Hill; 1995. [PDF](https://www.cs.unc.edu/techreports/95-007.pdf)

[41] LaValle SM, Yershova A, Katsev M, Antonov M. Head tracking for the Oculus Rift. In: Proc. IEEE ICRA 2014. p. 187–194. [PDF](https://msl.cs.illinois.edu/~lavalle/papers/LavYerKatAnt14.pdf)

[42] Knibbe J, Benko H, Wilson AD. Juggling the effects of latency: motion prediction approaches to reducing latency in dynamic projector-camera systems. Microsoft Research Technical Report MSR-TR-2015-35; 2015. [PDF](https://www.hbenko.com/publications/2015/Juggling_Knibbe_MSR_TR.pdf)

[43] Rosa-Pujazón A, Barbancho I, Tardón LJ, Barbancho AM. Fast-gesture recognition and classification using Kinect: an application for a virtual reality drumkit. Multimedia Tools and Applications. 2016;75(14):8137–8164. [doi:10.1007/s11042-015-2729-8](https://doi.org/10.1007/s11042-015-2729-8)

[44] Aerodrums. Latency (forum thread stating 125 fps for Aerodrums 1 and 132 fps for Aerodrums 2). [aerodrums.com](https://aerodrums.com/forums/viewtopic.php?t=83); [manual](https://aerodrums.com/manual/)

[45] Lee DN. A theory of visual control of braking based on information about time-to-collision. Perception. 1976;5(4):437–459. [doi:10.1068/p050437](https://doi.org/10.1068/p050437)

[46] Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed mathematical model. Journal of Neuroscience. 1985;5(7):1688–1703. [doi:10.1523/JNEUROSCI.05-07-01688.1985](https://doi.org/10.1523/JNEUROSCI.05-07-01688.1985)

[47] Dahl S. Playing the accent: comparing striking velocity and timing in an ostinato rhythm performed by four drummers. Acta Acustica united with Acustica. 2004;90(4):762–776. [PDF](http://www.sofiadahl.net/pdf/paper2-accents2.pdf)

[48] Godøy RI, Jensenius AR, Nymoen K. Chunking in music by coarticulation. Acta Acustica united with Acustica. 2010;96(4):690–700. [doi:10.3813/AAA.918323](https://doi.org/10.3813/AAA.918323); the prefix, excitation, suffix vocabulary: [RITMO, Exploring sound-producing actions](https://www.uio.no/ritmo/english/research/labs/fourms/education/online-courses/music-moves/articles/week2/2-09-exploring-sound-producing-actions.md)

[49] Zhong Z, Martin M, Voit M, Gall J, Beyerer J. A survey on deep learning techniques for action anticipation. arXiv:2309.17257; 2023. [arXiv](https://arxiv.org/abs/2309.17257)

[50] Large EW, Kolen JF. Resonance and the perception of musical meter. Connection Science. 1994;6(2–3):177–208. [doi:10.1080/09540099408915723](https://doi.org/10.1080/09540099408915723)

[51] Pardo B. Tempo tracking with a single oscillator. In: Proc. ISMIR 2004. Barcelona; 2004. [PDF](https://archives.ismir.net/ismir2004/paper/000206.pdf)

[52] Large EW, Jones MR. The dynamics of attending: how people track time-varying events. Psychological Review. 1999;106(1):119–159. [doi:10.1037/0033-295X.106.1.119](https://doi.org/10.1037/0033-295X.106.1.119)

[53] Bernier YW. Latency compensating methods in client/server in-game protocol design and optimization. In: Game Developers Conference 2001. [PDF](https://www.gamedevs.org/uploads/latency-compensation-in-client-server-protocols.pdf)

---

*Note on citations: [1], [2], [4] and [42] were read in full for this document, and [13] against the specification text; the numbers in the §1 table for those entries are quoted from the papers. The remaining entries were verified from abstracts, publisher pages or the papers that cite them, and archival URLs for older proceedings should be re-checked before quoting them in a publication.*
