# Conducting gestures and a virtual orchestra: a research map

*thoremin, 2026-09-09. Phase 1 deliverable of [#187](https://github.com/thorwhalen/thoremin/issues/187); the companion to [`rhythm-from-gesture-research-map.md`](rhythm-from-gesture-research-map.md) (#178), whose §1 and §6 this document assumes and does not repeat.*

## 0. Problem statement and scope

The maintainer's direction (#187): find methods and models for the movements made to conduct an orchestra, and make a virtual orchestra that those movements control; the same movements should also be able to pace a pre-existing audio recording or score. That settles #180 in favour of wiring conductor mode, and it names the piece #180 found missing: this repo has no content pipeline, so `src/nodes/music/score.ts` (built, tested, catalogued, unwired) has never had a real score to play.

Three sub-problems, each with its own literature, and each surveyed below with measured facts where a package is involved:

1. **Conducting-gesture understanding** (§1 to §3): from a hand or wrist trajectory sampled at 30 to 60 Hz, infer the beat instant (the *ictus*), the beat pattern and beat-in-bar, the tempo, the dynamics, and the articulation. The rhythm map (#178) established why this must be inference against a musical prior rather than measurement. This document goes one level down: which detectors and which update equations, with the constants the literature actually reports.
2. **A score pipeline** (§4): load MusicXML and MIDI client-side into one symbolic model, optionally render it with a cursor that *we* drive from the conductor's beat, and ship a few free demo pieces.
3. **A virtual orchestra** (§5 and §6): sample-based sections with per-section dynamics that can change during a held note, scheduled sample-accurately at the conductor's inferred tempo; and the same pacing seam applied to a pre-existing audio file by pitch-preserving time-stretch.

§7 turns the findings into the architecture for the `ictus` TypeScript core (`src/ictus/`), the thoremin nodes around it, and the fixtures that make the whole thing testable without a camera. §8 is the decision list. The PR plan derived from this document is appended to #187.

Constraints carried through every section: client-side only; every parser, sample set and codec is loaded on first use through the catalogued lazy-loading pattern (`src/lazy/`: `lazyResource` and the shared `LoadStatus` readout, [`docs/design/lazy-loading.md`](../design/lazy-loading.md), #188), which extracted the state machine the three older sites (`webcam_hands.ts`, `recording/formats.ts`, `midi_out.ts`) each wrote by hand; DAG conventions (`defineNode`, roles, live input ports, `npm run catalog`); the command write path (#87); the shipping rule (an entry point in `src/app/tools.ts` or a dial, plus a reachability test); and #146 for anything that needs a webcam and human eyes.

## 1. Conducting-gesture recognition: the systems and what they teach

### 1.1 The lineage in one arc

Machine conductor-following starts with Max Mathews' Conductor Program driven by the Radio Baton, a capacitive 3-D tracker whose "beat" is a trigger fired when the baton crosses a virtual plane above the antenna board; the program advances a pre-stored score at the rate the triggers imply and maps the other baton's position to dynamics and timbre [1,2]. Morita, Hashimoto and Ohteru (Waseda, 1989 to 1991) built the first camera-based follower: a CCD camera tracks the baton, a sensor glove reads the left hand, and a MIDI orchestra follows, with explicit tempo-prediction and compensation parameters tuned by observing conductors [3]. Marrin Nakra's Digital Baton and Conductor's Jacket (MIT Media Lab, 1996 to 2000) moved the emphasis from beat to *expression*, correlating muscle tension and gesture size with dynamics and phrasing [4,5]. Ilmonen and Takala trained neural networks to follow tempo and beat inside a rendered 3-D orchestra [6]. Murphy, Andersen and Jensen (2003) tracked a real baton with a camera and time-stretched an audio recording so that audio beat points aligned with gesture beat points [7]. The Borchers/Lee line (Personal Orchestra 2000 to 2004, You're the Conductor 2003 to 2004, conga 2006, iSymphony 2006) is the most thoroughly documented museum-deployed family: an infrared baton, a real orchestra recording time-stretched by a phase vocoder, and progressively more general gesture analysis [8,9,10,11,12]. Kolesnik and Wanderley (McGill, 2004) put HMMs on camera-tracked hands to recognise both right-hand beat patterns and left-hand expressive gestures [13,14]; Bevilacqua's IRCAM Gesture Follower reframed the task as continuous temporal alignment to a recorded template, emitting gesture-time progression and likelihood every frame [15]. Later systems substituted consumer sensors (Wiimote, gyroscope mice, Kinect skeletons) [16,17,18,19,20,21] and, most recently, off-the-shelf pose estimators feeding recurrent networks [22].

### 1.2 The one direct precedent for a MediaPipe pipeline

arXiv:2604.27957, "Real-Time Control of a Virtual Orchestra by Recognition of Conducting Gestures" (Mermerci, Pascoe, Edström and Kjellström, KTH, April 2026), is a museum dome installation in which MediaPipe Pose Landmarker provides 2-D upper-body pose, nine keypoints are kept (shoulders, elbows, wrists, hands, hip centre), finite differences give velocity and acceleration, and a hierarchical LSTM over a 500-frame window regresses **bar phase** as (sin φ, cos φ) rather than classifying discrete gestures [22]. Beats are thresholded phase events (upbeat when Δφ > 0.5; downbeat when φ wraps from above 3.8 to below 2.5), and playback speed is the ratio of the recording's next-bar duration to the observed inter-beat interval, with a median-of-three-intervals smoother chosen over raw and mean strategies. Training data: 12 conductors (6 professional), 130 takes of the Beethoven 5 opening at 60 Hz; the live system runs at 20 Hz. Reported numbers: beat-to-bar synchronisation error 0.192 ± 0.125 s across users (0.155 ± 0.106 s for a professional), and a candidly reported weakness that the system needs 2 to 4 beats to react to a tempo change, which the professional conductor described as "they are not listening" [22]. The lesson for us: a phase regressor plus interval averaging has no model of tempo as a *state*, so it cannot predict between beats and its adaptation speed is fixed by the smoother; an oscillator with a period term (§2) predicts at zero latency, and its adaptation lag is a gain choice rather than a property of the architecture. With the human-fitted gains adopted in §7.1 a tempo step is about two-thirds absorbed after two anchors and seven-eighths after four, the same order as the KTH lag; what the oscillator adds is the prediction, and what closes the lag is raising the period gain under the attentional gate, which is a tuning question the fixtures answer, not a research one.

### 1.3 How the ictus has been detected, system by system

Nearly every rule-based follower reduces the ictus to a vertical turning point. Personal Orchestra fires a downbeat on the negative-to-positive sign change of the baton's vertical velocity, the lowest point of the stroke, and adjusts tempo once per beat [8]. conga's "bounce detector" looks for a zero crossing of the vertical velocity with a magnitude criterion to suppress false triggers, and for the four-beat pattern chains five such feature detectors into a state machine that doubles as a beat predictor [10]. VirtualPhilharmony defines the beat point as the local minimum of the vertical component of whatever sensor it is fed, lets the player set a lag between beat point and sounding beat, and cites Nakra's finding that sub-10 ms sampling is needed to localise the ictus precisely [18]. Bradshaw and Ng detect beats as peaks in acceleration magnitude with a refractory period of one quarter of the previous inter-beat interval to suppress the rebound's secondary peak [16]. Peng and Gerhard classify a detected beat as a downbeat if the preceding samples approach it near-vertically [17]. The learning-based systems avoid the question: HMMs, DTW and LSTMs classify or align whole strokes, so the beat is a state transition or a phase wrap rather than a hand-coded extremum [13,19,21,22].

### 1.4 What perception says the ictus is (this matters more than the engineering)

Motion-capture studies of real ensembles and tapping experiments show that musicians do *not* synchronise to the lowest point of the trajectory. Luck and Toiviainen (2006) found ensemble onsets align with periods of **maximal deceleration along the trajectory** of the baton hand [23]; Luck and Sloboda (2009) found **absolute acceleration along the trajectory** to be the dominant cue in point-light tapping, with weights modulated by beat clarity and tempo [24]; Wöllner et al. (2012) showed that averaging conductors' patterns reduces jerk and *improves* synchronisation, so the prototype gesture is smoother than any individual's [25]. Meals (2020) measured the sound lag behind the ictus in six real ensembles: −31 ms (wind bands) to −51 ms (orchestras) on average, with SD ≈ 95 ms and per-ensemble means from −125 to +26 ms [26].

Design consequence for a 30 to 60 Hz landmark system: derive the ictus from the kinematic profile (the deceleration peak of a smoothed trajectory, with the vertical-velocity zero crossing as the cheap proxy), and treat its absolute timing as uncertain by tens of milliseconds *by construction*. A 33 ms frame period is about the size of a human ensemble's own lag distribution, so a musical prior and prediction (§2) are not optional, and a per-user offset between detected ictus and intended beat is a calibration constant, not a tracking error.

### 1.5 Beat pattern, tempo prediction, dynamics, articulation

Pattern recognition is either absent (up-down only), profile-based (conga runs Wiggle, Up-Down and Four-Beat profiles simultaneously and promotes to the best match; all five test users were promoted to Up-Down within two beats [10]), or statistical: Kolesnik's HMMs on four-beat legato vs staccato [13]; Höfer's discrete HMMs on gyroscope data classifying which beat of the pattern a stroke is (99.6% within-user, 90 to 96% cross-user) [19]; Fahn et al.'s DTW over Kinect palm trajectories on three patterns at five speeds and seven camera angles (89% at 30 fps) [21]. Tempo models range from per-beat ratio updates [8] to explicit predictors: VirtualPhilharmony's next-beat tempo is a weighted sum of a four-beat moving average, the last tempo delta and an expressive template, with bar-internal rules learned from recordings [18]. Dansereau, Brock and Cooperstock (2013) is the cleanest formulation for a landmark system: state = {phase, phase-rate (tempo), scale (dynamics), x/y bias}, measurement = a scaled gestural template T(φ), tracked by a particle filter or EKF on baton-tip data at 120 Hz and predicted 200 ms ahead to cancel network latency [27]. That state vector is the latent-variable rhythm model #178 argues for, already applied to conducting.

Gesture size (vertical amplitude) mapped to volume is universal [1,8,9,10]. Sarasúa and Guaus regressed loudness against Kinect descriptors (quantity of motion, contraction index, maximum hand height, velocity statistics over about 1 s) for 25 subjects and found subject-specific models differ substantially from the pooled model, motivating per-user calibration [20,28]. Articulation is the weakest link: Kolesnik separates legato from staccato patterns as HMM classes [13]; Huang et al. (ISMIR 2019) used 27-marker mocap and a multi-task BiLSTM to jointly predict dynamics (6 levels), articulation (3 types) and phrase cues, and found wrist and finger markers more informative than the baton tip [29]. Left-hand expressive gestures were addressed head-on only by Kolesnik (five classes at 97% on isolated gestures) [13] and by section-targeting metaphors (pointing selects a section; left-hand height sets ensemble dynamics) [30,31].

### 1.6 Latency numbers, and a sobering finding about non-experts

conga reports an average latency of 86 to 122 ms per user for the Up-Down profile and 107 to 203 ms for Four-Beat, part of it from a 32-point smoothing filter [10]. Mermerci et al. report 0.19 s bar-sync error and 2 to 4 beats to register a tempo change [22]. When You're the Conductor was tested with 20 children, their "beats" were frequently not synchronous with the music, so the authors *abandoned beat detection* for a velocity-magnitude to tempo mapping decoupled from beats [9]; conga then generalised this as the fallback Wiggle profile [10]. A robust design therefore layers (i) a beat-agnostic speed/size mapping that always works (this is what the existing `performance` node already is), (ii) a kinematic ictus detector with a refractory window, and (iii) a phase/tempo state estimator with a musical prior that predicts ahead of the frame period.

### 1.7 Pedagogy as a prior

Rudolf's *The Grammar of Conducting* codifies the standard patterns (2, 3, 4 and subdivided beats), organises them into legato, staccato, marcato and tenuto families, and defines the preparatory beat and the rebound; the "click" of a staccato beat is a sharp stop at the ictus, whereas legato beats pass through it smoothly [32]. Green's *The Modern Conductor* supplies the geometric invariants a detector can exploit: every ictus lies on the same horizontal plane, beat one (and the last beat) is downward, two goes left and three right in 4/4, and the rebound leaves in the direction opposite to the next beat [33]. Read with §1.4, the prior for a landmark system is: the *ictus plane* is a per-user constant to estimate; the vertical-velocity zero crossing on that plane is where the click lives; the sharpness of the speed profile around it is the legato-staccato axis; the horizontal displacement between successive ictus points identifies the beat number within the pattern; and the preparatory beat, one full beat before the first sound, is the earliest legitimate moment to commit a tempo.

### 1.8 Datasets

The IDEA Open Movement Dataset (IRCAM, MOCO 2019) provides full-length IMU recordings of a conductor's right hand across rehearsals and performances, with the Max patches used to follow them; it is the only open *following* dataset found [34]. ConductorMotion100 (VirtualConductor, ICME 2021) is 100 h of 2-D pose extracted from concert video, built for the inverse problem (music to motion) but usable as an unlabelled prior over conducting kinematics [35,36]. Mermerci et al.'s 130-take corpus is described but not stated as released [22]. For this repo the practical source is instructional YouTube video of conductors demonstrating patterns, fetched with `yb` into the app-data dir and reduced to hand-landmark streams headlessly (§7.5).

### 1.9 Comparison table

| System | Year | Input sensor | What it extracts | Ictus detection | Tempo model | Notes |
|---|---|---|---|---|---|---|
| Radio Baton + Conductor Program [1,2] | 1989 to 91 | Capacitive 3-D baton tracker | Beat triggers, dynamics, timbre | Baton crossing a virtual plane | Score advanced per trigger | |
| Morita, Hashimoto, Ohteru [3] | 1989 to 91 | CCD camera on baton + glove | Beat/tempo, left-hand expression | Camera-tracked baton | Tempo prediction + compensation | First vision-based follower |
| Conductor's Jacket [4,5] | 1996 to 2000 | EMG, respiration, position/acceleration | Expressive features | Not the focus; high-rate sensing | | 6 subjects, 12 h |
| DIVA Virtual Orchestra [6] | 1997 to 99 | Tracked hand/baton | Tempo, beat, intent | ANN classifies stroke sequences | ANN | Rendered 3-D orchestra |
| Murphy, Andersen, Jensen [7] | 2003 | Camera on real baton | Beat points → audio alignment | Baton trajectory | Playback-speed control | Phase-vocoder stretch |
| Personal Orchestra [8] | 2000 to 04 | Buchla Lightning II IR baton | Tempo, volume, section emphasis | Sign change of dy/dt (lowest point) | Per-beat ratio, catch-up window | 93% of visitors controlled tempo |
| You're the Conductor [9] | 2003 to 04 | IR baton | Tempo from speed, volume from size | **None** (decoupled from beats) | Velocity magnitude → tempo | Children's museum; audio stretch |
| conga [10] | 2006 | IR baton (device-agnostic DAG) | Beat, tempo, size, sub-beat progress | y-velocity zero crossing + magnitude gate | State machine predictor; profile competition | 86 to 203 ms latency |
| Kolesnik and Wanderley [13,14] | 2004 | Cameras + EyesWeb | Right-hand patterns, 5 left-hand gestures | HMM states over stroke | Continuous recognition | 97.2% isolated |
| Gesture Follower [15] | 2007 to 10 | Any stream | Time progression within a template + likelihood | Continuous HMM alignment | Alignment rate = tempo | One training example per class |
| Bradshaw and Ng [16] | 2008 | Wiimotes, 100 Hz | Beat points, tempo, dynamics | Acceleration peaks; refractory ¼ IBI | Inter-beat interval | |
| Peng and Gerhard [17] | 2009 | Wiimote IR baton | Trajectory, beats, pattern | Beat + vertical-approach test for downbeat | | Pedagogical |
| Höfer, Hadjakos, Mühlhäuser [19] | 2009 | Gyro mouse | Which beat of the pattern | VQ + discrete HMM | | 99.6% within-user |
| VirtualPhilharmony [18] | 2010 | Glove / Wii / capacitance, 11 ms | Beat point, predicted tempo, template | Local minimum of vertical component | Weighted MA + Δtempo + template | User-adjustable ictus→sound lag |
| Dansereau, Brock, Cooperstock [27] | 2013 | Vicon baton tip, 120 Hz | Phase, tempo, scale, bias | Phase in particle filter / EKF over a template | State-space, 200 ms prediction | Latency compensation |
| Sarasúa and Guaus [20,37] | 2014 | Kinect, 30 Hz | Beat timing; loudness from motion descriptors | Acceleration-based | | 25 subjects; per-user models |
| Fahn, Lee, Wu [21] | 2019 | Kinect palm, 30 fps | 3 patterns at 5 speeds | DTW over whole stroke | | 89% |
| Huang et al. [29] | 2019 | 27-marker mocap | Dynamics, articulation, phrase cues | offline | | Wrists/fingers beat baton tip |
| Mermerci, Pascoe, Edström, Kjellström [22] | 2026 | MediaPipe Pose, 9 keypoints, 20 Hz | Bar phase → beats → playback speed | Phase-wrap thresholds on LSTM output | Median of 3 IBIs; 2 to 4 beats to adapt | Sync error 0.19 ± 0.13 s |

## 2. Beat and tempo from sparse ictus anchors: implementable models

The tracker's input is a sparse causal stream of ictus candidates `(t_k, c_k)` with timestamps and confidences, not audio. This section gives the update rules, windows and parameter values the literature reports; #178's map has the theory.

### 2.1 Adaptive oscillators (Large and Kolen; Toiviainen; McAuley and Jones; Pardo)

The discrete-time form used in every implementation descends from Large and Kolen [38] and is stated compactly in Large 2001 [39]: the oscillator holds a phase `φ` and a period `p`; on each event `i` with inter-onset interval `IOI_i` and weight `X_i`, `φ_{i+1} = φ_i + IOI_i / p_i − η_φ · X_i · F(φ_i, κ)` (wrapped to −0.5..0.5) and `p_{i+1} = p_i + p_i · η_p · X_i · F(φ_i, κ)`. `η_φ` and `η_p` are the phase and period coupling strengths, and `F` is the derivative of a unit-amplitude von Mises attentional pulse, `F(φ, κ) = (1 / (2π e^κ)) · e^{κ cos 2πφ} · sin 2πφ` (closed form in Cont 2010 [40], citing Large and Jones [41]). `κ` is the attentional focus: large `κ` makes the pulse narrow, so only events near the expected phase move the oscillator. Period adaptation is multiplicative, so tempo change is relative, matching the log-tempo warping Cemgil et al. adopt for the same reason [42]. Large notes that phase coupling alone loses synchrony under rubato and that the period term is what tracks it [39].

Toiviainen's real-time MIDI accompanist [43] weights each event's effectiveness by its rhythmic importance, and a later variant runs many oscillators and picks the best fit. In our setting `X_i` is exactly where an ictus confidence and a kinematic sharpness measure belong. McAuley and Jones [44] give the same two-process oscillator with both gains bounded in 0..1: `φ_{i+1} = (1 − W_φ) · C` and `P_{i+1} = [1 + W_p · C] · P_i`, where the temporal contrast `C = (φ_i + IOI_i/P_i) mod 1` is wrapped to (−0.5, 0.5]; fitted human values were `W_φ ≈ 0.50 to 0.58` and `W_p ≈ 0.42 to 0.45`. Those are sensible starting gains for a conductor follower: about half the phase error and a bit less than half the period error corrected per anchor.

Pardo [45] is the cleanest published single-oscillator tempo tracker and a direct template. State: next-beat time `b_i` and period `p_i`. At each tick `t` with event weight `w_t`: `d = (t − b_i) / p_i`; if `|d| < ε` and `w_t > 0` then `p_i = p_avg · (1 + k·d)` and `b_i = b_{i−1} + p_i`; else if `t > b_i` and no event, free-run: `p_i = p_{i−1}`, `b_i = b_{i−1} + p_i`. `p_avg` is an exponentially weighted mean of the last `n = 20` periods with memory `m`. Random search over 5,000 settings on 99 piano performances gave `m = 0.65, ε = 0.36, k = 0.43`; mean phase error was about 23 ms per beat, statistically close to Cemgil's tempogram plus Kalman filter on the same corpus. Its documented failure mode is instructive: a sudden jump from 54 to 65 bpm lost the beat and never recovered, because a single hypothesis with `ε = 0.36` cannot re-lock.

### 2.2 Event-based multiple-hypothesis trackers (Dannenberg and Allen; BeatRoot; Cypher)

Dannenberg and Mont-Reynaud's real-time tracker (restated in Allen and Dannenberg [46]) is the smallest single-hypothesis model worth knowing: state `(T, B, S, W)`, beat duration `δ = W/S`; on a new onset `ΔB = ΔT/δ`, `Confidence = 1 − 2·|ΔB − round(ΔB)|` (a triangle peaking on predicted beats), `Decay = 0.9^(ΔB + 0.5)`, `W' = W·Decay + ΔB·Confidence`, `S' = S·Decay + ΔT·Confidence`. It was "either unreliable or unresponsive to tempo change, depending upon the rate of decay"; the fix that matters is a real-time beam search over interpretations with a credibility score, predictions taken from the most credible state, near-duplicates merged, and a beam width of only 2 to 3 states found sufficient [46].

Dixon's BeatRoot [47,48] is the canonical multi-agent tracker and every constant is published: onsets within 70 ms grouped; IOIs clustered with 25 ms width; for each tempo hypothesis one agent per event in the first 5 s; inner window ±40 ms accepts; outer window −20% / +40% of the inter-beat interval (asymmetric because slowing is more common than speeding) accepts *and* spawns a duplicate agent that rejects; `beatInterval += Error · CorrectionFactor`; `score += (1 − relError/2) · salience`; agents agreeing within 10 ms (interval) and 20 ms (phase) merge. Rowe's Cypher [49] keeps a score per beat period between 40 and 208 bpm and spawns candidates at 2:1 and 3:1 ratios, the simplest guard against octave errors.

### 2.3 Kalman tempo trackers (Cemgil, Kappen, Desain and Honing) and Raphael's Predict

Cemgil et al. [42] model a metronome as a two-state linear system, beat time `τ` and period `Δ`: `x_k = [τ_k, Δ_k]ᵀ`, `x_{k+1} = A x_k + ε_k` with `A = [[1, 1], [0, 1]]`, tempo fluctuation as process noise `Q` on the (log) period and expressive timing as observation noise `R` on the observed beat. For gesture anchors the observation is already a beat time, so the tempogram stage collapses and this becomes a two-state constant-velocity Kalman filter on beat times, with `R` set from the ictus detector's timing variance and `Q` from expected tempo drift per beat. Raphael's Music Plus One [50] is the same idea with a score and learned per-event tendencies, and one rule directly applicable here: if the onset posterior is high-variance or bimodal the module does not report it, "better to remain silent than provide bad information". An ictus candidate below a confidence threshold should be dropped, not fed with low weight.

### 2.4 Particle filters, PLLs, zero-latency pulse

Hainsworth and Macleod [51] track tempo and beats with particle filters on onsets; a Rao-Blackwellised variant performed best. A particle filter is justified for one anchor stream mainly if metrical-level ambiguity (beat vs half-beat) is to be carried as a discrete state. Shiu and Kuo [52] cast on-line beat tracking as a digital PLL; the Large-Kolen circle map *is* a PLL with a nonlinear phase detector and a multiplicative frequency update, and the PLL framing is useful for tuning intuition (loop gain ↔ `η_φ`, integrator ↔ `η_p`, pull-in range vs jitter). Meier, Chiu and Müller [53] are the current reference for zero-latency real-time beat output; their four exposed controls (tempo range, lookahead offset to absorb system latency, kernel size 4 to 12 s for stability vs responsiveness, and a stability threshold that gates output on confidence) are exactly the four a conductor follower needs to expose.

### 2.5 Score following as the consumer: Antescofo's tempo agent

Score following is beat following with the score as prior [50,54,55,56,57,58]. Antescofo's tempo model (Cont 2010, §VII and Algorithm 1 [40,59]) is the one to copy, because it is a Large-style oscillator driven by *sparse aligned events*. Tempo `ψ` is in seconds per beat; score event `n` has an expected phase `φ̂_n`; the attentional pulse is von Mises with concentration `κ`. On the arrival of event `n` at time `t_n`: (1) accumulate the circular dispersion of recent phase errors, `r ← r − η_s · (r − cos 2π((t_n − t_{n−1})/ψ − φ̂_n))`, then `κ = A_2^{−1}(r)` by table lookup (the maximum-likelihood von Mises concentration of the recent error population); (2) phase, `φ_n = φ_{n−1} + (t_n − t_{n−1}) / ψ_{n−1} + η_φ · F(φ_{n−1}, φ̂_{n−1}, κ)`; (3) period, `ψ_{n+1} = ψ_n · [1 + η_s · F(φ_n, φ̂_n, κ)]`. The confidence weighting is entirely in the adaptive `κ`: when recent events land where predicted, `κ` grows, the pulse narrows and a stray event produces almost no correction; when errors are dispersed, `κ` falls and the coupling becomes permissive. Cont notes an abrupt tempo jump is absorbed only progressively, with `κ` collapsing during the transient [40]. The tempo agent's prediction sets the decoder's expectation of *when* the next event should arrive, and the decoder's aligned event is the oscillator's next measurement. For our consumer the analogue is direct: gesture ictus → known beat index → tempo agent as above → score player scheduled from `ψ_{n+1}`.

### 2.6 Ictus detection from a 30 to 60 Hz trajectory, and sub-frame timing

Where the ictus is has been defined operationally the same way for forty years (§1.3), and conga is the most completely documented detector: a positive-to-negative zero crossing of the vertical velocity (conga's data is rotated 180°, so this is the same lowest point Personal Orchestra fires on), gated by requiring the magnitude of vertical movement over the last few samples to be a multiple (default 3×) of the horizontal movement, with the fractional beat extrapolated as `b = b_0 + (r/60)(t − t_0)` and clamped below `b_0 + 1` so beat position is monotone [10,60]. Grüll's thesis exposes the practical knobs: how many samples the signal may linger at zero, a pre-crossing magnitude threshold, and whether to fire when the hand halts or only once it moves up again ("robustness increases, but latency increases as well") [60]. Sarasúa and Guaus estimated beat positions from hand *acceleration* against manual annotations, reading a narrow error distribution centred at zero as "in sync", narrow and negative as "anticipating", and wide as "not following" [37,61].

A velocity zero crossing or acceleration extremum sampled at 30 to 60 Hz has ±8 to 17 ms quantisation; refine it with the three-point parabolic fit `p = ½ (α − γ) / (α − 2β + γ)` (offset in samples from the centre sample) [62], applied to the velocity minimum or acceleration peak rather than to position, because the position extremum is flat and the velocity crossing is where the curvature is. Latency accounting: a zero-crossing detector cannot fire until the first sample on the far side (one frame, 17 to 33 ms); a confirm-on-upward-return rule adds one or two more; detecting on the *deceleration peak* fires a fraction of a beat before the velocity zero, which is where perceivers put the beat anyway (§1.4). Antescofo's `κ` and Raphael's "do not report uncertain onsets" are the two ways to keep a late or doubtful candidate from moving the oscillator [40,50].

### 2.7 What the human synchronisation literature says a tracker should trust

In paced tapping, taps precede the tone by a few tens of milliseconds (the negative mean asynchrony), smaller in musicians and at faster tempo [63,64]. A conductor's ictus is the *stimulus* side of this relation: Meals measured conductor-gesture-to-sound offsets with per-ensemble means from −125 ms to +26 ms and SDs of 50 to 113 ms [26]. The linear two-process model (Mates; Vorberg and Wing; Vorberg and Schulze [65,66,67]) separates period correction `T_{n+1} = T_n − β (T_n − IOI_n)` from phase correction `a_{n+1} = a_n − α a_n + T_n − IOI_n`. The findings that bear on gain scheduling: `α` decreases as tempo increases [63]; phase correction is largely automatic, whereas period correction requires attention and is disrupted by a concurrent task [68]. Read as design guidance: the phase gain should be moderate and always on (`W_φ ≈ 0.5`), the period gain lower and applied only to consistent evidence (`W_p ≈ 0.4`, BeatRoot's outer-window "accept but hedge", or Antescofo's `κ`-gated coupling), and both should scale with the inter-beat interval so that at fast tempi individual anchors move the state less.

Where the beat is in the gesture, once more with the tracker in mind: detect the ictus on the deceleration peak (acceleration-magnitude maximum as the hand brakes into the turning point), not on the position minimum, and use the sharpness of that peak (or low jerk in the approach) as the per-anchor confidence `X_i`, because sharper braking is what makes a beat clear to human followers [23,24,25].

### 2.8 Evaluation

Davies, Degara and Plumbley [69] define the beat-tracking metrics, and `mir_eval.beat` [70] implements them with these defaults: 5 s of leading beats trimmed; F-measure with a ±70 ms window; Cemgil accuracy as a Gaussian error with σ = 40 ms; continuity scores CMLc/CMLt/AMLt with phase and period tolerances of 17.5% of the inter-annotation interval (AML accepts double/half tempo and off-beat); information gain from a 41-bin beat-error histogram. For a gesture stream the reference beats come from the score positions the conductor was following or a stated tempo the subject conducted to, so the metrics transfer unchanged; because our tracker is causal, report them on the *predicted* next-beat times, not the detected ones. The score-following metrics [58] belong alongside: per-event error, latency, miss rate, misalign rate (|e| > 300 ms), piece completion. A small TypeScript port of F-measure, Cemgil accuracy and CMLt is enough for the fixture tests (§7.5).

### 2.9 Comparison table

| Family | State | Update on anchor | Tempo change handled by | Multi-hypothesis? | Latency | Reference implementation |
|---|---|---|---|---|---|---|
| Adaptive oscillator (Large-Kolen / Toiviainen / Pardo) | phase `φ`, period `p` | `φ += IOI/p − η_φ c F(φ,κ)`; `p += p η_p c F(φ,κ)` [39]; Pardo: `p = p_avg(1 + k d)` if `\|d\| < ε` [45] | multiplicative period term | no (comb of oscillators in Toiviainen) | 0 (predicts next beat from state) | Pardo pseudocode [45]; GrFNN for the canonical model [71] |
| Antescofo tempo agent | `φ`, `ψ`, `κ`, dispersion `r` | Alg. 1: `κ` from circular dispersion; phase-couple; `ψ' = ψ(1 + η_s F)` [40] | period coupling; `κ` collapses during a jump | confidence-gated | 0; feeds HSMM occupancy | Antescofo [40,59] |
| McAuley-Jones two-gain oscillator | `φ`, `P` | `φ' = (1 − W_φ)C`; `P' = (1 + W_p C)P` [44] | `W_p` (human fit ≈ 0.4) | no | 0 | equations in [44] |
| Dannenberg-Mont-Reynaud confidence/decay | `(T, B, S, W)` | triangle confidence weights the IOI into decayed sums [46] | decay rate | no | 0 | listing in [46] |
| Allen-Dannenberg beam search | set of states with credibility | expand on onset; prune to beam 2 to 3; predict from most credible [46] | states carry different tempi | yes | 0 | [46] |
| BeatRoot agents | per agent: interval, prediction, history, score | inner ±40 ms accept; outer −20%/+40% accept and spawn rejecting twin [47] | per-agent correction; competing agents | yes | 0 | BeatRoot [47,48] |
| Cypher theories | score per period 288 to 1500 ms | candidates at 2:1/3:1 get points [49] | neighbouring theories averaged | yes (histogram) | 0 | Cypher [49] |
| Kalman (Cemgil et al.) | `[τ, Δ]`, log-period | predict `τ' = τ + Δ`; correct with `y = t_k` [42] | process noise `Q` | no (unimodal) | 0 | [42]; score-aware variant [50] |
| Particle filter (Hainsworth-Macleod) | beat time, tempo | importance-weight particles on onset likelihood [51] | Brownian tempo prior | yes | 0 | [51] |
| PLL (Shiu-Kuo) | DCO phase and frequency | phase detector → loop filter → DCO [52] | loop bandwidth | no | 0 | [52] |
| PLP zero-latency (Meier et al.) | local pulse kernel over 4 to 12 s | kernel extrapolates; stability threshold gates output [53] | tempo range, kernel size | implicit | 0 by construction | libfmp/PLP [53] |
| HMM/HSMM score follower as consumer | score position + occupancy | forward pass; occupancy from the tempo agent [40] | coupled tempo agent | yes | detection latency [58] | Antescofo audio agent [40]; Orio-Déchelle [55] |

## 3. Where the ictus is, in one paragraph

Collapsing §1.3, §1.4, §2.6 and §2.7: the ictus a follower should emit is the instant of **peak deceleration of the beating hand as it brakes into the turning point on the ictus plane**, refined to sub-frame precision by parabolic interpolation of the speed minimum, with a confidence proportional to the sharpness of that braking (in noise units of the hand's own frame-to-frame jitter, the convention `src/enroll/noise.ts` already establishes) and gated by a refractory window of about a quarter of the current period. The vertical-velocity zero crossing is the cheap equivalent and is what every rule-based system shipped; the deceleration peak fires earlier and is where humans put the beat. The absolute offset between that instant and the musically intended beat is a per-user calibration constant of the order of tens of milliseconds, and nothing at 30 Hz can measure it better than the ensemble's own scatter, which is why the anchor goes into a tempo oscillator and never directly to the sequencer.

## 4. The score pipeline: parsing and rendering in the browser

Every package fact in this section was read from the npm registry and bundlephobia on 2026-09-09; min+gz is bundlephobia's figure unless labelled "unpacked" (the registry's uncompressed tarball size, given where bundlephobia rate-limited).

### 4.1 MIDI: `@tonejs/midi`, lazily imported

`@tonejs/midi` is the only candidate that hands over the whole symbolic model in one object: `header.tempos[{bpm, ticks}]`, `header.timeSignatures`, `header.ppq`, `ticksToSeconds()`, and per-track `notes[{midi, ticks, durationTicks, time, duration, velocity 0..1}]` plus instrument, channel and name [72]. Beats are `ticks / header.ppq`. It is 8.95 kB min+gz, MIT, typed, pure JS (no DOM; Worker-safe), with an ESM entry. Its last publish is 2022, stale but stable; it is a thin layer on `midi-file` (2.8 kB, MIT, 2023) [73], the fallback if raw events plus a 60-line tempo map are ever preferred. Rejected: `midi-parser-js` (GPL) [74]; `midifile` (2018, 1.3 MB unpacked) [75]; `midi-json-parser` (actively published, but spawns its own Worker from a Blob URL, which complicates CSP, and yields raw events only) [76]. `webmidi`, already a dependency, is the Web MIDI *device* API and has no file parser [77].

### 4.2 MusicXML: `musicxml-io` behind our own `ScoreDoc` schema

`musicxml-io` is the only MIT, TypeScript, ESM, pure-JS (no `DOMParser`, so Worker-safe) MusicXML parser that also handles compressed `.mxl` (via `fflate`, already a dependency), has a `musicxml-io/browser` entry, exposes a semantic model (parts → measures → entries with pitch, octave, duration; `getAllNotes()` with part and measure context) and can export MIDI [78]. Its risk is youth: 0.10.1, published 2026-09-02, one maintainer, 1.67 MB unpacked (CJS and ESM builds, source maps and types; the README claims about 47 kB minified tree-shaken for basic parsing, not independently measured). The adapter boundary is what makes that acceptable: the app only ever sees `ScoreDoc` (a Zod schema: notes with onset and duration in beats, pitch, velocity, part; tempo map; time signatures; dynamics; articulations), so the fallback, `xml-js` (10.4 kB) plus a hand-rolled walker for `divisions`, `backup`/`forward`, chords, ties, tuplets, `<sound tempo>` and `<direction>` dynamics [79], is a swap, not a rewrite. Rejected: `musicxml-interfaces` (AGPL-3.0, a licensing wall for a deployed app) [80]; `@stringsync/musicxml` (MIT, 59 kB, a spec-conformance library rather than a note extractor, self-declared unstable, no `.mxl`) [81].

### 4.3 Rendering with an externally driven cursor: OSMD by default, Verovio as the swap

The requirement is "we own the clock; ask the renderer what is at beat b and move the cursor there." Both candidates satisfy it, differently. **OpenSheetMusicDisplay** (2.1.2, BSD-3, 333 kB min+gz, UMD only, needs a real DOM): `Cursor.iterator` is a public field and `MusicPartManagerIterator(sheet, startTimestamp)` is exported, so per tick `cursor.iterator = new MusicPartManagerIterator(osmd.Sheet, new Fraction(b, 4)); cursor.update();` followed by `NotesUnderCursor()` gives the sounding notes at beat b (OSMD timestamps are whole-note fractions, so a quarter-note beat b is `Fraction(b, 4)`) [82,83]. Nothing in the public build runs its own transport; the `PlaybackManager` lives only in the sponsor-gated audio player [84,85], which is what we want. OSMD also loads and unzips `.mxl` itself, so the rendering choice never forces a second parser. **Verovio** (6.3.0, LGPL-3.0-or-later, 2.41 MB min+gz with the WASM embedded, types via `@types/verovio`, runs in a Worker): `renderToTimemap()` returns entries with `qstamp` (quarter-note time, literally our beat), `on`/`off` id arrays, tempo and measure; `getElementsAtTime(ms)` and `getTimesForElement(id)` complete the picture, and because the rendered SVG carries the same ids the cursor is "index the timemap by `qstamp`, toggle a CSS class on `#id`" [86,87]. It is the more principled fit for an external clock and also imports MEI, Humdrum and ABC; the price is seven times OSMD's bundle and no light build on npm [88,89]. **alphaTab** (MPL-2.0, 288 kB plus fonts) has an external-media player mode with `updatePosition(ms)` every 50 ms, but it is designed around a fixed backing track and is tab-centric, workable but not natural [90,91,92,93]. **abcjs** is ABC-only [94]; **music21j** (431 kB) has no external-clock cursor [95]; **VexFlow** alone does no parsing, layout or cursor [96].

Decision: rendering is optional for the "done" criterion in #187 (a player conducts and the orchestra follows), so v1 ships no renderer; the cursor seam is designed against `qstamp`-style lookup so either OSMD or Verovio drops in later.

### 4.4 Demo content: OpenScore for MusicXML, Mutopia for orchestral MIDI

There is no CC0 full-orchestra MusicXML corpus. The OpenScore String Quartets and Lieder repositories already contain compressed MusicXML next to the MuseScore files (196 and 1,462 `.mxl` files respectively) under CC0-1.0 [97,98]; for orchestra the free options are MEI (Verovio-native, ECL-2.0) [99] or MIDI from Mutopia (public domain per listing) [100]. Candidates small enough to ship:

| Piece | Source | Size | Parts | License |
|---|---|---|---|---|
| Haydn, String Quartet Op.76 No.3 "Emperor" | OpenScore/StringQuartets `sq20428156.mxl` | 198 kB | 4 | CC0-1.0 |
| Beethoven, String Quartet Op.18 No.1 | OpenScore/StringQuartets `sq8071278.mxl` | 240 kB | 4 | CC0-1.0 |
| Dvořák, String Quartet Op.96 "American" | OpenScore/StringQuartets `sq8885439.mxl` | 247 kB | 4 | CC0-1.0 |
| Schubert, Der Erlkönig D.328 | OpenScore/Lieder `lc29062370.mxl` | 54 kB | voice + piano | CC0-1.0 |
| Beethoven, Symphony No.5 mvt 1 | Mutopia `Symphony5_1.mid` | 75 kB | orchestra | Public domain |
| Mozart, Eine kleine Nachtmusik K.525 | Mutopia `MozartWA-KV525-mids.zip` | 80 kB | strings | Public domain |

Do not ship: the musicxml.com example set (in copyright) [101]; `bach-370-chorales` (CC BY-NC-SA) [102]; the KernScores quartets (no license file) [103]; the music21 corpus (per-piece licenses, some non-commercial) [104]; anything from musescore.com other than OpenScore. A Symphony No. 5 opening is also the piece the KTH system used (§1.2), which makes it the natural first demo: a five-bar opening every player recognises, with fermatas in bars 2 and 5 that exercise the HOLD state (§6.3).

### 4.5 Summary table

| library | npm@version | license | min+gz | last publish | types | DOM | external-clock cursor | role here |
|---|---|---|---|---|---|---|---|---|
| @tonejs/midi | 2.0.28 | MIT | 8.95 kB | 2022-02 | yes | no | n/a | **MIDI parse (v1)** |
| midi-file | 1.2.4 | MIT | 2.8 kB | 2023-03 | yes | no | n/a | fallback |
| musicxml-io | 0.10.1 | MIT | 1.67 MB unpacked (~47 kB min claimed) | 2026-09 | yes | no | n/a | **MusicXML parse (v1)** |
| xml-js + walker | 1.6.11 | MIT | 10.4 kB | 2019-02 | yes | no | n/a | fallback |
| opensheetmusicdisplay | 2.1.2 | BSD-3 | 333 kB | 2026-08 | yes | yes | yes (iterator by Fraction) | renderer (later) |
| verovio | 6.3.0 | LGPL-3.0+ | 2.41 MB | 2026-08 | @types | no (Worker) | yes (timemap `qstamp`) | renderer swap |
| @coderline/alphatab | 1.8.4 | MPL-2.0 | 288 kB + fonts | 2026-07 | yes | Worker | yes (external media) | no |

## 5. The virtual orchestra: sample instruments in the browser

Sizes measured 2026-09-09 (bundlephobia, unpkg listings, CDN `HEAD`, GitHub API directory sums). Two premises that turned out false and change the recommendation: **VCSL contains no bowed strings, brass or orchestral woodwinds** (its trees are harps, keyboards, recorders, saxes and percussion; the sections live in the sibling VSCO-2-CE repo, which has no web build and no CDN) [105,106,107,108]; and **`sfumato` is an SF2 player, not an SFZ player**, and a work in progress [109].

### 5.1 Players

**smplr** (1.0.0, MIT, 23.2 kB min+gz, typed, zero dependencies) is the modern general sampler: `Soundfont` plays per-note MP3/OGG from gleitz's `midi-js-soundfonts`, `Soundfont2` parses `.sf2` in-browser, and the smpldsnds mirrors serve VCSL and a real double bass; scheduling is `start({note, velocity, time, duration})` against `AudioContext.currentTime` with a 200 ms look-ahead [110,111,112]. Its limits for an orchestra: `start()` returns only a stop function and the per-voice gain is fixed at note-on, so there is no per-note live gain (there is an instrument-level `output.volume`, which is a per-section dynamics control); velocity layers are hard-switched and SFZ crossfade opcodes are dropped; sustain loops for the gleitz sets are "experimental, may produce clicks". **webaudiofont** (3.0.4, GPL-3.0 player, MIT data) embeds SF2 zones with loop points in per-instrument JS files as small as 72 kB (trumpet) to 1.65 MB (string ensemble), and its `queueWaveTable` returns a GainNode per note, so live per-note gain is possible; the player's GPL is the problem for a client-side bundle, the data is not [113,114]. **Tone.js** `Sampler` is 76.6 kB and repitches a few samples with no velocity layers [115]. **@magenta/music**'s SoundFontPlayer needs TF.js and 41 MB per string ensemble [116,117]. No production-grade SFZ engine exists on npm (`sfizz-webaudio` and `sfz-web-player` are GitHub-only experiments) [118,119].

**spessasynth_lib** (4.3.14, Apache-2.0, typed) is the decisive find: a complete SoundFont2/SF3/DLS synthesizer in pure TypeScript running in an `AudioWorklet`, 17.8 kB gz in the bundle plus a 135 kB gz worklet module loaded on first use, and every real-time method takes `{ time }` in `AudioContext` seconds, so `noteOn`, `noteOff`, `controllerChange`, `programChange` and `pitchWheel` are all **schedulable sample-accurately** [120,121]. Because it is a full SF2 engine, CC7 volume and CC11 expression change the level of notes already sounding, SF2 modulators can route any CC to per-zone attenuation or filter cutoff (the mod-wheel crossfade idiom, §5.3), loops and release envelopes come from the bank, and it also *writes* SF2/SF3, which is how a GM bank is trimmed to an orchestral subset offline. **js-synthesizer** (FluidSynth WASM, 217 kB gz, 896 kB with SF3 support) is the alternative engine, but it schedules through FluidSynth's tick sequencer rather than `AudioContext` time [122].

### 5.2 Sample sets

| set | license | format | total | per instrument | layers / articulations | CDN |
|---|---|---|---|---|---|---|
| MuseScore_General 0.2 [123,124] | MIT | SF3 (ogg inside) | **39.9 MB** sf3 (216 MB sf2) | n/a (GM bank) | single layer for most ensembles; looped | osuosl mirror |
| FluidR3_GM via gleitz [125,126] | MIT (Wen) / CC-BY 3.0 (gleitz) | per-note mp3 in one JS file | 148 MB SF2 source | 2.0 to 3.0 MB per instrument (string ensemble 2.80, trumpet 2.94, flute 2.97, timpani 2.01) | one layer; loops only via a side JSON | gleitz.github.io; jsDelivr `/gh/` |
| webaudiofontdata [113,114] | MIT (data) | per-instrument JS with loop points | 326 MB repo | 72 kB to 1.65 MB | one zone per key range, looped | surikov.github.io; jsDelivr |
| VSCO 2 Community Edition [107,108] | CC0-1.0 | WAV + SFZ | 2.33 GB | Violin section susVib 46 MB, Cello 73 MB, Trumpet sus 41 MB, Horn 51 MB, Flute 25 MB, Timpani 36 MB (all WAV) | 2 to 3 dynamic layers, round robins on shorts; sus/pizz/spic/trem/stac/mutes | none |
| Sonatina Symphonic Orchestra v4 [127,128] | CC Sampling Plus 1.0 (no advertising) | SFZ + FLAC | 1.32 GB | 1st violins 54 MB | full articulations; CC1 volume on longs, CC21 vibrato | none |
| VCSL [105,106] | CC0-1.0 | WAV + SFZ; ogg mirror | 730 MB mirror | Concert harp 6 MB ogg | 2 to 3 layers; **no strings, brass, orchestral winds** | smpldsnds.github.io |
| GeneralUser GS 2.0.3 [129] | permissive (asks to self-host) | SF2 | 32.3 MB | n/a | GM | none |
| Philharmonia [130,131] | free, but not "as samples" | mp3 per note | not measured | not measured | pp to ff, all articulations, no loops | own site only |
| Salamander V3 [132] | CC-BY 3.0 | WAV / mp3 builds | 394 MB | piano only | 16 layers | tambien.github.io |

### 5.3 Techniques that matter

**Continuous dynamics on a held note** needs several dynamic layers crossfaded by a controller, or a single layer with loudness and brightness shaped after the fact. The layered idiom is standardised in SFZ as `xfin_loccN`/`xfout_loccN` [133], and in SF2 as a per-zone modulator from CC1 to attenuation with opposite polarities on the soft and loud zones, which spessasynth executes and its writer can author. GM banks and gleitz's renders are single-layer, and gain alone is not enough there: Fabiani and Friberg found timbre and loudness had equally large effects on perceived dynamic level, and spectral centroid rises with playing effort across orchestral instruments [134,135], so a per-section low-pass whose cutoff tracks the dynamics control (or a CC74 to filter-cutoff modulator authored into the bank) is the cheap approximation.

**Scheduling** follows Chris Wilson's two-clock pattern: a 25 ms timer enqueues everything due within a 100 ms look-ahead using `AudioContext.currentTime` [136]. An `AudioWorklet` is not required for sample accuracy, but it moves voice allocation and crossfade math off a main thread that in this app is also doing MediaPipe inference and canvas drawing, which is why spessasynth's worklet is worth its 135 kB [137]. **Decoding**: `decodeAudioData` expands a 3 s stereo note to about 1 MB of Float32 and detaches the input buffer [138,139]; cache the *encoded* bytes (Cache API or OPFS) and never the decoded buffers [140,141]. **Hosting**: GitHub Pages and jsDelivr `/gh/` are third-party origins to allow in CSP and cannot be version-pinned; self-hosting is unproblematic for CC0 and MIT sets, GeneralUser asks for it [129], CC-BY needs attribution, and Philharmonia forbids redistribution "as samples" [130]; jsDelivr's `/gh/` endpoint has its own size limits [142].

### 5.4 Recommendation

**v1: `spessasynth_lib` plus a self-hosted orchestral subset SF3 cut from MuseScore_General (MIT).** Keep GM presets 40 to 49 (strings), 56 to 61 (brass), 68 to 73 (winds), 46 to 47 (harp, timpani) and 0 (piano) using spessasynth's own SF3 writer offline; the orchestral subset of a 40 MB GM bank should land well under 15 MB (to be verified once cut). This gives sample-accurate `noteOn/noteOff/controllerChange` with `{ time }`, native loops and release envelopes, per-section CC11 expression and CC7 volume acting on notes already sounding, and one channel per section; pair CC11 with a per-section low-pass for the brightness half of a crescendo. **Fallback** if the SF3 trim is not ready: `smplr` with four gleitz FluidR3 instruments (string ensemble, trumpet, flute, timpani: 10.7 MB, about 7.5 MB on the wire) from jsDelivr, section dynamics via each instrument's output gain plus a filter; or the MIT `webaudiofontdata` files (2.1 MB for the same four, looped) behind a thin in-house player to avoid the GPL one. **Premium path**: VSCO-2-CE sections (CC0) converted to ogg and authored into an SF3 with CC1 crossfade modulators (about 3 to 5 MB per section per estimate), still played by spessasynth; or SSO's articulations if its Sampling Plus license (no advertising) is acceptable.

## 6. Tempo-following playback: score scheduling and audio pacing

### 6.1 What forty years of accompaniment systems settled

Dannenberg's 1984 accompanist [54] separates a matcher ("you are here") from a *virtual clock*, `V = (R − R_ref)·S + V_ref`, whose speed `S` is nudged whenever the clock is set forward or backward; it admits it made "no attempt to adjust tempos in a particularly musical manner" and simply skipped a note when behind, whereas a human accompanist "would be more likely to play the note anyway, and accelerate to catch up". The 2006 CACM survey [143] states the principle every later system obeys: a system that waits to hear a note and then responds "will always be late, since all musical events are detected with latency"; the controller extrapolates the future from detected onsets and other information. Raphael's Music Plus One [50,144] is the most fully documented scheduler, and it is an *audio* system: it phase-vocodes a pre-existing recording, predicting future timing with a Kalman-like model. Its loop: the system "is concerned only with scheduling the currently pending orchestra note time"; each detected solo onset recomputes that note's expected time; "sooner or later the actual clock time will catch up to the currently-scheduled time, at which point the orchestra note is played. Thus an orchestra note may be rescheduled many times before it is actually played." Detection latency of 30 to 90 ms is "enough to prove fatal if the accompaniment is consistently behind by this much", so "it is hopeless to build a purely responsive system"; and "very little harm is done when Listen fails to detect a solo note". For a recording, "scheduling a note simply means that we change the phase-vocoder's play rate so that it arrives at the appropriate audio file position at the scheduled time", "a trail of breadcrumbs for the phase vocoder to link" [143].

Antescofo [40,145,146] separates listening (position plus tempo) from a reactive engine whose actions are authored in beats and converted with the last detected tempo. Its synchronisation vocabulary is the checkable part: `@loose` uses only the estimated tempo; `@tight` triggers on the nearest detected event; `@target` adjusts the tempo of a sequence locally to converge on an anticipated event within a horizon; and, for the "conductor stops" case, `@conservative` holds position steady until an event is detected while `@progressive` keeps advancing even when the forecast event is missing [146]. Dannenberg's 2011 Virtual Orchestra [147] is the closest prior art to pacing a recording from a *beat signal*: 20 string tracks time-stretched by multi-channel PSOLA, driven by foot taps; the tracker ignores input until three even taps arrive, then uses linear regression over up to six previous taps to predict the next, accepts a tap within a third of a beat period of the expected time, and returns to the initial state after two misses. Its transferable idea: "the main output of the tapping system is the linear regression of recent beats", and the whole mapping (slope, beat offset, time offset) is what gets sent to the audio thread, so the audio callback maps its own *output* timestamp to a beat time. Passing a time-to-beat function instead of events is how they removed the event-latency problem.

### 6.2 The conducting-specific playback systems

Personal Orchestra [8,12] recognised the ictus as the downward turning point and mapped it onto manually pre-marked beats in the recording. Its phase servo is published: with `v_u` the user's conducted tempo (movie time per real time, from the last two beats) and `t_u` the position the user has conducted the movie to, the new movie speed to re-synchronise within a window Δt is `v_m = Δt·v_u / (t_m + Δt − t_u)`; a larger Δt makes the orchestra seem "slow to catch up" but filters "short tempo jitter by inexperienced conductors", so Δt was left a runtime variable. The CMJ paper reports the important user finding: conductors "place their beats precisely and consistently ahead of the music beat", whereas non-conductors sometimes lead and sometimes follow, so a small Δt that pleases conductors produces for novices a "spiral of death" (orchestra slows, user slows, orchestra slows) [12]. You're the Conductor therefore dropped beat synchronisation for children: gesture speed maps to tempo and size to volume, with an exponential decay of tempo to zero when the baton leaves range, and a PLAYING/WAITING state machine [9]. Personal Orchestra targeted 50 to 200% of recorded tempo, and PhaVoRIT covered 0 to 200% including pause [8,148]. The UBS Virtual Maestro (Wii Remote) used no position at all: velocity-magnitude peaks give inter-beat intervals, and the *playback* rate is smoothed by a further recursive filter, preferred to tight coupling because it "produces smoother results and avoids abrupt jumps"; if the user stops moving, "the performance will stop" [149]. The 2026 KTH system handles fermatas with a finite-state machine (waiting-for-upbeat, waiting-for-downbeat, sleep): in a fermata bar playback continues at the present speed and stops at the end of the bar, looping until a new speed command arrives; audio is time-stretched with WOLA [22].

### 6.3 The scheduling pattern, distilled

Four parts recur. (1) An estimator that publishes a **time-to-beat map**, `b̂(t)`, tempo `v̂` and a confidence, not a stream of beat events [50,146,147]. (2) A **pending-event scheduler**: for the next unplayed event at beat `B`, the predicted time `T = t_now + (B − b̂)/v̂` is recomputed every tick and committed to the audio engine only when `T` falls inside a short horizon; committed events are never moved [50]. Firing happens at the *predicted* time; waiting for the ictus is the "always late" design [143], with Antescofo's `@tight` reserved for events the score marks as hard sync points [146]. (3) A tempo **servo** with an explicit convergence horizon Δt [8,12,146]: the score does not jump to the ictus, it converges to it, and Δt is the single knob trading responsiveness for jitter rejection, small for conductors and larger for novices. (4) A **state machine** around the servo: READY → (preparatory upbeat) → RUNNING → HOLD. Every shipped system gates the start on a preparatory gesture [22,147] and defines "stop" as the *absence of the next expected ictus within a window* (a third of a beat and two misses in [147]; `@conservative` in [146]; exponential decay in [9]; run to bar end then sleep in [22]). Two details are easy to get wrong: the rebound must not be counted as a beat [8]; and the conductor's beat *leads* the sounding beat by a per-person, roughly constant offset [12], so the servo should estimate that lead rather than assume zero, which is exactly why the KTH system needs two to four beats to notice a change.

### 6.4 Priors for when the gesture is uncertain

Todd's model generates a rubato curve from the phrase hierarchy: every phrase boundary gets a parabolic tempo dip whose depth scales with the boundary's structural level, a prior that says *where* a conductor is likely to slow [150,151]. Friberg and Sundberg measured stopping runners and final ritardandi and found mean velocity approximated by a square-root function of time (constant braking power) [152]; the KTH Director Musices rule system packages this (Final Ritard, Phrase Arch) with tunable quantities [153,154]. For a Kalman-style tracker these are the *process model*: with a zero-mean tempo change (Raphael's sight-reading prior) you predict constant tempo; substituting the KTH curve for the phrase in progress gives a prediction that already decelerates into a cadence, so a hesitant or occluded gesture does not stall the music while a confident gesture still overrides it through the measurement update.

### 6.5 Web Audio scheduling mechanics

Wilson's look-ahead scheduler [136]: about 100 ms of look-ahead with a 25 ms interval, picking up the *current* tempo when computing the next note and never touching already-scheduled notes. That is the right half of the answer for a conductor: use a short horizon and re-plan often, because Web Audio cannot move a started source node (only `stop()` it and create another), while `AudioParam` automation *can* be revised with `cancelScheduledValues`/`cancelAndHoldAtTime`. "Schedule far and cancel" therefore means recreating nodes under a dropped tempo, which is audible. Sullivan documents the two failure modes of UI-thread look-ahead, timer imprecision and background tabs where "the UI thread virtually ceases" [155]; the practical mitigation is to drive the re-plan from the frame loop the pose pipeline already runs (the `Applier` effect in thoremin's `src/app/useEngine.ts`) and accept that a hidden tab stops conducting. Clock domains: pose timestamps live in `performance.now()`, audio in `AudioContext.currentTime`, the two drift, and `getOutputTimestamp()` returns a paired `{contextTime, performanceTime}` precisely so they can be mapped [156]. Tone.js's `Transport` is a reference implementation of "integrate a time-varying BPM into beat position" (a `TickParam` integrates bpm automation trapezoidally and inverts ramps analytically) [157,158,159], but its model is *planned automation*, not a servo; thoremin's `transport` node already integrates bpm over `ctx.dt`, which is the causal version of the same thing.

### 6.6 Pacing a pre-existing recording: rate change in the browser, measured

`HTMLMediaElement.playbackRate` with `preservesPitch` (Baseline since December 2023 [160]) is a real pitch-preserving stretcher in all three engines, but each picks its own algorithm and limits, none exposes when a rate change takes effect, and none aligns the media pipeline to the `AudioContext` sample clock, so it can drive a *coarse* pacer but not a phase servo. Chromium runs WSOLA with a 20 ms window and 30 ms search interval and accepts rates in [0.0625, 16] [161,162,163]; Firefox uses SoundTouch [164] and *mutes* outside [0.125, 8] [164], and `MediaElementAudioSourceNode` only honoured `playbackRate` from Firefox 91 [164]; Safari maps to AVFoundation's spectral algorithm, and the bug that made a media element routed through `createMediaElementSource` choppy was fixed in WebKit main only on 2026-03-27 [165,166]. `AudioBufferSourceNode.playbackRate` is the sample-accurate alternative, but pitch moves with rate [167]; it is the correct varispeed fallback and a useful test harness for the phase servo because its position integral is exact.

| lib | npm@version (published) | license | size (gz) | algorithm | worklet | real-time variable rate | notes |
|---|---|---|---|---|---|---|---|
| signalsmith-stretch [168,169] | 1.3.2 (2025-06) | MIT | 47.6 kB, one file with WASM inlined | Signalsmith Stretch (phase-vocoder family) | yes | **yes, `schedule({output, rate})` at context times, latency-compensated** | the only library whose rate changes are schedulable on the audio clock |
| @soundtouchjs/audio-worklet [170,171] | 2.1.1 (2026-08) | MPL-2.0 | 16.8 kB | SoundTouch WSOLA | yes | yes (AudioParams) | good on percussive, weaker on dense orchestral |
| rubberband-wasm / rubberband-web / @echogarden/rubberband-wasm [172,173,174] | 3.3.0 / 0.2.1 / 0.2.0 | **GPL** or paid commercial | 116 to 215 kB | Rubber Band | varies | yes | licensing trap: GPL virality, no app-store distribution without the commercial license |
| @superpoweredsdk/web [175,176] | 2.8.1 | commercial | 27 MB SDK | proprietary | yes | yes | by inquiry |
| paulstretch | 1.0.6 | MIT | 4.5 kB | Paulstretch | n/a | no (offline extreme stretch) | not a tempo tool |
| essentia.js [177] | 0.1.3 (2021) | AGPL-3.0 | 1.3 MB | analysis only | via examples | n/a | beat-grid extraction is the sibling epic's; AGPL |
| aubiojs | 0.2.1 | GPL (aubio) | 71 kB | aubio tempo/onset | no | real-time tempo | check license |
| web-audio-beat-detector | 8.2.39 (2026-08) | MIT | 5.9 kB | peak-interval BPM | worker | offline | cheapest beat-grid seed |

Latency is the number the libraries do not print, so take it from the one group that measured it: a phase vocoder has a startup latency of `2(R_a − R_s)` and a dynamic latency of `2R_s`, and a rate change requested mid-block takes effect at the next block, about 23 ms per change at 4096/1024, which "can result in a worst case cumulative error of 100 ms in under two minutes" if the pacer counts requested rather than effective rate [178]. PhaVoRIT [179] is the best documented orchestral-grade design, and its 60-subject listening test is the one data point on which algorithm class suits classical music: on the transient-free "Kleine Nachtmusik" the phase-locked vocoders beat the commercial time-domain stretchers, while on transient-heavy pop the ranking reversed. WSOLA (Chrome, Firefox, SoundTouch, the KTH system's WOLA) is the transient-friendly end of that trade-off; for sustained strings a phase-vocoder-class stretcher is the right default.

### 6.7 The pacing model: a PLL between two beat grids

The recording has a beat grid (beat j at audio time `A_j`), obtained offline by the sibling body epic (#186) or from a click track [147]. The conductor supplies the same time-to-beat map as §6.3. With the song's local tempo `v_s` and the audio position `a(t)` the stretcher is reading, the nominal ratio is `r₀ = v̂ / v_s` and the phase error in beats is `e(t) = b̂(t) − β(a(t))`. Personal Orchestra's servo is the proportional correction with a convergence horizon, `r = r₀ + e / (v_s Δt)` in linearised form [8,12]; Raphael's is the same idea in posterior form [50]; Dannenberg's is the linear map applied at the audio callback's *output* timestamp [147], which is the latency-compensation step: evaluate the error at `t + outputLatency + stretcherLatency`, not at `now`. Two clamps come from the DJ literature: Ishizaki et al. measured user discomfort against the tempo-adjustment ratio [180], and Stark, Davies and Plumbley's causal beat tracker outputs precisely a beat-phase/period pair, the same interface the conductor estimator publishes, so an audio-derived and a gesture-derived beat can share the servo [181]. Signalsmith's `schedule({output, rate})` is the one API that lets the ratio be committed at audio-clock times with the node's own latency compensated, which is what makes a stable loop possible in the browser; `HTMLMediaElement.playbackRate` cannot close the loop tighter than tens of milliseconds because the effective-rate onset is unobservable.

### 6.8 Systems table

| system | year | input | tempo model | scheduling | handles stops | ref |
|---|---|---|---|---|---|---|
| Dannenberg on-line accompaniment | 1984 | solo events | virtual clock, speed nudged on each match | events fired on virtual time | clock stops advancing | [54] |
| Music Plus One | 2001 to 2010 | audio (HMM) | Kalman-like tempo and onset chain, rehearsal-learned tendencies | one pending note re-predicted on every onset; phase-vocoder rate set to hit position on time | missed notes: predict from what was observed | [50,143,144] |
| Antescofo | 2008 on | audio, coupled audio and tempo agents | anticipatory tempo agent (§2.5) | beat-relative delays; `@loose`/`@tight`/`@target` | `@conservative` freezes; `@progressive` advances | [40,145,146] |
| Personal Orchestra | 2000 to 04 | IR baton | per-beat tempo; catch-up within Δt | audio/video speed, beat-aligned, 50 to 200% | complains if you stop | [8,12] |
| You're the Conductor | 2003 to 04 | IR baton, children | gesture speed → tempo, no beat sync; exponential decay | modified phase vocoder | WAITING state | [9] |
| iSymphony / Maestro! (PhaVoRIT) | 2006 | baton; adaptive pattern | beat-synchronised for conductors, speed-only for novices | phase vocoder, rate update 43/s, ≤69 ms | pause supported | [12,148,179] |
| Virtual Orchestra (HCMP) | 2011 | foot-pedal taps | linear regression over ≤6 taps → time-to-beat map | map sent to the audio thread; PSOLA at output timestamp | two misses → reset; taps within ⅓ beat | [147] |
| UBS Virtual Maestro | 2007 to 09 | Wii accelerometer | IBI of velocity peaks, recursively smoothed | playback rate | no motion → stop | [149] |
| KTH dome installation | 2026 | skeleton tracker, 20 Hz, LSTM | speed = target/measured IBI, median of 3; 2 to 4 beat lag | WOLA stretch of a recording | fermata FSM | [22] |

## 7. Architecture: `ictus`, the conductor nodes, the orchestra, and the fixtures

This section is the design the PR plan implements. It follows #178 §6 as written and adds what §1 to §6 above settle: which detector, which update rule, which scheduler, which player.

### 7.1 Where `ictus` lives and what it is

`src/ictus/` is a pure, framework-agnostic TypeScript module: no imports from `src/dag`, `src/nodes`, `src/app` or React, no DOM, no clock of its own, no allocation on the hot path. It is written as a package-in-waiting (its own `README.md`, an `index.ts` facade, tests that import only from it), so extracting it to the `ictus` package #178 proposes is a move, not a rewrite. Everything is causal: no method needs the future, and every method takes the current time as an argument rather than reading a clock. The body epic (#186) consumes it through the same facade for pacing a song from a dancer's pulse, which is why it is the first build PR.

The pipeline is #178's, with each box now specified:

```
samples (t, x, y[, z]) at 30-60 Hz         one tracked point (wrist, index tip, or a pose keypoint)
        │
        ▼
[IctusDetector]        ──▶ Anchor { t, confidence, strength, kind }
        │                  peak deceleration into the turning point (§3), refined by parabolic
        │                  interpolation; confidence in noise units; refractory ~¼ period
        ▼
[RhythmPrior]          ──▶ predict(t) / update(anchor) / state()
        │                  v1: AdaptiveOscillator (Large-Kolen circle map with Antescofo's
        │                  adaptive κ, §2.1 + §2.5); later: KalmanTempo (§2.3), beam/agents (§2.2)
        ▼
[MusicalTime]          ──▶ the SSOT: { t, beat, phase, tempo, period, confidence, nextBeatAt,
        │                  beatsPerBar, beatInBar, state: 'ready'|'running'|'hold', leadOffset }
        ▼
[Consumers]                ScoreScheduler (§7.3), AudioPacer (§7.4), overlay, MIDI clock
```

**Anchors are observations with likelihoods.** `IctusDetector` never emits a beat; it emits a candidate, and `RhythmPrior.update` decides whether it confirms the predicted beat, signals a tempo change, or is noise, using the attentional pulse: an anchor far from the expected phase moves the state little when `κ` is high. A candidate below a confidence floor is dropped, not fed with low weight (Raphael's rule, §2.3).

**`RhythmPrior` is an injected dependency** with one interface: `predict(t): Prediction {expectedAt, window, phase}`, `update(anchor): void`, `advance(t): void`, `state(): MusicalTime`, `reset()`. The v1 backend is the adaptive oscillator because it is O(1), zero-latency and the literature's consensus starting point; the Kalman and multi-agent backends are the documented upgrade for octave errors and sudden jumps (Pardo's 54 to 65 bpm failure, §2.1). The oscillator's gains default to the human-fitted values (`W_φ ≈ 0.5`, `W_p ≈ 0.4`, §2.1) scaled by inter-beat interval (§2.7), with `κ` adapted from the circular dispersion of recent phase errors exactly as Antescofo does (§2.5), so confidence weighting needs no extra knob. On signs: §2.1 writes the correction as `φ − η_φ·F(φ)` and §2.5 as `φ + η_φ·F(φ − φ̂)`; the difference is notational (Large's `F` is odd in the phase error and Antescofo's takes the error relative to the expected phase). `src/ictus` uses one convention: the phase error `e = wrap(φ)` in (−0.5, 0.5] is positive when the anchor arrives late, the phase correction is `φ −= η_φ·c·e·g(e, κ)` and the period correction is toward the running mean of accepted intervals scaled by `1 + η_p·c·e·g(e, κ)`, with `g` the von Mises gate normalised to 1 on the beat.

**Beat-agnostic fallback is a mode, not an afterthought.** You're the Conductor's finding (§1.6) is that novices' beats are often not synchronous with anything. The existing `performance` node (hand height → bpm and dynamics) *is* that fallback. `MusicalTime.confidence` is what a consumer reads to blend between "follow the ictus" and "follow the speed", and the conductor node exposes the blend as a dial rather than hiding it.

**Meter and beat-in-bar** come from the horizontal displacement between successive ictus points (Green's invariants, §1.7): the downbeat is the beat whose approach was most vertical and whose ictus is lowest; 2, 3 and 4 patterns are distinguished by the sequence of lateral directions, run as competing profiles that promote after two consistent bars (conga's scheme, §1.5). This is a second PR, gated on the oscillator being solid; v1 sets `beatsPerBar` from the score.

**Dynamics and articulation** are separate, stateless estimators over the same samples: dynamics from the vertical excursion of the last stroke, exponentially normalised against the player's own recent range (the `EwPair` idiom in `src/features/ewMoments.ts`); articulation from the sharpness of the braking peak relative to the stroke's mean speed (the legato-staccato axis, §1.7), in noise units. Both are per-user by construction, which is what Sarasúa's result demands (§1.5).

**Two-clock discipline.** `ictus` is *driven* by the frame clock (each pose frame calls `feed`), but its outputs are functions of time: `MusicalTime.beatAt(t)` and `nextBeatAt` let the audio side evaluate the map at its own output timestamp (Dannenberg's regression-map trick, §6.1), which is how the 30 Hz frame rate stops being the timing resolution.

### 7.2 The conductor node

A single `conductor` node (roles `feature` and `mapping`) wraps `ictus`: input `hands` (the existing hands frame, so it fans out additively off `cam.hands` like `handVec` does), plus live inputs `config` (from a `conductor.*` dial group) and `scoreMeter` (beats per bar from the loaded score); outputs `time` (the `MusicalTime` object on a `musical-time` port with a `PortSpec.schema`), and scalars `bpm`, `beat`, `dynamics`, `articulation`, `confidence` for the overlay and for mapping. It replaces `performance → transport` in the conductor chain; both nodes stay registered for the non-conductor chain, but neither feeds `score` alongside the conductor node, because the engine rejects fan-in to a single input port. The degrade path lives *inside* the conductor node: when confidence is low it blends toward the beat-agnostic mapping (hand speed and size → tempo and dynamics, what `performance` computes) and integrates that tempo into the beat itself (what `transport` computes, `beat += bpm/60 · dt`), so `score` always reads one `beat` from one node, and that beat carries the phase correction the old integrated-bpm beat could not.

### 7.3 The score pipeline and scheduler

`ScoreDoc` is the Zod SSOT: `{ title, parts[{ id, name, program, notes[{ midi, start (beats), duration (beats), velocity, articulation? }] }], tempoMap[{ beat, bpm }], timeSignatures[{ beat, numerator, denominator }], dynamics[{ beat, part?, value }], fermatas[beat] }`. Two loaders sit behind one `loadScore(file | url): Promise<ScoreDoc>` facade, each a `lazyResource` from `src/lazy/` (the #188 pattern: the parser is never in the main chunk, and the loader publishes a `LoadStatus` the shared readout renders): `@tonejs/midi` for `.mid`, `musicxml-io` for `.musicxml` and `.mxl` (the `.mxl` unzip uses the `fflate` already in the bundle). A score is a collection the zodal way: `ScoreDoc` records in a `scores` collection over `@zodal/store-localstorage`, seeded with the demo pieces from §4.4 fetched on first use. The existing `score` node changes in one way: its `notes` param becomes the `ScoreDoc` reference plus a part selection, and it gains per-part output so each part can be routed to its section.

The scheduler is §6.3 made concrete, as a pure module `src/ictus/scheduler.ts` (no audio imports; it emits *commands* with context times): one pending event per part; every frame, for the next unplayed event at beat `B`, `T = tNow + (B − beatAt(tNow)) / tempo`, committed when `T < audioNow + H` with `H = outputLatency + 2 frame periods` (60 to 100 ms); committed starts are never moved; releases are scheduled lazily. Tempo reaches the scheduler through a servo with horizon Δt (default one beat, a dial); HOLD is entered when no ictus arrives within 1.4 expected inter-beat intervals and on a fermata beat marked conservative; in HOLD sounding notes sustain and tempo decays exponentially; HOLD is left by a preparatory beat (one clear ictus with a consistent period). The KTH final-ritard curve is the tempo process model when confidence is low.

### 7.4 The orchestra and the pacer

`src/nodes/output/orchestra.ts` is a `synth`-role node built on `lazyResource` (`src/lazy/`, [`docs/design/lazy-loading.md`](../design/lazy-loading.md)): the resource's `load` imports `spessasynth_lib`, adds its worklet module and fetches the self-hosted orchestral SF3 (§5.4), requested from `process()` when the enable input goes true and never awaited on the tick path; its `status` port speaks the shared `LoadStatus` (`off | unavailable | loading | ready | active | error`, with `progress` while the SF3 downloads) so the shared readout shows progress and the structural guard can assert the enable input is connected. Persisting the fetched SF3 in the Cache API so a reload does not re-download it is *new* work on top of that pattern (the design page explicitly leaves caching to a later step) and is scoped into the orchestra PR. It consumes scheduler commands (`noteOn/noteOff/cc` with times) and the conductor's `dynamics` as CC11 per section with a per-section low-pass; sections map to channels. `src/app/pacer/` (later, shared with #186) is the `AudioPacer`: a lazily imported `signalsmith-stretch` worklet, the recording's beat grid, and the servo of §6.7 evaluated at the audio output timestamp.

### 7.5 Fixtures and tests (no camera)

Conducting videos are fetched with `yb` into `~/.local/share/thoremin/videos/conducting/` (a `README.md` there records source URLs, excerpt times and the stated pattern and tempo) and reduced headlessly to hand-landmark NDJSON with `scripts/video_to_landmarks.py`; only small derived streams are committed under `test/fixtures/conducting_<pattern>/` in the existing shape. Three excerpts exist already: 4/4, 3/4 and 2/4 patterns at a *stated* 70 bpm with both hands in frame (13 to 18 s each), which gives a ground-truth tempo without any annotation, plus slower narrated demos. Tests: (1) `IctusDetector` on the 70 bpm streams emits anchors whose inter-onset intervals cluster at 0.857 s with F-measure above 0.9 against a synthetic grid at the stated tempo (a TypeScript port of the `mir_eval` F-measure, Cemgil and CMLt metrics, §2.8); (2) the oscillator locks within three beats on a synthetic ictus train, tracks a linear accelerando, survives a dropped anchor and a doubled anchor, and re-locks after a jump when the Kalman backend is selected; (3) `runHeadless` over the real `defaultGraph()` with `?slot.source=replay-hands` on the conducting fixture drives the `score` node so that a note sounds on most ticks and the beat is monotone; (4) the reachability tests (`tools_shell`, `app_shell`) cover the Conductor tool from a cold load; (5) a structural guard asserts the orchestra's `enabled` input and the conductor's `config` input are connected in `graph.ts`, the #147 pattern. What only a webcam can settle (feel, latency, whether the lead offset converges on a real person) goes on #146.

## 8. Decisions

1. **Ictus = peak deceleration into the turning point**, sub-frame interpolated, confidence in noise units, refractory a quarter period (§3). The vertical-velocity zero crossing is kept as a selectable cheaper detector for comparison on the fixtures.
2. **Tempo inference = adaptive oscillator with Antescofo's adaptive κ** as the v1 `RhythmPrior`; Kalman and multi-agent backends behind the same interface later (§2, §7.1).
3. **Beat-agnostic fallback stays**: `performance` (speed and size → tempo and dynamics) is blended in by confidence (§1.6, §7.1).
4. **Scheduler = pending-event with a short commit horizon and a Δt servo**, HOLD as a state with fermata support, preparatory-beat start (§6.3, §7.3). Firing at the predicted time; waiting for the ictus is reserved for events the score marks as hard sync points (Antescofo's `@tight`).
5. **Score parsing = `@tonejs/midi` and `musicxml-io`** behind a Zod `ScoreDoc`, both lazy; rendering deferred, cursor seam designed against `qstamp` lookup so OSMD or Verovio drops in (§4).
6. **Orchestra = `spessasynth_lib` in an AudioWorklet plus a self-hosted orchestral subset SF3 cut from MuseScore_General (MIT)**, target under 15 MB (to be measured once cut), cached on first use; CC11 plus a low-pass for continuous dynamics; VSCO-2-CE with CC1 crossfades as the premium path (§5.4).
7. **Audio pacing = `signalsmith-stretch`** (MIT, latency-compensated `schedule()`), shared with #186 through the same `MusicalTime` map; `HTMLMediaElement.preservesPitch` as the no-WASM fallback; no GPL Rubber Band (§6.6, §6.7).
8. **Demo content**: OpenScore quartets (CC0, MusicXML) and Mutopia's Beethoven 5 (public domain MIDI), the latter first because the KTH work used the same opening and its fermata exercises HOLD (§4.4).
9. **`src/ictus/` is pure and extraction-ready**, first build PR, consumed by #186 (§7.1).

Two things this document deliberately does not decide, because they need a person: the per-user lead offset and Δt defaults (they need a real conductor in front of a webcam, listed on #146), and whether the beat-pattern recogniser is worth its second PR before the body source lands (it depends on how the 70 bpm fixtures score, which the first PR will report).

## REFERENCES

[1] Mathews MV. The Radio Baton and Conductor Program, or: Pitch, the Most Important and Least Expressive Part of Music. Computer Music Journal. 1991;15(4):37–46. [DOI 10.2307/3681070](https://doi.org/10.2307/3681070); [Semantic Scholar](https://www.semanticscholar.org/paper/f08911e7929a8f0c94de41458aadb83b70721d87).

[2] Boie R, Mathews M, Schloss A. The Radio Drum as a Synthesizer Controller. Proc. ICMC 1989, Columbus OH; p. 42–5. [CCRMA Radio Baton page](https://ccrma.stanford.edu/radiobaton/) (proceedings PDF unverified).

[3] Morita H, Hashimoto S, Ohteru S. A Computer Music System that Follows a Human Conductor. IEEE Computer. 1991 Jul;24(7):44–53. [DOI 10.1109/2.84835](https://doi.org/10.1109/2.84835); [Waseda record](https://waseda.elsevierpure.com/en/publications/a-computer-music-system-that-follows-a-human-conductor/). Earlier version: Computer Music System Which Follows a Human Conductor, Proc. ICMC 1989 ([ICMC archive](https://quod.lib.umich.edu/i/icmc/bbp2372.1989.050)).

[4] Marrin T, Picard R. The "Conductor's Jacket": A Device for Recording Expressive Musical Gestures. Proc. ICMC 1998. [Semantic Scholar](https://www.semanticscholar.org/paper/5bc65c6dfe299c941e478514f007e9da1e436040).

[5] Marrin Nakra T. Inside the Conductor's Jacket: Analysis, Interpretation and Musical Synthesis of Expressive Gesture [PhD thesis]. MIT Media Lab; 2000. MIT Media Lab TR-518. [PDF](https://vismod.media.mit.edu/pub/tech-reports/TR-518.pdf); [DSpace](https://dspace.mit.edu/entities/publication/15931178-7b40-4ae7-9ca7-8d5893b77a38).

[6] Ilmonen T, Takala T. Conductor Following With Artificial Neural Networks. Proc. ICMC 1999, Beijing; p. 367–70. Listed in [Takala's publication list](https://www.cs.hut.fi/~tta/publications/index.html); [ResearchGate](https://www.researchgate.net/publication/2607049_Conductor_Following_With_Artificial_Neural_Networks) (full text unverified).

[7] Murphy D, Andersen TH, Jensen K. Conducting Audio Files via Computer Vision. In: Gesture-Based Communication in Human-Computer Interaction (GW 2003), LNCS 2915. Springer; 2004. [DOI 10.1007/978-3-540-24598-8_49](https://doi.org/10.1007/978-3-540-24598-8_49).

[8] Borchers J, Lee E, Samminger W, Mühlhäuser M. Personal Orchestra: A Real-Time Audio/Video System for Interactive Conducting. Multimedia Systems. 2004;9(5):458–65. [DOI 10.1007/s00530-003-0119-y](https://doi.org/10.1007/s00530-003-0119-y); [author PDF](https://hci.rwth-aachen.de/publications/borchers2004a.pdf).

[9] Lee E, Marrin Nakra T, Borchers J. You're The Conductor: A Realistic Interactive Conducting System for Children. Proc. NIME 2004, Hamamatsu. [Zenodo](https://zenodo.org/records/1176629); [author PDF](https://hci.rwth-aachen.de/publications/lee2004a.pdf).

[10] Lee E, Grüll I, Kiel H, Borchers J. conga: A Framework for Adaptive Conducting Gesture Analysis. Proc. NIME 2006, Paris; p. 260–5. [NIME PDF](https://www.nime.org/proceedings/2006/nime2006_260.pdf); [Zenodo](https://zenodo.org/records/1176957).

[11] Lee E, Kiel H, Dedenbach S, et al. iSymphony: An Adaptive Interactive Orchestral Conducting System for Digital Audio and Video Streams. CHI 2006 Extended Abstracts. [DOI 10.1145/1125451.1125507](https://doi.org/10.1145/1125451.1125507).

[12] Lee E, Karrer T, Borchers J. Toward a Framework for Interactive Systems to Conduct Digital Audio and Video Streams. Computer Music Journal. 2006;30(1):21–36. [DOI 10.1162/014892606776021317](https://doi.org/10.1162/014892606776021317); [author PDF](https://hci.rwth-aachen.de/publications/lee2006a.pdf).

[13] Kolesnik P, Wanderley M. Recognition, Analysis and Performance with Expressive Conducting Gestures. Proc. ICMC 2004, Miami. [ICMC archive](https://quod.lib.umich.edu/i/icmc/bbp2372.2004.139?rgn=main;view=fulltext); [IDMIL PDF](https://www-archive.idmil.org/_media/publications/2004/kolesnik_2004_icmc.pdf) (both links found via search; fetch blocked from this session).

[14] Kolesnik P. Conducting Gesture Recognition, Analysis and Performance System [MA thesis]. McGill University; 2004. [eScholarship@McGill](https://mcgill.scholaris.ca/items/1a1b3095-bd73-4e07-820e-5d648e81fb0a); [IDMIL project page](https://www.idmil.org/project/conducting-gesture-recognition/).

[15] Bevilacqua F, Zamborlin B, Sypniewski A, Schnell N, Guédy F, Rasamimanana N. Continuous Realtime Gesture Following and Recognition. In: Gesture in Embodied Communication and HCI, LNCS 5934. Springer; 2010. p. 73–84. [DOI 10.1007/978-3-642-12553-9_7](https://doi.org/10.1007/978-3-642-12553-9_7); [HAL](https://hal.science/hal-01106955).

[16] Bradshaw D, Ng K. Analyzing a Conductor's Gestures with the Wiimote. Proc. EVA London 2008. [PDF](https://pdfs.semanticscholar.org/4e42/f2d7396966a75a14765aedcee60ed07ba2d6.pdf).

[17] Peng L, Gerhard D. A Wii-Based Gestural Interface for Computer Conducting Systems. Proc. NIME 2009, Pittsburgh. [NIME PDF](https://www.nime.org/proceedings/2009/nime2009_155.pdf). Companion: A Gestural Interface for Orchestral Conducting Education, Proc. CSEDU 2009; p. 406–9. [PDF](https://www2.cs.uregina.ca/~gerhard/publications/CSEDU_2009_111_CR_revised.pdf).

[18] Baba T, Hashida M, Katayose H. "VirtualPhilharmony": A Conducting System with Heuristics of Conducting an Orchestra. Proc. NIME 2010, Sydney; p. 263–70. [NIME PDF](https://www.nime.org/proceedings/2010/nime2010_263.pdf); [Zenodo](https://zenodo.org/records/1177715).

[19] Höfer A, Hadjakos A, Mühlhäuser M. Gyroscope-Based Conducting Gesture Recognition. Proc. NIME 2009, Pittsburgh. [NIME PDF](https://www.nime.org/proceedings/2009/nime2009_175.pdf).

[20] Sarasúa Á, Guaus E. Dynamics in Music Conducting: A Computational Comparative Study Among Subjects. Proc. NIME 2014, London; p. 195–200. [NIME PDF](https://www.nime.org/proceedings/2014/nime2014_464.pdf).

[21] Fahn C-S, Lee S-E, Wu M-L. Real-Time Musical Conducting Gesture Recognition Based on a Dynamic Time Warping Classifier Using a Single-Depth Camera. Applied Sciences. 2019;9(3):528. [DOI 10.3390/app9030528](https://doi.org/10.3390/app9030528).

[22] Mermerci M, Pascoe E, Edström F, Kjellström H. Real-Time Control of a Virtual Orchestra by Recognition of Conducting Gestures. arXiv:2604.27957 [cs]; 30 Apr 2026. [arXiv abs](https://arxiv.org/abs/2604.27957); [HTML](https://arxiv.org/html/2604.27957v1).

[23] Luck G, Toiviainen P. Ensemble Musicians' Synchronization With Conductors' Gestures: An Automated Feature-Extraction Analysis. Music Perception. 2006;24(2):189–200. [DOI 10.1525/mp.2006.24.2.189](https://doi.org/10.1525/mp.2006.24.2.189).

[24] Luck G, Sloboda JA. Spatio-Temporal Cues for Visually Mediated Synchronization. Music Perception. 2009;26(5):465–73. [UC Press](https://online.ucpress.edu/mp/article-abstract/26/5/465/62442/Spatio-Temporal-Cues-for-Visually-Mediated).

[25] Wöllner C, Deconinck FJA, Parkinson J, Hove MJ, Keller PE. The Perception of Prototypical Motion: Synchronization Is Enhanced With Quantitatively Morphed Gestures of Musical Conductors. J Exp Psychol Hum Percept Perform. 2012;38(6):1390–403. [PubMed](https://www.ncbi.nlm.nih.gov/pubmed/22506779); [DOI 10.1037/a0028130](https://doi.org/10.1037/a0028130).

[26] Meals CD. The Question of Lag: An Exploration of the Relationship Between Conductor Gesture and Sonic Response in Instrumental Ensembles. Front Psychol. 2020;11:573030. [DOI 10.3389/fpsyg.2020.573030](https://doi.org/10.3389/fpsyg.2020.573030); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7758255/).

[27] Dansereau DG, Brock N, Cooperstock JR. Predicting an Orchestral Conductor's Baton Movements Using Machine Learning. Computer Music Journal. 2013;37(2):28–45. [MIT Press](https://direct.mit.edu/comj/article/37/2/28/94423/Predicting-an-Orchestral-Conductor-s-Baton); [author PDF](http://www-personal.acfr.usyd.edu.au/ddan1654/Dansereau-Brock-Cooperstock2013.pdf).

[28] Sarasúa Á, Caramiaux B, Tanaka A. Machine Learning of Personal Gesture Variation in Music Conducting. Proc. CHI 2016; p. 3428–32. [DOI 10.1145/2858036.2858328](https://doi.org/10.1145/2858036.2858328).

[29] Huang Y-F, Chen T-P, Moran N, Coleman S, Su L. Identifying Expressive Semantics in Orchestral Conducting Kinematics. Proc. ISMIR 2019, Delft; p. 115–22. [ISMIR PDF](https://archives.ismir.net/ismir2019/paper/000011.pdf).

[30] Wei BT, Almeda SG, Shen S, Tam E, Abrahamson D. Sympathetic Orchestra: A Responsive Virtual Orchestra for Embodied Interpretive Practice in Conducting. CHI 2026 Extended Abstracts. [DOI 10.1145/3772363.3798418](https://doi.org/10.1145/3772363.3798418); [project page](https://bobtianqiwei.com/works/sympathetic-orchestra/).

[31] Wei BT, et al. Demonstration of Sympathetic Orchestra: An Interactive Conducting Education System for Responsive, Tacit Skill Development. UIST 2024 Adjunct. [DOI 10.1145/3672539.3686783](https://doi.org/10.1145/3672539.3686783).

[32] Rudolf M. The Grammar of Conducting: A Comprehensive Guide to Baton Technique and Interpretation. 3rd ed. Schirmer; 1994 (1st ed. 1950). [Internet Archive](https://archive.org/details/grammarofconduct0000rudo).

[33] Green EAH, Gibson M. The Modern Conductor. 7th ed. Pearson/Prentice Hall; 2004 (1st ed. 1961). [Google Books](https://books.google.com/books/about/The_Modern_Conductor.html?id=Q2MJAQAAMAAJ).

[34] Lemouton S, Borghesi R, Haapamäki S, Bevilacqua F, Fléty E. Following Orchestra Conductors: the IDEA Open Movement Dataset. Proc. MOCO 2019, Tempe. [DOI 10.1145/3347122.3359599](https://doi.org/10.1145/3347122.3359599); [HAL](https://hal.science/hal-02469891).

[35] Chen D, Liu F, Li Z, Xu F. VirtualConductor: Music-driven Conducting Video Generation System. IEEE ICME 2021 demo (Best Demo Award). [arXiv 2108.04350](https://arxiv.org/abs/2108.04350).

[36] ConductorMotion100 dataset and code. [GitHub: ChenDelong1999/VirtualConductor](https://github.com/ChenDelong1999/VirtualConductor).

[37] Sarasúa Á, Guaus E. Beat Tracking from Conducting Gestural Data: A Multi-Subject Study. Proc. MOCO 2014, Paris. [DOI 10.1145/2617995.2618016](https://doi.org/10.1145/2617995.2618016) (existence verified via Semantic Scholar; method details not retrieved).

[38] Large EW, Kolen JF. Resonance and the perception of musical meter. Connection Science. 1994;6(2-3):177-208. [doi:10.1080/09540099408915723](https://doi.org/10.1080/09540099408915723)

[39] Large EW. Periodicity, pattern formation, and metric structure. Journal of New Music Research. 2001;30(2):173-185. [Author PDF (Music Dynamics Lab)](https://musicdynamicslab.uconn.edu/wp-content/uploads/sites/433/2016/03/Large2001PubsAHEdits.pdf)

[40] Cont A. A coupled duration-focused architecture for real-time music-to-score alignment. IEEE Trans. Pattern Analysis and Machine Intelligence. 2010;32(6):974-987. [doi:10.1109/TPAMI.2009.106](https://doi.org/10.1109/TPAMI.2009.106); [HAL PDF](https://hal.science/hal-00479737v1/document)

[41] Large EW, Jones MR. The dynamics of attending: how people track time-varying events. Psychological Review. 1999;106(1):119-159. [doi:10.1037/0033-295X.106.1.119](https://doi.org/10.1037/0033-295X.106.1.119)

[42] Cemgil AT, Kappen B, Desain P, Honing H. On tempo tracking: tempogram representation and Kalman filtering. Journal of New Music Research. 2000;29(4):259-273. [doi:10.1080/09298210008565462](https://doi.org/10.1080/09298210008565462); ICMC 2000 version [PDF](https://www.mcg.uva.nl/mcg-2023/papers/mmm-27.pdf)

[43] Toiviainen P. An interactive MIDI accompanist. Computer Music Journal. 1998;22(4):63-75. [doi:10.2307/3680894](https://doi.org/10.2307/3680894)

[44] McAuley JD, Jones MR. Modeling effects of rhythmic context on perceived duration: a comparison of interval and entrainment approaches to short-interval timing. Journal of Experimental Psychology: Human Perception and Performance. 2003;29(6):1102-1125. [doi:10.1037/0096-1523.29.6.1102](https://doi.org/10.1037/0096-1523.29.6.1102); [PDF](https://taplab.psy.msu.edu/wp-content/uploads/2020/07/McAuley-Jones-2003.pdf)

[45] Pardo B. Tempo tracking with a single oscillator. In: Proc. ISMIR 2004, Barcelona. [ISMIR archive PDF](https://archives.ismir.net/ismir2004/paper/000206.pdf)

[46] Allen PE, Dannenberg RB. Tracking musical beats in real time. In: Proc. ICMC 1990, Glasgow; p. 140-143 (extended version). [CMU PDF](https://www.cs.cmu.edu/~rbd/papers/beattrack.pdf). Restates Dannenberg RB, Mont-Reynaud B. Following an improvisation in real time. Proc. ICMC 1987; p. 241-248.

[47] Dixon S. Automatic extraction of tempo and beat from expressive performances. Journal of New Music Research. 2001;30(1):39-58. [doi:10.1076/jnmr.30.1.39.7119](https://doi.org/10.1076/jnmr.30.1.39.7119); [OFAI TR-2001-19 PDF](https://ofai.at/papers/oefai-tr-2001-19.pdf)

[48] Dixon S. Evaluation of the audio beat tracking system BeatRoot. Journal of New Music Research. 2007;36(1):39-50. [doi:10.1080/09298210701653310](https://doi.org/10.1080/09298210701653310)

[49] Rowe R. Interactive Music Systems: Machine Listening and Composing. Cambridge, MA: MIT Press; 1993. Chapter 5, Machine Listening (Beat Tracking). [Author's online text](https://wp.nyu.edu/robert_rowe/text/interactive-music-systems-1993/chapter5/)

[50] Raphael C. Music Plus One and machine learning. In: Proc. ICML 2010; p. 21-28. [ICML PDF](https://icml.cc/Conferences/2010/papers/904.pdf)

[51] Hainsworth SW, Macleod MD. Particle filtering applied to musical tempo tracking. EURASIP Journal on Advances in Signal Processing. 2004;2004:927847. [doi:10.1155/S1110865704408099](https://doi.org/10.1155/S1110865704408099) (abstract verified; full text not retrieved)

[52] Shiu Y, Kuo C-CJ. On-line musical beat tracking with phase-locked-loop (PLL) technique. In: 2007 Digest of Technical Papers, IEEE International Conference on Consumer Electronics. [doi:10.1109/ICCE.2007.341369](https://doi.org/10.1109/ICCE.2007.341369); [IEEE Xplore 4145989](https://ieeexplore.ieee.org/document/4145989)

[53] Meier P, Chiu C-Y, Müller M. A real-time beat tracking system with zero latency and enhanced controllability. Transactions of the ISMIR. 2024. [doi:10.5334/tismir.189](https://doi.org/10.5334/tismir.189)

[54] Dannenberg RB. An on-line algorithm for real-time accompaniment. In: Proc. ICMC 1984, Paris; p. 193-198. [Author PDF (CMU)](https://www.cs.cmu.edu/~rbd/papers/icmc84accomp.pdf); [Michigan Publishing archive](https://quod.lib.umich.edu/i/icmc/bbp2372.1984.025/1)

[55] Orio N, Déchelle F. Score following using spectral analysis and hidden Markov models. In: Proc. ICMC 2001. See also Orio N, Lemouton S, Schwarz D. Score following: state of the art and new developments. Proc. NIME 2003. [NIME PDF](https://www.nime.org/proceedings/2003/nime2003_036.pdf) (unverified)

[56] Raphael C. Automatic segmentation of acoustic musical signals using hidden Markov models. IEEE Trans. Pattern Analysis and Machine Intelligence. 1999;21(4):360-370. [doi:10.1109/34.761266](https://doi.org/10.1109/34.761266)

[57] Raphael C. A probabilistic expert system for automatic musical accompaniment. Journal of Computational and Graphical Statistics. 2001;10(3):487-512. [doi:10.1198/106186001317115081](https://doi.org/10.1198/106186001317115081)

[58] Cont A, Schwarz D, Schnell N, Raphael C. Evaluation of real-time audio-to-score alignment. In: Proc. ISMIR 2007, Vienna. [ISMIR PDF](https://ismir2007.ismir.net/proceedings/ISMIR2007_p315_cont.pdf)

[59] Cont A. Antescofo: anticipatory synchronization and control of interactive parameters in computer music. In: Proc. ICMC 2008, Belfast; p. 33-40. [HAL hal-00694803](https://hal.inria.fr/hal-00694803) (unverified: HAL page not fetched; Michigan archive returns 403)

[60] Grüll I. conga: A Conducting Gesture Analysis Framework [Diplomarbeit]. Universität Ulm / RWTH Aachen Media Computing Group; 2005. [PDF](https://hci.rwth-aachen.de/publications/gruell2005a.pdf)

[61] PHENICX consortium (UPF). D4.4 Methods for recognising performer's gestures from visual live recording data, v1.1; 2014. [CORDIS PDF](https://cordis.europa.eu/docs/projects/cnect/6/601166/080/deliverables/001-PHENICXDWP4UPFD44Methodsforrecognizingperformer039sgesturesfromvisualliverecordingdatav11.pdf)

[62] Smith JO. Quadratic interpolation of spectral peaks. In: Spectral Audio Signal Processing. CCRMA, Stanford. [Online](https://ccrma.stanford.edu/~jos/sasp/Quadratic_Interpolation_Spectral_Peaks.html)

[63] Repp BH. Sensorimotor synchronization: a review of the tapping literature. Psychonomic Bulletin & Review. 2005;12(6):969-992. [doi:10.3758/BF03206433](https://doi.org/10.3758/BF03206433)

[64] Repp BH, Su Y-H. Sensorimotor synchronization: a review of recent research (2006-2012). Psychonomic Bulletin & Review. 2013;20(3):403-452. [doi:10.3758/s13423-012-0371-2](https://doi.org/10.3758/s13423-012-0371-2)

[65] Mates J. A model of synchronization of motor acts to a stimulus sequence. I. Timing and error corrections; II. Stability analysis, error estimation and simulations. Biological Cybernetics. 1994;70:463-473 and 475-484. [doi:10.1007/BF00203240](https://doi.org/10.1007/BF00203240); [doi:10.1007/BF00197323](https://doi.org/10.1007/BF00197323)

[66] Vorberg D, Wing A. Modeling variability and dependence in timing. In: Heuer H, Keele SW, editors. Handbook of Perception and Action, Vol. 2. Academic Press; 1996. p. 181-262. [doi:10.1016/S1874-5822(06)80007-1](https://doi.org/10.1016/S1874-5822(06)80007-1)

[67] Vorberg D, Schulze H-H. Linear phase-correction in synchronization: predictions, parameter estimation, and simulations. Journal of Mathematical Psychology. 2002;46(1):56-87. [doi:10.1006/jmps.2001.1375](https://doi.org/10.1006/jmps.2001.1375)

[68] Repp BH, Keller PE. Adaptation to tempo changes in sensorimotor synchronization: effects of intention, attention, and awareness. Quarterly Journal of Experimental Psychology A. 2004;57(3):499-521. [doi:10.1080/02724980343000369](https://doi.org/10.1080/02724980343000369)

[69] Davies MEP, Degara N, Plumbley MD. Evaluation methods for musical audio beat tracking algorithms. Technical Report C4DM-TR-09-06, Queen Mary University of London; 2009. [Semantic Scholar record](https://www.semanticscholar.org/paper/4f8ad740cd13c705c7456cd19eb2bf748554800a) (QMUL PDF link currently redirects; metrics verified via the mir_eval source)

[70] Raffel C, McFee B, Humphrey EJ, Salamon J, Nieto O, Liang D, Ellis DPW. mir_eval: a transparent implementation of common MIR metrics. In: Proc. ISMIR 2014. [ISMIR PDF](https://archives.ismir.net/ismir2014/paper/000320.pdf); beat module source [mir_eval/beat.py](https://github.com/mir-evaluation/mir_eval/blob/main/mir_eval/beat.py)

[71] Large EW, Herrera JA, Velasco MJ. Neural networks for beat perception in musical rhythm. Frontiers in Systems Neuroscience. 2015;9:159. [doi:10.3389/fnsys.2015.00159](https://doi.org/10.3389/fnsys.2015.00159)

[72] [Tonejs/Midi — README](https://github.com/Tonejs/Midi) · [npm @tonejs/midi](https://www.npmjs.com/package/@tonejs/midi)

[73] [carter-thaxton/midi-file — README](https://github.com/carter-thaxton/midi-file) · [npm midi-file](https://www.npmjs.com/package/midi-file)

[74] [npm midi-parser-js](https://www.npmjs.com/package/midi-parser-js) (registry-verified; GPL)

[75] [npm midifile](https://www.npmjs.com/package/midifile) (registry-verified)

[76] [chrisguttandin/midi-json-parser — README and src/module.ts](https://github.com/chrisguttandin/midi-json-parser)

[77] [npm webmidi (WEBMIDI.js)](https://www.npmjs.com/package/webmidi) (registry-verified)

[78] [tan-z-tan/musicxml-io — README](https://github.com/tan-z-tan/musicxml-io) · [npm musicxml-io](https://www.npmjs.com/package/musicxml-io)

[79] [npm xml-js](https://www.npmjs.com/package/xml-js) (registry-verified)

[80] [jocelyn-stericker/musicxml-interfaces — README (AGPL)](https://github.com/jocelyn-stericker/musicxml-interfaces)

[81] [stringsync/musicxml — README](https://github.com/stringsync/musicxml)

[82] [OSMD Cursor.ts (develop)](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/blob/develop/src/OpenSheetMusicDisplay/Cursor.ts) · [OSMD classdoc: Cursor](https://opensheetmusicdisplay.github.io/classdoc/classes/Cursor.html)

[83] [OSMD MusicPartManagerIterator.ts (develop)](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/blob/develop/src/MusicalScore/MusicParts/MusicPartManagerIterator.ts)

[84] [OSMD blog — "OSMD Audio Player upgraded" (PlaybackManager is in the sponsor-only player)](https://opensheetmusicdisplay.org/blog/blog-audio-player-upgraded/) (unverified — from search snippet)

[85] [opensheetmusicdisplay/osmd-types-player](https://github.com/opensheetmusicdisplay/osmd-types-player) (unverified — from search)

[86] [Verovio reference book — Toolkit methods](https://book.verovio.org/toolkit-reference/toolkit-methods.html); timemap/`getElementsAtTime` field names verified in [src/timemap.cpp and src/toolkit.cpp](https://github.com/rism-digital/verovio)

[87] [npm verovio](https://www.npmjs.com/package/verovio) (registry-verified) · [Verovio npm README](https://github.com/rism-digital/verovio/blob/develop/emscripten/npm/README.md)

[88] [Verovio reference book — JavaScript and WebAssembly](https://book.verovio.org/installing-or-building-from-sources/javascript-and-webassembly.html)

[89] [rism-digital/verovio Discussion #2791 — "Ultralightweight version of Verovio?"](https://github.com/rism-digital/verovio/discussions/2791)

[90] [alphaTab — Low-level APIs](https://www.alphatab.net/docs/guides/lowlevel-apis)

[91] [alphaTab — Audio & Video Sync guide](https://alphatab.net/docs/guides/audio-video-sync)

[92] [CoderLine/alphaTab Issue #1961 — External Audio Cursor API (milestone 1.6.0)](https://github.com/CoderLine/alphaTab/issues/1961)

[93] [alphaTab API reference — tickPosition](https://www.alphatab.net/docs/reference/api/tickposition)

[94] [abcjs docs — Timing Callbacks](https://docs.abcjs.net/animation/timing-callbacks.html)

[95] [cuthbertLab/music21j — README](https://github.com/cuthbertLab/music21j)

[96] [npm vexflow](https://www.npmjs.com/package/vexflow) (registry-verified)

[97] [OpenScore/StringQuartets](https://github.com/OpenScore/StringQuartets) (CC0-1.0; tree verified via GitHub API)

[98] [OpenScore/Lieder](https://github.com/OpenScore/Lieder) (CC0-1.0; tree verified via GitHub API)

[99] [music-encoding/sample-encodings](https://github.com/music-encoding/sample-encodings) (ECL-2.0; `MEI_5.0/Music/Complete_examples` listing verified via GitHub API)

[100] [Mutopia Project — search "Symphony"](https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=Symphony) · [K.525 listing](https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=Eine+kleine+Nachtmusik)

[101] [MusicXML — Example Sets](https://www.musicxml.com/music-in-musicxml/example-set/)

[102] [craigsapp/bach-370-chorales — LICENSE.txt (CC BY-NC-SA 4.0)](https://github.com/craigsapp/bach-370-chorales)

[103] [craigsapp/beethoven-string-quartets](https://github.com/craigsapp/beethoven-string-quartets) (no license file)

[104] [music21 corpus — license.txt](https://github.com/cuthbertLab/music21/tree/master/music21/corpus)

[105] [sgossner/VCSL — GitHub](https://github.com/sgossner/VCSL)

[106] [smpldsnds/sgossner-vcsl `sfz_files.json` (instrument index)](https://smpldsnds.github.io/sgossner-vcsl/sfz_files.json)

[107] [VSCO 2 Community Edition — Versilian Studios](https://versilian-studios.com/vsco-community/)

[108] [sgossner/VSCO-2-CE — GitHub](https://github.com/sgossner/VSCO-2-CE)

[109] [froos/sfumato — Codeberg](https://codeberg.org/froos/sfumato)

[110] [danigb/smplr — GitHub](https://github.com/danigb/smplr)

[111] [smplr README (raw)](https://raw.githubusercontent.com/danigb/smplr/main/README.md)

[112] [smplr `src/versilian.ts` — VCSL base URL and index](https://github.com/danigb/smplr/blob/main/src/versilian.ts)

[113] [surikov/webaudiofont — GitHub](https://github.com/surikov/webaudiofont)

[114] [WebAudioFontPlayer.js source (envelope/loop code)](https://raw.githubusercontent.com/surikov/webaudiofont/master/npm/dist/WebAudioFontPlayer.js)

[115] [Tone.js 15.1.22 Sampler docs](https://tonejs.github.io/docs/15.1.22/classes/Sampler.html)

[116] [magenta-js `soundfont.ts` (SoundFontPlayer)](https://github.com/magenta/magenta-js/blob/master/music/src/core/soundfont.ts)

[117] [sgm_plus `soundfont.json` on Google Cloud Storage](https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus/soundfont.json)

[118] [sfztools/sfizz-webaudio — GitHub](https://github.com/sfztools/sfizz-webaudio)

[119] [sfzlab/sfz-web-player — GitHub](https://github.com/sfzlab/sfz-web-player)

[120] [spessasus/spessasynth_lib — GitHub](https://github.com/spessasus/spessasynth_lib)

[121] [spessasynth_lib docs — Basic Synthesizer (eventOptions.time)](https://spessasus.github.io/spessasynth_lib/synthesizer/basic-synthesizer/)

[122] [jet2jet/js-synthesizer — GitHub](https://github.com/jet2jet/js-synthesizer)

[123] [MuseScore_General directory on OSUOSL mirror](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/)

[124] [MuseScore_General_License.md (MIT; FluidR3 COPYING)](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md)

[125] [gleitz/midi-js-soundfonts — GitHub](https://github.com/gleitz/midi-js-soundfonts)

[126] [jsDelivr mirror of gleitz FluidR3_GM string_ensemble_1-mp3.js (verified 200, 2,803,855 B)](https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/string_ensemble_1-mp3.js)

[127] [peastman/sso — Sonatina Symphonic Orchestra](https://github.com/peastman/sso)

[128] [SSO README (raw; control system, licence)](https://raw.githubusercontent.com/peastman/sso/master/README.md)

[129] [GeneralUser GS licence (repo documentation/LICENSE.txt)](https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt)

[130] [Philharmonia — Sound samples (licence text)](https://philharmonia.co.uk/resources/sound-samples/)

[131] [skratchdot/philharmonia-samples mirror](https://github.com/skratchdot/philharmonia-samples)

[132] [Salamander Grand Piano — sfzinstruments](https://sfzinstruments.github.io/pianos/salamander/)

[133] [sfzformat.com — xfin_loccN / xfin_hiccN](https://sfzformat.com/opcodes/xfin_loccN/)

[134] Fabiani M, Friberg A. Influence of pitch, loudness, and timbre on the perception of instrument dynamics. J Acoust Soc Am. 2011;130(4):EL193–EL199. doi:10.1121/1.3633687. [JASA](https://pubs.aip.org/asa/jasa/article/130/4/EL193/644293/Influence-of-pitch-loudness-and-timbre-on-the) (unverified: URL from search results, not fetched)

[135] Schubert E, Wolfe J, Tarnopolsky A. Spectral centroid and timbre in complex, multiple instrumental textures. ICMPC8, 2004. [PDF](https://newt.phys.unsw.edu.au/jw/reprints/SchWolTarICMPC8.pdf) (unverified: URL from search results, not fetched)

[136] Wilson C. A Tale of Two Clocks — Scheduling Web Audio with Precision. [web.dev](https://web.dev/articles/audio-scheduling)

[137] [MDN — AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)

[138] [MDN — BaseAudioContext.decodeAudioData()](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)

[139] Adenot P. Web Audio API performance and debugging notes. [padenot.github.io](https://padenot.github.io/web-audio-perf/)

[140] [MDN — Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache)

[141] [MDN — Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

[142] [jsDelivr — GitHub endpoint limits (README)](https://github.com/jsdelivr/jsdelivr)

[143] Dannenberg RB, Raphael C. [Music score alignment and computer accompaniment](https://www.cs.cmu.edu/~rbd/papers/accompaniment-cacm-06.pdf). Communications of the ACM 2006;49(8):38–43.

[144] Raphael C. [Demonstration of "Music Plus One" — A System for Orchestral Musical Accompaniment](https://www.ee.columbia.edu/~dpwe/ismir2004/CRFILES/paper176.pdf). ISMIR 2004.

[145] Cont A, Echeveste J, Giavitto J-L, Jacquemard F. [Correct Automatic Accompaniment Despite Machine Listening or Human Errors in Antescofo](https://hal.science/hal-00718854). Proc. ICMC 2012. (full text: fetch blocked; abstract via HAL API)

[146] IRCAM. [Antescofo Reference — Synchronization Strategies](https://antescofo-doc.ircam.fr/Reference/time_synchro/).

[147] Dannenberg RB. [A Virtual Orchestra for Human-Computer Music Performance](https://www.cs.cmu.edu/~rbd/papers/Virtual-Orchestra-ICMC-2011.pdf). Proc. ICMC 2011, pp. 185–188.

[148] RWTH Media Computing Group. [Personal Orchestra project page](https://hci.rwth-aachen.de/po).

[149] Nakra TM, Ivanov Y, Smaragdis P, Ault C. [The UBS Virtual Maestro: an Interactive Conducting System](https://www.nime.org/proceedings/2009/nime2009_250.pdf). Proc. NIME 2009, pp. 250–255.

[150] Todd N. [A Model of Expressive Timing in Tonal Music](https://continuum-hypothesis.com/music/todd.pdf). Music Perception 1985;3(1):33–57.

[151] Todd NPM. [The kinematics of musical expression](https://pubs.aip.org/asa/jasa/article-abstract/97/3/1940/838457/). J. Acoust. Soc. Am. 1995;97(3):1940–1949 (the "1992" model; JASA 1992;91(6):3540 is "The dynamics of dynamics"). (fetch blocked)

[152] Friberg A, Sundberg J. [Does music performance allude to locomotion? A model of final ritardandi derived from measurements of stopping runners](https://pubs.aip.org/asa/jasa/article-abstract/105/3/1469/558501/). J. Acoust. Soc. Am. 1999;105(3):1469–1484. (fetch blocked)

[153] Friberg A, Bresin R, Sundberg J. [Overview of the KTH rule system for musical performance](https://continuum-hypothesis.com/music/kth.pdf). Advances in Cognitive Psychology 2006;2(2–3):145–161.

[154] Friberg A, Colombo V, Frydén L, Sundberg J. Director Musices: The KTH Performance Rules System. ([DiVA PDF](https://www.diva-portal.org/smash/get/diva2:1246181/FULLTEXT01.pdf) — connection failed during check; unverified)

[155] Sullivan J. [Alternatives to Lookahead Audio Scheduling](https://repository.gatech.edu/entities/publication/ac112129-16e6-44b3-872b-ed063a32a5df). Web Audio Conference 2016, Atlanta.

[156] MDN. [AudioContext: getOutputTimestamp() method](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp).

[157] Tone.js. [Tone/core/clock/Transport.ts](https://github.com/Tonejs/Tone.js/blob/dev/Tone/core/clock/Transport.ts) (dev branch).

[158] Tone.js. [Tone/core/clock/TickParam.ts](https://github.com/Tonejs/Tone.js/blob/dev/Tone/core/clock/TickParam.ts).

[159] Tone.js. [Tone/core/clock/TickSource.ts](https://github.com/Tonejs/Tone.js/blob/dev/Tone/core/clock/TickSource.ts).

[160] MDN. [HTMLMediaElement: preservesPitch property](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch).

[161] Chromium. [media/filters/audio_renderer_algorithm.cc](https://chromium.googlesource.com/chromium/src/+/main/media/filters/audio_renderer_algorithm.cc) (main).

[162] Chromium. [third_party/blink/renderer/core/html/media/html_media_element.h](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/media/html_media_element.h) (`kMinPlaybackRate = 0.0625`, `kMaxPlaybackRate = 16.0`).

[163] blink-dev. [Intent to Implement and Ship: HTMLMediaElement.preservesPitch](https://groups.google.com/a/chromium.org/g/blink-dev/c/XVCt0EXVplQ/m/sDyHmylZAgAJ). June 2020.

[164] Mozilla Bugzilla. [Bug 495040 — Implement playbackRate and related bits](https://bugzilla.mozilla.org/show_bug.cgi?id=495040).

[165] WebKit. [MediaSessionManagerCocoa.mm — audioTimePitchAlgorithmForMediaPlayerPitchCorrectionAlgorithm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm).

[166] WebKit Bugzilla. [Bug 240405 — preservesPitch=false and playbackRate aren't correctly handled when hooked up to AudioContext](https://bugs.webkit.org/show_bug.cgi?id=240405) (fixed 2026-03-27).

[167] MDN. [AudioBufferSourceNode: playbackRate property](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate).

[168] Signalsmith Audio. [Signalsmith Stretch — Web Audio release (README in npm `signalsmith-stretch`)](https://github.com/Signalsmith-Audio/signalsmith-stretch).

[169] Signalsmith Audio. [Signalsmith Stretch (C++ library page)](https://signalsmith-audio.co.uk/code/stretch/).

[170] cutterbl. [SoundTouchJS monorepo](https://github.com/cutterbl/SoundTouchJS).

[171] npm. [@soundtouchjs/audio-worklet README](https://unpkg.com/@soundtouchjs/audio-worklet@2.1.1/README.md).

[172] Daninet. [rubberband-wasm](https://github.com/Daninet/rubberband-wasm).

[173] Breakfast Quay. [Rubber Band Library licensing](https://breakfastquay.com/rubberband/license.html).

[174] delude88. [rubberband-web](https://github.com/delude88/rubberband-web).

[175] Superpowered. [Web Audio JavaScript/WebAssembly SDK](https://github.com/superpoweredSDK/web-audio-javascript-webassembly-SDK-interactive-audio).

[176] Superpowered. [Pricing](https://superpowered.com/pricing).

[177] Correya A, et al. [Audio and Music Analysis on the Web using Essentia.js](https://transactions.ismir.net/articles/10.5334/tismir.111). TISMIR 2021.

[178] Lee E, Karrer T, Borchers J. [An Analysis of Startup and Dynamic Latency in Phase Vocoder-Based Time-Stretching Algorithms](https://hci.rwth-aachen.de/publications/lee2007f.pdf). Proc. ICMC 2007.

[179] Karrer T, Lee E, Borchers J. [PhaVoRIT: A Phase Vocoder for Real-Time Interactive Time-Stretching](https://hci.rwth-aachen.de/publications/karrer2006a.pdf). Proc. ICMC 2006, pp. 708–715.

[180] Ishizaki H, Hoashi K, Takishima Y. [Full-Automatic DJ Mixing System with Optimal Tempo Adjustment based on Measurement Function of User Discomfort](https://archives.ismir.net/ismir2009/paper/000043.pdf). Proc. ISMIR 2009, pp. 135–140.

[181] Stark AM, Davies MEP, Plumbley MD. [Real-Time Beat-Synchronous Analysis of Musical Audio](https://dafx.de/paper-archive/details.php?id=XiEJjIc0a2Hb_KTJon0SaA). Proc. DAFx 2009; implementation: [BTrack](https://github.com/adamstark/BTrack).
