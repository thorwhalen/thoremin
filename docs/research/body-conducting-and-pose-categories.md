# Body conducting and pose categories: which body channel carries the beat, and at which level

Research for the body-movement epic (#386), sub-issue A1 (#373). It folds in the research section of the 2026-10-13 body-movement design (§1 below, unchanged in substance) and adds what the design asked to be measured before any default is chosen (§2 to §5): four new pose fixtures, a channel-by-level table on five real clips and one synthetic control, a default channel set for the body conductor and for the dancer's `auto` channel, and an answer on "two levels at once give the meter". It extends the repo's three maps (`body-and-pace-research-map.md`, `rhythm-from-gesture-research-map.md`, `conducting-and-virtual-orchestra-research-map.md`) rather than repeating them.

## 0. Answer in brief

- **Body conductor, default channels:** the beating arm's strokes through the existing stroke detector when the arms are in view (nothing else in the body comes close: the beating elbow reaches R 0.85 to 0.92 at the beat), plus the **height of the trunk centroid** (the midpoint of shoulders and hips, `com.y`) as the body's own beat channel, read at its turning point (`extremum`), with its lag learned per player. The trunk locked to the hand's beat on the 4-pattern and the 2-pattern clips (R 0.77 and 0.68, Rayleigh p below 10⁻⁴; F after the lag 0.49 and 0.37 against chance levels of 0.33 and 0.30) and not on the slow 3-pattern hymn (R 0.35, p 0.08). The head alone is weaker than the trunk on every clip and is not a default. The **torso's rotation** (shoulder yaw) is the bar channel, not a beat channel (R at the bar 0.98 and 0.84 on the same two clips), with a caveat: the pelvis's rotation locks less (0.68 and 0.65), so part of the shoulders' rotation is the beating arm pulling one shoulder.
- **Dancer's `auto` channel:** keep the **stride** as the default and choose among {stride, lateral sway, torso rotation, trunk height} by the pulse follower's strength while trusted, with the 3 s persistence the pace controller already uses. On both dance clips the stride is periodic at the bar (ACF period 3.95 and 4.07 beats); Que Calor's lateral sway locks at the BEAT (R 0.59, p 0.0004: the weight shifting with every step) and its torso rotation at the bar (0.77, p 0.002); neither dancer's head or hips lock at the beat (#339 item 3: they do not earn a place as defaults), and the multi-joint sum is never better than the best single channel.
- **"Two levels at once give the meter": no** (not as a general mechanism). The ratio of a lateral period to a vertical one gave the conductor's meter on two of three clips (3.73 for a 4-pattern, 2.04 for a 2-pattern) but nothing on the 3-pattern, no dancer showed a beat-level vertical at all, and on the synthetic control the ratio read 2 for a 4-beat bar because a half-bar channel (the steps) outscored the bar channel (the sway). A7 should therefore take the bar's period and downbeat from torso rotation for a body conductor and snap it to the score's stated meter, rather than infer the meter from the body.
- **For the impact detector (A2):** the event that won is the channel's own turning point (`extremum`: 31 of the 32 significant cells on the real clips, the reference arm left out), not the acceleration magnitude (1), the directional impact or the speed's deceleration (none); a speed-only deceleration fires at both ends of a bounce. The multi-joint envelope of design §3.3 lost to the best single channel on every clip, even with weights matched to the level; select a channel (or weight by phase locking), do not sum.

## 1. Research

Sources were checked by a research pass on 2026-10-13 (DOIs through Crossref, arXiv IDs on their abstract pages); anything not confirmed is marked.

### 1.1 Visual beats in dance video

- **The visual beat is a kinematic event.** Davis and Agrawala build a "directogram" from optical flow, an impact envelope (the visual counterpart of an audio onset envelope), a visual tempogram, and pick beats by dynamic programming; aligning visual beats to musical ones makes footage read as dance [1]. Earlier, Kim, Park and Shin took motion beats from changes in movement direction and speed [2], Shiratori et al. segmented dance at minima of hand speed [3] (detail not re-checked), and Chu and Tsai and Ho et al. extracted and evaluated motion beats for dance video [4,5].
- **The metric.** AIST++ defines kinematic beats as local minima of kinetic velocity and scores a dance by the Beat Align Score, `BAS = (1/m) Σ_i exp(-min_j ||t_i^x - t_j^y||² / 2σ²)` with σ = 3 frames at 60 fps (50 ms); it is one-directional (every motion beat should land near a music beat, not every music beat needs a motion beat); real data scores 0.292 [6]. Bailando reverses the direction (each music beat looks for its nearest dance beat; ground truth 0.237) [7]; Lee et al. count a "beat hit rate" [8]. At thoremin's 30 fps the same σ is 1.5 frames.
- **The ceiling.** Pedersoli and Goto tracked dance beats from 13 OpenPose keypoints alone (neck, shoulders, elbows, wrists, hips, knees, ankles; face and feet dropped as unreliable) with a temporal convolutional network and an HMM, and reached F = 0.61 at best, well below audio beat tracking on the same clips; a periodicity loss helped most [9]. Pose alone does not give an audio-grade beat, which is why every design here puts a strong periodic prior (ictus) behind the anchors, and why the body conductor's anchors only correct a prediction.

### 1.2 Which body parts carry which metrical level

- Burger et al. (60 participants, 73-192 bpm, full text read): **vertical movement locks at the beat level; horizontal movement (side to side and front to back) locks at the bar level**; faster music pushes locking to higher levels; the preferred tempo is about 110-120 bpm; and the **phase differs between people** (whether one moves down or up on the beat), so phase must be learned per player, not hard-coded [11].
- Toiviainen, Luck and Thompson's eigenmodes of music-induced movement: side-to-side arm movement at the beat, upper-torso rotation at two beats, lateral torso flexion at four [10]; the press summary assigns the levels slightly differently, so the exact mapping is not settled (full text not read).
- Burger et al. 2018: the level people lock to depends on tempo and on low-frequency spectral flux [12].
- In this repo, before this measurement, on one dancer: the stride locks at the bar, head and hips at the noise floor (#339). §3 adds a second dancer and three conductor clips.

### 1.3 Conducting with the body

- **Where an observer hears the beat in a gesture.** Luck and Sloboda (24 participants): absolute acceleration along the trajectory is the main cue for the beat's position, with peak speed mattering on wide curves [13]; Bishop and Goebl: in ensemble cueing gestures, peak acceleration marks beat position while periodicity and peak velocity carry tempo, and head nods count [14]; Luck and Toiviainen linked the perceived beat to periods of acceleration [15]. ictus's stroke detector uses the turning point and measures the deceleration into it, which is the same event seen from the other side for a stroke that stops; for a bounce that does not stop sharply, acceleration peaks are the other candidate. §3 measures both.
- **The closest precedent to thoremin.** Mermerci et al. (2026) control a virtual orchestra from **MediaPipe Pose Landmarker at 20 Hz** on 9 upper-body points (shoulders, elbows, wrists, hands, hip centre), estimate beat phase with a hierarchical LSTM, and run a **finite-state machine**: waiting for the upbeat, waiting for the downbeat, and a sleep state for fermatas with a minimum wait; the music starts on an upbeat [16]. This is evidence that pose (not hand) landmarks are good enough for conducting.
- **Systems.** Personal Orchestra (an infrared baton steering tempo, dynamics and section emphasis over recorded audio and video) [17]; Kolesnik and Wanderley's HMMs for right-hand beats and left-hand expressive gestures [18]; the Conductor's Jacket, whose thesis notes that cut-offs and beats look alike and only the score's context tells them apart [19]; Sarasúa and Guaus on beat tracking from multi-subject Kinect conducting data [20] (findings not read; the conducting map §1.5 reports their related finding that loudness-from-movement models differ substantially between subjects).
- **Articulation.** The e-baton (NIME 2026): acceleration alone missed slow fluid gestures; adding jerk and rotation fixed it [21]. That supports Laban flow (mean jerk, already `body.effort.flow`) as the legato end of articulation.

### 1.4 Probabilistic tempo tracking for motion onsets

- Cemgil et al.'s tempogram plus Kalman filter suits sparse, irregular onsets such as motion events [22]; Hainsworth and Macleod's particle filter [23].
- The **bar-pointer** model infers tempo, meter and rhythmic pattern jointly and includes a Poisson observation model for onset events, which maps onto motion events directly [24]; Krebs, Böck and Widmer made its state space efficient [25]; madmom's online DBN tracker is a ready causal template (55-215 bpm by default) [26]; BeatNet does online beat, downbeat and meter with a particle filter [27]. These are the backends a "beat and bar from the body" prior (A7) would grow into if the integer-ratio rule proves too crude.
- Large and Kolen's adaptive oscillator [28] is ictus's v1 prior; Righetti, Buchli and Ijspeert's adaptive-frequency oscillator learns the frequency of a CONTINUOUS periodic input with no onsets at all [29], a candidate for a bounce channel that the pulse follower currently handles with an ACF.

### 1.5 Latency and prediction at 30 fps

- People tap 20-80 ms ahead of the beat (negative mean asynchrony) and can synchronise with intervals from about 0.1 s to 1.8 s [30,31] (numbers from the reviews, not re-read). A moving visual beat (a bouncing ball) supports synchronisation nearly as well as an audio metronome, flashes do not [32], which is a point for showing the player a moving beat cursor rather than a flash.
- The target for intimate musical control is about 10 ms latency with 1 ms jitter [33]. MediaPipe's documented per-frame pose latency: Heavy, Full, Lite at 53, 25 and 20 ms on a Pixel 3 GPU and 38, 27 and 25 ms on a 2017 MacBook Pro; BlazePose runs 33 keypoints above 30 fps on a Pixel 2; world landmarks are metres with the origin at the mid-hip; landmark smoothing is on by default [34]. No published browser benchmark was found.
- The One Euro filter: start with a 1 Hz minimum cutoff and β = 0, lower the cutoff while still until jitter goes, then raise β by decades while moving fast until lag is acceptable [35]. The conductor already dropped a median prefilter for costing a frame (#231), so any smoothing must be measured against the parabolic fit first.

### 1.6 Pose categories for interaction

- MediaPipe's pose-classification guide: normalise each pose by torso size and rotate it upright, use pairwise joint distances, run a two-pass k-NN (drop outliers by the max per-coordinate distance, choose by the mean), smooth class probabilities with an exponential moving average, and use enter and exit hysteresis thresholds; it recommends a few hundred samples per class [36]. thoremin's classifier already has the hysteresis tracker and noise-unit distances; the guide's torso-upright normalisation is the torso frame of the pose feature space (B1, #381).
- Interactive machine learning: Wekinator's record, train, test, repeat loop [37] and Teachable Machine's in-browser pose classes [38] are the UX precedents #330 already follows.
- Invariance: generalized Procrustes alignment removes translation, scale and rotation [39]; view-adaptive skeleton models learn a viewpoint transform [40]; one-shot skeleton recognition by metric learning [41,42] is the "few examples per category" regime a personal carve-out lives in.
- Dynamic gestures (out of v1): the $-family template recognisers [43,44], the Gesture Follower [45] and GVF, which also estimates speed, scale and rotation as a gesture unfolds [46].

## 2. The measurement

### 2.1 The clips

The four new clips are from Wikimedia Commons under CC BY 3.0, so the derived pose streams may be committed with attribution (each fixture's `meta.json` names the licence, author and source page); Que Calor is the existing #186 fixture, whose `meta.json` names no licence (#417). The videos and audio stay in the app-data directory; only the pose streams (`camBody.body.ndjson.gz`, `scripts/video_to_pose.py`, MediaPipe PoseLandmarker full) and the replayed feature vectors are committed.

| fixture | what | length | reference grid | meter |
|---|---|---:|---|---:|
| `video_body_conducting_44` | David Drillock conducting a choir through alleluia verses, simple 4 pattern, three-quarter front, head to knees [47] | 24 s | the conductor's own right-wrist strokes (ictus's stroke detector), 87 bpm | 4 |
| `video_body_conducting_34` | the same conductor, Bortniansky's Cherubic Hymn, 3 pattern, slow and uneven [48] | 27 s | the same, about 71 bpm with beats from 0.54 to 1.47 s | 3 |
| `video_body_conducting_24` | the same conductor, the Greek Trisagion, 2 pattern [49] | 24.5 s | the same, 62 bpm | 2 |
| `video_body_budots` | a Budots dance (a bouncing street dance), the longest uncut shot, three dancers, the most confident pose per frame [50] | 13.5 s | the soundtrack's beats, librosa's beat tracker [51,52], 143.5 bpm, interval CV 0.027 | 4 |
| `video_body_que_calor` (existing, #186) | a dancer stepping a routine | 20 s | the stated tempo, 129.2 bpm, phase unknown | 4 |
| synthetic control (generated, not committed) | `synthetic-body` with bounce at the beat, steps and arms at the half-bar, sway at the bar, 1.5 px landmark noise | 30 s | the generator's own, 120 bpm | 4 |

Two choices need saying. **The conductor's grid is the conductor's own hand.** The choir is legato: the soundtrack's onset autocorrelation peaks at only 0.2, and librosa's tracker returned 123 bpm against the 87 bpm the conductor beats. In conducting the beat is defined by the gesture, so the baton wrist is the reference and its rows are marked "(the grid)" and "(same arm)": they are a check of the method, not a finding. The question the conductor clips answer is therefore "when a conductor beats with the hand, what else in the body marks it?", which is what a body conductor (A3) needs to know about channels, but it is not the same as a player who conducts with the body on purpose; that case needs the self-recorded take of §5. **The grid's holds are not scored**: an interval longer than 1.6 median intervals (the conductor between verses) splits the grid into runs, and only anchors inside a run count. **False doubles are dropped**: a stroke closer than 0.6 median intervals to its neighbour (a wobble at the bottom of a slow stroke; the 3-pattern hymn had seven) loses to the stronger of the pair.

What was looked at and rejected, so a later session does not repeat it: the AIST Dance Video Database (research use only, no redistribution [53]); AIST++'s keypoints (CC BY 4.0 annotations [54], but the download requires accepting the database's research-only terms, so not without the maintainer's decision); YouTube's Creative Commons search (it works, but every video page from this server answers with a bot check that needs a signed-in cookie); a Commons Beethoven 5 performance (wide shots, the conductor a few pixels tall, cuts); two more Commons dance clips (dark, filmed from behind, a crowd: no channel locked to anything, a null result, not committed).

### 2.2 Channels, events, levels, scores

`scripts/body/lib_channels.ts` holds the method; `scripts/body/measure_channels.ts` prints the tables; every cell is in `docs/research/data/body-channels.csv`.

- **Channels**, in image coordinates over a running 1 s median torso length, gaps up to 3 frames bridged, a 2 s moving average subtracted: `head.y` (nose height), `hips.y`, `com.y` (the trunk centroid, the midpoint of shoulders and hips), `hipsOverAnkles.y` (the knee bounce, needs the feet), `wrist.l/r` and `elbow.l/r` (points), `stride` (the ankles' horizontal distance, as `body-pulse`), `sway.x` (the trunk over the ankles when both are in view in 80 % of the frames, else the trunk alone: one mode per clip), `torso.yaw` (the shoulder line's angle in the world landmarks' x-z plane, unwrapped), `hips.yaw` (the hip line's, the control that says how much of the shoulders' rotation is the beating arm), and two multi-joint envelopes: `multi` (design §3.3: each joint's directional deceleration over its own median, averaged) and `multi.weighted` (each joint weighted by its own autocorrelation at the level's period, the matched weighting of §3.3 step 3, which needs a tempo but no grid phase).
- **Events** (what an anchor is): `decel` (a peak of the speed's deceleration: the dance literature's visual beat; it has no direction, so a bounce fires it at both ends), `accel` (a peak of the acceleration magnitude: where observers place a conductor's beat [13,14]), `impact` (directional: acceleration along the channel's axis toward one end, peaking as the movement brakes into the bottom or the top; §3.3's vertical option), `extremum` (the channel's own turning point; for a wrist its vertical, which is what ictus's stroke detector fires on). `impact` and `extremum` are tried at both polarities, since which end of a bounce lands on the beat differs between people [11].
- **Levels:** beat, half-bar (in 4 only), bar. Anchors are picked once per level: local maxima of the event's envelope, kept greedily by height at least half a level period apart, above the envelope's median plus one MAD, refined by a parabola (the impact detector told the level).
- **Scores per cell:** F (±70 ms, `fMeasure` from ictus) at the best of the level's downbeat phases; **F (lag)**, the same after removing the anchors' circular-mean lag (what a calibrated per-player offset could reach; one fitted constant, so slightly optimistic); **R**, the circular resultant of the anchors' phase in the level's cycle (phase locking regardless of lag), with the anchor count in brackets and the Rayleigh test [55] marked `*` for p < 0.01 and `**` for p < 0.001; the AIST++ beat-alignment score and Cemgil's accuracy are in the CSV. Under each table, **chance**: what F after the lag reaches for random anchors at one per beat (200 draws); a channel's F means something only above its 95th percentile. The table's cell is the event (and polarity) with the most significant lock, its initial printed (`d`, `a`, `i`, `e`); R alone is not used to choose, because it rewards a channel that fires three times in phase. The choice among four events and two polarities makes a starred p about eight times too generous; the claims below rest on cells far past that (p below 10⁻⁴) or on agreement across clips.

### 2.3 The method's control

On the synthetic control the measurement finds what was put in: the trunk, hips and head at the beat (R 1.00, F 0.99), the stride and the arms at the half-bar (R 0.98 to 0.99), the sway at the bar (R 0.96), and no bar lock from a beat-level channel (R 0.15). Two things it taught: the multi-joint sum fails even here (R 0.13 at the beat), because joints at different levels cancel; and the generator's bounce is sharp at the TOP, not the bottom its comment says (the `|sin|` dip is zero, the highest point, at each period), which a later test of a "bottom of the bounce" detector would trip on (#417).

## 3. Results

### 3.1 F and R per channel per level per fixture

Columns: F | F after the lag | R (anchors) event. The event initials: `d` decel, `a` accel, `i` impact, `e` extremum. A dash is a level the meter does not have.

#### video_body_conducting_44

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | 0.15 | 0.36 | 0.31 (35) i | 0.15 | 0.15 | 0.34 (11) e | 0.35 | 0.24 | 0.69* (9) e |
| hips.y | 0.00 | 0.54 | 0.83** (21) e | 0.00 | 0.67 | 0.64** (17) e | 0.00 | 0.24 | 0.67 (9) a |
| com.y | 0.34 | 0.49 | 0.77** (22) e | 0.00 | 0.61 | 0.52* (17) e | 0.00 | 0.75 | 0.75* (8) e |
| hipsOverAnkles.y | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d |
| wrist.l | 0.00 | 0.68 | 0.44* (28) e | 0.00 | 0.84 | 0.79** (15) e | 0.35 | 0.00 | 0.71* (9) e |
| wrist.r (the grid) | 0.86 | 0.86 | 0.99** (25) e | 0.00 | 0.73 | 0.44 (18) e | 0.00 | 0.82 | 0.76* (9) d |
| elbow.l | 0.14 | 0.58 | 0.58** (28) e | 0.11 | 0.11 | 0.27 (21) e | 0.00 | 0.00 | 0.27 (11) i |
| elbow.r (same arm) | 0.00 | 0.69 | 0.92** (21) e | 0.00 | 0.80 | 0.85** (15) i | 0.00 | 0.94 | 0.78* (9) i |
| stride | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d |
| sway.x | 0.17 | 0.21 | 0.20 (17) e | 0.06 | 0.13 | 0.45 (15) e | 0.12 | 0.35 | 0.64 (9) e |
| torso.yaw | 0.00 | 0.34 | 0.64** (16) e | 0.00 | 0.40 | 0.90** (14) e | 0.00 | 0.38 | 0.98** (8) e |
| hips.yaw | 0.00 | 0.36 | 0.55* (19) e | 0.00 | 0.38 | 0.76** (16) e | 0.00 | 0.59 | 0.68 (9) d |
| multi | 0.19 | 0.25 | 0.32 (33) | 0.22 | 0.11 | 0.08 (21) | 0.00 | 0.71 | 0.73* (9) |
| multi.weighted | 0.13 | 0.19 | 0.47** (32) | 0.22 | 0.51 | 0.21 (20) | 0.11 | 0.67 | 0.56 (10) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.23, 95th percentile 0.33.

#### video_body_conducting_34

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | 0.14 | 0.34 | 0.20 (41) i | - | - | - | 0.10 | 0.10 | 0.47 (11) a |
| hips.y | 0.11 | 0.33 | 0.26 (25) e | - | - | - | 0.19 | 0.00 | 0.26 (11) e |
| com.y | 0.08 | 0.27 | 0.35 (21) e | - | - | - | 0.10 | 0.20 | 0.29 (10) e |
| hipsOverAnkles.y | 0.00 | 0.00 | 0.00 (0) d | - | - | - | 0.00 | 0.00 | 0.00 (0) d |
| wrist.l | 0.49 | 0.42 | 0.66** (27) e | - | - | - | 0.15 | 0.08 | 0.15 (16) d |
| wrist.r (the grid) | 0.04 | 0.50 | 0.78** (22) e | - | - | - | 0.00 | 0.40 | 0.84** (10) e |
| elbow.l | 0.42 | 0.35 | 0.67** (22) e | - | - | - | 0.10 | 0.10 | 0.47 (11) e |
| elbow.r (same arm) | 0.50 | 0.42 | 0.86** (18) e | - | - | - | 0.00 | 0.60 | 0.84** (10) e |
| stride | 0.00 | 0.00 | 0.00 (0) d | - | - | - | 0.00 | 0.00 | 0.00 (0) d |
| sway.x | 0.04 | 0.21 | 0.36 (17) e | - | - | - | 0.09 | 0.17 | 0.44 (13) i |
| torso.yaw | 0.06 | 0.45 | 0.31 (36) a | - | - | - | 0.11 | 0.11 | 0.47 (9) e |
| hips.yaw | 0.31 | 0.29 | 0.23 (40) d | - | - | - | 0.19 | 0.19 | 0.31 (11) e |
| multi | 0.18 | 0.15 | 0.01 (37) | - | - | - | 0.17 | 0.17 | 0.10 (13) |
| multi.weighted | 0.27 | 0.24 | 0.31 (37) | - | - | - | 0.16 | 0.16 | 0.11 (15) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.17, 95th percentile 0.28.

#### video_body_conducting_24

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | 0.00 | 0.27 | 0.47 (13) e | - | - | - | 0.00 | 0.52 | 0.78** (11) e |
| hips.y | 0.18 | 0.27 | 0.58** (20) e | - | - | - | 0.00 | 0.22 | 0.37 (15) e |
| com.y | 0.23 | 0.37 | 0.68** (19) e | - | - | - | 0.00 | 0.30 | 0.46 (15) e |
| hipsOverAnkles.y | 0.00 | 0.00 | 0.00 (0) d | - | - | - | 0.00 | 0.00 | 0.00 (0) d |
| wrist.l | 0.00 | 0.39 | 0.72** (22) e | - | - | - | 0.00 | 0.15 | 0.50 (15) a |
| wrist.r (the grid) | 0.89 | 0.89 | 0.98** (21) e | - | - | - | 0.00 | 0.77 | 0.70** (14) e |
| elbow.l | 0.09 | 0.44 | 0.60** (21) e | - | - | - | 0.00 | 0.15 | 0.48 (14) a |
| elbow.r (same arm) | 0.00 | 0.68 | 0.91** (20) e | - | - | - | 0.00 | 0.56 | 0.78** (13) a |
| stride | 0.00 | 0.00 | 0.00 (0) d | - | - | - | 0.00 | 0.00 | 0.00 (0) d |
| sway.x | 0.15 | 0.05 | 0.35 (15) e | - | - | - | 0.08 | 0.08 | 0.73** (12) e |
| torso.yaw | 0.11 | 0.39 | 0.28 (33) i | - | - | - | 0.00 | 0.26 | 0.84** (11) e |
| hips.yaw | 0.05 | 0.29 | 0.65** (17) e | - | - | - | 0.00 | 0.40 | 0.65* (13) e |
| multi | 0.08 | 0.15 | 0.16 (28) | - | - | - | 0.00 | 0.07 | 0.45 (15) |
| multi.weighted | 0.12 | 0.29 | 0.47* (25) | - | - | - | 0.07 | 0.15 | 0.36 (15) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.17, 95th percentile 0.30.

#### video_body_budots

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | 0.46 | 0.57 | 0.29 (39) d | 0.17 | 0.08 | 0.41 (8) e | 0.14 | 0.13 | 0.41 (7) e |
| hips.y | 0.28 | 0.56 | 0.32 (33) i | 0.16 | 0.24 | 0.25 (9) e | 0.22 | 0.22 | 0.31 (10) i |
| com.y | 0.25 | 0.59 | 0.32 (33) i | 0.17 | 0.24 | 0.33 (9) e | 0.13 | 0.13 | 0.45 (8) e |
| hipsOverAnkles.y | 0.14 | 0.28 | 0.30 (12) a | 0.11 | 0.22 | 0.90 (3) e | 0.17 | 0.33 | 0.86 (4) e |
| wrist.l | 0.20 | 0.56 | 0.32 (30) i | 0.22 | 0.22 | 0.39 (12) a | 0.31 | 0.31 | 0.72 (5) e |
| wrist.r | 0.43 | 0.46 | 0.27 (34) d | 0.22 | 0.50 | 0.24 (21) d | 0.25 | 0.50 | 0.53 (8) e |
| elbow.l | 0.16 | 0.41 | 0.22 (32) i | 0.23 | 0.15 | 0.39 (10) e | 0.15 | 0.14 | 0.48 (6) e |
| elbow.r | 0.44 | 0.65 | 0.29 (37) d | 0.08 | 0.32 | 0.42 (10) e | 0.13 | 0.38 | 0.47 (8) e |
| stride | 0.32 | 0.41 | 0.40 (13) d | 0.16 | 0.16 | 0.26 (9) a | 0.33 | 0.33 | 0.97 (4) d |
| sway.x | 0.47 | 0.50 | 0.25 (33) i | 0.35 | 0.35 | 0.27 (19) i | 0.18 | 0.00 | 0.45 (4) e |
| torso.yaw | 0.09 | 0.34 | 0.30 (16) e | 0.41 | 0.41 | 0.48 (19) a | 0.27 | 0.27 | 0.64 (8) e |
| hips.yaw | 0.21 | 0.51 | 0.22 (36) d | 0.09 | 0.18 | 0.76 (7) e | 0.15 | 0.46 | 0.95* (6) e |
| multi | 0.32 | 0.45 | 0.15 (31) | 0.25 | 0.31 | 0.26 (17) | 0.22 | 0.42 | 0.18 (11) |
| multi.weighted | 0.33 | 0.48 | 0.15 (36) | 0.00 | 0.00 | 0.00 (0) | 0.38 | 0.10 | 0.12 (13) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.32, 95th percentile 0.45.

#### video_body_que_calor (stated tempo, phase unknown: F is after the lag)

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | - | 0.30 | 0.28 (23) e | - | 0.32 | 0.46 (17) e | - | 0.32 | 0.22 (14) e |
| hips.y | - | 0.32 | 0.30 (20) e | - | 0.22 | 0.49 (15) e | - | 0.26 | 0.22 (13) e |
| com.y | - | 0.31 | 0.35 (21) e | - | 0.28 | 0.51 (15) e | - | 0.17 | 0.25 (14) i |
| hipsOverAnkles.y | - | 0.28 | 0.29 (21) e | - | 0.31 | 0.53* (18) e | - | 0.10 | 0.22 (11) e |
| wrist.l | - | 0.46 | 0.21 (44) i | - | 0.19 | 0.33 (11) e | - | 0.42 | 0.43 (9) e |
| wrist.r | - | 0.36 | 0.31 (35) i | - | 0.46 | 0.50* (18) a | - | 0.09 | 0.41 (11) a |
| elbow.l | - | 0.37 | 0.20 (38) a | - | 0.33 | 0.48 (15) e | - | 0.35 | 0.36 (12) e |
| elbow.r | - | 0.42 | 0.23 (38) i | - | 0.19 | 0.69* (9) e | - | 0.60 | 0.65 (9) e |
| stride | - | 0.25 | 0.41 (14) e | - | 0.36 | 0.58 (12) e | - | 0.12 | 0.74 (7) e |
| sway.x | - | 0.47 | 0.59** (21) e | - | 0.37 | 0.40 (17) e | - | 0.26 | 0.36 (12) a |
| torso.yaw | - | 0.20 | 0.22 (18) e | - | 0.18 | 0.33 (12) e | - | 0.20 | 0.77* (9) e |
| hips.yaw | - | 0.42 | 0.12 (57) i | - | 0.19 | 0.57 (10) e | - | 0.38 | 0.58 (10) e |
| multi | - | 0.37 | 0.14 (53) | - | 0.20 | 0.22 (28) | - | 0.23 | 0.22 (16) |
| multi.weighted | - | 0.38 | 0.14 (52) | - | 0.12 | 0.24 (28) | - | 0.15 | 0.27 (16) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.30, 95th percentile 0.40.

#### synthetic

| channel | beat F | beat F (lag) | beat R | half-bar F | half-bar F (lag) | half-bar R | bar F | bar F (lag) | bar R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| head.y | 0.99 | 0.99 | 1.00** (59) e | 0.29 | 0.29 | 0.13 (45) d | 0.00 | 0.00 | 0.21 (20) e |
| hips.y | 0.99 | 0.99 | 1.00** (59) e | 0.03 | 0.16 | 0.08 (43) i | 0.31 | 0.31 | 0.20 (24) d |
| com.y | 0.99 | 0.99 | 1.00** (59) e | 0.00 | 0.38 | 0.15 (43) i | 0.54 | 0.54 | 0.15 (26) e |
| hipsOverAnkles.y | 0.99 | 0.99 | 1.00** (59) e | 0.29 | 0.32 | 0.11 (46) d | 0.40 | 0.00 | 0.09 (25) e |
| wrist.l | 0.99 | 0.99 | 0.97** (59) a | 0.00 | 1.00 | 0.99** (30) e | 0.00 | 0.00 | 0.33 (21) d |
| wrist.r | 0.02 | 0.98 | 0.92** (61) d | 0.00 | 1.00 | 0.98** (30) e | 0.44 | 0.00 | 0.31 (21) a |
| elbow.l | 0.97 | 0.97 | 0.86** (62) a | 0.00 | 0.97 | 0.99** (30) e | 0.25 | 0.10 | 0.11 (25) i |
| elbow.r | 0.95 | 0.95 | 0.87** (60) a | 0.00 | 0.97 | 0.98** (30) e | 0.00 | 0.28 | 0.32 (21) e |
| stride | 0.00 | 0.64 | 0.94** (30) e | 0.00 | 0.97 | 0.98** (30) e | 0.06 | 0.28 | 0.22 (21) i |
| sway.x | 0.45 | 0.45 | 0.10 (83) d | 0.38 | 0.38 | 0.69** (17) e | 0.60 | 0.60 | 0.96** (15) e |
| torso.yaw | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d |
| hips.yaw | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d | 0.00 | 0.00 | 0.00 (0) d |
| multi | 0.00 | 0.57 | 0.13 (67) | 0.00 | 0.34 | 0.15 (40) | 0.00 | 0.00 | 0.07 (21) |
| multi.weighted | 0.03 | 0.61 | 0.55** (65) | 0.00 | 0.34 | 0.18 (40) | 0.00 | 0.00 | 0.07 (21) |

Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median 0.28, 95th percentile 0.35.

### 3.2 The pulse follower per channel (the `auto` channel's evidence)

ictus's pulse follower (`createPulseFollower`, the `body-pulse` defaults: 8 s window, 0.3 to 3 s periods, the oscillator prior) over each scalar channel: the fraction of ticks after a 4 s warm-up with a trusted pulse, the median ACF strength while trusted, the level it held most often in grid beats, and that level's share.

#### video_body_conducting_44

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.27 | 0.57 | 3.75 | 0.50 |
| hips.y | 0.19 | 0.69 | 4 | 0.72 |
| com.y | 0.42 | 0.71 | 4 | 0.62 |
| hipsOverAnkles.y | 0.00 | - | - | 0.00 |
| wrist.l | 0.64 | 0.66 | 4 | 0.63 |
| wrist.r | 0.74 | 0.73 | 1 | 0.44 |
| elbow.l | 0.03 | 0.49 | 4 | 1.00 |
| elbow.r | 0.52 | 0.78 | 4 | 0.79 |
| stride | 0.00 | - | - | 0.00 |
| sway.x | 0.08 | 0.48 | 2.75 | 0.72 |
| torso.yaw | 0.47 | 0.82 | 4 | 0.89 |
| hips.yaw | 0.47 | 0.66 | 4 | 0.92 |

#### video_body_conducting_34

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.25 | 0.75 | 2 | 0.76 |
| hips.y | 0.07 | 0.48 | 3.25 | 0.53 |
| com.y | 0.32 | 0.58 | 3 | 0.54 |
| hipsOverAnkles.y | 0.00 | - | - | 0.00 |
| wrist.l | 0.53 | 0.56 | 1 | 0.39 |
| wrist.r | 0.59 | 0.65 | 1 | 0.51 |
| elbow.l | 0.26 | 0.60 | 3 | 0.56 |
| elbow.r | 0.35 | 0.64 | 3.25 | 0.44 |
| stride | 0.00 | - | - | 0.00 |
| sway.x | 0.22 | 0.60 | 3 | 0.67 |
| torso.yaw | 0.30 | 0.70 | 2.75 | 0.48 |
| hips.yaw | 0.20 | 0.54 | 3.25 | 0.47 |

#### video_body_conducting_24

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.41 | 0.71 | 2 | 0.94 |
| hips.y | 0.30 | 0.50 | 2 | 0.71 |
| com.y | 0.64 | 0.53 | 2 | 0.96 |
| hipsOverAnkles.y | 0.00 | - | - | 0.00 |
| wrist.l | 0.00 | - | - | 0.00 |
| wrist.r | 0.91 | 0.74 | 2 | 0.64 |
| elbow.l | 0.03 | 0.48 | 2.75 | 1.00 |
| elbow.r | 0.42 | 0.58 | 1 | 0.45 |
| stride | 0.00 | - | - | 0.00 |
| sway.x | 0.44 | 0.68 | 2 | 0.68 |
| torso.yaw | 0.64 | 0.78 | 2 | 0.73 |
| hips.yaw | 0.65 | 0.60 | 2 | 0.62 |

#### video_body_budots

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.17 | 0.53 | 6.5 | 0.50 |
| hips.y | 0.00 | - | - | 0.00 |
| com.y | 0.13 | 0.48 | 6.75 | 0.83 |
| hipsOverAnkles.y | 0.10 | 0.52 | 3.75 | 0.55 |
| wrist.l | 0.42 | 0.55 | 4.25 | 0.42 |
| wrist.r | 0.21 | 0.69 | 4.5 | 0.73 |
| elbow.l | 0.09 | 0.59 | 4.25 | 0.54 |
| elbow.r | 0.23 | 0.66 | 4.5 | 0.92 |
| stride | 0.00 | - | - | 0.00 |
| sway.x | 0.26 | 0.74 | 6 | 1.00 |
| torso.yaw | 0.36 | 0.49 | 5.75 | 0.73 |
| hips.yaw | 0.13 | 0.56 | 4 | 1.00 |

#### video_body_que_calor (stated tempo, phase unknown: F is after the lag)

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.34 | 0.70 | 6 | 0.80 |
| hips.y | 0.03 | 0.45 | 6 | 0.50 |
| com.y | 0.16 | 0.54 | 6 | 0.57 |
| hipsOverAnkles.y | 0.09 | 0.55 | 3.75 | 1.00 |
| wrist.l | 0.26 | 0.61 | 4 | 0.56 |
| wrist.r | 0.06 | 0.52 | 6.25 | 1.00 |
| elbow.l | 0.00 | - | - | 0.00 |
| elbow.r | 0.23 | 0.56 | 4 | 1.00 |
| stride | 0.86 | 0.80 | 4 | 0.65 |
| sway.x | 0.49 | 0.71 | 4.25 | 0.59 |
| torso.yaw | 0.18 | 0.67 | 4.25 | 0.47 |
| hips.yaw | 0.63 | 0.73 | 4.25 | 0.55 |

#### synthetic

| channel | trusted | strength | level (beats) | share |
|---|---:|---:|---:|---:|
| head.y | 0.98 | 0.93 | 1 | 1.00 |
| hips.y | 0.98 | 0.96 | 1 | 1.00 |
| com.y | 0.98 | 0.98 | 1 | 1.00 |
| hipsOverAnkles.y | 0.98 | 0.93 | 1 | 1.00 |
| wrist.l | 0.96 | 1.00 | 2 | 1.00 |
| wrist.r | 0.98 | 1.00 | 2 | 1.00 |
| elbow.l | 0.96 | 1.00 | 2 | 1.00 |
| elbow.r | 0.98 | 1.00 | 2 | 1.00 |
| stride | 0.98 | 0.99 | 2 | 1.00 |
| sway.x | 0.96 | 0.95 | 4 | 1.00 |
| torso.yaw | 0.00 | - | - | 0.00 |
| hips.yaw | 0.00 | - | - | 0.00 |

### 3.3 Two levels at once

The strongest vertical channel's ACF period within 0.6 to 1.6 beats, the strongest lateral or rotational channel's within 1.6 to 6 beats, and their ratio (grid-free except for stating the search windows in beats).

| clip | stated beats per bar | beat level: channel, period in beats (ACF r) | bar level: channel, period in beats (ACF r) | ratio |
|---|---:|---|---|---:|
| video_body_conducting_44 | 4 | hips.y 1.06 (r 0.22) | torso.yaw 3.97 (r 0.67) | 3.73 |
| video_body_conducting_34 | 3 | hips.y 1.29 (r 0.10) | sway.x 3.18 (r 0.34) | 2.45 |
| video_body_conducting_24 | 2 | hips.y 0.95 (r 0.16) | torso.yaw 1.94 (r 0.67) | 2.04 |
| video_body_budots | 4 | - - (r -) | stride 4.07 (r 0.76) | - |
| video_body_que_calor | 4 | - - (r -) | stride 3.95 (r 0.65) | - |
| synthetic | 4 | com.y 1.00 (r 0.98) | stride 2.00 (r 0.99) | 2.00 |

## 4. What the numbers say

1. **A conductor's trunk marks the beat the conductor's hand gives**, on the 4-pattern (`com.y` R 0.77, p < 10⁻⁶; `hips.y` 0.83) and the 2-pattern (`com.y` 0.68, p < 10⁻⁴; `hips.y` 0.58), at the bottom of its travel in both. It does not on the slow 3-pattern hymn (`com.y` 0.35, p 0.08). The trunk's F is modest (0.34 and 0.23 raw, 0.49 and 0.37 after the lag, against chance levels of 0.33 and 0.30), so it is a channel to correct a prediction with, which is all design §3.8 asks of it, not a beat tracker by itself. Its lag relative to the hand's stroke is +85 ms on one clip and -112 ms on the other, so the lag must be learned per player and per piece (#427 measures it against a click, §5.2, and finds it moves within one take and cannot be measured to ±20 ms in sixteen strokes). The hips alone lock too (0.83 and 0.58), so the trunk's beat is not only the beating arm moving the shoulders.
2. **The head is not the body's beat.** On the conductor clips the head is weaker than the trunk every time (R 0.31, 0.15, 0.47, none significant at the beat). Head nods count for observers [14], but the trunk carries more of the beat in these clips.
3. **The torso's rotation marks the bar, partly through the beating arm.** `torso.yaw` at the bar: 0.98 (4-pattern, 8 anchors, p < 10⁻⁴), 0.84 (2-pattern, p < 10⁻⁴); for a conductor it is the pattern's left-right excursion seen in the torso. The pelvis's rotation, which the arm moves less, locks less (0.68, not significant; 0.65, p < 0.01), and the lateral sway agrees on the 2-pattern (0.73). A downbeat from the torso is plausible for a conductor (#187 PR 6, #364 item 3), but these clips cannot separate it from the arm that drives it; a body conductor who keeps the arms still is the test (#415).
4. **Dancers: the stride carries the bar, the sway can carry the beat, the height does not.** Que Calor's stride is periodic at 3.95 beats (ACF r 0.65) and leans toward a lock at the bar (R 0.74 on only 7 anchors, p 0.017: suggestive, not significant once the choice among eight event variants is counted); its torso rotation locks at the bar (0.77, p 0.002) and its lateral sway at the beat (0.59, 21 anchors, p 0.0004; F after the lag 0.47 against a chance level of 0.40): the weight shifting from foot to foot with every step. Budots' stride is periodic at 4.07 beats (r 0.76), but its ankles are often off screen, so the pulse follower never trusts it; both dancers' arms repeat at about 4 beats. Neither dancer's head, hips or trunk height locks at the beat (best p 0.03, 33 anchors). Budots is a bouncing dance, so this does not show that dancers fail to bounce on the beat. It shows that a bounce did not survive the pose model and 30 fps with three tracked dancers switching identities, at 143 bpm (0.42 s per beat, 12.6 frames). A single dancer bouncing to a known tempo is still missing (§5).
5. **Which event:** on the real clips, the reference arm left out, the turning point (`extremum`) won 31 of the 32 significant cells (p < 0.01), `accel` 1. The deceleration of the speed alone is the wrong event for a channel that reverses (it fires at both ends); the directional impact is a reasonable stand-in but loses to the turning point on pose data, which matches ictus's own finding for the hand (its detector fires on the turning point and measures the braking as articulation, `detector.ts`).
6. **The multi-joint envelope does not earn its place.** Equal weights: never significant at the beat on a real clip (0.32, 0.09, 0.16, 0.15, 0.14) and not on the synthetic control (0.13). Level-matched weights help (0.47, 0.35, 0.47 on the conductors) but stay below the best single non-reference channel (0.83, 0.63, 0.72). Joints in one body move at different levels (arms at the half-bar, trunk at the beat, torso at the bar), so a sum mixes levels; selecting the channel, or weighting by phase locking rather than by periodicity, is the design to build.
7. **Against chance and the literature's ceiling:** random anchors at one per beat reach an F after the lag of 0.17 to 0.32 (median) and 0.28 to 0.45 (95th percentile) on these clips, because a fitted lag and a free downbeat phase help any anchor set. The best non-reference channels clear that on the conductors (the trunk 0.49 and 0.37, the other wrist 0.68 on the 4-pattern) and only modestly on Budots (the trunk 0.59 against 0.45). Pedersoli and Goto's 0.61 for a learned tracker over 13 keypoints [9] is a raw F without a fitted lag, so it is not directly comparable; raw F here is lower because every channel has a lag of its own.
8. **What this measurement does not settle.** The meter reading has no significance floor (the beat-level vertical's ACF r is only 0.10 to 0.22, so the ratio is mostly the bar channel's own period); the 2 s moving-average detrend keeps only about two thirds of a 2.8 s bar's amplitude and slightly favours periods near 1.3 s; and the choice among events and polarities makes single-star cells weak evidence.

## 5. Defaults and decisions

- **Body conductor (A2, A3):** `conductor.source = body` reads, in this order, the beating arm's wrist through the existing stroke detector when the arm is visible (its own elbow is the fallback when the wrist is lost), and the trunk centroid's height (`com.y`) at its turning point, polarity and lag learned per player, as the body's own beat channel; the head is not in the default set; `torso.yaw` is read for the bar (downbeat and bar period), never for the beat. The impact detector's event default is the turning point (`extremum`), with `impact` as the option for a bounce channel; do not sum joints into one envelope by default. A grid taken from strokes needs a minimum interval: false doubles at the bottom of slow strokes are real (seven in 27 s of the 3-pattern).
- **Dancer (`body-pulse`, #339 item 3; built in #416):** the stride stays the default. `auto` chooses among {stride, sway.x, torso.yaw, com.y} by the pulse follower's strength while trusted, a new choice held 3 s (the pace controller's persistence). The sway is in the set because it carried Que Calor's beat; `com.y` replaces `head` and `hip` as the vertical candidate; the existing `head` and `hip` options can stay selectable but should not be in `auto`'s set: they never locked on either dancer.
- **Meter from the body (A7): no.** Two levels at once gave the right meter for the conductor on two of three clips and never for a dancer, and the ratio cannot by itself tell a half-bar from a bar (the synthetic read 2 for a 4-beat bar). A7, if built, should take only the bar's phase (the downbeat) and period from torso rotation for a body conductor, and take the meter from the score (or the player), snapping the ratio to it.
- **Still missing, and not something an agent can fetch from this server:** a single dancer bouncing in place to a known tempo (YouTube's Creative Commons videos need a signed-in download; AIST++ needs a licence decision), and a self-recorded take of a player conducting and bouncing with the body on purpose, through the trainer's click pipeline (#247). Both are asked for in #415; when they exist, the same script adds a row per fixture and the decisions above are re-checked, not re-derived.

### 5.1 Transport from the body (A5, #377)

The body conductor's start, hold and stop are rules over two numbers measured per pose frame (`createBodyMotionMeter` in `src/nodes/features/conductor_body.ts`), run by a pure state machine (`createTransport` in `packages/ictus/src/transport.ts`):

- **`raise`**: the beating wrist's height on the torso, 0 at the hip midpoint and 1 at the shoulder midpoint. With the side `auto` it is the higher wrist. A wrist the tracker does not see is extrapolated from its elbow along the upper arm (a hanging forearm below the frame of a waist-up player).
- **`motion`**: the beating arm's wrist and elbow displacement per frame over the tracker's own jitter (noise units), smoothed over 0.15 s; with the side `auto`, the arm whose wrist is higher. The jitter is the median second difference over every seen landmark, converted to a step's jitter, and then the median of those per-frame values over the last 4 s. Movement only ever inflates the per-frame value, so the median ignores a stroke, or a player settling in front of the camera while the pose model locks on, once half the window is quiet (an exponential average kept such a start several times too large for seconds, and the upbeat unseen). A still body reads about 1.

On `video_body_conducting_44` (10th to 90th percentile, right arm or `auto`) the arm at rest reads 1.5 to 2.5 noise units, the hold between the verses 2.0 to 7.6, gentle beating 5.5 to 16 and full strokes 8 to 43. The raised arm reads 0.3 to 1.2 while beating and 0.6 to 1.0 in the hold; a hanging arm reads about 0. The defaults follow from that: still below 8, the upbeat above 9, raised above 0.45, dropped below 0.2. An inverted configuration (dropped above raised, the upbeat below still) is made consistent by the transport.

The rules, each threshold a field of `conductor.transport`:

| Rule | Condition | Effect |
|---|---|---|
| Ready, then start | raised and still for `readyS` (0.4 s); then motion above `moveAbove` (the upbeat); then the first anchor | that anchor is the downbeat: beat 0 at the top, or the next stroke's beat after a cut-off; no anchor reaches the prior before it |
| Wait | running, no anchor for `waitAfterPeriods` (0.9) stroke periods, raised and still | the beat does not cross the next stroke's beat on its own |
| Hold (fermata) | no anchor for `holdAfterPeriods` (1.5) stroke periods, raised and still | `hold`: the beat runs up to just short of the next stroke's beat and stays; the next stroke releases it, restarting the prior (the tempo after a fermata is a new one) |
| Stop (cut-off) | dropped and still for `stopAfterPeriods` (1) stroke periods; an anchor in that pose is not a stroke (the detector's noise on a still body) | the prior back to `ready`, the score silent; the next start needs the ready pose and an upbeat again, and plays the next stroke's beat after the stop; past the piece's last note the beat returns to the top |
| Lost | sounding, the arm unseen for 2 s since the last stroke (the player left the frame) | stop, so walking back in does not resume the piece |

The rules are about the beating arm, so they apply to the arm points (`bodyPoint` `impact`, the default, and `wrist`). A player who bounces with the arms hanging holds exactly the cut-off pose between strokes, so the bounce points (`com`, `hips`, `head`) keep the hand's transport (the first stroke starts, the prior's own hold, no stop). A rhythm start (four regular strokes start without the ready pose) was tried for the bounce and dropped: footsteps are regular too, and the review's walk-in of five steps started the piece.

Periods are the STROKE period (A4's note: at bar level a stroke is a bar). Before any period is known the transport uses 0.75 s.

Measured on the same clip: the transport is idle until the still raised arm at 0.47 s, sees the upbeat at 0.77 s and starts on the anchor delivered at 0.90 s, the grid's first beat being 0.888 s; the first verse's strokes are then counted within 0.25 of a beat. The conductor's hold between the verses is a hold from 11.8 s to the stroke at 12.93 s.

Three consequences found while building it:

1. **The score's tempo no longer seeds the body follower when the rules are on.** A3 seeded the detector's period and both priors from the score's first tempo mark. Under the start rule the first anchor the prior sees is the downbeat, and a seed at twice the conductor's tempo (the level test's 160 bpm score) handed the detector a period short enough to take every stroke's rebound for a stroke for eight beats. The beat now moves at the marked tempo between the downbeat and the second stroke instead, and never crosses the second stroke's beat on its own.
2. **Reading the body, a fermata is released by a stroke at least half a period after it was reached.** A stroke that ends in a stop is confirmed late (the detector needs the frames after it), so the stroke that lands on a written fermata could arrive after the beat got there and count as its release. The hand conductor has the same lag (the review measured 2 to 6 frames on the hand fixtures, 7 of 12 fermatas released one stroke early on `conducting_44`), but its behaviour is left as it was (#449).
3. **A hold never freezes the beat between two strokes.** The release of a beat frozen at three quarters of a stroke has no right answer: the phase servo picks a side by rounding, and the `half` and `beat` levels then disagreed by a stroke on the same clip.

The override seam (B4, #387 choice B5): the node's `transportPose` input takes `{ ready?, hold?, cutoff? }`, and a stated predicate replaces its rule's geometry while the timing stays. Nothing feeds it yet; a personal pose category will.

### 5.2 The lead offset per joint (#427)

The body conductor plays the turning point of the joint its detector follows as the beat, so a joint that rides the stroke late (or early) moves the beat. "Learn my timing" in the Conductor tool measures each joint's lag against the trainer's click (a bar's count-in, 16 clicks; each joint of the conductor's set followed alone, as the conductor would follow it: a detector of its own whose period a rhythm prior sets, seeded at the click's tempo) as the trimmed circular mean of its anchors' phase in the click interval, and the conductor subtracts it from that joint's anchors (a joint that leads has its anchor held until its corrected time). A joint's lag is kept only when the take measured it: at least 8 anchors, R at least 0.5 (`lock`), the lag under 0.35 of a beat (`level`), a standard error under 20 ms with at least three quarters of the anchors inside the trim (`loose`), and the take's two halves within 40 ms of each other (`drift`). The offsets are a per-device pref, never an instrument setting, and a later take only replaces the joints it measured.

Replayed on the three conductor clips (`npx vite-node scripts/body/measure_lead_offset.ts`; the grid, the beating wrist's strokes, stands in for the click), with each joint ALONE followed. Each row gives the follower's lag behind the grid in ms on the test span, before and after the correction. The offset is learned on the whole clip (in-sample) or on the other half (held out). The fifth column is the calibrated lag, R, the anchor count, the standard error and the two halves' lags.

| clip | joint | test span | calibrated on | lag, R, n, SE, halves (ms) | offset or refusal | lag before | lag after | F before | F after |
|---|---|---|---|---|---|---|---|---|---|
| conducting_44 | trunk | whole | whole | 53, 0.66, 30, 15, 81/18 | drift | 45 | 45 | 0.43 | 0.43 |
| conducting_44 | trunk | 2nd half | 1st half | 89, 0.69, 16, 19, 50/125 | drift | 3 | 3 | 0.47 | 0.47 |
| conducting_44 | trunk | 1st half | 2nd half | 31, 0.67, 13, 20, 56/6 | loose | 75 | 75 | 0.40 | 0.40 |
| conducting_44 | elbow | whole | whole | -7, 0.68, 30, 14, 5/-18 | -7 | -13 | -6 | 0.45 | 0.52 |
| conducting_44 | elbow | 2nd half | 1st half | 5, 0.62, 15, 23, -25/40 | loose | -27 | -27 | 0.67 | 0.67 |
| conducting_44 | elbow | 1st half | 2nd half | -13, 0.69, 14, 21, -11/-15 | loose | 4 | 4 | 0.25 | 0.25 |
| conducting_44 | wrist | whole | whole | 5, 0.98, 31, 4, 7/4 | 5 | 8 | 3 | 0.95 | 0.95 |
| conducting_44 | wrist | 2nd half | 1st half | 7, 0.98, 15, 6, -4/18 | 7 | 4 | -4 | 0.94 | 0.94 |
| conducting_44 | wrist | 1st half | 2nd half | -1, 0.99, 15, 4, -6/3 | -1 | 13 | 14 | 0.97 | 0.97 |
| conducting_34 | trunk | whole | whole | 19, 0.13, 32, 27, 28/11 | lock | -3 | -3 | 0.23 | 0.23 |
| conducting_34 | trunk | 2nd half | 1st half | 30, 0.34, 11, 39, -47/100 | lock | -25 | -25 | 0.17 | 0.17 |
| conducting_34 | trunk | 1st half | 2nd half | -187, 0.09, 22, 34, -89/-298 | lock | -1 | -1 | 0.31 | 0.31 |
| conducting_34 | elbow | whole | whole | -69, 0.41, 39, 19, -75/-63 | lock | -89 | -89 | 0.41 | 0.41 |
| conducting_34 | elbow | 2nd half | 1st half | -80, 0.53, 19, 26, -133/-50 | loose | -91 | -91 | 0.46 | 0.46 |
| conducting_34 | elbow | 1st half | 2nd half | -76, 0.51, 17, 26, -55/-99 | loose | -88 | -88 | 0.35 | 0.35 |
| conducting_34 | wrist | whole | whole | 7, 0.77, 34, 11, -6/10 | 7 | 5 | -2 | 0.78 | 0.78 |
| conducting_34 | wrist | 2nd half | 1st half | 7, 0.79, 16, 17, -18/32 | drift | 9 | 9 | 0.79 | 0.79 |
| conducting_34 | wrist | 1st half | 2nd half | 8, 0.78, 18, 18, 15/3 | 8 | 0 | -7 | 0.77 | 0.84 |
| conducting_24 | trunk | whole | whole | -74, 0.25, 32, 28, -51/-98 | lock | -67 | -67 | 0.27 | 0.27 |
| conducting_24 | trunk | 2nd half | 1st half | -51, 0.36, 17, 42, 45/-95 | lock | -90 | -90 | 0.36 | 0.36 |
| conducting_24 | trunk | 1st half | 2nd half | -99, 0.14, 15, 33, -100/-99 | lock | -58 | -58 | 0.19 | 0.19 |
| conducting_24 | elbow | whole | whole | -101, 0.60, 27, 23, -91/-110 | loose | -107 | -107 | 0.38 | 0.38 |
| conducting_24 | elbow | 2nd half | 1st half | -90, 0.49, 15, 36, -125/-52 | lock | -125 | -125 | 0.33 | 0.33 |
| conducting_24 | elbow | 1st half | 2nd half | -108, 0.62, 13, 37, -153/-24 | loose | -84 | -84 | 0.43 | 0.43 |
| conducting_24 | wrist | whole | whole | 1, 0.98, 24, 6, -7/10 | 1 | 7 | 5 | 0.98 | 0.98 |
| conducting_24 | wrist | 2nd half | 1st half | -7, 0.98, 12, 9, -20/6 | -7 | 10 | 17 | 1.00 | 0.92 |
| conducting_24 | wrist | 1st half | 2nd half | 4, 0.98, 12, 9, -4/12 | 4 | 3 | 0 | 0.96 | 0.96 |

What it says:

1. **The subtraction itself works.** The 4-pattern trunk's lag (53 ms over the clip) subtracted from its anchors lands the trunk-alone follower within 2 ms of the grid on the same clip (`test/conductor_lead.test.ts`; scripted strokes move the conductor node's beat by an 80 ms offset within a frame, either way).
2. **The trunk's lag is not a constant of this conductor, and a take cannot measure it.** On the one clip where the trunk keeps the beat, its lag is 81 ms over the first half and 18 ms over the second. Its anchors scatter about ±100 ms, so 16 strokes measure the mean to about ±25 ms at best. A first version gated on the resultant alone and accepted it, and an offset learned on one half then moved the other half by as much as it corrected (3 ms became -84 ms, 75 ms became 51 ms). With the gates, the take refuses the trunk on every clip and split: `drift` or `loose` on the 4-pattern, `lock` on the 3- and 2-pattern.
3. **What the take keeps does no harm.** In-sample a kept offset never moves its joint further from the grid, and what one half keeps never moves the other half more than 15 ms further (the worst: the 2-pattern wrist, 10 to 17 ms). The wrist's offset is under 15 ms on every clip, which is the reference's own noise; the 4-pattern elbow is kept over the whole clip (-7 ms: -13 to -6). The 2-pattern elbow, the one joint the ungated correction helped held out, is refused as `loose` or `lock` (standard error 23 to 37 ms). A first version pinned each joint's detector to the click's period; it found other peaks than the live follower (the 4-pattern elbow +11 ms against -7) and its kept offset moved that elbow from -13 to -24 ms in-sample, which is why the take now follows each joint as the conductor does.

So the issue's check (the trunk alone within ±20 ms of the grid after calibration) is met only in-sample, by the subtraction. A take does not reach it, because the take refuses the trunk. Whether a real player's trunk holds a lag from one take to the next, and whether a longer take would measure it, is a live check (#146) and its own follow-up issue.

### 5.3 `body-pulse` `channel: auto` (#416)

`auto` runs a pulse follower per channel (stride, sway over the ankles, shoulder yaw, trunk-centroid height) and publishes the one whose ACF strength is highest while its state is trusted; a challenger must beat the leader by 0.05 for 3 s without a break (`createPulseSelector`, the pace controller's persistence). The stride stays the default channel, so nothing changes for a player who does not choose `auto`. Measured with the shipped follower defaults, ticks after the first 6 s (`test/body_pulse.test.ts`):

| clip | stride | sway (over feet) | yaw | trunk height | `auto` |
|---|---|---|---|---|---|
| Que Calor | trusted 98 %, strength 0.76, bar | trusted 77 %, 0.67, bar | 14 %, 0.58 | 0 % (ACF 0.35) | the stride, no switch |
| Budots | never (ankles out of frame) | never | 5 % (a level at the 3 s edge: noise) | 0 % (ACF 0.26 at the bar, 1.66 s) | no pulse reported |

What this says: the issue's premise that sway and yaw carry the pulse for a player with the feet out of frame is NOT borne out by the ACF follower. The anchor-based measurement of §3 (a beat-locked event rate over a whole clip) finds structure that an 8 s causal ACF window does not trust, and on a 13 s clip with three dancers it cannot. The trunk's camera-x alone (no feet) was tried for sway and reached 0.46 at the beat on Que Calor and nothing on Budots, so it was dropped. Sway over the feet is the useful addition: a second feet channel that agrees with the stride on Que Calor. A real no-feet verdict needs a longer, single-dancer clip with the feet out of frame (#415).

### 5.4 The pulse follower's tempo step and red noise (#339)

**Tempo step (item 1).** After a tempo step the full 8 s window is half the old tempo, so its ACF keeps voting for the old level, and a level switch resets the rhythm prior, which then has to find a lock again from its own default tempo. The pulse follower now also runs a step detector (`PulseOptions.fastWindowS`, 4.5 s, `body-pulse`'s `fastWindowS`; 0 = off): an ACF over only the last 4.5 s, acting only while the level is under a third of that span (1.5 s; a 1.9 s bar is the full window's alone), switching the level when the tail's fundamental is strong (0.6), differs from the level by 6 % or more, the old level is no longer among its peaks, and it has persisted for 1 s. After any level switch the prior is built at the new period and the phase is fitted on the samples since the switch, and for the next window the level is followed from the tail. Measured on a synthetic cosine stepping at t = 20 s (`test/ictus_pulse.test.ts`; period within 5 % of the new one and trusted for good, then total time untrusted):

| step | before | after |
|---|---|---|
| 1.2 s to 1.0 s | 10.6 s settled, 4.9 s untrusted, undershoot to 0.93 s | 3.6 s, 0.1 s, none |
| 1.0 s to 1.2 s | 8.7 s | 3.8 s |
| 0.8 s to 0.64 s | 11.7 s, 3.1 s untrusted, undershoot to 0.55 s | 2.8 s, 0.4 s, 0.61 s |

Limits found by the adversarial review: a step of about 10 % or less (1.1 to 1.0 s, 1.45 to 1.3 s) settles as slowly as before (the level drifts inside the detector's 6 % band before the tail is strong), and a step near the 1.5 s reach gains little (1.4 to 1.2 s with noise: 8.1 s against 8.4 s). The review also found a false octave: on a steady, noisy fast cycle (0.45 to 0.6 s, noise 0.35 to 0.45) the tail's ACF sometimes put the doubled period within a hair of the true one, and the detector jumped there and stayed for about 10 s (7 of 20 seeds; 39 s wrong in total over 36 runs, against 1 s with it off). A longer period is now a new level only if it is not 2, 3 or 4 times the level and beats the level's own tail peak by the switch margin, a shorter one (the lock on a multiple) still switches, and the test pins it (`test/ictus_pulse.test.ts`).

On the real streams (the five body fixtures, replayed at 1x and 1.4x so more levels fall in the detector's reach) the trusted fraction is within half a point of the old follower's in 48 of the 50 runs (5 clips x 5 channels x 2 speeds); one improves (Que Calor sway at 1.4x: trusted 20 % to 30 %), one is a hair worse (conducting_24 yaw at 1.4x: 66 % to 64 %). Que Calor's stride (1.9 s bar) is out of reach, so a real tempo step at the bar level is not faster: the real fixtures hold no tempo step, and splicing two speeds of the same take makes a phase jump that defeats both versions, so the step evidence is the synthetic one. An earlier variant that also re-acquired a lock the full window had lost reacquired too eagerly on real data (conducting_24 yaw: 66 % to 54 %) and was dropped.

**Red noise (item 2): no detector found.** A slowly wandering channel (low-passed noise, a = 0.8 and 0.95) is trusted in 1.4 % and 7.8 % of ticks (16 runs of 40 s), at levels of 1.5 to 3 s, with ACF strengths of 0.5 to 0.86, the range of a real bar (Que Calor stride: 0.76). Two discriminators were measured and both fail: (a) a phase-coherence check, the sinusoid fitted to the older and to the newer half of the window must agree in phase: real periodic streams show a difference of 0.1 to 0.3 rad (p99 0.32), red noise a = 0.95 shows a median 0.25 and p90 0.70, so a threshold that keeps the dancer passes most of the noise, and the halves are under two cycles exactly for the 2 to 3 s levels noise produces; (b) the harmonic test, ACF at twice the level over ACF at the level: Que Calor 0.87 (median), red noise 0.84 (a = 0.95). A raised floor for long levels cannot work for the same reason as (a). The defence stays what #186 PR H built: the pace controller follows a new level only after it persists 3 s, and holds below `PULSE_TRUSTED_CONFIDENCE`.

**A third discriminator, the surrogate test (2026-10-19): it does not separate them either.** Each estimate's strongest ACF peak was compared with the same measurement on 40 first-order autoregressive surrogates carrying the channel's own lag-1 correlation (detrended like the window, deterministic seeds); an estimate counted only if fewer than a share `alpha` of the surrogates reached it. Run through the whole follower, 16 runs of 40 s of red noise (a = 0.95) against the five body fixtures with four channels each (stride, sway, trunk, yaw), counting trusted ticks (confidence at or above `PULSE_TRUSTED_CONFIDENCE`, after the first 6 s):

| alpha | red noise a = 0.95, trusted | red noise a = 0.8, trusted | real fixtures, trusted ticks (of 9456) |
|---|---|---|---|
| off | 7.16 % | 0.77 % | 1750 |
| 0.05 | 2.53 % | 0.62 % | 1041 (-40 %: Que Calor sway 282 to 137, conducting_44 yaw 351 to 142, conducting_24 trunk 61 to 0) |
| 0.25 | 7.16 % | 0.77 % | 1723 |

A threshold strict enough to cut the noise by two thirds cuts the real dancers' trusted ticks by two fifths, and a loose one does neither: the real streams are, to an AR(1) null of their own smoothness, about as surprising as the noise is. No pulse-side gate is shipped; the pace controller's 3 s persistence stays the defence. What might still work, untried: a longer window for the long levels only (the false 2 to 3 s levels are three cycles of an 8 s window; a 12 s window sees four), at the price of the slower step response the fast detector was built to remove.

## 6. Reproducing

```
# a scratch venv (not a fleet environment): mediapipe 0.10.14, opencv-python-headless, librosa, soundfile.
# mediapipe 0.10.35 and 1.x need libEGL / libGLESv2 at import time; 0.10.14 runs headless on CPU.
python scripts/video_to_pose.py <clip.mp4> <pose.ndjson.gz>          # 640x360, 30 fps excerpt made with ffmpeg
python scripts/body/audio_beats.py <clip.mp4> > beats.json          # a clip whose soundtrack carries the beat
npx vite-node scripts/body/excerpt.ts -- <pose> <cut> --from S --to S --beats <beats.json|stroke> --bpb N --meta-out extra.json --provenance prov.json
npx vite-node scripts/build_body_fixture.ts <scenario> <cut> --clip "..." --meta extra.json
npx vite-node scripts/body/measure_channels.ts -- --csv docs/research/data/body-channels.csv   # every video_body_* fixture with a grid, plus the synthetic control
npx vite-node scripts/body/measure_channels.ts -- --pose <pose> --beats <beats.json|stroke> --bpb N   # vet a clip before it becomes a fixture
```

The findings the defaults rest on are pinned in `test/body_channels.test.ts` (the synthetic control, the conductors' trunk and torso rotation, the meter readings, Que Calor's stride and head); the fixtures' provenance and replay regression are in `test/video_body_fixtures.test.ts`.

## REFERENCES

1. Davis A, Agrawala M. Visual rhythm and beat. ACM Trans Graph. 2018;37(4). [doi:10.1145/3197517.3201371](https://doi.org/10.1145/3197517.3201371); [project page](http://abedavis.com/visualbeat/)
2. Kim TH, Park SI, Shin SY. Rhythmic-motion synthesis based on motion-beat analysis. ACM Trans Graph. 2003;22(3). [doi:10.1145/882262.882283](https://doi.org/10.1145/882262.882283)
3. Shiratori T, Nakazawa A, Ikeuchi K. Dancing-to-music character animation. Comput Graph Forum. 2006;25(3). [doi:10.1111/j.1467-8659.2006.00964.x](https://doi.org/10.1111/j.1467-8659.2006.00964.x)
4. Chu WT, Tsai SY. Rhythm of motion extraction and rhythm-based cross-media alignment for dance videos. IEEE Trans Multimedia. 2012. [doi:10.1109/TMM.2011.2172401](https://doi.org/10.1109/TMM.2011.2172401)
5. Ho C, et al. Extraction and alignment evaluation of motion beats for street dance. ICASSP. 2013. [doi:10.1109/ICASSP.2013.6638091](https://doi.org/10.1109/ICASSP.2013.6638091)
6. Li R, Yang S, Ross DA, Kanazawa A. AI Choreographer: music conditioned 3D dance generation with AIST++. ICCV. 2021. [arXiv:2101.08779](https://arxiv.org/abs/2101.08779); [dataset](https://google.github.io/aistplusplus_dataset/)
7. Siyao L, et al. Bailando: 3D dance generation by actor-critic GPT with choreographic memory. CVPR. 2022. [arXiv:2203.13055](https://arxiv.org/abs/2203.13055)
8. Lee HY, et al. Dancing to music. NeurIPS. 2019. [arXiv:1911.02001](https://arxiv.org/abs/1911.02001)
9. Pedersoli F, Goto M. Dance beat tracking from visual information alone. ISMIR. 2020:400-8. [PDF](https://program.ismir2020.net/static/final_papers/144.pdf)
10. Toiviainen P, Luck G, Thompson MR. Embodied meter: hierarchical eigenmodes in music-induced movement. Music Percept. 2010;28(1):59-70. [doi:10.1525/mp.2010.28.1.59](https://doi.org/10.1525/mp.2010.28.1.59)
11. Burger B, Thompson MR, Luck G, Saarikallio SH, Toiviainen P. Hunting for the beat in the body: on period and phase locking in music-induced movement. Front Hum Neurosci. 2014;8:903. [doi:10.3389/fnhum.2014.00903](https://doi.org/10.3389/fnhum.2014.00903)
12. Burger B, London J, Thompson MR, Toiviainen P. Synchronization to metrical levels in music depends on low-frequency spectral components and tempo. Psychol Res. 2018. [doi:10.1007/s00426-017-0894-2](https://doi.org/10.1007/s00426-017-0894-2)
13. Luck G, Sloboda JA. Spatio-temporal cues for visually mediated synchronization. Music Percept. 2009;26(5):465-73. [doi:10.1525/mp.2009.26.5.465](https://doi.org/10.1525/mp.2009.26.5.465)
14. Bishop L, Goebl W. Beating time: how ensemble musicians' cueing gestures communicate beat position and tempo. Psychol Music. 2017. [doi:10.1177/0305735617702971](https://doi.org/10.1177/0305735617702971)
15. Luck G, Toiviainen P. Ensemble musicians' synchronization with conductors' gestures: an automated feature-extraction analysis. Music Percept. 2006;24(2):189-200. [doi:10.1525/mp.2006.24.2.189](https://doi.org/10.1525/mp.2006.24.2.189)
16. Mermerci, Pascoe, Edström, Kjellström. Real-time control of a virtual orchestra by recognition of conducting gestures. arXiv. 2026. [arXiv:2604.27957](https://arxiv.org/abs/2604.27957)
17. Borchers J, Lee E, Samminger W, Mühlhäuser M. Personal Orchestra: a real-time audio/video system for interactive conducting. Multimedia Syst. 2004;9(6):458-65. [doi:10.1007/s00530-003-0119-y](https://doi.org/10.1007/s00530-003-0119-y)
18. Kolesnik P, Wanderley MM. Recognition, analysis and performance with expressive conducting gestures. ICMC. 2004. [thesis](https://escholarship.mcgill.ca/downloads/tt44pn498)
19. Marrin T, Picard R. The Conductor's Jacket. ICMC. 1998. [MIT TR-470](https://vismod.media.mit.edu/pub/tech-reports/TR-470.pdf); Nakra's thesis on cut-offs versus beats: [TR-518 §6.4](https://vismod.media.mit.edu/tech-reports/TR-518/6.4.htm)
20. Sarasúa Á, Guaus E. Beat tracking from conducting gestural data: a multi-subject study. MOCO. 2014. [doi:10.1145/2617995.2618016](https://doi.org/10.1145/2617995.2618016)
21. Jeremic, Van Troyer. e-baton. NIME. 2026. [proceedings](https://nime.org/proc/nime2026_163/)
22. Cemgil AT, Kappen B, Desain P, Honing H. On tempo tracking: tempogram representation and Kalman filtering. J New Music Res. 2000;29(4). [doi:10.1080/09298210008565462](https://doi.org/10.1080/09298210008565462)
23. Hainsworth SW, Macleod MD. Particle filtering applied to musical tempo tracking. EURASIP J Appl Signal Process. 2004. [doi:10.1155/S1110865704408099](https://doi.org/10.1155/S1110865704408099)
24. Whiteley N, Cemgil AT, Godsill S. Bayesian modelling of temporal structure in musical audio. ISMIR. 2006. [PDF](https://archives.ismir.net/ismir2006/paper/000044.pdf)
25. Krebs F, Böck S, Widmer G. An efficient state-space model for joint tempo and meter tracking. ISMIR. 2015. [supplement](https://www.cp.jku.at/people/krebs/ismir2015/)
26. Böck S, et al. madmom: a new Python audio and music signal processing library. ACM MM. 2016. [arXiv:1605.07008](https://arxiv.org/abs/1605.07008)
27. Heydari M, Cwitkowitz F, Duan Z. BeatNet: CRNN and particle filtering for online joint beat, downbeat and meter tracking. ISMIR. 2021. [arXiv:2108.03576](https://arxiv.org/abs/2108.03576)
28. Large EW, Kolen JF. Resonance and the perception of musical meter. Connect Sci. 1994. [doi:10.1080/09540099408915723](https://doi.org/10.1080/09540099408915723)
29. Righetti L, Buchli J, Ijspeert AJ. Dynamic Hebbian learning in adaptive frequency oscillators. Physica D. 2006. [doi:10.1016/j.physd.2006.02.009](https://doi.org/10.1016/j.physd.2006.02.009)
30. Repp BH. Sensorimotor synchronization: a review of the tapping literature. Psychon Bull Rev. 2005;12(6). [doi:10.3758/BF03206433](https://doi.org/10.3758/BF03206433)
31. Repp BH, Su YH. Sensorimotor synchronization: a review of recent research (2006-2012). Psychon Bull Rev. 2013;20(3). [doi:10.3758/s13423-012-0371-2](https://doi.org/10.3758/s13423-012-0371-2)
32. Hove MJ, Iversen JR, Zhang A, Repp BH. Synchronization with competing visual and auditory rhythms: bouncing ball meets metronome. Psychol Res. 2013. [doi:10.1007/s00426-012-0441-0](https://doi.org/10.1007/s00426-012-0441-0)
33. Wessel D, Wright M. Problems and prospects for intimate musical control of computers. Comput Music J. 2002. [doi:10.1162/014892602320582945](https://doi.org/10.1162/014892602320582945)
34. Bazarevsky V, et al. BlazePose: on-device real-time body pose tracking. 2020. [arXiv:2006.10204](https://arxiv.org/abs/2006.10204); [MediaPipe Pose docs (latency table)](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
35. Casiez G, Roussel N, Vogel D. 1€ filter: a simple speed-based low-pass filter for noisy input in interactive systems. CHI. 2012. [doi:10.1145/2207676.2208639](https://doi.org/10.1145/2207676.2208639); [tuning guide](https://gery.casiez.net/1euro/)
36. Google. MediaPipe pose classification. [Guide](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose_classification.md)
37. Fiebrink R, Cook PR, Trueman D. Human model evaluation in interactive supervised learning. CHI. 2011. [doi:10.1145/1978942.1978965](https://doi.org/10.1145/1978942.1978965); [Wekinator](http://www.wekinator.org/)
38. Carney M, et al. Teachable Machine: approachable web-based tool for exploring machine learning classification. CHI EA. 2020. [doi:10.1145/3334480.3382839](https://doi.org/10.1145/3334480.3382839)
39. Gower JC. Generalized Procrustes analysis. Psychometrika. 1975. [doi:10.1007/BF02291478](https://doi.org/10.1007/BF02291478)
40. Zhang P, et al. View adaptive recurrent neural networks for high performance human action recognition from skeleton data. ICCV. 2017. [arXiv:1703.08274](https://arxiv.org/abs/1703.08274)
41. Sabater A, et al. One-shot action recognition in challenging therapy scenarios. 2021. [arXiv:2102.08997](https://arxiv.org/abs/2102.08997)
42. Memmesheimer R, et al. Skeleton-DML: deep metric learning for skeleton-based one-shot action recognition. 2020. [arXiv:2012.13823](https://arxiv.org/abs/2012.13823)
43. Wobbrock JO, Wilson AD, Li Y. Gestures without libraries, toolkits or training: a $1 recognizer for user interface prototypes. UIST. 2007. [doi:10.1145/1294211.1294238](https://doi.org/10.1145/1294211.1294238)
44. Vatavu RD, Anthony L, Wobbrock JO. Gestures as point clouds: a $P recognizer for user interface prototypes. ICMI. 2012. [doi:10.1145/2388676.2388732](https://doi.org/10.1145/2388676.2388732)
45. Bevilacqua F, et al. Continuous realtime gesture following and recognition. Gesture in Embodied Communication and HCI. 2010. [doi:10.1007/978-3-642-12553-9_7](https://doi.org/10.1007/978-3-642-12553-9_7)
46. Caramiaux B, et al. Adaptive gesture recognition with variation estimation for interactive systems. ACM TiiS. 2014. [doi:10.1145/2643204](https://doi.org/10.1145/2643204)
47. OrthodoxMusicOnline (OMIO), with David Drillock. Conducting choir - Allelulias [video]. Wikimedia Commons; CC BY 3.0. [File page](https://commons.wikimedia.org/wiki/File:Conducting_choir_-_Allelulias.webm)
48. OrthodoxMusicOnline (OMIO), with David Drillock. Conducting choir - Bortniansky Cherubic Hymn [video]. Wikimedia Commons; CC BY 3.0. [File page](https://commons.wikimedia.org/wiki/File:Conducting_choir_-_Bortniansky_Cherubic_Hymn.webm)
49. OrthodoxMusicOnline (OMIO), with David Drillock. Conducting choir - Trisagion (Greek) [video]. Wikimedia Commons; CC BY 3.0. [File page](https://commons.wikimedia.org/wiki/File:Conducting_choir_-_Trisagion_(Greek).webm)
50. Tuna S (DJ Love). Budots Dance Video [video]. Wikimedia Commons; CC BY 3.0. [File page](https://commons.wikimedia.org/wiki/File:Budots_Dance_Video.ogg)
51. Ellis DPW. Beat tracking by dynamic programming. J New Music Res. 2007;36(1):51-60. [doi:10.1080/09298210701653344](https://doi.org/10.1080/09298210701653344)
52. McFee B, et al. librosa: audio and music signal analysis in Python. Proc. SciPy. 2015. [doi:10.25080/Majora-7b98e3ed-003](https://doi.org/10.25080/Majora-7b98e3ed-003)
53. Tsuchida S, Fukayama S, Hamasaki M, Goto M. AIST Dance Video Database: multi-genre, multi-dancer, and multi-camera database for dance information processing. ISMIR. 2019. [PDF](https://archives.ismir.net/ismir2019/paper/000060.pdf); [terms of use](https://aistdancedb.ongaaccel.jp/terms_of_use/)
54. Google. AIST++ dataset: facts and figures (annotations under CC BY 4.0) and download terms. [Facts](https://google.github.io/aistplusplus_dataset/factsfigures.html); [download](https://google.github.io/aistplusplus_dataset/download.html)
55. Zar JH. Biostatistical analysis. 5th ed. Upper Saddle River (NJ): Prentice Hall; 2010. Chapter 27, the Rayleigh test (the p-value approximation used here).

Repository documents cited by section: `docs/research/body-and-pace-research-map.md`, `docs/research/rhythm-from-gesture-research-map.md`, `docs/research/conducting-and-virtual-orchestra-research-map.md`, `docs/research/intent-and-subframe-timing.md`.
