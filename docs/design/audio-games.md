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
| Lessons: a Zod schema (targets in beats, a tempo, a count-in) and the shipped lessons | the games slice, `lib/lessons.ts` | yes |
| The game state machine (idle, count-in, playing, results) over a lesson and the event stream | the games slice, `lib/` | yes |
| The game nodes (`sing-game`, `play-along-game`, `match-note-game`) | the games slice, `nodes/` | DAG nodes |
| The stage overlay elements | the games slice, `nodes/overlay/` | draw only |
| Editor sections, the start button, status | the games slice, `panels/`, `app/` | React |
| The calibration take (tap along to clicks) | the games slice, a tool section; writes B's input-offset pref | React + pure maths in the judge |

One slice (`src/slices/games/`, extension id `audio-games`) holds the three games: they share the lesson model, the state machine, the clock handling, the guide sink and the calibration, and the player meets them as one family in the library (a class of their own, "Listening games"). Splitting them later is a move inside the slice, not a seam change.

## Time

Every time in a game is **engine seconds**. The `audio-events` source has already converted the worklet's context frames to engine time and removed the measured input stage (B's design). The game subtracts one more number, the **player offset** from the calibration take, when it judges an event against music the player hears (the count-in and the guide), because a tap-along measures the round trip plus the player's anticipation [research §6]. Targets are laid out from a start time the node chooses on the tick the game starts: `start = now + lead`, where `lead` covers the output stage so that the first count-in click can be scheduled ahead. The count-in and the guide are note events at exact engine times, sounded on the audio clock by the plucked-note sink (the SDK's `makePluckOutNode`, the discipline the air instruments use: scheduled ahead, never moved).

Pitch frames are stamped at their window's centre (the pitch describes the window), and onsets at their attack. The judge never reads a clock.

## The view model and the stage

A game node's `view` output is plain data: the phase, the engine time now, the visible span, the targets in it with their state (pending, hit with tier, missed), the recent pitch trail, the last few judgments, the running score and, in results, the summary. The overlay element draws only from it, so a test asserts what the player would see without a canvas, and the drawing is swapped without touching the game.

The stage owns the canvas: the seed hides the video (`overlay.video.show: false`) and the element paints its own background first. The camera still opens today, because whether the camera opens is decided by the source slot, not by the instrument. **Gap filed for the shell**: an instrument that needs no camera should be able to say so (an audio-only instrument then never asks for camera permission). Until then the games run with the camera open and unseen.

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
