# Audio games: Sing, Play along, Match the note

*Design for lane A of [#866](https://github.com/thorwhalen/thoremin/issues/866) (2026-10-29). The research behind it, including why these three, is [`docs/research/music-games-from-audio.md`](../research/music-games-from-audio.md). The audio-input seam they stand on is lane B's, [`docs/design/audio-input.md`](audio-input.md).*

## In one breath

A game is a slice: one **game node** that reads the microphone's events (pitch frames, onsets, level) from lane B's `audio-events` source and the engine clock, runs a pure **lesson** (targets in time) through the pure **judge** (`@thoremin/judge`), and emits a **view model**; one **overlay element** of the slice's own that draws the whole stage from that view model with the camera image hidden; and **note events** for its own sounds (count-in clicks, a guide melody), scheduled ahead on the audio clock through a plucked-note sink. The player's latency is one per-device number, the **input offset**, measured once by a tap-along take and subtracted from every event before it is judged.

```
microphone ─▶ AudioWorklet analysers (B: onset, level; A: pitch)
                │ events stamped in context frames
                ▼
          audio-events (B, source node)          lesson (A, pure data: targets in beats + tempo)
                │ engine time, input stage removed        │
                ▼                                          ▼
          <game> node (A) ── judge (@thoremin/judge) ── score
                │ view model                     │ note events (count-in, guide)
                ▼                                ▼
          overlay element (A: the stage)    pluck sink (A's instance of the SDK's makePluckOutNode)
```

## The three games

| Game | Kind it stands for | Targets | Judged by | Stage |
|---|---|---|---|---|
| **Sing** | karaoke pitch matching (SingStar, UltraStar, Smule) | a melody's notes (start, end, MIDI) | `judgePitchNote`: the share of each note's time within a cents tolerance, octave-folded; a line score | pitch bars scrolling right to left past a now line, the voice's trail over them; a bar fills where the voice is on it; tolerance drawn as the bar's thickness |
| **Play along** | instrument play-along lessons (Yousician, Simply Piano, Melodics), and the rhythm trainers as its unpitched level | onsets (time, optional pitch) | `createOnsetJudge` with `AUDIO_ONSET_WINDOWS`; a pitched target also needs the pitch at the onset within tolerance | a note highway: notes travel down lanes (one lane for a rhythm, one per pitch class for a melody) to a hit line; perfect / great / good / miss flashes, early and late, combo |
| **Match the note** | tuners and pitch matching (GuitarTuna, singers' drills) | one note at a time, played as a cue | time to reach the note (within tolerance) and how steadily it is held (the spread in cents over the hold) | a tuner dial: the target at the top, a needle in cents, a hold ring that fills while in tune |

Each is a seed (an instrument in the library) and its editor section. Each has a difficulty: a cents tolerance for pitch (UltraStar's 200, 100, 50 cents as easy, medium, hard) and a window set for time (`AUDIO_ONSET_WINDOWS_EASY` or the normal set).

## Pieces and where they live

| Piece | Where | Pure? |
|---|---|---|
| Windows, onset judge, pitch judge, score, calibration estimate | `packages/judge/` (`@thoremin/judge`, landed) | yes |
| YIN pitch over a buffer and a streaming tracker | `packages/sdk/src/audio/pitch.ts` (lane A's file in lane B's directory, by agreement on #866) | yes |
| The pitch analyser wrapper the worklet hosts | `packages/sdk/src/audio/` beside B's onset analyser (one registration line) | yes |
| Lessons: a Zod schema (targets in beats, a tempo, a count-in) and the shipped lessons | `@thoremin/games` (`packages/games/`: `lesson.ts`, `lessons.ts`; the Zod schema apart in `lesson_schema.ts`) | yes |
| The game state machine (idle, count-in, playing, results) over a lesson and the event stream | `@thoremin/games` (`sing.ts`, `play_along.ts`, `match.ts`, `calibrate.ts`) | yes |
| The game nodes (`sing-game`, `play-along-game`, `match-note-game`) | the games slice, `nodes/` | DAG nodes |
| The stage overlay elements | the drawing in `@thoremin/games` (`stage.ts`); the overlay element that wraps it in the games slice, `nodes/overlay/` | draw only |
| Editor sections, the start button, status | the games slice, `panels/`, `app/` | React |
| The calibration take (tap along to clicks) | the games slice, a tool section; writes B's input-offset pref | React + pure maths in the judge |

Since `docs/design/apps.md` the games are played on their own pages (`play/`, the listening app), and the camera build no longer lists this slice: it is kept as the seam for a game that uses the camera and the microphone together, built and tested by `npm run test:lab` (`extensions.lab.json`). One slice (`src/slices/games/`, extension id `audio-games`) holds the three games: they share the lesson model, the state machine, the clock handling, the guide sink and the calibration, and the player meets them as one family in the library (a class of their own, "Listening games"). Splitting them later is a move inside the slice, not a seam change.

## The microphone

The games branch composes its own `audio-events` node (lane B's source, id `gamesAudio`) whose params name the two analysers the games read, `onset` and `pitch`; its lease on the audio-input hub opens the microphone while a game is composed and closes it with the last lease. `heardFrom` adapts the tick's events to the games' own input (`Heard`: pitch frames and onsets in engine seconds), reading only those two analysers by id, so another consumer's onsets (the sound mapper's) never reach a game. The node's state reaches the game as `micStatus`, and the stage and the editor say what is wrong ("allow the microphone") until it is live.

## Time

Every time in a game is **engine seconds**. The `audio-events` source has already converted the worklet's context frames to engine time and removed the measured input stage (B's design). The game subtracts one more number, the **player offset** from the calibration take, when it judges an event against music the player hears (the count-in and the guide), because a tap-along measures the round trip plus the player's anticipation [research §6]. Targets are laid out from a start time the node chooses on the tick the game starts: `start = now + lead`, where `lead` covers the output stage so that the first count-in click can be scheduled ahead. The count-in and the guide are note events at exact engine times, sounded on the audio clock by the plucked-note sink (the SDK's `makePluckOutNode`, the discipline the air instruments use: scheduled ahead, never moved).

Pitch frames are stamped at their window's centre (the pitch describes the window), and onsets at their attack. The judge never reads a clock.

## The view model and the stage

A game node's `view` output is plain data: the phase, the engine time now, the visible span, the targets in it with their state (pending, hit with tier, missed), the recent pitch trail, the last few judgments, the running score and, in results, the summary. The overlay element draws only from it, so a test asserts what the player would see without a canvas, and the drawing is swapped without touching the game.

The stage owns the canvas: the seed hides the video (`overlay.video.show: false`) and the element paints its own background first. The camera still opens today, because whether the camera opens is decided by the source slot, not by the instrument. **Gap filed for the shell** ([#869](https://github.com/thorwhalen/thoremin/issues/869)): an instrument that needs no camera should be able to say so (an audio-only instrument then never asks for camera permission). Until then the games run with the camera open and unseen.

## Standalone pages

The same games run without the instrument around them. Everything a game is (lessons, sessions, difficulty, the stage) is the pure package `@thoremin/games`; the slice runs a session inside its graph node, and a page in `play/` runs it in a plain animation loop (`play/src/runner.ts`) over its own AudioContext and the browser audio-input hub (`src/audio/browser.ts`), drawing the stage on its own canvas and playing the cues with a small synth. No camera opens, and no graph, React, store or extension is loaded: `npm run check:play` (CI) fails a page that reaches a module outside its allow list or grows past its budget, and the browser smoke checks it never requests the app. The first page was Match the Note (`play/match-the-note.html`); every game has one now (see funfon below).

## Field games: the voice as a dot

The second family (Pop the Notes, the Pitch Maze, Vowels and Vowel Pop) puts the voice on a plane instead of a timeline, and is built from four small pieces of `@thoremin/games` that each game combines rather than reimplements:

| Piece | What it is | Used by |
|---|---|---|
| `cursor` | a `PointSource`: heard frames to a point. The pitch cursor puts the pitch CLASS across (one octave that wraps; a column per semitone, the note in tune mid-column) and the loudness up, steadied by the 1-euro filter (`@thoremin/stats/smooth`, with a period for the wrap) | Pop the Notes, the Pitch Maze |
| `loudness` | loudness as a position 0..1: by default the player's own range (the 5th and 95th percentiles of the last 30 s of voice, never narrower than 18 dB, a fixed range until 2 s of voice are heard), or a fixed range (soft, normal, loud). Both ends are reachable whatever the microphone, because the ends are where the player has been; the fixed ranges are the manual setting | Pop the Notes |
| `dwell` | time inside toward "enough", with a decay while outside (0 = wait) | a balloon's hold (drains at half its rate off it); a wall's passage (no decay) |
| `field` + `field_stage` | the plane (x and y in 0..1, an optional wrap, a hit test in screen proportions), its view model `FieldView`, and one stage that draws any of them: a backdrop given as data (columns, a polygon, marks), walls, balloons that shake harder as their hold fills and burst, the dot and its trail | all |

- **Pop the Notes**: `pop` (balloons popped by a `dwell` each, a few up at a time) over the pitch cursor with loudness. A course of balloons sits on the semitone columns at heights the scale reaches, sizes mixed (smaller is harder).
- **Pitch Maze**: `maze`, a track session over the pitch cursor with no y. The track is a list of segments, each a note's lane along the way (where it starts, how long, its note, its width in semitones), and a segment is one of two kinds; the levels go from one to the other (`TRACK_LEVELS`). A **wall** (levels 1 to 3, seen from above) is a bar across with one opening: the ball waits under it unless under the opening and goes through only while the note is held, for the wall's thickness (`dwell` with no decay); forgiving, a wrong note costs time, never the game; each wall's note is played as a hint early enough to die away before the ball arrives. A **band** (levels 4 to 6, the road: the piano roll in perspective, running to the horizon) is a lit strip along the note's lane as long as the note lasts at the lesson's tempo: nothing stops the ball, the player gains points while on the band and loses them while off it or silent (the first 0.1 s of a band forgiven, a rhythm game's good window), and at zero the game is lost. The lane's width is the precision asked for: a semitone, 25 cents either side, 12. The stage projects the same segments from above or onto the road (`field_stage`: one projection per view, segments drawn as projected quads). Both kinds take the melody from a Sing lesson.

- **Vowels** (`play/vowels.html`): the IPA vowel trapezoid as the plane. A `formants` analyser on the audio thread (`@thoremin/sdk/audio/formants`: decimate to 11 kHz, LPC by Levinson-Durbin of order 2 + kHz, the roots' narrow resonances; a second resonance above 3400 Hz means F2 was lost, as it often is when a back vowel's F1 and F2 merge) feeds a vowel cursor (`vowels`): F1 and F2 in Bark onto the chart by an affine fit on the eight primary cardinal vowels' reference formants, corrected by Gaussian radial basis functions so each passes exactly through its place; the median of the last seven windows; a loudness gate; a voice scale (the player's median F3 over the reference voice's, or chosen). The same map inverted (Newton from the affine inverse) gives the formants of any point, so the chart is playable: touching it sounds a parallel formant synthesiser (`play/src/vowel_synth.ts`). Practice is a pop session with no balloons (free play); **Vowel Pop** is the same session with the vowels as balloons. The vowel table and its places are glossa's; the reference formants Catford's. On the eight Commons recordings each lands nearest its own place, but one speaker's vowels sit 0.03 to 0.17 off the textbook places, so the balloons are wide; a per-player calibration (say three corner vowels) is the next step.

Loudness rides on the pitch frames (`PitchEvent.rms`, the same window YIN read), so the dot's height and its column describe the same audio. Both games are standalone pages (`play/pop-the-notes.html`, `play/pitch-maze.html`, through `play/src/page.ts`, which every page shares).

## funfon: the pages as an app

**Echo the Rhythm** (`play/echo.html`, `@thoremin/games/echo`) is call and response, the rhythm teacher's drill: the game plays a bar of rhythm over a quiet metronome, counts "1, 2, 3, 4" (clicks and the numbers shown big), and the player claps or taps it back in silence, judged by the onset judge with the microphone windows. A level is a rhythm (onsets in beats, the same `LessonNote`s as a lesson, so any melody is a rhythm too) at a tempo and a meter, cut into bars by onset; its rounds present the bars one at a time and then stacked (`stackRounds`: `end`, every piece and then all, or `grow`, 1, 2, 1-2, 3, 1-3 and so on, in pieces of `barsPerPiece` bars). A round under `passAt` (0.7) is played again once (`retries`) before the game moves on. The metronome stays off while the player answers, because the microphone would hear it as claps; a player on headphones can keep it (`clickWhileAnswering`). Each round is placed on the clock when it begins, since a retry changes what comes next. Its stage (`echo_stage`) draws the round's bars as one strip: the call's notes as blocks, the player's claps as ticks under them, the judge's colours once the answer is in.

Every game has a standalone page (`play/<name>.html`: Match the Note, Pop the Notes, the Pitch Maze, Vowels, Sing Along, Play Along Lessons, Echo the Rhythm, Audio timing), all through `play/src/page.ts`, and `play/index.html` is their home. thoremin's build ships them under `/thoremin/play/`; `vite.funfon.config.ts` builds them alone as **funfon**, a second app from this repo (`enlace_apps/funfon/`, tw_platform's nested-app pattern), served at `/funfon/`. The timed games subtract the player's offset, measured by the Audio timing page and kept in the browser's storage (`play/src/offset.ts`; the app keeps it as a device pref instead). `test/play/home.test.ts` keeps the home and the page list equal.

## Calibration

`Audio timing` (a section of the games' tool): eight clicks of count-in, then sixteen clicks at 100 bpm; the player taps the table or claps on each; the microphone's onsets are paired with the clicks by `estimateOffset` (median, outliers dropped, refused when the spread is over 30 ms or fewer than six pairs survive). An accepted take writes the per-device **player offset** with its spread and date; a refused one says why and keeps the old value. A loopback take (the speaker heard by the microphone, no player) is offered where the speaker is audible: it measures the device's round trip alone.

## What the seam must give (lane A's requirements on #866, as agreed)

1. Onset, level and pitch events, each stamped with the time of the audio it describes, in engine seconds with the input stage removed.
2. Pitch at its own hop (about 100 per second), several per tick; the analysers pure and runnable offline over a recording (`runAnalysers`), so the games are tested on real recordings through the code the worklet runs.
3. One shared microphone with echo cancellation, noise suppression and gain control off; headphones are recommended in the games' own words when a guide or backing plays.
4. A per-device input-offset pref with a source, written by the games' calibration take through a setter the seam exposes.
5. Per-tick events are enough: nothing in these games sounds in reaction to the player's note.

## Tests

- The judge: known offsets, worked by hand (`test/judge/`).
- Pitch: synthetic tones and two vocadito excerpts against their f0 annotation (`test/games/pitch.test.ts`).
- Each game's state machine over real recordings with known answers: a vocadito excerpt sung against its own annotated notes must score high, the same excerpt against a transposed melody must score low; CC0 claps placed on a grid with known offsets must land in the tiers the offsets say.
- A browser smoke per seed: the seed loads, the stage draws, a scripted audio source plays the lesson, the results screen appears.
- Reachability: each seed is in the library and has a guide page.
