# Sub-frame impact prediction from body video: method, harness, numbers

*Thor Whalen — 2026-09-26*

## 0. What this is

[intent-and-subframe-timing.md](intent-and-subframe-timing.md) argued that a camera instrument cannot *react* to a strike in time (a 30 fps frame period plus the pipeline is 80 to 150 ms against a 10 to 30 ms perceptual budget) and must therefore *predict* it, and it separated three problems hiding inside "beyond the frame rate": locating an event that already happened to sub-frame precision (**resolution**), producing the sound at the event rather than after it (**prediction**), and deciding where the event was *meant* to be (**intent**). This document is the working answer to all three, scored on synthetic ground truth. It ships as code in `src/ictus/` (the impact predictor, a timing magnet and a second rhythm prior), a scoring harness in `scripts/subframe/`, committed replay fixtures under `test/fixtures/subframe_*`, and the tests in `test/subframe/`.

The numbers come from the `an.impacts` harness [1]: clips of a stick or a ball striking a surface, or turning in mid-air with no contact, on a known tempo grid with humanised timing, sampled by a camera model with a shutter and capture-time jitter, each with a ground-truth sidecar (the intended grid time, the executed impact time in continuous seconds, and what every frame shows). Nothing was rendered: the keypoints are exact and tracker noise is added by the scorer. The benchmark set is 288 clips (object × surface/air × 24/30/60 fps × instantaneous/180-degree shutter × four capture-timing regimes × three seeds), 24 strokes each at a 96 → 132 bpm accelerando with accents (1, .6, .8, .6) and 12 ms of AR(1) timing jitter; `scripts/subframe/gen_clip_sets.py` regenerates it under `~/.local/share/thoremin/synthetic/` (never committed).

The short version: **a surface impact can be predicted about 50 ms before it happens with less error than the frame-snapped detector has after it**; an air impact can be predicted as early with about the frame-snapped detector's error; the shipped adaptive oscillator estimates the *intended* beat 65 to 75 ms late under an accelerando and a tempo-trend prior fixes that; and pulling a prediction halfway toward that prior's grid buys about 10 % on intent for 60 % on actuality, which is the dial the earlier report asked for. What is not shipped is the instrument that consumes it (§6).

---

## 1. The three estimators and the three scores

