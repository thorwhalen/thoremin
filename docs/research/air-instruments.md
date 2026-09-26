# Air instruments: prior art, a footage pipeline, and a first model (guitar chord shapes)

*Research map, September 2026. Builds on [`intent-and-subframe-timing.md`](intent-and-subframe-timing.md) (the timing budget and the actuality / intent / sounding-good trade-off), [`body-and-pace-research-map.md`](body-and-pace-research-map.md) (the body slot and the impact as a phase anchor) and [`rhythm-from-gesture-research-map.md`](rhythm-from-gesture-research-map.md) (the `ictus` prior). Pipeline code: [`scripts/air/`](../../scripts/air/README.md); tests: `test/air/`.*

## 0. What this map answers

The request: air guitar, flute, bass and drums, learned from YouTube footage of people playing the real instruments, with body, hand and mouth tracking. Guitar chords first, because a chord shape is a *pose*, and a pose needs none of the sub-frame timing machinery the other three need. This document (1) collects the prior art on air instruments and on recognising guitar chords from video, (2) records the footage pipeline that now exists in the repository and what it keeps out of it, (3) reports the first model, guitar chord shape from the fretting hand, with its held-out numbers, and (4) lays out flute, bass and drums as footage, tracking and a plan each.

## 1. Headline findings

- **Chord shape from hand landmarks is a solved-looking problem in-distribution and does not transfer across players, because a chord is not a shape.** Every recent MediaPipe-landmark paper reports 95 to 98% on a random split of its own frames [E12, E15, A6, A7]; the two that tested on new footage or new capture conditions report 83% [E13], "above 85% under the same acquisition conditions" [E14], and a Stanford project that scored 100% in-distribution and then recognised only two of five chords on new images [E10]. The honest number is leave-one-player-out, and almost nobody reports it. Ours (§6.3): **96% within a player, 24% across players**, on 31,000 labelled frames, with the failure traced to two players fingering G differently. **Two seconds of a player's own hand per chord gives 90 to 98%**, and adding other players' data to that makes it worse. The target for an air guitar is therefore the trainer's per-player enrolment (`src/enroll/`), not a shared model.
- **Real-instrument footage labels itself through the sound.** Audio chord recognition on a solo strummed guitar with a per-video vocabulary of two to four chords is near-perfect with 1999-vintage chroma templates plus Viterbi decoding [F1, F2]; the 76 to 94% ceiling that human annotators reach on full mixes [F7] does not apply to a beginner drilling C to G. Air footage has no such label, which is why the model is learned on real playing and only *probed* on air.
- **The domain shift from guitar to air is real and unmeasured.** No study trains on footage with the instrument and tests without it. The nearest evidence, MediaPipe's own sim-to-real table (25.7% error synthetic-only, 16.1% real-only, 13.4% combined [G1]), the in-distribution collapse above, and Godøy's finding that air-instrument mimicry keeps the gross gesture but loses the detail [A4], all point the same way: expect a shift, and plan for a short per-player calibration on air rather than pure transfer. The trainer (`src/enroll/`) is built for exactly that.
- **The fretting hand is the hard case for the hand tracker, and hand size in frame decides everything.** Fingers pressed to a neck occlude each other and are foreshortened from the front; MediaPipe Hands reports no occlusion-specific metric [G1], a metamorphic-testing study found it degrades "largely" with four joints occluded [G2], and the guitar-vision literature has fought this since 2006 (neck-mounted cameras [E1], coloured markers [E2, E3], fretboard rectification [E5, E6]). On our footage (§6.3) a close-up on the neck gives a usable fretting hand in 94% of frames; a waist-up lesson 76 to 81%; a whole-body or 720p shot 8 to 11%, which is unusable.
- **Drums are the timing problem in its purest form**, and Dahl's air-drumming measurement is the paper the sub-frame stream should read first: at 200 fps the velocity reversal (the "hit") comes *after* the audio onset and drifts with tempo (−3 ms fast, +44 ms slow), while acceleration peaks come *before* it and hold steady, so trigger on the acceleration peak [B2]. That is the conducting map's peak-deceleration ictus, measured on drummers.
- **There is no camera-based air flute in the literature.** Breath is sensed with microphones [C4, C5], the mouth with a head-worn camera in 2003 [C2], the face with optic flow in 2005 [C3]. MediaPipe's mouth blendshapes are a newer sensor than any published air-wind instrument, so flute is where this project has the least to copy and the most to try.

## 2. Prior art, by instrument

### 2.1 Air guitar

The Helsinki University of Technology Virtual Air Guitar (2005 to 2006) is the origin: data gloves, a magnetic tracker and, in the desktop version, a webcam; hand distance sets the pitch, a strumming motion of the right hand plucks, and a "guitar control language" turns gestures into musically plausible output on an electric-guitar physical model with amplifier distortion [A2, A3]. Its companion latency study is the one the timing report already leans on: 16 subjects on a delayed theremin found 20 to 30 ms just noticeable, with slow vibrato passages hiding much more [A1]. Two design facts from that work carry over. Without tactile feedback players tolerate more latency than with it (their virtual xylophone ran at about 60 ms strike-to-sound and players did not find it very noticeable [A2]). And the instrument mapped *intent*, not fingering: the air guitar never tried to read a chord shape, it read hand distance and strum energy and let the control language pick plausible notes, an early instance of the "sounds good over faithful" compromise of the timing report's §3.

Godøy, Haga and Jensenius filmed novices and experts miming to recordings and found that novices reproduce the *overall* activity of sound-producing gestures but not the detail [A4]. For an air instrument this cuts both ways: the coarse gesture (a strum, a chord change, a hit) is what an untrained player will actually produce, and the fine one (which fingers are down) is what a real-guitar-trained recogniser looks for.

The recent wave is MediaPipe plus a small classifier. AirStrum [A6, unverified journal details] classifies left-hand landmark images with a CNN and reads strum velocity from the right hand, reporting 95.9%; a 2025 browser-native "AIR Guitar" [A7, unverified authors] is the closest thing to thoremin in the literature: MediaPipe keypoints, a client-side SVM and Web Audio, 96.1% chord accuracy with the SVM costing a third of the frame rate against the CNN's two thirds, and 99.6% on Nashville-number finger gestures (hold up 1 to 7). That last number is the pragmatic alternative to fretting-shape recognition: a *number gesture* is unambiguous, camera-facing and needs no guitar to have been learned. "Air Guitar Hero" [A5] is an EMG neuroprosthetic-training interface, not a camera system.

