# Music games and lessons that listen: melody and rhythm from live audio

*Research for lane A of [#866](https://github.com/thorwhalen/thoremin/issues/866), 2026-10-29. What the singing games, instrument tutors, tuners, ear trainers and rhythm trainers that listen to a microphone actually do, the methods and browser libraries they rest on, how they judge and calibrate, how they draw, and which three kinds thoremin builds first.*

## Key takeaways

- **The three most common kinds that listen are singing (karaoke pitch matching), instrument play-along lessons, and tuners/pitch matching.** By Android installs, the karaoke apps lead (StarMaker 500M+, Smule 100M+) [1, 2], then the tutors (Yousician 50M+, Simply Piano 50M+, Simply Guitar 10M+, flowkey 5M+, Skoove 1M+) [3, 4, 5, 6, 7], with tuners in between (GuitarTuna 100M+, Soundcorset 50M+) [8, 9]. Rhythm trainers that listen are two orders of magnitude smaller (Complete Rhythm Trainer 500K+) [10], ear trainers mostly grade taps rather than sound (Perfect Ear 5M+) [11]. So thoremin builds **Sing**, **Play along** and **Match the note**, and folds the rhythm trainer into Play along as its unpitched level (clap or tap the rhythm).
- **Every one of them is the same machine**: an analyser turns audio into timestamped features (pitch with a confidence, onsets with a strength, a level); a judge compares them with targets through tolerances (cents for pitch, milliseconds or beats for time); a fold turns judgments into a score; a calibration constant (the round-trip latency) is subtracted first; and the visual is drawn from the targets and the judgments, not from a camera. The judge and the calibration are input-agnostic and already landed as `@thoremin/judge`.
- **Pitch tolerance is a semitone-scale number, folded by octave.** UltraStar Deluxe accepts 2, 1 or 0 semitones of error on easy, medium and hard, after moving the sung pitch by octaves to within six semitones of the target [12]; Performous scores on a linear ramp from full credit at 0.5 semitone to none at 1.5 on Normal (0.2151 to 0.5 on its hardest level) [13]; Rock Band accepts any octave [14]. Scoring is by the share of each note's time on pitch, not by onset.
- **Timing windows for a microphone are wider than for a key, and nobody publishes theirs.** Yousician, Melodics, Rocksmith and SingStar publish no millisecond windows [3, 15, 16]; the keyboard rhythm games do (ITG's top tier is ±21.5 ms, osu!mania's ±16 ms) [17, 18]. A clap or a plucked string detected by a causal onset detector arrives with 5 to 25 ms of analysis delay and some jitter [19, 20], and skilled human tapping spreads by about 10 to 20 ms [21], so honest microphone tiers start at about ±30 ms and go to ±100 ms.
- **Calibration is a tap along or a loopback, always with a single offset.** Rock Band calibrates audio by strumming in time with a beat, or automatically by holding a controller's sensor at the speaker [22]; UltraStar and Performous store a microphone delay or a round-trip offset [12, 13]; Yousician and EarMaster expose latency compensation and recommend headphones so the metronome is not heard as a clap [23, 24]. A tap-along take measures the round trip plus the player's own anticipation (humans tap tens of milliseconds ahead of a click [21]), which is the right number for judging that player against heard music.
- **Browser stack: write the analysis in house, pick only permissive libraries.** YIN and MPM are 40 to 100 lines each; pitchy (MPM, MIT) and Meyda (features, MIT) are permissive, but pitchfinder and aubio are GPL-3.0 and Essentia.js is AGPL-3.0 [25, 26, 27, 28, 29]. CREPE (via ml5) and SPICE are accurate but heavy [30, 31]; basic-pitch (Apache-2.0) is a post-hoc polyphonic transcriber, not live feedback [32].
- **Fixtures**: vocadito (40 solo vocal excerpts with frame-level f0, CC BY 4.0) is the committable sung-pitch set [33]; NSynth and GuitarSet (CC BY 4.0) give instrument notes [34, 35]; MIR-1K, TONAS and MDB-stem-synth cannot be committed (restricted or non-commercial) [36, 37, 38]. No permissively licensed annotated clap dataset exists, so clap fixtures are CC0 claps placed on a known grid.

## 1. Method and scope

Two passes on 2026-10-29: one over apps and games (store listings, publisher pages, support articles, developer diaries, the source code of the two open-source karaoke games), one over methods, libraries and datasets (papers, repositories, npm and Zenodo metadata). Install counts are Google Play's buckets as displayed on each listing: Android only, cumulative, not active users. They rank kinds against each other; they are not market sizes. Where a figure could only be read from a search snippet or a review it is called unverified in the text. The rhythm-game genre research done earlier for camera input (the rhythmin series) informed the judging vocabulary; this document is about audio input.

"Listens" means the app takes the player's sound through a microphone or an instrument cable and decides something from it. Touch toys with musical themes (Real Guitar, DrumPad Machine, each 100M+ installs) and lesson-video apps that never listen (Fender Play) are out of scope [39].

## 2. The apps, by kind

### 2.1 Singing and karaoke: pitch matching against a melody

- **SingStar** (Sony, PS2 to PS4) detects the pitch of the voice and compares pitch and timing with the original; outside rap sections there is no speech recognition, so humming the right pitch scores; target notes are horizontal bars on a stave-like grid, lyrics underneath, one colour per player; it sold over 16 million units in the PAL region and 1.5 million in the US [40]. Rap sections are judged by the timing of detected speech sounds against expected positions (Sony's patent) [41].
- **Let's Sing** (Voxler/PLAION) scores pitch and rhythm for up to four singers, using phones as microphones through a companion app [42].
- **Smule** and **StarMaker** show the melody on screen with live pitch analysis; their scoring is undocumented; 100M+ and 500M+ Android installs [1, 2].
- **Rock Band vocals** accept a note sung in any octave; Rock Band 3 licensed iZotope's real-time pitch technology [14, 43].
- **UltraStar Deluxe** and **Performous**, open source, are the only karaoke games whose judging is readable: section 5.1.
- **Pitch monitors for singers** (OnPitch, PitchMonitorPro, Nail the Pitch) draw the sung pitch on a piano roll, some with a ghost trail of earlier takes and a practice report [44].

### 2.2 Instrument play-along and lessons that listen

- **Yousician** (guitar, bass, ukulele, piano, voice) listens with "proprietary audio recognition", gives real-time feedback, rates a song part from one silver to three gold stars (gold needs right notes with good timing), and offers an advanced latency calibration and a buffer-size setting; 20M+ monthly users together with GuitarTuna (publisher figure), 50M+ Android installs [3, 23].
- **Simply Piano / Simply Guitar** (JoyTunes) listen through the microphone with a patented engine that hears chords of up to five notes, or take MIDI; notes turn blue when right, yellow when right after a hint and red when wrong in moving stages, and a keyboard strip greys the keys heard and lights the right one [4, 45, 46].
- **Skoove** validates polyphonic piano in the browser ("multipitch validation", built with Fraunhofer IDMT), checking that the expected notes come in order and staying robust to noise, volume and out-of-tune pianos [7, 47]. **flowkey** has a wait mode with microphone or MIDI [6].
- **Rocksmith 2014 / Rocksmith+** take a real guitar through a cable, an interface or (Rocksmith+) a phone microphone; chord detection weights the third and the bass root most, the developers tune tolerance between "robotic" and "fosters bad habits", and an optimised WASAPI path reaches about 25 ms round trip [16, 48].
- **Melodics** (pads, keys, finger drumming; MIDI first) labels every hit early, late or perfect, colours notes green or red, and rates lessons with one to three stars and a platinum for all green; it publishes no millisecond windows [15].
- **Synthesia** is the falling-notes reference but listens only to MIDI or touch, not to a microphone [49]. **Chordify** (10M+ installs) transcribes chords from recorded songs rather than judging the player [50].

### 2.3 Tuners and pitch matching

GuitarTuna (100M+ Android installs; 140M downloads by its publisher's count), Tuner and Metronome by Soundcorset (50M+), Pitched Tuner (1M+) [8, 9, 51]. A tuner is the purest pitch-matching exercise: one target, the deviation in cents, a needle or a strobe, and "in tune" when it stays within a few cents. The singer's versions (sing this note, hold it) live inside Yousician's voice course, Simply Sing and the pitch monitors.

### 2.4 Ear training and rhythm trainers

Perfect Ear (5M+), Complete Ear Trainer (1M+), EarMaster (100K+), Pitch Trainer (100K+) [11, 24, 52]: mostly multiple-choice answers on a screen; EarMaster also listens to sight-singing and rhythm clapping, with a microphone calibration wizard that includes a clap step and a warning that the metronome may be heard as a clap without headphones [24]. Rhythm trainers that listen are small: Complete Rhythm Trainer 500K+ (input mode unconfirmed), Rhythm Sight Reading Trainer (tap or microphone mode, each tap's accuracy shown by colour and position; ten ratings on one store) [10, 53].

## 3. Which kinds are the most common

| Kind | Notable apps found | Largest Android buckets | Listens to audio? |
|---|---|---|---|
| Singing / karaoke pitch matching | SingStar, Let's Sing, Smule, StarMaker, Rock Band vocals, UltraStar, Performous, Yousician voice, pitch monitors | StarMaker 500M+, Smule 100M+; SingStar 17.5M units | Yes |
| Instrument play-along lessons | Yousician, Simply Piano, Simply Guitar, Skoove, flowkey, Rocksmith, Melodics | Yousician 50M+, Simply Piano 50M+, Simply Guitar 10M+, flowkey 5M+ | Yes (Melodics, Piano Marvel MIDI first) |
| Tuners and pitch matching | GuitarTuna, Soundcorset, Pitched, Cleartune | GuitarTuna 100M+, Soundcorset 50M+ | Yes |
| Chord transcription | Chordify | 10M+ | Of recordings, not of the player |
| Ear training | Perfect Ear, Complete Ear Trainer, EarMaster, Pitch Trainer | 5M+ | Rarely |
| Rhythm tap/clap trainers | Complete Rhythm Trainer, Rhythm Sight Reading Trainer, EarMaster rhythm | 500K+ | Sometimes |

Sources in sections 2.1 to 2.4. The ranking is robust to the caveats (Android only, cumulative): the top three kinds are each at least an order of magnitude above the rest, and each has several independent apps, so no single title decides it.

**What thoremin builds, and why rhythm is not lost.** The three kinds become three games: **Sing** (a melody's notes as bars, the voice as a trail), **Play along** (a note highway with timing and pitch judgment) and **Match the note** (a tuner turned into a drill: hear a note, find it, hold it). The owner asked for melody *and* rhythm: rhythm judging is the core of Play along, whose first level is an unpitched chart (clap or tap the rhythm), which is what the rhythm trainers do; it shares the onset judge with the pitched levels.

## 4. Methods

### 4.1 Monophonic pitch

A frame must hold about two periods of the lowest pitch: 25 ms for a voice down to 80 Hz, 49 ms for a bass's low E, 10 ms above 200 Hz; with the browser's 44.1 or 48 kHz that is 1024 to 2048 samples [19, 54]. The two failure modes are octave errors and the voicing decision (is there a pitch at all).

- **Autocorrelation and AMDF** pick the lag of greatest self-similarity; cheap, but prone to octave-down errors on short windows [55]. UltraStar uses a circular AMDF over 49 semitones from C2 to C6 [12].
- **YIN** (de Cheveigné and Kawahara, 2002) replaces the autocorrelation with a cumulative-mean-normalised difference function, takes the first dip under an absolute threshold (0.10 to 0.15) and refines it by parabolic interpolation; the paper reports about a threefold reduction of gross errors over the methods of its time [55]. Latency equals the window; the cost is a few hundred thousand multiply-adds per frame, comfortable in an AudioWorklet.
- **pYIN** (Mauch and Dixon, 2014) runs YIN at many thresholds and decodes pitch and voicing with an HMM; by construction it needs look-ahead, so it suits scoring a recorded attempt rather than live feedback [56].
- **MPM** (McLeod and Wyvill, 2005) uses the normalised square difference function and takes the first key maximum above a fraction (about 0.9) of the highest, which suppresses octave errors and yields a clarity usable as a voicing score [57]; pitchy implements it (MIT) [25].
- **SWIPE** matches the spectrum against a sawtooth-like harmonic kernel, very resistant to octave errors but with longer windows [58].
- **CREPE** (Kim et al., 2018) is a CNN on 1024 raw samples at 16 kHz (64 ms) with 20-cent bins from about 33 Hz to 2 kHz, more accurate than pYIN and SWIPE on the paper's benchmarks; the full model (about 22M parameters) is too heavy for a phone in real time, the tiny one is plausible on WebGL [30]. **SPICE** (Gfeller et al., 2020) learns pitch self-supervised from transposed CQT frames and is robust to background music [31]. RMVPE and FCPE (2023 to 2024) target singing over accompaniment and low latency in voice conversion, without mature browser builds [59].

**Choice for thoremin**: YIN with parabolic refinement and a clarity of `1 - d'(tau)` in house, MPM as an option, both pure over a buffer and testable on recordings. A learned estimator is a later upgrade behind the same `PitchEstimate` type, when singing over a backing track needs it.

### 4.2 Polyphony and chords

NMF factorises a spectrogram into note templates and activations (offline, modest accuracy); Onsets and Frames (Hawthorne et al., 2018) is the piano reference, with BiLSTMs that imply offline use [60]; basic-pitch (Bittner et al., 2022) is a light multi-instrument CNN on a harmonic CQT that transcribes a recording in seconds per minute of audio (Apache-2.0, `@spotify/basic-pitch`) [32]; MT3 is server-only [61]. Chords come from chroma (a spectrum folded to 12 pitch classes) matched against templates and smoothed by an HMM (Fujishima 1999; Sheh and Ellis 2003) [62]; thoremin already has that path in its harmony slice's microphone chord follower (`@thoremin/sdk/harmony/chroma`). Skoove's and Simply Piano's polyphonic checks are not "transcribe then compare" but "is the expected chord present", a much easier question: the expected notes' partials are tested against the spectrum [7, 47]. Polyphonic play-along is out of the first three games.

### 4.3 Onsets

Energy and high-frequency content (HFC) rise at percussive attacks and cost almost nothing; spectral flux sums the positive magnitude changes between frames (Bello et al., 2005) with 1024 to 2048-sample frames and 256 to 512-sample hops; the complex-domain method handles soft onsets; SuperFlux adds a frequency maximum filter that suppresses vibrato false positives (Böck and Widmer, 2013); CNN onset detectors (Schlüter and Böck, 2014) are the most accurate [19, 20, 63, 64]. Peak picking normalises the detection function, takes local maxima over a moving median plus an offset, with a refractory interval of 30 to 50 ms (Böck et al., 2012, who also measure online variants) [65]. Evaluation counts a detection within ±50 ms (MIREX) [66], far looser than a game's top tier. A causal detector with a 1024-sample window reports an onset 10 to 25 ms after the attack; the remedy for judging is to stamp the attack itself (the start of the rise inside the frame) and subtract the known pipeline delay [65]. Lane B of #866 owns thoremin's onset detector; the games consume its events.

### 4.4 Beats

Ellis's dynamic programming beat tracker, BeatRoot, madmom's RNN with a dynamic Bayesian network and BeatNet's causal CRNN with particle filtering track the beat of a recording or a stream [67, 68, 69, 70]; realtime-bpm-analyzer (Apache-2.0) estimates a live tempo but not a beat phase [71]. **A game that owns its click does not need beat tracking**: the targets are on its own clock, and only the player's onsets are located against them [72]. Beat tracking matters for playing along with the player's own recording, which thoremin's song slice already does from a file (`trackSongGrid`).

### 4.5 Alignment and score following

Dynamic time warping aligns a sung contour with a reference offline [73]; Dixon's online DTW does it incrementally in a band, as in the Match system [74]; score followers (Dannenberg and Vercoe, 1984; Orio et al., 2003; IRCAM's Antescofo) model each score event as a state with a duration and decode in real time, which is what a wait mode ("the song waits until you play the note", flowkey, Synthesia) needs [75, 76]. The first three games run in fixed time (the chart scrolls); a wait mode is a later option for Play along.

## 5. Judging

### 5.1 Pitch: the two readable karaoke engines

**UltraStar Deluxe** [12]: a volume gate (0.05 to 0.60) decides voicing; the detected tone is folded to a pitch class and, per note, moved by octaves to within six semitones of the target; a beat is a hit when `|target - sung| <= 2 - level` semitones (easy 2, medium 1, hard 0); points accrue per beat of the song grid while the note is held, 9,000 for notes and up to 1,000 for a line bonus out of 10,000; golden notes count double, rap notes always hit (timing only), freestyle never scores; a `MicDelay` setting compensates latency.

**Performous** [13]: a Hamming-windowed 1024-sample FFT with phase-vocoder refinement and harmonic grouping; the error is `|remainder(sung - target, 12)|` semitones, octave-wrapped; credit is a linear ramp, full below the first threshold and none above the second: Normal 0.5 / 1.5, Hard 0.5 / 1.0, Perfect 0.2151 / 0.5 semitones; weighted by the overlap with the note and by a golden multiplier of 2; audio/video delay and round-trip offsets are adjustable while singing.

Common rules, then: **octave folding**, a **tolerance of half a semitone to two** as the difficulty knob, and **credit by the share of the note's time on pitch**. Sung notes drift and wobble by 20 to 50 cents (vibrato, scoops) even when heard as right, so nothing tighter than about ±50 cents is fair for voice [30]. `@thoremin/judge`'s `judgePitchNote` implements the share-of-time rule with a cents tolerance and octave folding; a Performous-style ramp is a small option to add when a game wants partial credit.

### 5.2 Time: windows and tiers

Keyboard rhythm games publish tight tiers: ITG Fantastic ±21.5 ms, Excellent ±43, Great ±102, Decent ±135, Way Off ±180 [17]; osu!mania's best ±16 ms at high difficulty, a miss beyond ±188 ms at the lowest [18]. The listening tutors publish none [3, 15, 16]. For a microphone the error budget is the player's spread (skilled tapping 10 to 20 ms; untrained players more [21]) plus the detector's jitter (a few milliseconds when the attack is located within the frame [65]) plus the calibration's residual. Taking a skilled player's 15 ms and a casual player's 30 ms, tiers of **perfect ±30, great ±60, good ±100 ms** put about 95 % of a skilled player's hits in the top two tiers and most of a casual player's inside good (Gaussian arithmetic: ±2σ). These are `AUDIO_ONSET_WINDOWS` in `@thoremin/judge`, with an easy set a third wider. Beat-relative windows (`windowsInBeats`) serve slow lessons.

Melodics's early/late labels [15] are the most useful feedback a tutor gives: the mean offset of a take says "you rush" or "you drag", and the spread says how steady the player is. `scoreJudgments` reports both.

### 5.3 Anti-cheese

A player who claps continuously or sings every pitch must score below one who plays the chart. Guitar Hero's overstrum and IIDX's empty judgment (strays) are the rhythm-game answer; for pitch, voicing plus the per-note share already defeats a sliding siren, because only the part of the note on pitch counts. The onset judge reports strays and the score can charge them (`strayCost`).

## 6. Latency and calibration

The browser's audio clock is the master: the AudioWorklet runs in 128-frame quanta (2.7 ms at 48 kHz) [54]; `AudioContext.baseLatency` and `outputLatency` estimate the output side and `getOutputTimestamp()` pairs the context clock with the page clock, unreliably on Safari [77, 78, 79]; the input side has no standard number (`MediaTrackSettings.latency` is a hint) [80]. No authoritative cross-browser round-trip table exists; practice is about 20 to 50 ms on desktop with wired output, 40 to well over 100 ms on Android, and Bluetooth adding 100 to 250 ms [81]. thoremin's own measurement puts its output stage at about 32 ms on built-in speakers [82].

So calibration is per device, and the patterns are few [12, 13, 22, 23, 24]:

1. **Tap along**: the game plays clicks, the player taps or claps on them, the microphone stamps the taps. It measures the round trip *plus the player's anticipation* (taps precede a click by tens of milliseconds, the negative mean asynchrony [21]), which is exactly what judging that player against heard music needs. It must be robust (median, outliers dropped) and refuse an irregular take.
2. **Loopback**: the game schedules clicks and the microphone hears its own speaker; no human in the loop, so it measures the device's round trip. It needs echo cancellation off and a speaker the microphone can hear, and fails with headphones [81].
3. **A manual offset** as the fallback (UltraStar's `MicDelay`, Performous's round trip, Rock Band's manual calibration).

Processing the browser applies to a voice call (echo cancellation, noise suppression, gain control) smears transients and gates soft notes; all three are asked off [80]. Headphones remove the backing track from the microphone, which is why EarMaster and Yousician recommend them [23, 24]. `@thoremin/judge`'s `estimateOffset` serves both takes: an offset, a robust spread, and a refusal when it cannot be trusted.

## 7. Visual conventions

| Convention | Who | What it shows | Feedback |
|---|---|---|---|
| **Pitch bars and a pitch trail** | SingStar, UltraStar, Let's Sing, Smule | target notes as horizontal bars on a pitch axis, scrolling past a now line; the sung pitch as a line over them | the bar fills or glows where the voice is on pitch; per-line rating (SingStar "Perfect", UltraStar's line bonus) |
| **Pitch trail alone** | PitchMonitorPro, Nail the Pitch | the sung pitch on a piano roll, a ghost of earlier takes | none, or a practice report |
| **Note highway** | Guitar Hero, Rock Band, Rocksmith, Yousician | notes in lanes travelling toward a hit line; lane = string, fret or pad | hit flashes, early/late, combo and multiplier, stars |
| **Falling notes on a keyboard** | Synthesia, Simply Piano | blocks falling onto the key that plays them | colour per result (Simply: blue, yellow, red) |
| **Notation follow** | Simply Piano sheet stage, flowkey | a cursor over notation | note colours; wait mode |
| **Lanes with early/late** | Melodics | pads as lanes | each hit labelled early, late or perfect; green or red |
| **Needle or strobe** | GuitarTuna, Soundcorset | the deviation in cents from the nearest (or the target) note | green when within a few cents |

Sources: [4, 15, 40, 44, 45, 49, 51, 53]. Difficulty is usually a named setting (easy, medium, hard), not a visibly thicker bar [12, 13]; showing the tolerance as the bar's thickness is a cheap, honest improvement thoremin can make.

**Why the game owns the picture.** In every one of these the screen is the game's: the camera image, if any, is a background at most. In thoremin that means a game draws its own overlay element from the graph's data (targets, the pitch track, judgments) on a stage with the video hidden, rather than drawing guides over the mirrored camera.

## 8. Browser libraries

| Library | Licence | What it gives | Live? | Verdict |
|---|---|---|---|---|
| Web Audio AnalyserNode | platform | FFT and time-domain frames, polled on the main thread | yes, jittery timing | prototypes only; the harmony slice's chord follower uses it |
| AudioWorklet | platform | 128-frame processing off the main thread | yes | the place for analysis (lane B's seam) |
| pitchy [25] | MIT | MPM f0 + clarity | yes | fine; in-house YIN/MPM is as short |
| pitchfinder [26] | GPL-3.0 (manifest) | YIN, AMDF, MPM, wavelet | yes | avoid (copyleft) |
| ml5 pitchDetection [30] | MIT | CREPE on tfjs | yes, heavy | later, for accuracy over a backing |
| SPICE on tfjs [31] | Apache-2.0 | self-supervised f0 | possible, heavy | later |
| Essentia.js [27] | AGPL-3.0 | onsets, beats, HPCP, chords, melody | partly | avoid (AGPL) |
| Meyda [28] | MIT | RMS, flux, centroid, chroma, MFCC | yes | fine for features |
| aubio / aubiojs [29] | GPL-3.0 | onset, pitch, tempo | yes | avoid (copyleft) |
| basic-pitch-ts [32] | Apache-2.0 | polyphonic notes | offline | later, for a recorded take |
| Tone.js [83] | MIT | scheduling and synthesis | yes | scheduling only; thoremin has its own |
| realtime-bpm-analyzer [71] | Apache-2.0 | live tempo | yes | not needed with an owned click |
| web-audio-beat-detector [84] | MIT | tempo of a buffer | offline | not needed |

## 9. Datasets for tests

| Dataset | Content | Licence | Committable |
|---|---|---|---|
| vocadito [33] | 40 solo vocal excerpts, 7 languages, frame-level f0, note annotations | CC BY 4.0 | yes, with attribution |
| GuitarSet [35] | 360 guitar excerpts, per-string notes and pitch | CC BY 4.0 | yes |
| NSynth [34] | 305,979 four-second notes with pitch labels | CC BY 4.0 | yes |
| E-GMD, Groove MIDI [85] | human drumming, MIDI onsets (E-GMD with audio) | CC BY 4.0 | yes |
| MDB-stem-synth [38] | resynthesised melody stems with exact f0 | CC BY-NC 4.0 | no |
| MIR-1K [36], TONAS [37] | karaoke clips; flamenco | restricted | no |
| IDMT-SMT-Drums, ENST-Drums [86] | drum onsets | non-commercial | no |
| Freesound [87] | single claps, snaps, taps | per sound; CC0 usable | yes, unannotated |

No permissively licensed dataset of annotated hand claps turned up, so the clap fixtures place CC0 clap recordings on a known, jittered grid: exact ground truth from real sounds. Real-room takes by the owner (a phone or laptop microphone, the speaker audible) are the human-only verification.

## 10. What this means for thoremin

1. **The analysers** are pure functions over sample buffers (pitch with a clarity; onsets and levels from lane B), run in lane B's AudioWorklet and replayable offline over a recording, so the same code is tested on vocadito and on clap fixtures.
2. **The judge** is `@thoremin/judge` (landed with this lane's first PR): windows, onset and pitch judging, score, calibration, input-agnostic so a camera game can use it too.
3. **Three games as slices** (Sing, Play along, Match the note), each a node that reads the audio events and the clock and emits a view model, and an overlay element of its own that draws the stage with the video hidden.
4. **One calibration take** (tap along, with loopback where the speaker is audible), writing the per-device input offset that lane B's seam subtracts.

The design is in `docs/design/audio-games.md`.

## References

1. [StarMaker on Google Play](https://play.google.com/store/apps/details?id=com.starmakerinteractive.starmaker&hl=en_US)
2. [Smule on Google Play](https://play.google.com/store/apps/details?id=com.smule.singandroid&hl=en_US)
3. [Yousician: About](https://yousician.com/about); [Yousician on Google Play](https://play.google.com/store/apps/details?id=com.yousician.yousician&hl=en_US); [Yousician support: song score](https://support.yousician.com/hc/en-us/articles/208014795-How-song-score-is-calculated) (read from a search snippet)
4. [Simply Piano on Google Play](https://play.google.com/store/apps/details?id=com.joytunes.simplypiano&hl=en_US)
5. [Simply Guitar on Google Play](https://play.google.com/store/apps/details?id=com.joytunes.simplyguitar&hl=en_US)
6. [flowkey on Google Play](https://play.google.com/store/apps/details?id=com.flowkey.app&hl=en_US)
7. [Skoove on Google Play](https://play.google.com/store/apps/details?id=com.skoove.piano&hl=en_US)
8. [GuitarTuna on Google Play](https://play.google.com/store/apps/details?id=com.ovelin.guitartuna&hl=en_US); [Yousician: guitar tuner](https://yousician.com/guitar-tuner)
9. [Tuner and Metronome by Soundcorset on Google Play](https://play.google.com/store/apps/details?id=com.soundcorset.client.android&hl=en_US)
10. [Complete Rhythm Trainer on Google Play](https://play.google.com/store/apps/details?id=com.binaryguilt.completerhythmtrainer&hl=en_US)
11. [Perfect Ear on Google Play](https://play.google.com/store/apps/details?id=com.evilduck.musiciankit&hl=en_US)
12. UltraStar Deluxe source: [UNote.pas](https://github.com/UltraStar-Deluxe/USDX/blob/master/src/base/UNote.pas), [URecord.pas](https://github.com/UltraStar-Deluxe/USDX/blob/master/src/base/URecord.pas), [UIni.pas](https://github.com/UltraStar-Deluxe/USDX/blob/master/src/base/UIni.pas); [the UltraStar format](https://usdx.eu/format/)
13. Performous source: [notes.cc](https://github.com/performous/performous/blob/master/game/notes.cc), [analyzer.cc](https://github.com/performous/performous/blob/master/game/analyzer.cc), [screen_sing.cc](https://github.com/performous/performous/blob/master/game/screen_sing.cc)
14. [Harmonix support: calibration](https://harmonix.zendesk.com/hc/en-us/articles/218868278-My-game-s-calibration-is-definitely-off-What-can-I-do-to-make-this-better) (octave rule as summarised by a search; unverified)
15. [Melodics: lesson scoring](https://support.melodics.com/en/articles/15092017-lesson-scoring); [Melodics: finger drumming](https://melodics.com/finger-drumming)
16. [Rocksmith+ dev diary, February 2022: audio updates](https://www.ubisoft.com/en-us/game/rocksmith/plus/news-updates/1Zcwvdcw0IwhBEYoCGCQtt/rocksmith-dev-diary-february-2022-audio-updates)
17. [StepMania wiki](https://github.com/stepmania/stepmania/wiki) (ITG timing windows; numbers widely cited, check against the theme metrics)
18. [osu! wiki: osu!mania judgement](https://osu.ppy.sh/wiki/en/Gameplay/Judgement/osu%21mania)
19. J. P. Bello et al., [A tutorial on onset detection in music signals](https://doi.org/10.1109/TSA.2005.851998), IEEE TSAP 13(5), 2005
20. S. Böck, G. Widmer, [Maximum filter vibrato suppression for onset detection (SuperFlux)](https://madmom.readthedocs.io/en/latest/modules/features/onsets.html), DAFx-13, 2013
21. B. H. Repp, [Sensorimotor synchronization: a review of the tapping literature](https://pubmed.ncbi.nlm.nih.gov/16615317/), Psychon. Bull. Rev. 12, 2005; B. H. Repp, Y.-H. Su, [Sensorimotor synchronization: a review of recent research (2006-2012)](https://link.springer.com/article/10.3758/s13423-012-0371-2), 2013
22. [Harmonix: how to calibrate](https://www.harmonixmusic.com/blog/how-to-calibrate); [Harmonix support: calibration tips for Rock Band 4](https://harmonix.zendesk.com/hc/en-us/articles/217771388-I-ve-read-your-FAQ-on-Calibration-and-can-t-seem-to-get-it-just-right-Do-you-have-any-tips-for-Calibration-in-Rock-Band-4)
23. [Yousician support: Game settings tab](https://support.yousician.com/hc/en-us/articles/203751452-Game-Settings-tab); [setting up for singing](https://support.yousician.com/hc/en-us/articles/360000535945-How-to-set-up-for-singing) (both read from search snippets)
24. EarMaster forum: [microphone calibration](https://earmaster.com/forum/viewtopic.php?p=5973), [clap detection](https://earmaster.com/forum/viewtopic.php?p=6485), [latency compensation](https://earmaster.com/forum/viewtopic.php?p=17292); [EarMaster on Google Play](https://play.google.com/store/apps/details?id=com.earmaster.android&hl=en_US)
25. [pitchy](https://github.com/ianprime0509/pitchy) (MIT)
26. [pitchfinder](https://github.com/peterkhayes/pitchfinder) (GPL-3.0 per its manifest)
27. [Essentia.js](https://github.com/MTG/essentia.js) (AGPL-3.0)
28. [Meyda](https://github.com/meyda/meyda) (MIT)
29. [aubio](https://github.com/aubio/aubio) (GPL-3.0); [aubiojs](https://github.com/qiuxiang/aubiojs)
30. J. W. Kim, J. Salamon, P. Li, J. P. Bello, [CREPE: a convolutional representation for pitch estimation](https://arxiv.org/abs/1802.06182), ICASSP 2018; [marl/crepe](https://github.com/marl/crepe); [ml5 pitchDetection](https://docs.ml5js.org/#/reference/pitchdetection)
31. B. Gfeller et al., [SPICE: self-supervised pitch estimation](https://arxiv.org/abs/1910.11664), 2020; [tfjs-models](https://github.com/tensorflow/tfjs-models)
32. R. M. Bittner et al., [A lightweight instrument-agnostic model for polyphonic note transcription and multipitch estimation](https://arxiv.org/abs/2203.09893), ICASSP 2022; [basic-pitch-ts](https://github.com/spotify/basic-pitch-ts) (Apache-2.0)
33. [vocadito](https://zenodo.org/records/5578807) (CC BY 4.0); R. M. Bittner et al., [vocadito: a dataset of solo vocals](https://arxiv.org/abs/2110.05580), 2021
34. [NSynth](https://magenta.tensorflow.org/datasets/nsynth) (CC BY 4.0)
35. [GuitarSet](https://zenodo.org/records/3371780) (CC BY 4.0)
36. [MIR-1K on Zenodo](https://zenodo.org/records/3532216) (restricted)
37. [TONAS on Zenodo](https://zenodo.org/records/1290722) (restricted)
38. [MDB-stem-synth](https://zenodo.org/records/1481172) (CC BY-NC 4.0)
39. [Real Guitar on Google Play](https://play.google.com/store/apps/details?id=com.gismart.guitar&hl=en_US); [Drum Pad Machine on Google Play](https://play.google.com/store/apps/details?id=com.agminstruments.drumpadmachine&hl=en_US); [Fender Play on Google Play](https://play.google.com/store/apps/details?id=com.fender.play&hl=en_US)
40. [SingStar, Wikipedia](https://en.wikipedia.org/wiki/SingStar)
41. [US20120116767, method and system of speech evaluation (Sony)](https://patents.google.com/patent/US20120116767)
42. [PLAION: Let's Sing 2025](https://press.plaion.com/LETS-SING-2025-THE-PERFECT-PARTY-GAME-FOR-THE-HOLIDAY-SEASON)
43. [MusicRadar: Rock Band 3 gets iZotope pitch technology](https://www.musicradar.com/news/tech/rock-band-3-gets-izotope-pitch-correction-257529)
44. [OnPitch](https://apps.apple.com/us/app/id1212118228); [PitchMonitorPro](https://apps.apple.com/app/id6766515700); [Nail the Pitch](https://apps.apple.com/ae/app/id1486640549)
45. [Simply Piano help: learning with Simply Piano](https://piano-help.hellosimply.com/en/articles/7943490-learning-with-simply-piano-the-basics)
46. [US8592670, polyphonic note detection (JoyTunes)](https://patents.google.com/patent/US8592670); [A look under the hood of Simply Piano, part 2](https://medium.com/joytunes/a-look-under-the-hood-of-simply-piano-part-2-3ba3cafa1bbf)
47. [Fraunhofer IDMT: Skoove](https://idmt.fraunhofer.de/en/Press_and_Media/press_releases/2016/skoove.html)
48. [Rocksmith+ dev diary, September 2021](https://ubisoft.com/en-au/game/rocksmith/plus/news-updates/2rN7QW1RC4E4NsipNX1cz7/rocksmith-dev-diary-september-2021)
49. [Synthesia on the App Store](https://apps.apple.com/us/app/synthesia/id579518445)
50. [Chordify on Google Play](https://play.google.com/store/apps/details?id=net.chordify.chordify&hl=en_US)
51. [Pitched Tuner on Google Play](https://play.google.com/store/apps/details?id=com.stonekick.tuner&hl=en_US)
52. [Complete Ear Trainer on Google Play](https://play.google.com/store/apps/details?id=com.binaryguilt.completeeartrainer&hl=en_US); [Pitch Trainer on Google Play](https://play.google.com/store/apps/details?id=com.eartraining.pitchtrainer&hl=en_US)
53. [Rhythm Sight Reading Trainer on the App Store](https://apps.apple.com/au/app/id396302174)
54. [Web Audio API specification](https://webaudio.github.io/web-audio-api/) (render quantum, AudioWorklet)
55. A. de Cheveigné, H. Kawahara, [YIN, a fundamental frequency estimator for speech and music](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf), JASA 111(4), 2002
56. M. Mauch, S. Dixon, [pYIN: a fundamental frequency estimator using probabilistic threshold distributions](https://code.soundsoftware.ac.uk/projects/pyin), ICASSP 2014
57. P. McLeod, G. Wyvill, [A smarter way to find pitch](http://miracle.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf), ICMC 2005
58. A. Camacho, J. G. Harris, [A sawtooth waveform inspired pitch estimator for speech and music](https://doi.org/10.1121/1.2951592), JASA 124(3), 2008
59. H. Wei et al., [RMVPE: a robust model for vocal pitch estimation in polyphonic music](https://arxiv.org/abs/2306.15412), 2023
60. C. Hawthorne et al., [Onsets and Frames: dual-objective piano transcription](https://arxiv.org/abs/1710.11153), ISMIR 2018
61. J. Gardner et al., [MT3: multi-task multitrack music transcription](https://arxiv.org/abs/2111.03017), ICLR 2022
62. M. Müller, [Fundamentals of Music Processing](https://www.audiolabs-erlangen.de/fau/professor/mueller/bookFMP), Springer (chroma, chord recognition, DTW)
63. C. Duxbury et al., complex-domain onset detection, DAFx 2003 (as summarised in [19])
64. J. Schlüter, S. Böck, [Improved musical onset detection with convolutional neural networks](https://ieeexplore.ieee.org/document/6854953), ICASSP 2014
65. S. Böck, F. Krebs, M. Schedl, [Evaluating the online capabilities of onset detection methods](https://archives.ismir.net/ismir2012/paper/000049.pdf), ISMIR 2012
66. [MIREX: audio onset detection](https://www.music-ir.org/mirex/wiki/2018:Audio_Onset_Detection)
67. D. P. W. Ellis, [Beat tracking by dynamic programming](https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf), JNMR 36(1), 2007
68. S. Dixon, [Evaluation of the audio beat tracking system BeatRoot](https://www.eecs.qmul.ac.uk/~simond/pub/2007/jnmr07.pdf), JNMR 36(1), 2007
69. [madmom](https://github.com/CPJKU/madmom) (code BSD; models CC BY-NC-SA 4.0)
70. M. Heydari, F. Cwitkowitz, Z. Duan, [BeatNet: CRNN and particle filtering for online joint beat, downbeat and meter tracking](https://zenodo.org/records/5624577), ISMIR 2021
71. [realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer) (Apache-2.0)
72. thoremin, [drum-pattern training research](https://github.com/thorwhalen/thoremin/blob/main/docs/research/drum-pattern-training.md) (a pattern fitted against an owned grid)
73. H. Sakoe, S. Chiba, dynamic programming for spoken word recognition, IEEE TASSP 26(1), 1978 (as presented in [62])
74. S. Dixon, [An on-line time warping algorithm for tracking musical performances](https://www.ijcai.org/Proceedings/05/Papers/0981.pdf), IJCAI 2005
75. N. Orio, S. Lemouton, D. Schwarz, [Score following: state of the art and new developments](https://www.nime.org/proceedings/2003/nime2003_036.pdf), NIME 2003
76. [Antescofo documentation](https://antescofo-doc.ircam.fr)
77. [MDN: AudioContext.baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency); [MDN: AudioContext.outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
78. [MDN: AudioContext.getOutputTimestamp()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp); [web.dev: audio output latency](https://web.dev/articles/audio-output-latency)
79. [Apple developer forums: getOutputTimestamp on Safari](https://developer.apple.com/forums/thread/696356) (one report)
80. [MDN: echoCancellation constraint](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation); [MDN: MediaTrackSettings.latency](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/latency)
81. [@hi-audio/latency-test](https://github.com/idsinge/latency-test); [round-trip latency estimation with maximum-length sequences, Web Audio Conference 2025](https://hal.univ-lyon2.fr/S2A/hal-05154354v2) (the desktop/Android/Bluetooth ranges are practice, not a published table)
82. thoremin, [latency budget and browser real time](https://github.com/thorwhalen/thoremin/blob/main/docs/research/latency-budget-and-browser-realtime.md)
83. [Tone.js](https://github.com/Tonejs/Tone.js) (MIT)
84. [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) (MIT)
85. [E-GMD](https://magenta.tensorflow.org/datasets/e-gmd); [Groove MIDI](https://magenta.tensorflow.org/datasets/groove) (CC BY 4.0)
86. [IDMT-SMT-Drums](https://zenodo.org/records/7544164) (CC BY-NC-ND 4.0); [ENST-Drums](https://zenodo.org/records/1415902)
87. [Freesound: licences](https://freesound.org/help/faq/)