Each estimator is causal: it sees the samples of one tracked point (the stick tip, the ball's bottom; in the app, a wrist or a fingertip) in time order and emits an event time. The scorer matches every emitted time to the nearest ground-truth event within 120 ms; the rest are misses and spurious events. Three scores per matched event, one per objective of the earlier report's §3:

- **actuality** — estimate minus the executed impact time `t_impact`. Reported as the mean (a bias), the standard deviation (the part a calibration cannot remove, which is what the player feels as jitter [2,3]), the mean absolute error and its 95th percentile.
- **intent** — estimate minus the intended grid time `t_grid`. With 12 ms of humanisation the best an estimator that tracks the *stroke* can do is about 10 ms here; only a prior over the grid can do better.
- **lead** — `t_impact` minus the sample time at which the estimate was committed. A detector that needs the sample after the bottom commits one frame *after* the impact (negative lead); a predictor commits before it. This is the number that decides whether the sound can be scheduled at the impact.

The estimators:

| name | what it is | commits |
|---|---|---|
| `lowest` | the frame-snapped baseline: the deepest sample of a stroke, confirmed by the next one, at the sample's own time. The shipped ictus detector with its sub-frame refinement switched off (`refine: false`, added for this ablation) and no median filter. The harness's own `lowest_error` up to the stroke gate. **The bar to beat.** | one frame after |
| `parabola` | the shipped ictus detector as shipped: the three-sample parabolic vertex on the raw samples, a spike (a jump faster than a hand can move) bridged, the bottom confirmed by a decisive return (a few hundredths of the stroke) or by the second sample after it that is not deeper (#231) | one frame after a sharp bottom, two after a soft one |
| `parabolaRaw` | the same with no prefilter at all | one frame after |
| `parabolaMedian` | the detector as shipped before #231: median-of-three on every sample | two frames after |
| `confirm` | the impact predictor's post-hoc estimate at the first sample past the bottom | one frame after |
| `predict` | the impact predictor's committed prediction, one per stroke, the floor learned | before |
| `predictKnown` | the same with the contact plane given (a calibrated table), surface clips only | before |
| `sounded` | what the instrument plays: the prediction (never earlier than its commit plus the required lead), else the confirmation sounded at the confirming sample plus the required lead — late, and scored as late | mixed |
| `grid:<prior>` | the rhythm prior's nearest expected beat, read at the moment of the prediction: the pure intent estimate | before |
| `magnet<m>:<prior>` | the prediction pulled toward that grid by magnetism `m` (§2.5) | before |

---

## 2. The method

### 2.1 The movement model, and why a plane makes prediction well-posed

The approach to an impact is, to a good approximation, constant acceleration: a stick or a hand falling, a wrist snapping down. Flash and Hogan's minimum-jerk profile [4] and Dahl's measurements of drummers [5] both say the stroke is stereotyped and its later part is fixed by its earlier part; the harness models the fall as an ease-in, which is exactly a quadratic in time. A least-squares quadratic through the last few approach samples (`fitQuadratic`, all samples of the last 150 ms, at least three) is therefore the state estimate, and a surface impact happens where that trajectory reaches a **plane**. The plane is the constraint the dictated design brief pointed at ("you know where the impact would happen even if no frame shows it"): solve the quadratic for the crossing of the plane and the impact time is known while the stick is still tens of milliseconds above the table (`crossingTau`). This is time-to-contact estimation, Lee's tau [6], done by the machine rather than the player.

An **air** impact has no plane. What it has is the player's own repetition: the depth the strokes turn at is consistent (in the harness by construction; for a player, the "virtual drum head" is a learned position, Dahl's consistency finding), so the plane can be *learned* from confirmed reversals. What the extrapolation cannot see is the braking: an air stroke decelerates into its turning point over the last few tens of milliseconds (30 ms in the harness), so the ease-in extrapolation reaches the learned floor about half a brake before the true turn. That offset is a per-player constant and is learned too, as the running difference between the extrapolated crossing and the observed turning point (`lag`). The same code then serves both kinds: `level` given for a calibrated surface, learned otherwise.

### 2.2 Two kinds of stroke, told apart by the rebound

The two kinds differ in what the frames show *after* the bottom, and the predictor uses that to learn under the right rule. A surface stroke rebounds at about its approach speed, so the approach and departure fits form a **kink**: their intersection is the plane (exactly, for a V) and the unbiased post-hoc impact time. An air stroke leaves slowly from rest, a smooth turn: the vertex of a quadratic through the departure samples has zero velocity, so it *is* the turn, in time and depth. The rebound ratio (the speed over the first sample past the bottom, over the approach speed at the crossing) classifies each stroke, voted over the last three; on the benchmark it is right 85 % of the time (16 872 of 19 870 strokes, noise-free), and a wrong vote costs one stroke's worth of floor and lag learning, not a missed event.

The choice of post-hoc reference matters more than it looks. A parabola fitted through three samples around a sharp V has its vertex *above* the apex (by about 10 px at 30 fps and 2 000 px/s) and about 2 ms late, so learning the floor from it puts the plane too high and every prediction a few milliseconds early; a parabola around a smooth but asymmetric turn (sharp arrival, slow departure) is late by 5 to 10 ms, so learning the lag from it over-corrects. The kink for surfaces and the departure vertex for air were what made the probe's air predictions go from −15 ms (the unlearned brake) to ±3 ms. *Amended 2026-10-13 (#234):* that probe was dense; at 24 and 30 fps three departure samples span 70 to 125 ms, past where the departure is still one quadratic. Where its fit is accepted (a cap with its vertex within two sample periods of the bottom) the departure vertex lands 35 ms early with a 28 ms spread at 24 fps and 10 / 21 ms at 30 fps; it is rejected, and the three-sample vertex used instead, on 68 % of air strokes at 24 fps and 31 % at 30, so the reference as learned from was 7.5 / 25 ms and 5.7 / 19 ms early, against the three-sample parabola's 3 to 4 ms late (2 at 60 fps) with a 5 to 7 ms spread. A reference's spread goes straight into the learned lag and so into every prediction, while its bias only shifts their mean, so the air reference is now the three-sample vertex (`airReference: 'vertex'`, §3.1.1).

### 2.3 Commit as late as possible, then never move it

A prediction is emitted once per stroke, at the last sample that still leaves at least `minLead` seconds before the predicted impact given the sample period (the consumer's need: audio output latency plus a margin), and only when the fit is trusted: enough approach samples, a stroke big enough to be a stroke (relative to the player's recent envelope and to the online jitter estimate, in noise units as everywhere else in `ictus`), and a prediction that agrees with the previous sample's within 12 ms. Committed events are never moved. This is the pending-event scheduler of the conducting map's §6.3 and the client-side prediction of networked games [7]: act on the predicted state, and let the authoritative observation correct the *next* decision. Later, better estimates of the same stroke exist (each new sample sharpens the fit) and are deliberately not used for the sound already scheduled; they feed the floor and the lag for the next stroke.

### 2.4 Confirm, then learn

At the first sample past the bottom the stroke is **confirmed**: the post-hoc estimate (the crossing plus the learned lag for a surface, the three-sample vertex for an air turn), the prediction it confirms and the correction between them. A stroke too fast or too early to predict is confirmed without a prediction: the reactive, always-late case, and what `sounded` falls back to. Two samples later the departure is fitted, the stroke classified, and the floor and lag updated. The confirmation is also what the rhythm prior is fed, as an anchor with the stroke's relative amplitude as its confidence, exactly as the conductor node feeds it a beat.

### 2.5 Intent: two priors, and the magnet

The rhythm prior is injected (the `RhythmPrior` interface of #178); two are scored. The **adaptive oscillator** is the shipped one (`oscillator.ts`: a Large-Kolen circle map [8] with a running-mean period and an adaptive attentional focus). The **trend prior** (`trend_prior.ts`, new) is the plainest version of Cemgil's Kalman tempo tracker [9]: a least-squares fit of anchor time against beat index, quadratic once five anchors are in, over the last six or twelve anchors, so a linearly changing tempo is a *state*, not a disturbance. Both publish the same `MusicalTime`, so a consumer swaps them without knowing.

The **magnet** (`magnet.ts`) is the rhythmic twin of `magneticPitch` in `src/music/theory.ts` and a DAW's quantise strength [10] applied live: it pulls a predicted time toward the prior's nearest expected beat by a magnetism in 0..1, through a Gaussian attentional gate (Large and Jones's pulse [11]) that fades with distance from the beat and scales with the prior's confidence, so an event far from any expected beat is left alone. It reads the prior and never updates it; confirming the event is the caller's job. Its output is what the instrument *chooses to sound*, kept separate from what it *inferred*, as the rhythm map's §6 asks.

---

## 3. Results

All tables: 288 clips, 3 456 events per stroke kind; errors in ms, negative = early; "lead" = impact minus commit time, negative = after the fact; noise-free keypoints and `minLead` = 30 ms unless stated. `scripts/subframe/score.ts` writes the full tables next to the set.

### 3.1 Headline: actuality, by estimator and kind

| estimator | kind | mean | sd | MAE | p95 | mean lead | missed |
|---|---|---|---|---|---|---|---|
| `lowest` (the bar) | surface | −3.6 | **10.8** | 8.8 | 23.2 | −27 | 0 |
| `lowest` | air | 0.4 | **10.7** | 8.3 | 21.0 | −31 | 0 |
| `parabola` (shipped since #231) | surface | −3.8 | 7.3 | 6.3 | 17.5 | −28 | 0 |
| `parabola` (shipped since #231) | air | 2.8 | 5.5 | 4.8 | 13.2 | −39 | 0 |
| `parabolaRaw` (no prefilter) | surface | −3.8 | 7.3 | 6.3 | 17.5 | −27 | 0 |
| `parabolaRaw` (no prefilter) | air | 2.8 | 5.5 | 4.8 | 13.2 | −31 | 0 |
| `parabolaMedian` (shipped before #231) | surface | −4.0 | 12.4 | 9.9 | 26.1 | −42 | 30 |
| `parabolaMedian` (shipped before #231) | air | 4.3 | 10.9 | 9.0 | 23.9 | −50 | 0 |
| `confirm` | surface | −3.5 | 7.0 | 5.9 | 16.3 | −27 | 0 |
| `confirm` | air | 1.9 | 6.9 | 5.3 | 15.0 | −31 | 0 |
| **`predict`** | surface | −3.1 | **7.1** | 5.6 | 15.1 | **+53** | 213 |
| **`predict`** | air | −4.7 | **9.8** | 8.3 | 21.5 | **+57** | 259 |
| **`predictKnown`** (plane given) | surface | −3.6 | **6.0** | 5.0 | 13.6 | **+53** | 91 |
| `predict` re-measured 2026-10-13 (air reference `departure`, the rows above as of today) | surface | −3.2 | 7.4 | 5.7 | 15.8 | +56 | 209 |
| `predict` re-measured 2026-10-13 (air reference `departure`) | air | −4.8 | 9.7 | 8.3 | 21.4 | +60 | 250 |
| `predict`, air reference `vertex` (2026-10-13, #234; shipped) | surface | −3.1 | 7.3 | 5.6 | 15.5 | +56 | 209 |
| `predict`, air reference `vertex` (2026-10-13, #234; shipped) | air | +2.2 | **6.5** | 4.9 | 14.6 | +53 | 263 |
| `sounded` | surface | 2.6 | 17.6 | 9.5 | 44.6 | +48 | 0 |
| `sounded` | air | 1.4 | 20.9 | 12.6 | 58.8 | +50 | 0 |

Read across a row: `predict` on a surface commits 53 ms *before* the impact with a 7.1 ms spread, where the frame-snapped detector reports 27 ms *after* it with a 10.8 ms spread: 80 ms earlier and a third tighter. Against the best *post-hoc* estimator on the set, the unfiltered parabola (7.3), the prediction is as tight and 80 ms earlier; the earliness is the point, the tightness is the bonus. With the plane known the spread is half the baseline's. The 213 misses are mostly one per clip: the first stroke, before a floor exists. `sounded` is what a player would hear from a consumer with 30 ms of latency: the prediction (never earlier than its commit plus the lead), else the confirmation sounded at the confirming sample plus the lead — one frame plus 30 ms late by construction, which is what puts its 95th percentile at 45 to 59 ms: the unpredicted first stroke of every clip is loud in that column, and it is the honest price of a floor that has to be learned. On air the prediction is as early but only as accurate as the baseline; its post-hoc `confirm` is much better (6.9), so the air prediction's extra error is in the extrapolation across the brake, which the learned lag removes on average (the mean is −5) but not stroke by stroke.

Two things about the baselines. The detector as shipped before #231, with its median-of-three prefilter (`parabolaMedian`), is *worse* on timing than the frame-snapped detector (12.4 versus 10.8 on surfaces, 30 strokes missed) and two frames late; without the filter it is the best post-hoc estimator for air (5.5). The median replaces the extremum sample by a neighbour exactly where the parabola needs it. The filter existed to kill one-frame landmark spikes on real MediaPipe streams; #231 (the timing plan's step 1) made the trade the other way: the raw samples time the turn, a spike is defined by a hand-speed ceiling rather than removed from every sample, and the bottom is confirmed by a return larger than a few hundredths of the stroke, which is what keeps a tracker's one-frame wobble from being a beat. The shipped `parabola` row is now that detector: the `parabolaRaw` spread with no stroke missed, committed 1.5 ms (surface) and 7 ms (air: the smooth turn's first return is sometimes within the margin, and the second sample confirms) after the immediate rule, 14 and 12 ms before the median's. On the conducting fixtures (real MediaPipe) the detections at 30 fps score the same as the median's on 3/4 and 2/4 and on 4/4 (F at 17.5 % / 30 % / 70 ms, CMLt: .783 / .870 / .783 / .700); at 15 fps 4/4 .783 / .957 / .783 / .700 (median .870 / .957 / .783 / .700: one anchor in a hand-swap glitch, timed from the plateau's first sample, falls outside the 150 ms window), 3/4 .909 / .909 / .636 / .778 (median .818 / .909 / .545 / .778), 2/4 .571 / 1.000 / .571 / .000 (median .615 / .923 / .462 / .400, both seven anchors). The mean confirmation latency (confirming sample minus anchor time, which flatters the median's late anchors by 5 to 15 ms) is 49 / 59 / 82 ms on 4/4, 3/4, 2/4 at 30 fps against the median's 57 / 51 / 129, no anchor past 97 ms at 30 fps; at 15 fps one 3/4 anchor takes 363 ms with either detector (the footage). Under tracker noise on smooth 60 fps strokes (4 and 8 % of the stroke, 30 s each, the reviewer's synthetic set) the shipped detector hits 38 / 40 and 26 / 40 steady strokes with 5 and 33 spurious anchors against the median's 32 / 40 with 9 and 14 / 40 with 25, and 80 / 80 and 79 / 80 fast strokes with 1 and 5 spurious against 80 / 80 with 1 and 78 / 80 with 3. One caveat is recorded as a known failure in `test/ictus_detector.test.ts`: the 2/4 excerpt's follower lock, which the 10 to 15 ms anchor moves flip to half tempo (#232).

**The slow column (the timing plan's step 1b).** The scorer can now thin every clip to a regular slower camera (`--fps 15`, `--fps 20`) or pace it by a simulated inference time (`--infer 0.045`: a frame is processed once the previous inference has finished, the latest captured frame wins, each keeps its capture stamp, which on a 30 fps camera gives the alternating 33 / 67 ms spacings a slow laptop produces). Two things in the predictor were counts that only made sense at 30 fps and above: the commit deadline guessed the next gap from the last one (under 33 / 67 ms pacing it waited for a sample that came 67 ms later and committed short), and the floor was learned from three departure samples (at 15 fps that is 200 ms of settling, which a fast tempo's next descent overruns, so the floor was never learned and nothing was ever predicted). The deadline now reads the 90th percentile of the last eight gaps, and when the next descent arrives before the third departure sample, a departure that spans 100 ms with two samples teaches the floor as a line (three samples are always preferred when they come: a line learns a worse floor, and the irregular-stamp air-drum test showed a 77 ms miss when two were used as soon as the window was reached). Measured on the same 288 clips (noise 0, minLead 0.06, `predict`, surface / air; "missed" counts the first stroke of every clip, which has no floor): at the native rates the rows are unchanged on spread and gain a little lead (24 / 30 / 60 fps sd 12.8 / 9.2 / 4.9 against 12.7 / 9.2 / 4.8, missed 138 / 98 / 96 against 155 / 100 / 96, mean lead 89 / 87 / 83 ms against 86 / 84 / 82: the deadline on the clips with capture jitter commits a little earlier; `predictKnown` 10.2 / 7.4 / 4.0 against 10.1 / 7.4 / 3.7); thinned to 15 fps, sd 15.0 / 14.6 with 154 / 213 of 3456 missed against 13.9 / 13.7 with 256 / 436 (the predictable strokes committed: 95 % / 93 % against 92 % / 86 %; `predictKnown` surface MAE 9.5, `confirm` surface MAE 11.7, both within 0.2 ms of before; the shipped `parabola` misses 0 at 15 fps against the median's 1732 of 3456), 1861 of 6545 predictions short of the 60 ms lead (a 67 ms frame cannot always leave it; 1933 of 6220 before) and 6541 of 6545 committed on their first usable fit (the stability check's bypass, now counted: at 15 fps a prediction is always a single fit, at 20 fps 96 %, at 30 fps and above 53 %, at the 30 ms lead 13 %); inference-paced at 45 ms on the 30 fps clips, 11.8 / 13.9 with 161 / 169 missed against 10.5 / 14.0 with 206 / 287 (lead 89 ms against 81). The bench's tempi are 96 to 132 bpm, where three departure samples still fit at 15 fps; the review's 150 bpm case is `test/subframe/impact_low_rate.test.ts`'s fast-tempo case, where the count loses the floor on the air fixtures and the fallback keeps it. A consumer that still sees no floor after a few confirmations (`unlearnedConfirmations()`) can say "camera too slow for prediction" instead of asking for one more stroke; the air drum's status line does not say it yet (its status is a node port, left for a catalog-regenerating change).


#### 3.1.1 The air reference (#234, measured 2026-10-13)

The air rows above were the one place the prediction was no tighter than the frame-snapped baseline. Decomposing the 30 fps error (noise 0, `minLead` 30 ms) into the commit-time crossing and the learned lag showed where it was: the crossing, against the true brake offset, has a 5 to 6 ms spread; the learned lag had 7 to 15 ms and sat 9 ms short. The lag was learned from the departure-fit vertex, which at 24 and 30 fps is the noisy step (§2.2's amendment: its third sample falls past the departure's inflection). The bench's brake and fall are constants in `truth.json`, so what varied was not the brake but this reference. The issue's two fixes were tried against that:

- **The departure vertex as the prediction's target** (the lag measured against the committed prediction's own crossing instead of the confirmation's fit, which holds braking samples): no gain with either reference. At the 30 ms lead the 30 fps air sd moved 9.6 → 10.2 (departure) and 5.8 → 5.9 (vertex); at 77 ms it traded spread for bias (vertex: sd 7.2 → 8.0, mean +6.1 → +4.1). Not shipped.
- **A per-player stroke template**: not built. On this bench every stroke has the same fall and brake, so a template would match it by construction and its number would say nothing about a player (#234's 2026-10-05 note). It needs the stroke-variability clip set (thorwhalen/cutan#27, closed; its generator is not installed on the machine this was measured on) and a real-hand take, and is [#351](https://github.com/thorwhalen/thoremin/issues/351).
- **The three-sample vertex as the air reference** (`airReference: 'vertex'`, an option since the first version, now the default) is what the decomposition pointed to, and it is what shipped.

`npx vite-node scripts/subframe/score.ts --predict-opts '{"airReference":"departure"}'` reproduces the before column. `predict`, noise 0 unless stated, sd / MAE in ms, missed of 3456 where shown; "effective lead" is the app's 77 ms (the 0.05 dial plus the frame's age):

| column | air before | air after | surface before | surface after |
|---|---|---|---|---|
| all rates, lead 30 ms | 9.7 / 8.3, 250 | **6.5 / 4.9**, 263 | 7.4 / 5.7, 209 | 7.3 / 5.6, 209 |
| 24 fps, lead 30 ms | 13.4 / 11.2 | **8.2 / 7.3** | 9.5 / 7.6 | 9.5 / 7.6 |
| 30 fps, lead 30 ms | 9.6 / 9.2 | **5.8 / 5.3** | 7.4 / 6.3 | 7.4 / 6.3 |
| 60 fps, lead 30 ms | 4.3 / 4.7 | **2.7 / 2.4** | 4.0 / 3.4 | 3.5 / 3.1 |
| all rates, lead 60 ms | 10.4 / 8.0, 169 | **7.7 / 6.2**, 187 | 8.4 / 5.9, 163 | 8.3 / 5.8, 163 |
| 30 fps, effective lead, `exact` | 7.1 / 7.5 | **4.6 / 6.2** | 5.7 / 4.7 | 5.7 / 4.7 |
| 30 fps, effective lead, `capture-jitter-actual` (Chromium since #226) | 7.6 / 7.7 | **5.3 / 7.0** | 6.0 / 5.0 | 6.0 / 5.0 |
| 30 fps, effective lead, `capture-jitter` (nominal stamps) | 8.8 / 7.1 | 7.5 / 7.4 | 9.1 / 7.2 | 9.1 / 7.2 |
| 30 fps, effective lead, `stamp-noise` | 12.5 / 10.9 | 10.1 / 9.6 | 12.5 / 9.9 | 12.4 / 9.9 |
| 24 fps, effective lead, `capture-jitter-actual` | 13.3 / 10.6 | **7.7** / 10.5 | 7.8 / 6.5 | 7.8 / 6.5 |
| all rates, effective lead | 11.0 / 8.3, 148 | **8.7 / 7.3**, 150 | 9.4 / 6.6, 146 | 9.3 / 6.5, 146 |
| tracker noise 1 px, lead 30 ms | 10.4 / 8.2, 290 | **6.7 / 5.1**, 300 | 7.5 / 6.0, 241 | 7.5 / 5.9, 241 |
| tracker noise 2 px, lead 30 ms | 11.2 / 8.3, 347 | **8.1 / 5.8**, 367 | 9.7 / 7.3, 297 | 9.6 / 7.1, 299 |
| `--fps 15` | 12.9 / 15.4, 480 | 12.9 / 15.4, 480 (identical) | 14.0 / 10.9, 277 | identical |
| `--fps 20` | 11.0 / 9.9, 313 | 9.7 / 10.0, 330 | 9.8 / 7.4, 211 | identical |
| `--infer 0.045` | 13.7 / 10.4, 366 | **8.6 / 9.4**, 380 | 9.8 / 7.5, 264 | 9.6 / 7.4, 264 |
| `--dejitter line` | 9.1 / 8.5, 196 | **5.9 / 4.6**, 195 | 5.6 / 4.8, 167 | identical |

The spread target of #234's acceptance (30 fps, truthful stamps, effective lead, at most 6.5 ms) is met on this bench: 7.6 → 5.3. The rest of that acceptance is not: it asked for a clip set with brake and fall variability (bench-v2's are constants), for `missed` not to rise (it rises, below), and for a real-hand take better than `lowest` (none was measured). The change is unvalidated on real hands; #234 stays open for that. What it costs, stated plainly:

- **A late mean.** The three-sample vertex is 2 to 4 ms late on this asymmetric turn, and the prediction's mean moves from early to late: −4.8 → +2.2 ms over all rates at 30 ms of lead, growing with the lead and with a slower camera (at the effective lead +6.1 at 30 fps and +9.0 at 24; `--fps 20` +8.2). That is why the MAE gains less than the spread wherever the bias is largest (24 fps at the effective lead: sd 13.3 → 7.7, MAE 10.6 → 10.5; `--fps 20`: MAE 9.9 → 10.0). A constant is what a latency calibration removes, but this one depends on the frame rate and the lead, so it is not free; no correction is shipped for it ([#352](https://github.com/thorwhalen/thoremin/issues/352)). *Update 2026-10-14:* decomposed and one correction tried in §3.1.2; still none shipped.
- **More strokes unpredicted, and a shorter lead.** Air misses rise in most columns: +2 to +20 of 3456 in the table's, +33 at a zero lead (316 → 349), and up to +51 with tracker noise in the slow column (`--infer 0.045`, noise 2: 630 → 681; `--fps 20`, noise 2: 754 → 790); none with `--dejitter line`, at 15 fps, or in the two truthful-stamp regimes. The mean lead of an air prediction drops by about 6 ms (59.8 → 53.2 at the 30 ms lead). Every extra one is a stroke with no prediction at all, not a wrong one (at the 60 ms lead, 24 and 30 fps: 25 → 43 of 2304, in the `capture-jitter` and `stamp-noise` regimes): the later lag moves the commit deadline a sample later, and on noisy stamps that sample is sometimes past the bottom. Those strokes are sounded on confirmation, as before.
- **What the player hears.** `sounded` / air (the prediction, else the late confirmation) improves at the native rates, sd / MAE 20.6 / 12.4 → 18.1 / 9.7, but its mean moves +1.0 → +7.1 ms, and on a slow camera its MAE gets slightly worse: `--fps 20` 16.3 → 16.7, 24.1 → 24.7, 27.2 → 27.8 ms at noise 0 / 1 / 2; `--infer 0.045` 17.8 → 17.2 at noise 0 and 21.5 → 21.6 at noise 1 (mean +8.9 → +16.1).
- **`--poll 60`** (sample-and-hold at a 60 Hz vsync, measured by the review): at noise 0 only `predict` / air changes, sd 20.3 → 11.2; at noise 2 and a 60 ms lead the spread and the misses fall for both kinds (air 26.4 / 1389 → 22.4 / 1207, surface 26.2 / 1468 → 23.6 / 1325), but spurious predictions rise (air 67 → 118, surface 50 → 81): false sounds, on a regime the pump no longer produces.
- `confirm` / air moves 6.9 → 7.1 ms sd (the strokes classified as surfaces use the lag).

The air drum, bass and guitar take the new default through `createImpactPredictor`. On the air drum's own synthetic pads take (`test/air/synthetic_drums.ts`, a stick on an arc with a cosine ease, through the production graph) the hit timing improves: MAE 33.6 → 22.6 ms on the default take, 38.9 → 23.1 with landmark noise, 24.1 → 15.8 on the overlapping-pads script (four strokes per pad). One thing got slower: the snare struck after the kick (whose centre is 0.08 below it) lands on the snare from its fourth stroke instead of its second, because the pad is read at the depth the fall reaches by the predicted time, capped at the floor learned on the previous pad, and the old ~20 ms early prediction read a shallower depth that happened to favour the shallower pad. Over that script 4 strokes land off their pad against 5 before, but that count depends on the pattern: on 16-stroke kick / snare alternation, groove and pairs patterns the review counted 7 / 7 / 4 off-pad with the old reference and 8 / 7 / 5 with the new, and under either nearly every snare after a kick reads as the kick; `test/drums/landing_arc.test.ts` pinned the fourth stroke per pad until per-pad floors made a change of pad immediate ([#353](https://github.com/thorwhalen/thoremin/issues/353), §3.1.3). The predictor's fixture tests are unchanged and green.

#### 3.1.2 The late mean, decomposed (#352, measured 2026-10-14)

A prediction is the crossing extrapolated at the commit plus the learned lag, and the lag is learned as the reference (the three-sample vertex) minus the crossing the confirmation fits. So the air error splits into three parts that add up to it: how far the commit's crossing sits from the confirmation's (`commitX − confX`), the reference's own bias (`ref − T`), and how far the learned lag trails this stroke's reference offset (in `auto` mode it also holds the strokes taken as surface, whose lag is learned from the kink). `npx vite-node scripts/subframe/decompose.ts` prints the table (bench-v2, noise 0, native rates, mean ± sd in ms):

| fps | minLead | error | commitX − confX | ref − T | lag trail | lead |
|---|---|---|---|---|---|---|
| 24 | 30 ms | +5.0 ± 8.2 | −0.2 ± 5.7 | +3.4 ± 6.7 | +1.7 ± 7.1 | 58 |
| 30 | 30 ms | +2.8 ± 5.8 | −1.1 ± 4.1 | +3.0 ± 5.4 | +0.9 ± 4.6 | 57 |
| 60 | 30 ms | −1.1 ± 2.7 | −3.1 ± 2.1 | +1.6 ± 2.7 | +0.4 ± 2.5 | 52 |
| 24 | 77 ms | +9.0 ± 10.8 | +4.0 ± 10.7 | +3.4 ± 6.8 | +1.6 ± 7.2 | 106 |
| 30 | 77 ms | +6.1 ± 7.2 | +2.2 ± 7.1 | +3.0 ± 5.4 | +0.9 ± 4.6 | 100 |
| 60 | 77 ms | +0.1 ± 4.2 | −1.9 ± 4.4 | +1.6 ± 2.7 | +0.4 ± 2.5 | 98 |

The reference's bias is constant in the lead and grows with the sample period (the three-sample parabola on an asymmetric turn). The commit offset is what moves with the lead: −3.1 to −0.2 ms at a 30 ms lead; at 77 ms +4.0 at 24 fps and +2.2 at 30, while 60 fps stays negative (−1.9). The commit's quadratic is extrapolated further across a brake it does not model. At 60 fps (both leads) and at the short lead the offset and the vertex's bias have opposite signs and partly cancel.

**Tried: learning the commit offset** (an exponentially weighted mean of `confX − commitX` per air stroke, gain 0.1 or 0.3, a running mean for the first strokes, added to the prediction). It removes the lead-dependent part and leaves the reference's bias: the mean becomes a near-constant +2 to +5 ms. `predict`, mean / sd / MAE in ms, misses of 3456 where shown:

| column | air before | air, gain 0.1 | surface before | surface, gain 0.1 |
|---|---|---|---|---|
| all rates, 30 ms | +2.2 / 6.5 / 4.9, 263 | +3.5 / 6.2 / 5.2, 266 | −3.1 / 7.3 / 5.6, 209 | −3.2 / 7.4 / 5.8, 210 |
| all rates, 77 ms | +5.0 / 8.7 / 7.3, 150 | +3.8 / 8.8 / 7.0, 153 | +0.6 / 9.3 / 6.5, 146 | −0.5 / 10.5 / 7.3, 146 |
| 24 fps, 77 ms | +9.0 / 10.8 / 11.3 | +5.2 / 12.1 / 10.0 | +1.1 / 12.5 / 9.2 | −0.6 / 14.1 / 10.4 |
| 30 fps, 77 ms | +6.1 / 7.2 / 7.6 | +3.9 / 7.9 / 7.0 | +1.1 / 8.8 / 6.7 | −0.2 / 10.0 / 7.5 |
| 60 fps, 30 ms | −1.1 / 2.7 / 2.4 | +1.9 / 2.9 / 2.7 | −1.6 / 3.5 / 3.1 | −1.7 / 3.7 / 3.2 |
| 30 fps, 77 ms, `capture-jitter-actual` | +6.6 / 5.3 / 7.0 | +3.7 / 6.2 / 6.0 | +1.8 / 6.0 / 5.0 | +0.4 / 7.5 / 5.8 |

It helps where the bias was largest (the app's effective lead at 24 and 30 fps: MAE 11.3 → 10.0, 7.6 → 7.0) and costs everywhere else: the spread rises, the MAE gets worse at the 30 ms lead and at 60 fps (where removing the negative commit offset uncovers the vertex's bias), and surface strokes get worse, because in `auto` mode some of a surface clip's strokes are taken as air and the offset applies to them. Gain 0.3 is within 0.4 ms of gain 0.1 everywhere (slightly better at 60 fps and 30 ms, MAE 2.6 against 2.7, slightly worse elsewhere); applying it to every kind moves the surface mean to −3.2 to −4.7 ms at 77 ms and −3.6 at 30 ms over all rates. Not shipped: it is not better everywhere, and what is left after it (the reference's +2 to +4 ms) is the generator's turn shape, which only a real-hand take can say anything about ([#351](https://github.com/thorwhalen/thoremin/issues/351)).

#### 3.1.3 One floor per pad (#353, measured 2026-10-14)

The predictor learns one floor per hand, which is right while the strokes stop at one depth and wrong across an air drum's pads: a stroke after a change of pad was extrapolated to the last pad's floor, so its impact came early or late and its landing point was read at the wrong depth, and where two pads are stacked at one x (the kick under the snare) nothing but the depth tells them apart. The seam is `ImpactPredictor.setFloor`: the consumer names the floor of the stroke in progress, the prediction and the confirmation's crossing are taken against it, and the events report it (`floor`) with the stroke's top (`top`). The air drum learns each pad's floor and top from the strokes that turned on it (`packages/ext-air/src/lib/pad_floors.ts`; the pad read at the predictor's depth of the turn, not the fall's fit read at the turn's time, which overshoots by the landmark noise and put noisy snare strokes on the kick's top edge, 0.02 below the snare's floor) and names, before each sample, the floor of the pad whose strokes start nearest where this one did, among the pads its way down crosses at their floor. A stroke cannot say where it will stop until it has (#261), so the rule reads where it STARTED: the player positions the hand over the pad and then swings.

That needed one change inside the predictor. A stroke's top was the least depth since the last confirmation, so after the arm carried the stick DOWN to a lower pad and waited there the approach fit held the carry and the wait, two fits in a row disagreed by more than the stability tolerance, and a hard 90 ms stroke on the floor tom was never committed (8 of 16 predicted in the first attempt, against 15 with one floor, whose shallower floor happened to make the first fit the last chance). While a floor is named, a point that stops descending before its descent is a stroke (the amplitude and speed gates), nothing committed, now starts the stroke there. It is scoped to a named floor because on the bench with 1 px of noise the same rule for every stroke moved the single-floor numbers both ways (`sounded` MAE 2 to 3 ms better, `predict` spread 1 ms worse, the anchor scorer's 90th percentile 7 to 10 ms worse for the wrist and the fingertip): with one floor every stroke starts from about the same top, and the least depth is it.

The production graph on the synthetic pads take (`test/air/synthetic_drums.ts`, 30 fps, a stick on an arc), 16 strokes per row unless named, before / after: strokes on their own pad, strokes predicted (the rest sound as ghost notes on confirmation), and the MAE of the SOUNDING time against the impact.

| take | on pad | predicted | sounding MAE (ms) |
|---|---|---|---|
| kick / snare alternating (stacked pads) | 9 → 15 | 15 → 15 | 17.0 → 13.2 |
| the same, landmark noise 0.02 | 8 → 15 | 15 → 15 | 17.1 → 12.8 |
| the same, landmark noise 0.05 | 8 → 15 | 13 → 14 | 19.0 → 16.7 |
| the same, soft and hard strokes mixed | 8 → 16 | 15 → 14 | 29.5 → 17.8 |
| snare / kick / tom groove | 12 → 15 | 15 → 15 | 23.8 → 13.2 |
| the same, landmark noise 0.02 | 11 → 15 | 8 → 15 | 26.5 → 13.9 |
| kick / snare in pairs | 10 → 15 | 15 → 15 | 14.1 → 13.2 |
| tom / floor tom alternating (overlapping) | 8 → 16 | 15 → 14 | 26.4 → 16.3 |
| overlapping pads, four strokes per pad (32) | 28 → 31 | 28 → 31 | 15.8 → 13.2 |
| the same, landmark noise 0.02 (32) | 26 → 31 | 28 → 31 | 18.4 → 13.5 |
| the demo take, one pad at a time (13) | 13 → 13 | 10 → 11 | 22.6 → 20.5 |
| the same, landmark noise 0.02 (13) | 13 → 13 | 9 → 11 | 23.1 → 18.4 |

The stroke left off its pad is, in every row, the first ever on the kick: no floor describes a pad before a stroke has turned on it, so it is read as before (a pad's own geometry as the prior for its first stroke is [#530](https://github.com/thorwhalen/thoremin/issues/530); a predicted stroke's path, which still runs to the frame's bottom, is [#531](https://github.com/thorwhalen/thoremin/issues/531)). Two rows lose one prediction to a ghost note and both gain on the sounding time. Where the kick is moved down until it no longer overlaps the snare (y 0.88), a prediction at the kick's floor is read on the pad under its landing point rather than on the snare the path walks through first (the path still decides when the pad it crosses first has no floor yet, which is how a stroke reaches a pad never struck above the named one); that layout puts 1 of 16 off (14 before #353, 7 with per-pad floors but the path deciding).

What the rule does not do, from the adversarial review. It reads where a stroke started, so a stroke raised much lower (or higher) than that pad's usual can be sent to the stacked neighbour: snare strokes at a lift of 0.45 against hard kicks at 0.7 put 7 of 16 off (8 before #353), at 0.5 two; the limit is a pad whose stroke heights vary by more than half the depth gap to its stacked neighbour ([#533](https://github.com/thorwhalen/thoremin/issues/533)). The first stroke on a pad never struck can now go either way: on the kick / snare alternation the old single floor got the first kick right by a late commit (its bad fits made it wait until the stroke was already below the snare), and the restart's better fit commits earlier, against the snare's floor. The floors start over whenever the predictor is rebuilt (the hand's size drifting by 1.5x, a changed tracked point), and a pad moved while its floor is learned keeps the old floor until its strokes pull it over at half a stroke per stroke. With no pad on nothing is named: `scripts/subframe/score.ts` on `bench-v2` (noise 0 and 1 px, leads 30 and 77 ms) and `scripts/air/eval_drum_anchors.ts` (arm 0 and 25 %, noise 0 and 0.02) print byte-identical tables before and after, and no hit's time, sound, velocity or position changes (a ghost note's landing is read at the turn's depth only with a pad on).

#### 3.1.4 A pad never struck (#530, measured 2026-10-14)

After #353 the one stroke off its pad was, in every row, the first ever on a pad: nothing describes a pad before a stroke has turned on it, so the stroke was named the floor of whatever learned pad its way crossed (the first kick, under the snare, read as the snare). A pad never struck now gets a prior from its geometry and the player's own habits on the pads already struck (`priorPadFloor` in `packages/ext-air/src/lib/pad_floors.ts`): its floor is its centre's depth moved by the mean distance between a learned pad's floor and its centre, its top one mean fall (learned floor minus learned top) above that, and it competes with the learned pads under the same rule (its way must cross it at that floor; the nearest top wins). Its first confirmed stroke replaces the prior with what it did. The prior has no constant of its own; with no pad learned, nothing is named, as before.

`npx vite-node scripts/air/eval_pad_floors.ts` (the production graph on the synthetic stick takes, 30 fps; the rows of §3.1.3 plus the follow-ups' cases), main after #353 → with the prior: strokes on their own pad, strokes predicted, sounding MAE (ms).

| take | n | on pad | predicted | sounding MAE |
|---|---|---|---|---|
| kick / snare alternating (stacked) | 16 | 15 → 16 | 15 → 15 | 13.2 → 12.6 |
| the same, noise 0.02 | 16 | 15 → 16 | 15 → 15 | 12.8 → 11.9 |
| the same, noise 0.05 | 16 | 14 → 14 | 15 → 15 | 8.8 → 8.8 |
| soft and hard mixed | 16 | 16 → 16 | 14 → 15 | 17.8 → 17.8 |
| snare / kick / tom groove | 16 | 15 → 16 | 15 → 15 | 13.2 → 12.6 |
| the same, noise 0.02 | 16 | 15 → 16 | 15 → 15 | 13.1 → 12.1 |
| kick / snare in pairs | 16 | 15 → 16 | 15 → 15 | 12.6 → 12.6 |
| tom / floor tom alternating | 16 | 16 → 16 | 14 → 15 | 16.3 → 12.6 |
| four strokes per pad | 32 | 31 → 32 | 31 → 31 | 13.2 → 11.9 |
| the same, noise 0.02 | 32 | 31 → 32 | 31 → 31 | 13.5 → 11.3 |
| the demo take, starter kit | 13 | 13 → 13 | 11 → 12 | 20.5 → 15.3 |
| the same, noise 0.02 | 13 | 13 → 13 | 11 → 12 | 18.4 → 14.6 |
| snare lifted 0.45, kick 0.7 (#533) | 16 | 9 → 10 | 15 → 15 | 14.1 → 13.0 |
| snare lifted 0.5, kick 0.7 (#533) | 16 | 14 → 15 | 15 → 15 | 12.9 → 11.8 |
| snare lifts 0.5 to 0.9, kick 0.7 (#533) | 16 | 14 → 15 | 15 → 15 | 13.0 → 11.9 |
| crash, snare, kick, hihat, tom | 10 | 8 → 9 | 7 → 8 | 19.2 → 15.7 |
| ride then floor tom | 6 | 6 → 6 | 3 → 3 | 22.2 → 14.6 |

No row loses anything. The noise-0.05 row's two strokes off are the first stroke of the take (no pad learned at all) and one snare read as the kick under heavy noise. What is left off in the #533 rows is #533's own limit (a pad's stroke heights varying by more than half the gap to its stacked neighbour), not the first stroke. The synthetic player's strokes stop at the pad's centre, so here the moved centre is exact; a real player who strikes a pad's near edge is expected there on a new pad too, which is the reason for the offset. With no pad on, `scripts/air/eval_drum_anchors.ts` on `bench-v2` prints a byte-identical table (the change is inside the pad rule only).

### 3.2 By frame rate

| estimator | 24 fps | 30 fps | 60 fps |
|---|---|---|---|
| `lowest` sd / MAE | 13.8 / 11.6 | 11.8 / 9.8 | 5.4 / 4.4 |
| `predict` sd / MAE | 11.4 / 9.3 | 8.7 / 7.8 | 4.2 / 4.0 |
| `predictKnown` sd / MAE | 7.8 / 6.6 | 6.0 / 5.6 | 2.9 / 2.8 |
| `predict` mean lead | +55 | +57 | +53 |

The frame-snapped error scales with the frame period, as it must (a uniform error over the period has sd 0.29 periods: 12, 9.6 and 4.8 ms). The prediction's error scales less than proportionally because more of the approach is sampled at a higher rate, and its lead does not depend on the rate at all: the sound is scheduled at the predicted time. At 60 fps with a known plane the prediction is 2.9 ms, under the 4 ms intrinsic variability of human tapping [3]. This is the number that says the webcam route can match Aerodrums' 125 fps hardware route [12] on timing, given the plane.

### 3.3 The shutter: a bias every estimator shares

| estimator | instantaneous shutter: mean / sd | 180° shutter: mean / sd |
|---|---|---|
| `lowest` | +2.1 / 10.5 | −5.3 / 10.0 |
| `predict` | −0.3 / 8.3 | −7.5 / 7.3 |
| `predictKnown` | **+0.1 / 4.6** | −7.2 / 4.9 |

With an open shutter what a frame *shows* is the average of the object's positions over the exposure, and the observation stream stamps the frame with its exposure's opening time, so every estimator sees the object a half-exposure earlier than it was there: 8.3 ms at 30 fps and a 180-degree shutter, 5.6 ms averaged over the three rates. The bias is constant, identical for all estimators, and is what an end-to-end latency calibration (#227) removes; the *spread* is untouched (`predictKnown` 4.6 versus 4.9). In the real pipeline the same bias hides inside the capture timestamp, whichever instant the camera driver chooses to stamp, and is one more reason the earlier report's latency budget should be measured rather than derived.

### 3.4 Capture timing: what #226 is worth

The four regimes: `exact` (frames on time, reported truthfully); `capture-jitter` (the camera's frames arrive with 8 % of a period of jitter, but the stream *reports* the nominal time: an irregular camera with the old inference-time stamp); `capture-jitter-actual` (the same irregular camera, reported truthfully: the post-#226 world); `stamp-noise` (a regular camera whose reported times carry 12 % of a period of noise, 4 ms at 30 fps: the pre-#226 stamp on a regular camera).

| estimator | exact | capture-jitter (nominal) | capture-jitter (actual) | stamp-noise |
|---|---|---|---|---|
| `lowest` sd | 10.8 | 10.9 | 10.7 | 11.3 |
| `predict` sd / missed | 7.7 / 74 | 8.3 / 142 | 7.3 / 75 | 10.6 / 181 |
| `predictKnown` sd / missed | 4.3 / 0 | 6.2 / 31 | 4.2 / 0 | 8.5 / 60 |

The frame-snapped detector does not care (its error is dominated by the frame period). The predictor does: 4 ms of noise on the timestamps doubles the known-plane prediction's spread (4.3 → 8.5) and makes it *decline* to predict one stroke in fourteen (the stability check refuses a fit that keeps moving), while an irregular camera reported truthfully costs nothing. Honest timestamps are what a sub-frame estimator needs, and they are what #226 (landed as [PR #228](https://github.com/thorwhalen/thoremin/pull/228)) provides when the browser reports the capture time.

#### 3.4.1 The gated de-jitter (timing plan step 9, measured 2026-10-13)

Where the browser hands the frame pump no capture time, its stamps are clock readings (`clock`, `estimated`), the `stamp-noise` row's world. The gated de-jitter (`packages/sdk/src/timing/stamp_dejitter.ts`) fits a line of stamp against frame index over the last 30 frames of such a run and moves each stamp onto it; the frame index is inferred from a handful of candidate lattices (two seed periods, the 20th percentile and the mean of the gaps, each over 1 to 4 frames; the rules are below the table). A capture stamp passes through byte for byte, and so does a run that already sits on a grid. The scorer runs it with `--dejitter line` (the shipped rule) or `--dejitter clamp` (each output capped at its raw reading), and `--poll 60` for the `raf-poll` regime (positions held from the latest frame, sampled and stamped at a 60 Hz vsync: Safari before the pump fix). Same 288 clips; today's baseline in the first column (it differs from the table above by up to 0.6 ms: the estimators have changed since that table was measured).

| `stamp-noise`, sd / missed | off | `line` (shipped) | `clamp` |
|---|---|---|---|
| `lowest` | 11.3 / 0 | 10.9 / 0 | 11.2 / 0 |
| `predict` | 11.0 / 168 | 7.9 / 72 | 8.3 / 97 |
| `predictKnown` | 9.1 / 45 | **4.6 / 0** | 6.5 / 3 |

The known-plane prediction gets back to within 0.3 ms of exact stamps (4.3), and stops declining strokes; the learned-plane prediction recovers most of the way (exact 7.7 / 74). The line as it is beats the capped line because capping keeps the late half of the noise. The gate holds where it must: `exact` and `capture-jitter-actual` come out byte-identical (the scorer refuses to run otherwise), `capture-jitter` (nominal, stamps on the nominal grid) is unchanged, and every `raf-poll` row is identical with and without the de-jitter (`predictKnown` sd 12.3 ms on `exact`, 14.4 on `capture-jitter`, 11.0 on `capture-jitter-actual`, 14.7 on `stamp-noise`, either way): no line is fitted to the poll's stamps. That holds because the bench's poll stamps are jitter-free and the 1 ms jitter floor keeps the gate shut, not because anything detects sample-and-hold: a poll whose stamps carried 1.5 ms of jitter engaged on 289 of 300 frames in the review's test. The case is gone from the pump itself, which no longer delivers a held frame twice.

**What carries over to the browser.** The de-jitter only ever sees the pump's fallbacks: a browser with the video frame callback but no capture time, or one where the callback is absent or silent. On Chrome, Firefox and Safari with a camera it changes nothing. On the animation-frame fallback the delivery error is mostly the camera beating against the display's vsync. The adversarial review simulated it (cameras at 15 to 30 fps under 50 to 144 Hz vsync, 3000 frames each). Under 50, 59.94 and 60 Hz, with under 0.5 ms of callback jitter, the gate stayed shut on every frame (raw error 3 to 6 ms, passed through): a beat pattern on a 60 Hz grid is fitted by no lattice at a camera's rate within the residual bound. Under 75, 120 and 144 Hz it engaged and the error against the camera's grid fell: 3.45 to 0.64 ms, 0.72 to 0.38 and 2.20 to 0.77. Under 60 Hz with 2 ms of callback jitter it fell from 3.82 to 3.39. So the Gaussian `stamp-noise` gain above is the gain on Gaussian clock noise; on the vsync fallback the gain depends on the display, and at 60 Hz there is none.

**How the lattice is found, after the review.** A candidate period is believed only if:

- it is a camera's frame rate (5 to 60 fps, within 3 percent);
- its residual is under 0.15 of its period;
- it is the coarsest such lattice, or a finer one that explains the run 1.5 times better.

The seeds are the 20th percentile and the mean of the gaps, each over 1 to 4 frames. The camera-rate rule is what separates a 60 fps camera paced to 33 / 50 ms gaps from a 30 fps camera beating against a 75 Hz display at 27 / 40 ms: from the stamps alone both are the same two-to-three alternation. A stamp more than half a period from its own line passes through and stays out of the run; three in a row restart it. On one-sided (exponential, 2 ms) delivery noise, 4 percent of engaged frames sit on a 60 fps sub-lattice, which fits nearly the same line with every index doubled; the output error is 0.84 ms against 2.05 raw. Before the review, a third of them sat on sub-lattices down to a fifth of the camera's period.

### 3.5 How early, and what it costs

| required lead | `predict` mean lead (surface / air) | sd (surface / air) | strokes not predicted (surface / air) |
|---|---|---|---|
| 0 ms (as late as possible) | +28 / +32 | 6.3 / 10.3 | 270 / 358 |
| 30 ms | +53 / +57 | 7.1 / 9.8 | 213 / 259 |
| 60 ms | +83 / +85 | 8.4 / 10.3 | 169 / 182 |

Committing earlier costs almost nothing in accuracy (the fit at 60 ms out is nearly as good as at 30), which is the Knibbe, Benko and Wilson finding [13] for a 30 Hz sensor: a stroke is predictable well inside its own duration. The commit rule allows for the prediction still moving by its stability tolerance, so the mean lead sits about a frame above the required minimum; even so, at 30 ms required, 10 % of predictions (633 of 6 440) were committed with less than the required lead, and at 60 ms, 7 %, because a stroke's first trusted fit can already be its last chance, and the required observed descent (§2.3) caps the lead at about 60 % of the fall. A consumer sounds those at its commit time plus its latency, which is what the `sounded` row scores. The practical setting is the consumer's audio latency plus one frame period, which is what 30 ms is at 30 fps.

### 3.6 Tracker noise

| noise | `lowest` sd / spurious | `predict` sd (surface / air) / spurious | `predictKnown` sd / missed |
|---|---|---|---|
| 0 px | 10.8 / 0 | 7.1 / 9.8 / 0 | 6.0 / 91 |
| 1 px | 10.8 / 271 | 7.4 / 10.4 / 0 | 6.3 / 118 |
| 2 px | 10.9 / 278 | 9.5 / 11.2 / 0 | 8.4 / 195 |

Gaussian noise on the keypoints (the harness's keypoints are an ideal tracker's) degrades the prediction gracefully to 2 px, which is about MediaPipe's frame-to-frame jitter on a still hand at 640 px. The unfiltered frame-snapped detector fires on noise between strokes (271 spurious of 6 912); the predictor's gates — an absolute floor the caller sets in its own units (12 px here; a stroke is hundreds), noise units against an online *median* of residuals (so a clean sharp kink is not mistaken for noise), a warm-up before the estimate means anything, and a required observed descent before a prediction (a fit through a few noise samples at rest can "reach" a floor a stroke away) — leave no spurious prediction at 1 or 2 px; the misses come from the stability check declining a fit that keeps moving.

### 3.7 Intent: the priors, and the magnet's trade

The prior's grid, read at the moment each stroke is predicted, against the intended time:

| prior | mean (surface / air) | sd | MAE vs grid |
|---|---|---|---|
| `osc` (shipped oscillator) | **+65.5 / +74.4** | 25 / 20 | 68 / 77 |
| `oscFast` (period memory 0.7, gain 0.7) | +21.7 / +29.2 | 24 / 24 | 27 / 33 |
| `trend4l` (linear, 4 anchors) | +15.3 / +22.9 | 21 / 21 | 21 / 26 |
| `trend12l` (linear, 12 anchors) | +76.6 / +81.8 | 34 / 31 | 80 / 86 |
| `trend6q` (quadratic, 6 anchors) | −2.6 / +3.6 | 28 / 29 | 22 / 23 |
| **`trend12q`** (quadratic, 12 anchors) | **−2.9 / +2.5** | 24 / 26 | **16 / 17** |
| **`blend`** (the default since #232: `osc` until three innovations share a sign, then `trend12q`) | +1.9 / +8.4 | 26 / 28 | **18 / 20** |

The rows above score each prior on its own events (a prior not yet running has no grid at that stroke: `osc` on 3052 / 3008 strokes, the others on 3105 / 3069). On the 6060 strokes every prior scored (the scorer's "same events" table): `osc` +65.4 / +74.4, vs-grid MAE **68.1 / 77.2**; `blend` +1.7 / +8.2, **18.4 / 20.3**; `trend12q` −2.9 / +3.0, **16.5 / 17.0**. The blend's air number sits AT the issue's bound of 20 ms on its own events and 0.3 ms over it on the same events; the bound was a target for the mean of the two columns, and the surface number is 1.6 ms inside, but the air column is not comfortably inside and the doc says so.

Under a 1.5 %-per-beat accelerando the shipped oscillator's grid runs 65 to 75 ms late: its period is a running mean of past intervals and its phase correction only halves each error, so it settles a constant distance behind. A linear fit over a long memory lags the same way for the same reason (the tempo halfway through the window is the tempo it reports). Only a model with a tempo *rate* has no lag, and with 12 ms of humanisation in the anchors its floor is about 15 ms (the leverage of extrapolating a quadratic one step). The oscillator remains the right prior for a conductor holding a tempo; the trend prior is the right one for a player deliberately pushing it, and the seam already lets a consumer pick.

**The blend (#232, the timing plan's step 2) is what ships.** `blend_prior.ts` runs both priors on the same anchors: each anchor's innovation is measured against the grid the oscillator was publishing before the anchor is folded in (`nearestExpectedBeat`, the magnet's question; the red-team's `blend_rule.ts` simulated exactly this), and when three in a row share a sign the trend's weight rises by a third per anchor toward 1, otherwise it falls by a third; the published state is the oscillator's with its next beat, period and confidence moved that fraction of the way toward the trend's, so the beat count stays the oscillator's and at rest the blend IS the oscillator. The row above is the bench re-scored on the branch (noise 0, minLead 0.03, 288 clips; `osc` reproduces 68 / 77): **18 / 20 ms**, inside the issue's bound of 20 and 2 to 3 ms behind the trend alone, which is the ramp-in over the first six anchors of every 16-stroke clip (the mean of +2 / +8 is that ramp). At a steady humanised tempo (sd 12 ms AR(1) plus 7 ms detection error, 24-beat passages, counted from the fifth anchor) the rule fires on 14.7 % of anchors on the test's 400 fixed-seed passages, the mean trend weight is 0.09 and the grid moves by under 1 ms, against bounds of 15 % and 0.1 (`test/ictus_blend.test.ts`; the red-team's 12 to 13 % excluded the cold start, where a one-interval seed makes a same-sign run likely and the trend's five-point fit is the better grid). **The 15 % bound is at the margin, not comfortably inside it:** across 20 seed sets of 100 passages the rate is 12.7 to 16.0 % (mean about 14.2), above 15 in 3 of 20, while the mean weight is 0.073 to 0.098, never above 0.1. The false triggers stay cheap (the steady grid moves 11.6 → 11.9 ms), which is the number that matters; the rate itself is reported, not guaranteed. The oscillator's gate survives the blend: an anchor more than 0.3 of a period from the oscillator's grid is withheld from the trend half and from the sign history, so a mid-beat rebound and a dropped beat with the trend engaged leave the tempo within 2 % where trend12q alone carries the rebound for twelve beats at 25 to 30 % off. `MusicalTime.leadOffset` (the per-person lead the research map asks for) is a field now; nothing measures it yet.

**What the adversarial review of PR #310 found, and the three rules it added.** (1) After a sudden slowdown the trend half numbered beats against its old period (0.5 → 0.75 s: every real beat two indices) and settled at double tempo for good, because nothing reset it when the oscillator re-seeded; on 100 humanised runs the trend half was stuck at double tempo in 53 (→ 0.75 s) and 100 (→ 1.0 s) runs and the published period was more than 25 % off at 213 and 125 of 3100 post-jump anchors (the oscillator alone never). Now a restart of the oscillator's lock (`restarts()`: lost lock, octave re-seed, restart out of hold) resets the trend half, the weight and the sign history, and a trend half whose period disagrees with the oscillator's by more than a fifth (`PERIOD_DISAGREEMENT`) starts over the same way, which is what catches the 0.75 case the oscillator rides out by correction without re-seeding: stuck 0 and 0 of 100, off 0 of 3100 in both, worst 15 % / 3 %. (2) The weight and the sign history used to carry across the re-seed (after an accelerando and a halving the weight stayed 1 on a pre-jump fit for five beats, grid errors −37 to −52 ms where the oscillator's were 0); with the restart rule the weight is 0 at the restart anchor and the grid is the oscillator's from there (the accelerando-then-halving case: blend MAE 5.0 ms over the 27 scored beats against the oscillator's 34.0; accelerando then 0.75 s: 27.9 against 60.7). (3) In a ritardando the slide shrinking at an anchor stepped the whole-beat count back by about 0.01 in 81 of 100 runs; the published count now never reads below a whole beat it has crossed (reset only when the oscillator restarts, whose own restart rounds the count as it always did): 0 of 100 in the ritardando, the slowdowns and the accelerando, and the ritardando's grid MAE is 15.5 ms against the oscillator's 57.4 (mirror of the accelerando's 16.7 / 54.5). (4) `createRhythmPrior('trend')` built `createTrendPrior`'s own six-anchor defaults, not the `trend12q` the table calls best; it now builds `TREND_DEFAULTS`, the same fit as the blend's trend half.

**The same PR restored the 2/4 fixture's lock**, lost between #231 and #232 for a reason that had nothing to do with the accelerando: the oscillator dropped its lock on two consecutive misses whatever their intervals and re-seeded from the span of the last two intervals (a half-tempo seed), and a conductor's long-short pattern (1.05 then 0.65 s at a bar-level 70 bpm) is two misses in a row too. A lost lock now needs misses at agreeing intervals (a tempo jump repeats its new interval; `lostIfIntervalsAgree: false` is the old rule) and re-seeds from that interval, which holds the 2/4 lock in 100 of 100 runs under 10 ms of anchor jitter (`test/ictus_detector.test.ts`; main held 12 of 200 at 5 ms). Stated plainly, because the result rests on 8 anchors: on this clip's anchors the agreement rule alone (with the old two-interval seed) matches the branch at every jitter level (200 / 200 / 188 of 200 at 5 / 10 / 20 ms), and the seed change alone also recovers the clean run (76.0 bpm) but is the less robust half (191 / 154 / 133). **At 15 fps the lock is not robust**: 7 anchors, held in 108 of 200 runs at 5 ms of jitter (main: 81), which the test reports as a floor of 40 in 100 and does not claim as a lock. The three steady-tempo conducting fixtures before (main) and after, `scripts/ictus/conducting_metrics.ts` at the recorded 30 fps and decimated to 15 fps; the detection columns (F-measures, CMLt, confirmation latency) are identical before and after and for every prior, and are in the script's output:

| fixture | fps | before (main): running / tempo at last / end / predictions F | after, `blend` (default) | after, `oscillator` |
|---|---|---|---|---|
| 4/4 | 30 | 92 % / 68.3 bpm / hold / 0.783 | 92 % / 68.3 / hold / 0.783 | same as blend |
| 4/4 | 15 | 92 % / 67.4 bpm / hold / 0.870 | 92 % / 67.5 / hold / 0.870 | 92 % / 67.4 / hold / 0.870 |
| 3/4 | 30 | 92 % / 70.0 bpm / hold / 0.667 | 92 % / 70.0 / hold / 0.667 | same as blend |
| 3/4 | 15 | 92 % / 70.4 bpm / hold / 0.909 | 92 % / 70.4 / hold / 0.909 | same as blend |
| **2/4** | 30 | 88 % / **41.7 bpm / running** / 0.400 | 88 % / **72.7 / hold** / 0.667 | same as blend |
| **2/4** | 15 | 86 % / **37.3 bpm / running** / 0.286 | 86 % / **64.4 / hold** / 0.429 | same as blend |

The one digit the blend moves on these clips is the 4/4 tempo at 15 fps (67.4 → 67.5 bpm: a same-sign run engaged the trend once, for a third); `trend` alone, for the record, ends the 2/4 clip at 101.8 bpm at 30 fps, carried by one stray anchor, which is the case the blend's gate is for.

**A saved instrument keeps its follower.** The conductor dial's new `prior` field defaults to `blend` for an instrument made from now on, but an instrument saved with a conductor and no `prior` (and a returning player's hot store, migration v21) is filled with `oscillator` (`LEGACY_CONDUCTOR_PRIOR` in `src/settings/schema.ts`; `normalizeLayer` and `migrateControls`), so adding the field changed what no saved instrument does; the panel's "Tempo sense" chooser is how a player moves.

The magnet at strength 0.5 toward each prior's grid, scored on both axes:

| what sounds | actuality MAE (surface / air) | intent MAE (surface / air) |
|---|---|---|
| `predict` (magnetism 0) | **5.6 / 8.3** | 11.3 / 12.5 |
| `magnet0.5:trend12q` | 8.9 / 9.7 | **10.1 / 10.8** |
| `magnet0.5:osc` | 13.9 / 14.4 | 17.5 / 17.8 |

Pulling halfway toward a good grid moves the sounded onset about 10 % closer to the intended time at a 60 % cost in fidelity to the executed one; pulling toward a *late* grid (the oscillator's) makes both worse. That is the whole argument of the earlier report's §3 in two rows: magnetism is only as good as the prior, and it is a dial, not a setting.

---

## 4. The compromise, made operational

The dictated brief asked for "some kind of skewing that still sounds good", within the limit that actuality is maximised first, then intent, then musicality. The results say how to set the three decisions:

1. **When to commit.** At the consumer's audio output latency plus one frame period before the predicted impact (`minLead`), never later. Earlier costs no accuracy; later risks having no prediction. A stroke whose prediction never became trusted is sounded on confirmation, one frame late, with the confidence to match (a ghost note, not a wrong one, in the anticipatory-onset design of the earlier report's §5.3).
2. **How strongly to snap.** By the prior's *confidence and lag*, not by a fixed strength. With a locked trend prior, 0.5 is the point where the intent gain and the actuality cost are of the same size; with the oscillator under a tempo change, 0 (the gate's confidence term does part of this on its own). This is Dragan and Srinivasa's confidence-dependent arbitration, and the trainer's noise-unit jitter estimate is the natural input: a player whose strokes land within the prior's window needs no pull.
3. **What to do when the prediction was wrong.** Nothing to the sound already scheduled. The confirmation's correction (median 2 to 5 ms on surfaces, larger on air) goes into the floor, the lag and the prior for the *next* stroke. A correction larger than the attentional window is a new stroke shape or a moved target, and it resets the learning the same way a missed beat resets the oscillator.

---

## 5. What this does not settle

- **Air at 24 and 30 fps.** The prediction's spread on air strokes (9.8 ms) is the one number in §3.1 not better than the baseline's. The extrapolation across the brake is the weak step: the learned lag is right on average and wrong by the brake's own variability stroke by stroke. Two things would help and neither is in this PR: a stroke template learned per player (the Gesture Follower idea of the earlier report's §5.2), so the brake is predicted from the stroke's prefix rather than added as a constant; and the departure-fit vertex used as the *prediction's* target rather than only for learning, which needs the previous stroke's departure shape. Both are additive behind `createImpactPredictor`'s options. *Update 2026-10-13 (#234, §3.1.1):* the variability was the learning reference's, not the brake's. With the three-sample vertex as the air reference the air spread is 6.5 ms against the baseline's 10.7 (5.3 ms at 30 fps with truthful stamps and the app's lead), at the cost of a 2 to 10 ms late mean; the departure vertex as the target gave nothing; the template is untested here because the bench's strokes all have one shape, and waits for the stroke-variability clips and a real-hand take (#351); the late mean is #352.
- **Real hands.** Every number here is on an ideal tracker plus Gaussian noise. A MediaPipe wrist has spikes, dropouts and a landmark that slides on the hand; the median filter the detector used against the first two cost 5 ms and a frame (§3.1) and is gone since #231, and what a real stream's small spikes do to the raw-sample detector is measured only on the three conducting fixtures so far. The committed fixtures let the predictor's tests run without a camera; the trainer's cue-interval fixtures (`docs/TESTING.md`) are how a real stroke's ground truth would be recorded.
- **The instrument.** The predictor emits events; nothing in the app consumes them yet. An air-drum instrument is stream D's remit (`docs/research/air-instruments*.md`), and it needs the two-clock scheduler of the conducting map's §6.5 (schedule the sample at the predicted `AudioContext` time, re-plan from the frame loop) to turn a 43 ms lead into a sound at the impact. Until it exists this work is a library with numbers, not a feature a player can find, and the shipping rule of `CLAUDE.md` applies to whoever wires it.
- **The oscillator under tempo change** (§3.7) is a finding about the conductor too: a conductor who accelerates is followed 65 ms late. Settled by #232: the conductor node's `prior` param selects the oscillator, the trend or the blend, and the blend is the default. What the conductor's own servo adds on top of the prior's grid (#239's 31 ms at zero delay) is step 3's measurement.
- **The harness shares the predictor's model.** The clips' strokes are quadratic ease-in approaches and quadratic departures, which is exactly the predictor's local model, so the fits are exact where a real stroke's are approximate. A probe with a smoothstep (minimum-jerk-like) departure put the learned air floor about 7 px deep and the predictions 17 to 47 ms early until the lag re-learned; a real player's stroke shape is the per-player template of the first point above, and it is the reason the benchmark's absolute numbers are an upper bound on what a webcam will give, while its *comparisons* (prediction against frame-snapping, honest against noisy timestamps, trend against oscillator) should carry over.

---

## 6. Where the pieces are

| piece | path |
|---|---|
| The impact predictor: fits, crossing, kink, classification, commit rule, learning | `src/ictus/impact.ts` |
| The timing magnet | `src/ictus/magnet.ts` |
| The trend prior | `packages/ictus/src/trend_prior.ts` |
| The blend prior (the default) and the prior factory | `packages/ictus/src/blend_prior.ts`, `createRhythmPrior` in `packages/ictus/src/index.ts` |
| The detector's `refine` switch (the frame-snapped ablation) | `src/ictus/detector.ts` |
| Clip-set generation (the `an.impacts` recipe) | `scripts/subframe/gen_clip_sets.py` |
| The scorer: estimators × axes → JSON and Markdown tables | `scripts/subframe/score.ts` |
| Committed fixtures from the harness (a stick on a table and in the air at 30 fps, a ball in the air at 60 fps) | `test/fixtures/subframe_*`, built by `scripts/subframe/build_fixture.ts` |
| Tests: the fits, the predictor on the fixtures (bounds from §3 with margin), the magnet, the trend prior | `test/subframe/impact_predictor.test.ts`, `test/subframe/magnet_and_trend.test.ts` |
| The capture-time stamp and the once-per-frame feed the predictor relies on (#225, #226) | `src/nodes/sources/frame_pump.ts`, `src/nodes/features/conductor.ts`, `test/subframe/frame_pump.test.ts`, `test/subframe/conductor_frame_dedupe.test.ts` |

---

## REFERENCES

[1] Whalen T. `an.impacts`: a synthetic impact harness (stick and ball, surface and air, tempo grid, humanisation, shutter and capture-timing model, ground-truth sidecar). In: `an`, structured animation. 2026. [github.com/thorwhalen/an](https://github.com/thorwhalen/an)

[2] Jack RH, Stockman T, McPherson A. Effect of latency on performer interaction and subjective quality assessment of a digital musical instrument. In: Proc. Audio Mostly 2016. [doi:10.1145/2986416.2986428](https://doi.org/10.1145/2986416.2986428)

[3] McPherson AP, Jack RH, Moro G. Action-sound latency: are our tools fast enough? In: Proc. NIME 2016. [PDF](https://www.nime.org/proceedings/2016/nime2016_paper0005.pdf)

[4] Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed mathematical model. Journal of Neuroscience. 1985;5(7):1688–1703. [doi:10.1523/JNEUROSCI.05-07-01688.1985](https://doi.org/10.1523/JNEUROSCI.05-07-01688.1985)

[5] Dahl S. Playing the accent: comparing striking velocity and timing in an ostinato rhythm performed by four drummers. Acta Acustica united with Acustica. 2004;90(4):762–776. [PDF](http://www.sofiadahl.net/pdf/paper2-accents2.pdf)

[6] Lee DN. A theory of visual control of braking based on information about time-to-collision. Perception. 1976;5(4):437–459. [doi:10.1068/p050437](https://doi.org/10.1068/p050437)

[7] Bernier YW. Latency compensating methods in client/server in-game protocol design and optimization. In: Game Developers Conference 2001. [PDF](https://www.gamedevs.org/uploads/latency-compensation-in-client-server-protocols.pdf)

[8] Large EW, Kolen JF. Resonance and the perception of musical meter. Connection Science. 1994;6(2–3):177–208. [doi:10.1080/09540099408915723](https://doi.org/10.1080/09540099408915723)

[9] Cemgil AT, Kappen B, Desain P, Honing H. On tempo tracking: tempogram representation and Kalman filtering. Journal of New Music Research. 2000;29(4):259–273. [doi:10.1080/09298210008565462](https://doi.org/10.1080/09298210008565462)

[10] Desain P, Honing H. The quantization of musical time: a connectionist approach. Computer Music Journal. 1989;13(3):56–66. [JSTOR](https://www.jstor.org/stable/3680012)

[11] Large EW, Jones MR. The dynamics of attending: how people track time-varying events. Psychological Review. 1999;106(1):119–159. [doi:10.1037/0033-295X.106.1.119](https://doi.org/10.1037/0033-295X.106.1.119)

[12] Aerodrums. Latency (125 fps for Aerodrums 1, 132 fps for Aerodrums 2). [aerodrums.com](https://aerodrums.com/forums/viewtopic.php?t=83)

[13] Knibbe J, Benko H, Wilson AD. Juggling the effects of latency: motion prediction approaches to reducing latency in dynamic projector-camera systems. Microsoft Research Technical Report MSR-TR-2015-35; 2015. [PDF](https://www.hbenko.com/publications/2015/Juggling_Knibbe_MSR_TR.pdf)

[14] Smith JO. Quadratic interpolation of spectral peaks. In: Spectral Audio Signal Processing. CCRMA, Stanford. [online](https://ccrma.stanford.edu/~jos/sasp/Quadratic_Interpolation_Spectral_Peaks.html)

[15] Repp BH. Sensorimotor synchronization: a review of the tapping literature. Psychonomic Bulletin & Review. 2005;12(6):969–992. [doi:10.3758/BF03206433](https://doi.org/10.3758/BF03206433)

[16] Dragan AD, Srinivasa SS. A policy-blending formalism for shared control. International Journal of Robotics Research. 2013;32(7):790–805. [doi:10.1177/0278364913490324](https://doi.org/10.1177/0278364913490324)

[17] W3C WICG. HTMLVideoElement.requestVideoFrameCallback(), VideoFrameCallbackMetadata (captureTime, presentationTime, mediaTime). [spec](https://wicg.github.io/video-rvfc/)

---

*Note on citations: [4], [5], [6], [8], [11] and [13] are cited for the claims the earlier report already verified them for; [9] and [10] for the model families named; [1] and [17] were read in full for this document. Every number in §3 is reproducible from the committed scripts and the generator's spec, which the set's `index.json` records.*