### 2.2 Air drums

Camera and inertial systems split the field. Aerodrums (2014) tracks retro-reflective markers on sticks and feet with a PS3 Eye camera and needs a dark room [B4]; Freedrum and the AirSticks put an IMU on each stick over Bluetooth MIDI [B5, B6]; Airstic Drum combined the two so an accelerometer threshold tells a real-drum hit from an air strike [B1]. Rosa-Pujazón et al. built a Kinect drumkit and had to add a linear predictor of hand motion to offset the sensor lag, with trajectory and arm-pose features to classify the strike [B3]. None of these are webcam-only, and the ones that are cameras use markers or depth. Their common lesson is the one the timing report's §5.3 derives from first principles: an air hit has no contact plane, so it is *predicted* from the approach, never observed.

Dahl's NIME 2014 study is the measurement behind that [B2]. Air-drummers at several tempi under 200 fps motion capture, aligned to the sound they were playing to: the velocity reversal is a poor trigger (late, tempo-dependent), the acceleration-magnitude peak is a good one (−33 to −14 ms before the onset, stable across tempo). At 30 fps a webcam sees a peak that lasts 30 to 60 ms about once, so the braking-onset detector plus stroke-template extrapolation that the sub-frame stream is building is not optional; drums are last in this stream's order for that reason, and the drum plan in §7 is written against the harness that stream produces.

### 2.3 Air flute, and wind instruments generally

The lineage is short. Ystad and Voinier instrumented a real flute body as a controller for a synthesis model [C1]: a prop, not air. Lyons' Mouthesizer put a head-worn camera on the mouth and turned opening shape into MIDI controllers [C2], then face-region optic flow into note triggers [C3]: the ancestors of steering synthesis from face landmarks, which thoremin already does with blendshapes for the face-chord node. Breath has always been a microphone: BLUI localises where on a laptop screen the user blows from a single mic [C4]; Ocarina's iPhone flute is mic breath plus multitouch finger holes [C5]. A 2023 comparison of camera-tracked virtual trumpet valves against a haptic glove and a real trumpet found the camera version easy but tactile-poor [C6]. There is no published webcam air flute; the demos that exist are not evaluated.

What that means for thoremin: the fingering half of a flute is a hand-shape problem like guitar (six to nine finger-hole states, both hands, seen from the side), and the mouth half is new. MediaPipe's `mouthPucker`, `mouthFunnel`, `jawOpen` and the cheek blendshapes are the embouchure sensor; breath itself is not visible, but its *onset* (the lips closing to a pucker, the cheeks tensing) is, and the microphone the app already opens for the assistant is the other channel. §7 lays out what footage teaches which half.

### 2.4 Air bass, other strings, surveys and sensors

No dedicated air-bass paper exists. Bass differs from guitar in the things that matter to a tracker: one finger per note rather than a shape, wider fret spacing, and a plucking hand whose alternation (index, middle) is a rhythm signal. Han and Gold's Leap Motion Air-Keys and Air-Pads record the design constraints of hand-sensor instruments [D1]; Serafin et al.'s Computer Music Journal survey gives nine design guidelines for virtual-reality instruments [D2]; Guzsvinecz et al. review the accuracy envelopes of Kinect and Leap [D3]. The number that calibrates expectations for a webcam: against marker-based motion capture, MediaPipe's finger-segment angles carry about 10.9° RMSE, better than Leap Motion's 14.7° [D4]. Two chord shapes that differ by less than that at one joint are not separable per frame, only by aggregation over time.

## 3. Chord shapes from video: what the literature reports

The problem has a twenty-year record, and the methods track the sensors. Burns and Wanderley mounted the camera on the neck (the player's-eye view), found fingertips with a circular Hough transform and frets and strings with a linear one, and reported 5 ± 2 px fingertip error at 640 × 480 over frets 1 to 5, with self-occlusion failures on C7 and Dm7 [E1]. Kerdvibulvech and Saito put coloured markers on the fingertips, tracked them with particle filters and an AR marker for the neck pose, and classified chords with PCA [E2, E3]. Paleari et al. used a frontal camera under two metres to disambiguate string and fret for 89% of audio-transcribed notes [E4]. Hrybyk and Kim's ISMIR 2010 study is the one to remember for the *role* of video: coloured dots on the fretboard for homography, PCA "eigenchords" over the rectified image, 24 chords from three guitarists; audio got the chord right 98.6% of the time and video got the *voicing* right 94.4%, but video alone got the chord only 34%, and combining them lifted voicing-level accuracy from 61.1 to 93.1% [E5]. Sound names the chord; the image says how it was fingered. That division is exactly the one our pipeline uses, with the audio as the label and the hand as the feature. Scarr and Green (markerless fretboard normalisation, 2010) [E6], Wang and Ohya (finger contours 2016, then a CNN hand-pose estimator with 6.1 mm joint error and a released annotated guitar-video dataset 2018) [E7, E8], Duke and Salgian (real-time tablature 2019) [E11] and TapToTab (YOLO fretboard plus audio, 2024) [E16] continue the fretboard-first line.

The landmark-first line starts around 2018. Ooaku et al. got about 90% on three chords and 70% on five from finger patterns [E9]; the Stanford CS230 report trained GoogLeNet on 1,797 frames of five chords, scored 100% on its test split and recognised only F and Em on new realistic images [E10]. GuitarGuru (MediaPipe → CNN, 97.1% [E12, unverified]), Kristian et al. (14 chords, 13k images from 10 contributors, 83% on 115 *new* live examples [E13]), Marullo et al. (MediaPipe plus RGB-D from 18 players, four chords plus "unknown", random forest above 85% balanced accuracy "under the same acquisition conditions" [E14]) and Naya and Tanuwijaya (63-dimensional landmark vectors, seven chords, 97.6% in 5-fold CV, the most occlusion-robust of their 1-D CNNs [E15]) are the current state. Read together: landmarks plus any small classifier saturate on a random split; the only two papers that held out *conditions* landed at 83 to 85%; nobody held out *players* on landmarks and said so. Datasets do not help: GuitarSet [E17] and Guitar-TECHS [E18] are audio-only; GAPS has performance video of classical guitar from 200+ performers [E19], which is fingerstyle, not chord shapes; Ego-Exo4D's music scenario has 3-D hand-pose annotations for guitar, piano and violin [E20] and is the one to look at when the model outgrows YouTube.

Two consequences for the design in §6. First, evaluate leave-one-player-out and say so. Second, do not build a fretboard detector: the app has no fretboard. A recogniser that needs the neck in frame has learned the neck, and the air player brings none.

## 4. Labels from the audio

Fujishima's pitch-class profile with template matching [F1] and Sheh and Ellis' HMM decoding over chroma [F2] are the whole method, and librosa ships both halves (`chroma_cqt`, `sequence.viterbi`). librosa's own documentation warns that its chroma-template example is "not accurate enough to use in practice" [F6], which is true of full mixes with a 24-chord vocabulary and a flat prior. It is not true of the case here: one acoustic guitar, no vocals, a vocabulary of two to four chords declared per video, and a sticky self-transition. NNLS chroma [F3] and the deep chroma extractor that madmom ships [F4, F5] buy 10 to 15 points on full mixes (about 78 to 80% major/minor WCSR against 67 to 78% for hand-crafted chroma); Byambatsogt et al. measured guitar-specific audio recognition at 88.2% root and 82.9% major/minor accuracy over a 98-class vocabulary [F8]; Pauwels et al.'s twenty-year review puts inter-annotator agreement at 76 to 94% [F7]. With the vocabulary collapsed to the video's own chords the ceiling is the boundary placement, and the join in `lib_chord_shape_dataset.ts` drops a quarter second on either side of every change so the boundary's exact position does not matter.

`scripts/air/label_chords.py` implements it: harmonic component (HPSS), constant-Q chroma at 36 bins per octave, temporal median over five hops, cosine match against binary triad templates for the declared vocabulary, a no-chord state whose emission is a floor raised over quiet frames, and Viterbi with a 0.97 self-transition. Its `--self-test` synthesises a seven-segment progression with plucked harmonic tones and recovers it with 98% frame agreement, 100% away from the changes. A recent ISMIR 2025 paper on joint strumming-direction and chord transcription from audio plus a wrist IMU [F9] is the pointer for when strum *direction* becomes a target.

## 5. The footage pipeline in this repository

Five idempotent steps, documented in [`scripts/air/README.md`](../../scripts/air/README.md): fetch (the ecosystem's `yb`, 1080p cap), extract (the existing `scripts/video_to_landmarks.py` / `video_to_pose.py` / `video_to_face.py`, so there is one MediaPipe pipeline for fixtures and for this), label (the audio decoder of §4), join, train. The committed artefact is the source list, `scripts/air/sources/guitar.json`, a Zod-validated document (`test/air/sources.test.ts`) whose entries carry the id, the player (the held-out unit), why the clip was chosen, its licence as yt-dlp reports it, the chord vocabulary the labeller may emit, and how to pick the fretting hand (by image-x side, robust to the label flicker of #144 and refusing a lone hand on the wrong half of the frame, or by MediaPipe label, whose "Left" on unmirrored video is the physical right hand). The schema is a discriminated union on the instrument, so a flute or drums list parses today and grows its own label fields at that one seam. The join itself has two seams, a `featurize` function (frame to vector) and a `labelOf` function (time to label), which is what lets the next instruments reuse it rather than rewrite it. Everything derived, video, landmarks, labels, datasets, weights, results, lives under `~/.local/share/thoremin/<kind>/air/<instrument>/` and never in the repository, per the ecosystem's provenance rule (a public repo holds nothing derived from a private-licence source, however small).

The guitar set is ten videos: two channels of close-up chord-switching drills (C/G, D/G, C/G, C/F, G/Em), a four-chord progression (G Em C D), JustinGuitar's One Minute Changes (A, D, E), a left-handed lesson (the fretting hand on the viewer's left, which the pick must survive), a C G Am F play-along loop, and one Air Guitar World Championship performance flagged `holdout`: scored, never trained on. All are standard-YouTube-licence; no Creative Commons drill footage was found.

## 6. The first model: guitar chord shapes from the fretting hand

### 6.1 The featurizer is the catalog

`scripts/air/lib_chord_shape_features.ts` computes nothing new. It builds the catalog's `HandCtx` for the fretting hand and evaluates every `HAND_SIDE_FEATURES` entry whose declared invariance (#131) covers scale, position, yaw, pitch and roll: the five fingers' MCP, PIP and DIP joint angles and curls, the four adjacent spreads and thumb opposition, the pinch distances and openness; 40 features, side-relative ids (`index.curl`, not `hand.left.index.curl`), from the world landmarks when present. Palm orientation is excluded by default because it measures the camera angle, not the shape, and because it is signed by chirality (a left-handed player's fretting hand is the mirror image and would flip it); `--orientation` adds that group for a camera-locked, same-handedness variant. The default features are angles and span-normalized distances, which a mirror image leaves unchanged, so the lefty source needs no special casing. Raw positions are never used. The point is architectural, not statistical: the vector is the one the Lab plots, the trainer clusters and the gesture dispatcher reads, so a chord-shape model is one more consumer of `hand-feature-vector` and can run in the browser with no second implementation to drift.

### 6.2 Two models, three numbers

Softmax regression (multinomial logistic regression, Adam, L2, class-balanced because the audio hands out very different amounts of each chord) on standardized features with mean-imputation of anything MediaPipe could not compute that frame. Beside it, the trainer's own nearest-centroid classifier (`src/enroll/classify.ts`, inverse-spread weights) as the baseline that answers whether the in-app machinery for learning a player's own categories would already do. Both are evaluated three ways and the three are always reported together, plus a fourth experiment, enrolment (`scripts/air/enrol_chord_shape.ts`: the first seconds of each chord from the held-out player's own footage as training, the rest after a gap as test, with and without the other players): leave-one-player-out (the honest number: a shape learned on other players' hands and cameras must transfer; the unit is the *player*, not the video, because two channels contribute several videos each), the same with a nine-frame majority vote that never crosses a time gap (a chord is held for beats, and a flicker to a neighbouring shape is not a change), and a within-player random split (the optimistic bound that the literature of §3 reports, included so the two can be compared on the same data). A held-out frame whose chord no training player played cannot be scored as a classification; those are counted as `unscorable` and folded into an all-frames accuracy that treats them as errors, so the exclusion is never silent. The air-guitar probe is never labelled (its backing track is not what the hand mimes) and is reported as what the final model predicts on it and how confidently, not as an accuracy. `test/air/chord_shape_model.test.ts` runs the whole protocol on synthetic hands with world landmarks and out-of-plane rotation: three "players" with systematic 0.08 rad offsets on every joint, five shapes, per-frame jitter, 88 to 100% leave-one-player-out across five seeds, and a spy trainer that asserts the probe never enters a training fold.

### 6.3 Results on the footage

Ten videos were fetched and tracked (`scripts/air/sources/guitar.json`; all standard YouTube licence; 1080p cap; MediaPipe HandLandmarker at the native 23 to 30 fps). Hand detection and audio labelling per source, from the extraction log and the labeller's statistics:

| source (player) | what it is | frames | fretting hand found | labelled frames after the join | chords (frames) |
|---|---|---|---|---|---|
| MtFmLEQ1zoc (for3v3rfaithful) | C↔G drill, close-up on the neck | 18,943 | 94% | 11,912 | G 6,705, C 5,207 |
| D6U-kZ1jHiA (for3v3rfaithful) | D↔G drill, same framing | 20,030 | 95% | 11,185 | G 6,161, D 5,024 |
| DKqbdVSeAEg (good-guitarist) | C↔G lesson, waist-up, talk between drills | 9,520 | 81% | 1,323 | C 992, G 331 |
| 2pXS8k1zx8U (good-guitarist) | G Em C D progression lesson | 9,094 | 76% | 2,538 | C 908, D 760, Em 756, G 114 |
| mRKy7O5yuks (good-guitarist) | C↔F lesson | 9,103 | 80% | 1,686 | C 1,073, F 613 |
| vBkZQiqTen0 (good-guitarist) | G↔Em lesson | 8,748 | 80% | 1,541 | G 799, Em 742 |
| qXK_If0QzDM (justinguitar) | One Minute Changes, stage 1 | 9,187 | 68% | 12 | A 12 |
| LNS_m2IosVY (gch-lefty) | left-handed first chords, 720p | 7,757 | 8% | 0 | none |
| dkmVG82lSH4 (maebelle) | C G Am F play-along loop | 18,026 | 11% | 952 | G 263, C 247, Am 227, F 215 |
| T071wzJmseU (airistotle, probe) | air guitar, stage shot | 8,793 | 10% | 846 unlabelled | probe |

Three things the table says before any model runs. The drill footage is what works: a fixed close-up on the neck gives a usable fretting hand in 94% of frames and a chord label on 60% of them. Lesson footage is mostly talk: JustinGuitar's six minutes contain about sixteen seconds of chords at any threshold, and the whole video contributes twelve frames. And the tracker fails on small hands: the left-handed lesson (720p, waist-up), the play-along loop (whole body in frame) and the air-guitar stage shot find a hand in 8 to 11% of frames, so the one left-handed source contributes nothing and the play-along little.

The dataset is 31,137 labelled frames over three players (the JustinGuitar player is dropped below thirty frames), six chord shapes, 40 features, and the honest evaluation is leave-one-player-out:

| held-out player | frames | unscorable | accuracy | macro-F1 | accuracy, 9-frame vote | accuracy, all frames |
|---|---|---|---|---|---|---|
| for3v3rfaithful | 23,097 | 0 | 20.4% | 23.4% | 22.4% | 20.4% |
| good-guitarist | 5,590 | 1,498 | 41.3% | 46.2% | 38.4% | 32.6% |
| maebelle | 725 | 227 | 17.1% | 16.2% | 16.7% | 13.0% |
| **pooled, softmax** | 29,412 | 1,725 | **24.3%** | 25.2% | **25.3%** | 22.9% |
| **pooled, nearest centroid** | 29,412 | 1,725 | **25.3%** | 26.3% | **23.8%** | 23.9% |

Chance for six classes is 17%; for the two-chord drills it is 50%. The same data, split at random within players, scores 96.1% (macro-F1 85.7%). The camera-locked variant with palm orientation is no better across players (22.5% pooled). The confusion is not noise: held-out C is called G in 7,916 of 8,427 frames, held-out G is called Em or D in 10,932 of 14,373, which is one player's shape being read as another player's different shape. The air-guitar probe, 846 frames the tracker found a hand in, is predicted Em (290), Am (272) and F (166) with a mean top probability of 0.80, that is, confidently and meaninglessly, since the model has no notion of "not a chord".

Before concluding anything from a 24%, the pipeline was checked in the direction that would expose a bug. Leave-one-**video**-out inside the good-guitarist player, four videos of the same hand and camera, scores 94.8% pooled (97.1, 100, 89.6, 91.2% per fold): the labels are right, the join is aligned, the features carry the shape. And the per-chord feature means say why the transfer fails: for the close-up player, G has the pinky extended (curl 2.2 rad against 3.1 for C) and a wide ring-pinky spread (0.76 against 0.20); for the lesson player, G has the pinky curled (3.0 against 2.2 for C) and no ring-pinky spread. They finger G differently, one with the pinky on the high string and one without, and the audio labels both "G". "G" is a chord; it is not a shape.

So the experiment that matters is the one the trainer (`src/enroll/`) already assumes: how much of the *player's own* footage is needed. For each player, the first `s` seconds of each chord in time order are the enrolment (what they would demonstrate to a cue), the rest, after a two-second gap, the test (`scripts/air/enrol_chord_shape.ts`):

| player | enrolment s/chord | enrol frames | test frames | chords | own only, softmax | others + own, softmax | own only, centroid |
|---|---|---|---|---|---|---|---|
| for3v3rfaithful | 2 | 162 | 22,882 | C D G | 97.5% | 72.3% | 94.6% |
| good-guitarist | 2 | 270 | 6,684 | C D Em F G | 89.4% | 58.5% | 83.5% |
| maebelle | 2 | 216 | 651 | Am C F G | 15.8% | 15.4% | 17.5% |
| for3v3rfaithful | 5 | 405 | 22,579 | C D G | 98.3% | 87.2% | 97.7% |
| good-guitarist | 5 | 675 | 6,341 | C D Em F G | 94.1% | 71.5% | 88.1% |
| maebelle | 5 | 540 | 366 | Am C F G | 31.1% | 16.4% | 33.6% |
| for3v3rfaithful | 10 | 810 | 22,112 | C D G | 98.1% | 92.7% | 98.2% |
| good-guitarist | 10 | 1,350 | 5,639 | C D Em F G | 99.1% | 83.4% | 95.7% |
| for3v3rfaithful | 20 | 1,620 | 21,331 | C D G | 98.1% | 94.9% | 97.4% |
| good-guitarist | 20 | 2,700 | 4,267 | C D Em F G | 99.6% | 97.0% | 93.1% |

Two seconds per chord of the player's own hand gives 97.5% and 89.4% on the two well-tracked players; five seconds gives 98.3% and 94.1%. Adding the other players' 30,000 frames to that enrolment *lowers* accuracy at every budget under twenty seconds (72.3% and 58.5% at two seconds): the transfer is negative, because the other players' G is a different shape. The trainer's nearest-centroid classifier on the same two seconds reaches 94.6% and 83.5%, within a few points of the softmax, so the in-app machinery is already most of the model. The play-along player does not enrol either (15 to 31%): with the hand at 11% detection and small in frame, its chord shapes are not separable in the features at all, which is a tracking limit, not a modelling one.

Everything in the tables is regenerated by the five pipeline steps plus `enrol_chord_shape.ts`; the per-fold JSON with every confusion matrix lives with the other local artefacts and is not committed.

### 6.4 What the numbers mean, and the air domain shift

**A chord is not a shape, so "guitar chords from hand shape" was the wrong target and the data said so quickly.** The audio names the sounding chord; players finger it differently (the four-finger G against the three-finger G is the textbook case, and it showed up in the first two channels compared); and a classifier trained on other people's fingerings does not transfer, in either direction. This is Hrybyk and Kim's 2010 finding (§3) from the other side: they showed video sees the voicing where audio sees the chord; here the voicing differences across players are large enough to defeat a chord label entirely. It is also what the in-distribution literature of §3 hides by splitting frames at random: our 96% within-player is the number those papers report, and it says nothing about a new hand.

**The right target is the trainer's.** Two to five seconds of the player's own hand per chord, enrolled through a cue ("hold your G"), recognises their shapes at 90 to 98% with either classifier, and the trainer (`src/enroll/`) is built for exactly that loop: cue, capture still-points, cluster, name the category, bind it to a sound. For the air-guitar instrument this means the chord vocabulary is *the player's*, named by them, and the sound bound to a category is a strummed chord voicing chosen from the name (the music layer already has voicings). The cross-player model has one remaining use, as a *prior* that proposes a name for a newly enrolled category, and even that is doubtful at 24%; a chord-name suggestion is better read from the pinch and spread features by a rule than from this model.

**The tracking limit is the harder constraint.** Three of ten sources gave the tracker a hand in about a tenth of frames: the hand small in frame, the fingers behind the neck, 720p. MediaPipe's own paper reports no occlusion metric and the metamorphic study found it degrades sharply with four joints hidden [G1, G2]; here that is the difference between a source that works and one that does not. For the air instrument this is good news in one way: an air guitarist's fretting hand is in front of nothing, and a webcam close enough to a player's chest sees it at the close-up player's scale, the case that gave 94% detection. But the enrolment must be done at the distance and angle the player will play at, and the app should say so.

**The domain shift to air is still unmeasured, and the probe shows why a probe alone cannot measure it.** The stage-shot air guitarist's hand was found in a tenth of frames and every frame was assigned a chord with 0.80 confidence, because a closed-set classifier always answers. Measuring the shift needs air footage *with labels*, which only a person miming known chords on cue can supply: the trainer's cue mechanism again, run once on the real guitar and once on air by the same player, with the two enrolments compared feature by feature. That is a fixture recording session with the maintainer's own hands (§8), not another YouTube search, and it is the next step for this instrument. Its likely outcome, from §1's evidence and from the C-versus-G feature means above: the coarse shape survives (which fingers are down and how spread), the fine one does not (the curl a string imposes), so the air enrolment is what should be used at play time and the guitar enrolment is only a check on it.

**What this does to the plan for the other three instruments.** Flute fingering is the same problem with more classes and both hands, and the same answer, enrol per player; the flute *footage* is still worth tracking for the embouchure half, where the target is an onset, not a category, and per-player enrolment is not obviously enough. Bass and drums were never shape problems. So the footage pipeline's lasting value is the label-from-audio machinery (chords here; pitch and onsets next) and the measurement of what the tracker sees, and the modelling moves into the app, where the trainer is.

## 7. Flute, bass, drums: footage, tracking, a first model each

Each runs through the same pipeline with a different label source and tracker (`scripts/air/README.md`): pitch from the audio (`label_pitch.py`, probabilistic YIN restricted to the instrument's range; its self-test recovers a synthetic melody in both the flute and the bass register at 100% away from note edges) for flute and bass, hit onsets from the audio (`label_onsets.py`, spectral flux on the percussive component; self-test 100% recall and precision at ±30 ms) for drums. The featurizers reuse the chord-shape vector: the flute's is both hands, prefixed by side, plus the embouchure blendshapes of the face stream; the bass's is the fretting hand plus its offset from the plucking hand in palm-span units (a camera-invariant position along the neck); the drums use the pose stream's wrists. The held-out unit is the player throughout.

### 7.1 Bass: position is not a shape either

Ten videos from seven players, 9,729 labelled frames over the six players whose audio yielded labels (hand detection 68 to 100%; the two "only metronome" videos of the seventh player yielded no pitch labels because the click dominates their audio). Target: the pitch class of the sounding note from the fretting hand's shape and its position along the neck.

| held-out player | frames | accuracy | macro-F1 | accuracy, 9-frame vote |
|---|---|---|---|---|
| andre-tonelli | 920 | 6.0% | 5.3% | 5.5% |
| coversolutions | 3,341 | 7.8% | 3.4% | 8.2% |
| etpbass | 811 | 21.5% | 14.0% | 22.2% |
| janusz-frychel | 137 | 18.2% | 11.7% | 17.5% |
| tom-bornemann | 1,464 | 5.5% | 4.1% | 5.7% |
| trevor | 3,056 | 13.0% | 7.2% | 13.1% |
| **pooled, softmax** | 9,729 | **10.2%** | 8.3% | 10.4% |
| **pooled, centroid** | 9,729 | **9.8%** | 8.6% | 10.3% |

Chance for twelve classes is 8%. The within-player random split, the optimistic bound, reaches only 32.0%: unlike the guitar, the bass target is not even separable for one player in these features. The reason is in the instrument, not the tracker: a sounding pitch is a fret *and* a string, the fretting hand's shape is the same one-finger-per-fret posture at every fret, and the only position cue, the offset from the plucking hand, is a noisy proxy for the fret and blind to the string. The one-string chromatic exercise (etpbass) is the best fold at 21.5% because on one string the offset *is* the fret. What the literature did for this, fretboard detection and rectification (§3, [E5, E6, E11]), is exactly what an air bassist cannot offer.

For the air instrument this is a clarification rather than a loss. An air bass has no frets, so "which pitch" is the player's intent expressed as a *displacement along an imaginary neck* relative to their body, plus which finger is down: a continuous axis to be quantised to a scale, the theremin's own pitch mapping, with the body slot's torso frame (#186) making the displacement camera-invariant. That is a mapping problem the app already solves for the hand-theremin, not a recognition problem, and it needs no footage. The plucking hand is the part of the bass that *is* a recognition problem, a two-finger alternation at eighth-note rate, and it is a rhythm anchor for `ictus`, which is the drums problem in §7.3.

### 7.2 Flute: fingering from both hands, embouchure from the face

Seven videos, five players, tracked for hands and face (a fixed camera on a flautist gives the tracker 65 to 87% of frames with a hand and, when the player faces the camera, 97 to 100% with a face; the play-along source had no person in frame and was dropped). Labels: the pitch class of the sounding note from `label_pitch.py`, 32,139 frames over four players after the join (both hands required). Features: both hands' chord-shape vectors, prefixed by side, plus twenty embouchure blendshapes (`mouthPucker`, `mouthFunnel`, `jawOpen`, the cheek and lip-press shapes), 100 in all.

| held-out player | frames | accuracy | macro-F1 | accuracy, 9-frame vote |
|---|---|---|---|---|
| lance-suzuki (three videos) | 22,508 | 4.9% | 3.2% | 4.8% |
| lauren-teaches-flute | 3,364 | 8.4% | 3.2% | 8.6% |
| musicians-addition | 5,744 | 44.9% | 21.2% | 46.6% |
| selfridge (embouchure clip, two notes) | 523 | 0.0% | 0.0% | 0.0% |
| **pooled, softmax** | 32,139 | **12.3%** | 8.5% | 12.6% |
| **pooled, centroid** | 32,139 | **11.0%** | 6.1% | 11.1% |

Chance is 8%. Hands only, without the face, gives 11.5% pooled: the embouchure neither helps nor hurts a fingering model. The within-player random split reaches 66.9% (65.5% hands only), which looks like separability until the enrolment experiment is run on the same data: with ten seconds of their own footage per pitch class, the two players who cover all twelve classes reach only 29.7% and 18.0% (softmax) or 23.9% and 36.6% (centroid), and the beginner who plays three notes 62.8%. That is the number that matters, and it says the within-player 67% is mostly adjacent frames leaking across a random split, not fingering being read.

Unlike the guitar, this is not a vocabulary problem: Boehm fingerings are standard, two flautists playing G finger the same keys. It is a resolution problem. A flute key press moves a fingertip a few millimetres and a joint a few degrees, the hand is seen edge-on with the tube in front of it, and MediaPipe's finger-angle error against motion capture is about 11° [D4]; the signal is under the noise floor of the sensor at this distance and angle. What does survive is coarse: which hand is on the tube, and the beginner's three notes (an open-ish B, a closed-ish G) separated by whole fingers. The literature has no webcam flute to compare against (§2.3), and this is why.

For the air instrument the consequence is a design rather than a model. Fingering as a *set of small key presses* is not readable; fingering as a set of *large, deliberate finger lifts* is the guitar result again (an enrolled shape per note, at a scale the tracker sees), and an air flautist has no tube in the way, so the lifts can be as large as they like. The embouchure half stands on its own: the face stream found the mouth in 97 to 100% of frames on the front-facing sources, `mouthPucker` and `mouthFunnel` are the shape a flautist makes and nothing else in the catalog is, and the onset question (does the pucker settle before the sound starts, by how much) is a measurement against the pitch labels' segment starts that belongs with the sub-frame stream's timing harness, since it is a timing question. The footage and labels for it are now local.

### 7.3 Drums: strokes and drums at frame resolution; the timing is the sub-frame stream's

<!-- DRUMS -->

## 8. What stays local and what is committed

Committed: the scripts, their tests on synthetic hands, the source lists, this document with its numbers. Local under the app-data dir, never committed: the videos and their metadata, every landmark stream, every label file, every dataset, model and result file. The tests cannot depend on the local data and do not; the CI gate (`npm run typecheck`, `npm test`) is green without any footage on the machine. When a fixture is wanted for the app (a replay of a chord change through the `hand-feature-vector` node, say), it is recorded from the maintainer's own hand with the existing `npm run record` path, not cut from YouTube.

## REFERENCES

**A. Air guitar**

1. [A1] Mäki-Patola T, Hämäläinen P. Latency tolerance for gesture controlled continuous sound instrument without tactile feedback. Proc. ICMC. 2004. [PDF](https://users.aalto.fi/~hamalap5/publications/icmcarticlefinal10.pdf)
2. [A2] Mäki-Patola T, Laitinen J, Kanerva A, Takala T. Experiments with virtual reality instruments. NIME 2005, pp. 11–16. [PDF](https://www.nime.org/proceedings/2005/nime2005_011.pdf)
3. [A3] Karjalainen M, Mäki-Patola T, Kanerva A, Huovilainen A. Virtual air guitar. J. Audio Eng. Soc. 54(10):964–980. 2006. [AES](http://www.aes.org/e-lib/download.cfm?ID=13884)
4. [A4] Godøy RI, Haga E, Jensenius AR. Playing "air instruments": mimicry of sound-producing gestures by novices and experts. Gesture Workshop 2005, LNCS 3881:256–267. 2006. [Springer](https://link.springer.com/chapter/10.1007/11678816_29)
5. [A5] Armiger RS, Vogelstein RJ. Air-Guitar Hero: a real-time video game interface for training and evaluation of dexterous upper-extremity neuroprosthetic control algorithms. IEEE BioCAS. 2008. [IEEE](https://ieeexplore.ieee.org/document/4696889/)
6. [A6] Beulah et al. AirStrum: a virtual guitar using real-time hand gesture recognition and strumming technique. Romanian J. Inf. Technol. Autom. Control. 2024. [PDF](https://rria.ici.ro/documents/1235/art._10_Beulah_Panda_Nair.pdf) [unverified: journal details and author list]
7. [A7] AIR Guitar: a browser-native number-gesture instrument for everyday music-making. 2025. [ResearchGate](https://researchgate.net/publication/399444430) [unverified: authors and venue]

**B. Air drums**

8. [B1] Kanke H, Takegawa Y, Terada T, Tsukamoto M. Airstic Drum: a drumstick for integration of real and virtual drums. ACE 2012, LNCS. 2012. [DOI](https://doi.org/10.1007/978-3-642-34292-9_5)
9. [B2] Dahl L. Triggering sounds from discrete air gestures: what movement feature has the best timing? NIME 2014. [PDF](https://www.nime.org/proceedings/2014/nime2014_514.pdf)
10. [B3] Rosa-Pujazón A, Barbancho I, Tardón LJ, Barbancho AM. Fast-gesture recognition and classification using Kinect: an application for a virtual reality drumkit. Multimedia Tools and Applications. 2016. [Springer](https://link.springer.com/article/10.1007/s11042-015-2729-8)
11. [B4] Aerodrums (Lee R, Morvan Y). Product, 2014–. [Wikipedia](https://en.wikipedia.org/wiki/Aerodrums)
12. [B5] Freedrum. Vendor and press page. 2018. [Nordic Semiconductor](https://www.nordicsemi.com/Nordic-news/2018/10/Freedrum-employs-nRF52832-to-wirelessly-connect-drumstick-attached-devices)
13. [B6] Trolland S, Ilsar A, Frame C, McCormack J, Wilson E. AirSticks 2.0: instrument design for expressive gestural interaction. NIME 2022. [DOI](https://doi.org/10.21428/92fbeb44.c400bdc2)

**C. Air flute, wind, mouth**

14. [C1] Ystad S, Voinier T. A virtually real flute. Computer Music Journal 25(2):13–24. 2001. [MIT Press](https://direct.mit.edu/comj/article/25/2/13/93608/A-Virtually-Real-Flute)
15. [C2] Lyons MJ, Haehnel M, Tetsutani N. Designing, playing, and performing with a vision-based mouth interface. NIME 2003, pp. 116–121. [arXiv](https://arxiv.org/abs/2010.03213)
16. [C3] Funk M, Kuwabara K, Lyons MJ. Sonification of facial actions for musical expression. NIME 2005. [arXiv](https://arxiv.org/abs/2010.03223)
17. [C4] Patel SN, Abowd GD. BLUI: low-cost localized blowable user interfaces. UIST 2007. [DOI](https://doi.org/10.1145/1294211.1294250)
18. [C5] Wang G. Ocarina: designing the iPhone's magic flute. Computer Music Journal 38(2):8–21. 2014. [MIT Press](https://direct.mit.edu/comj/article/38/2/8/94458/)
19. [C6] Blewett DJ, Gerhard D. Brass haptics: comparing virtual and physical trumpets in extended realities. Arts 12(4):145. 2023. [DOI](https://doi.org/10.3390/arts12040145)

**D. Air bass, surveys, sensors**

20. [D1] Han J, Gold N. Lessons learned in exploring the Leap Motion sensor for gesture-based instrument design. NIME 2014. [NIME](https://nime.org/proc/nime2014_ngold/index.html)
21. [D2] Serafin S, Erkut C, Kojs J, Nilsson NC, Nordahl R. Virtual reality musical instruments: state of the art, design principles, and future directions. Computer Music Journal 40(3):22–40. 2016. [MIT Press](https://direct.mit.edu/comj/article/40/3/22/94804/)
22. [D3] Guzsvinecz T, Szücs V, Sik-Lányi C. Suitability of the Kinect sensor and Leap Motion controller: a literature review. Sensors 19(5):1072. 2019. [DOI](https://doi.org/10.3390/s19051072)
23. [D4] Maggioni V, Coste C, Durand S, Bailly F. Optimisation and comparison of markerless and marker-based motion capture methods for hand and finger movement analysis. Sensors 25(4):1079. 2025. [DOI](https://doi.org/10.3390/s25041079)

**E. Visual guitar chord and fingering recognition**

24. [E1] Burns A-M, Wanderley MM. Visual methods for the retrieval of guitarist fingering. NIME 2006. [PDF](https://www.nime.org/proceedings/2006/nime2006_196.pdf)
25. [E2] Kerdvibulvech C, Saito H. Real-time guitar chord recognition system using stereo cameras for supporting guitarists. ECTI Trans. EEC 5(2):147–157. 2007. [PDF](http://hvrl.ics.keio.ac.jp/paper/pdf/international_Journal/2007/chutisant_ECTI07.pdf)
26. [E3] Kerdvibulvech C, Saito H. Guitarist fingertip tracking by integrating a Bayesian classifier into particle filters. Advances in Human-Computer Interaction. 2008. [Wiley](https://onlinelibrary.wiley.com/doi/10.1155/2008/384749)
27. [E4] Paleari M, Huet B, Schutz A, Slock D. A multimodal approach to music transcription. IEEE ICIP 2008. [PDF](https://www.eurecom.fr/en/publication/2491/download/mm-palema-081012.pdf)
28. [E5] Hrybyk A, Kim YE. Combined audio and video analysis for guitar chord identification. ISMIR 2010. [PDF](https://ismir2010.ismir.net/proceedings/ismir2010-29.pdf)
29. [E6] Scarr J, Green R. Retrieval of guitarist fingering information using computer vision. IVCNZ 2010. [DOI](https://doi.org/10.1109/IVCNZ.2010.6148852)
30. [E7] Wang Z, Ohya J. Tracking the guitarist's fingers as well as recognizing pressed chords from a video sequence. IS&T Electronic Imaging (IPAS). 2016. [IS&T](https://library.imaging.org/ei/articles/28/15/art00010)
31. [E8] Wang Z, Ohya J. A 3D guitar fingering assessing system based on CNN-hand pose estimation and SVR-assessment. IS&T Electronic Imaging (IRIACV). 2018. [DOI](https://doi.org/10.2352/ISSN.2470-1173.2018.09.IRIACV-204)
32. [E9] Ooaku T, Linh TD, Arai M, Maekawa T, Mizutani K. Guitar chord recognition based on finger patterns with deep learning. ICCIP 2018. [DOI](https://doi.org/10.1145/3290420.3290422)
33. [E10] Tran L, Zhang S, Zhou E. CNN transfer learning for visual guitar chord classification. Stanford CS230 report. 2019. [PDF](https://cs230.stanford.edu/projects_fall_2019/reports/26255715.pdf)
34. [E11] Duke B, Salgian A. Guitar tablature generation using computer vision. ISVC 2019, LNCS 11845. [DOI](https://doi.org/10.1007/978-3-030-33723-0_20)
35. [E12] Nagpurkar V et al. GuitarGuru: a realtime guitar chords detection system. IEEE CSCITA 2023. [DOI](https://doi.org/10.1109/CSCITA55725.2023.10104798) [accuracy figure unverified]
36. [E13] Kristian Y, Zaman L, Tenoyo M, Jodhinata A. Advancing guitar chord recognition: a visual method based on deep CNNs and deep transfer learning. ECTI-CIT 18(2). 2024. [ECTI](https://ph01.tci-thaijo.org/index.php/ecticit/article/view/254624)
37. [E14] Marullo G et al. Three-dimensional vision-based recognition of guitar chords. Computer Music Journal 49:1–16. 2025. [DOI](https://doi.org/10.1162/comj.a.690)
38. [E15] Naya RA, Tanuwijaya E. Comparative analysis of 1D CNN architectures for guitar chord recognition from static hand landmarks. J. Applied Informatics and Computing 9(6). 2025. [DOI](https://doi.org/10.30871/jaic.v9i6.11339)
39. [E16] Ghaleb A et al. TapToTab: video-based guitar tabs generation using AI and audio analysis. arXiv:2409.08618. 2024. [arXiv](https://arxiv.org/abs/2409.08618)
40. [E17] Xi Q, Bittner R, Pauwels J, Ye X, Bello JP. GuitarSet: a dataset for guitar transcription. ISMIR 2018. [PDF](https://archives.ismir.net/ismir2018/paper/000188.pdf)
41. [E18] Pedroza H et al. Guitar-TECHS: an electric guitar dataset covering techniques, musical excerpts, chords and scales using a diverse array of hardware. ICASSP 2025. [arXiv](https://arxiv.org/abs/2501.03720)
42. [E19] Riley X, Guo Z, Edwards AC, Dixon S. GAPS: a large and diverse classical guitar dataset and benchmark transcription model. ISMIR 2024. [arXiv](https://arxiv.org/abs/2408.08653)
43. [E20] Grauman K et al. Ego-Exo4D: understanding skilled human activity from first- and third-person perspectives. CVPR 2024. [arXiv](https://arxiv.org/abs/2311.18259)

**F. Audio chord recognition as a label source**

44. [F1] Fujishima T. Realtime chord recognition of musical sound: a system using Common Lisp Music. ICMC 1999, pp. 464–467. [Semantic Scholar](https://www.semanticscholar.org/paper/c9a84645f0e9f3498bf8e4ebfdc1150a86faf78c)
45. [F2] Sheh A, Ellis DPW. Chord segmentation and recognition using EM-trained hidden Markov models. ISMIR 2003. [PDF](https://www.ee.columbia.edu/~dpwe/pubs/ismir03-chords.pdf)
46. [F3] Mauch M, Dixon S. Approximate note transcription for the improved identification of difficult chords. ISMIR 2010. [DBLP](https://dblp.org/rec/conf/ismir/MauchD10.html)
47. [F4] Korzeniowski F, Widmer G. Feature learning for chord recognition: the deep chroma extractor. ISMIR 2016. [arXiv](https://arxiv.org/abs/1612.05065)
48. [F5] Böck S, Korzeniowski F, Schlüter J, Krebs F, Widmer G. madmom: a new Python audio and music signal processing library. ACM Multimedia 2016. [DOI](https://doi.org/10.1145/2964284.2973795)
49. [F6] librosa documentation, `librosa.sequence.viterbi_discriminative`. [librosa](https://librosa.org/doc/main/generated/librosa.sequence.viterbi_discriminative.html)
50. [F7] Pauwels J, O'Hanlon K, Gómez E, Sandler MB. 20 years of automatic chord recognition from audio. ISMIR 2019. [PDF](https://archives.ismir.net/ismir2019/paper/000004.pdf)
51. [F8] Byambatsogt G, Choimaa L, Koutaki G. Guitar chord sensing and recognition using multi-task learning and physical data augmentation with robotics. Sensors 20. 2020. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7663498/)
52. [F9] Murgul S, Schimper J, Heizmann M. Joint transcription of acoustic guitar strumming directions and chords. ISMIR 2025. [arXiv](https://arxiv.org/abs/2508.07973)

**G. Hand tracking under occlusion; domain shift**

53. [G1] Zhang F, Bazarevsky V, Vakunov A, et al. MediaPipe Hands: on-device real-time hand tracking. CVPR Workshop on CV for AR/VR. 2020. [arXiv](https://arxiv.org/abs/2006.10214)
54. [G2] Pu M, Chong CY, Lim MK. Robustness evaluation in hand pose estimation models using metamorphic testing. IEEE MET 2023. [DOI](https://doi.org/10.1109/MET59151.2023.00012)
55. [G3] Jin Y et al. Audio matters too! Enhancing markerless motion capture with audio signals for string performance capture. SIGGRAPH 2024. [arXiv](https://arxiv.org/abs/2405.04963)
