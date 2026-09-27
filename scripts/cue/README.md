# scripts/cue — real-versus-air takes into labelled pairs (#247)

Every air-instrument model so far learns from other people's footage, where the air version has no ground truth and the real version has a different player (`docs/research/air-instruments.md` §6.4). A real-versus-air take gives paired data instead: the same player performing the same cued phrase on a real surface or instrument, where the microphone hears the ground truth, and then in the air, to the same click.

```bash
npm run pair -- ~/Downloads/real-vs-air-2026-09-27T10-00-00.zip
```

That extracts the take to `~/.local/share/thoremin/takes/cue/<name>/`, pairs it, prints one line per phrase, and writes `~/.local/share/thoremin/datasets/cue/<stem>/`. Nothing is written into the repository: a take is the player's body and room. `THOREMIN_DATA_DIR` moves the root; `--out <dir>` moves the output.

## Recording a take (the one page for the player)

**You need:** Chrome, a table, **wired headphones**, about three minutes. Headphones, because the microphone must hear only your taps: a click from the speakers is recorded on top of the tap it prompted. Wired, because Bluetooth delays the click by a fifth of a second.

**Set up:** sit at the table with the camera seeing both hands and the table top in front of you, hands about half a metre from the camera, in good light.

**Run:** open thoremin, then **Trainer** in the tools bar, choose the routine **Real vs air: taps**, press **Start**, and allow the camera and the microphone. Each phrase starts with three seconds to read the instruction on screen, then four low count-in clicks, then sixteen higher clicks to play on (the first of every four is higher still). Play on the sixteen, not on the count-in.

1. **Clap** once on each click (four claps), where the camera can see your hands.
2. **Taps, on the table:** the fingers of one hand, on each click.
3. **Taps, in the air:** the same, just above the table, without touching it.
4. **Alternating, on the table:** left, right, left, right.
5. **Alternating, in the air.**
6. **Soft and hard, on the table:** four soft, four hard, four soft, four hard.
7. **Soft and hard, in the air:** the same pattern, as if striking.

It stops by itself after about two and a half minutes and saves `real-vs-air-<date>.zip` to Downloads (or to the folder the Record button is set to). Then run the command above.

With a guitar, the routine **Real vs air: guitar** does the same for strums: a chord on each click, changing every four, then the same chords on air guitar.

## What the take holds

A normal recording folder (`docs/design/recording-v2.md`): the clean camera, `features.jsonl` (the hand feature vectors), `mic.wav` and `mic.webm` (the room, recorded raw: no echo cancellation, noise suppression or gain control, which would treat a tap as noise), and `annotations.jsonl`: an interval per cue, a point per verdict, and a point per click (`click:count`, `click:beat`) stamped with the time it was scheduled to sound. The manifest's `meta.trainer.cues` holds the routine's full cue specs, so the take says which cue was the real or air half of which phrase at what tempo.

## What the pairs are

`pairs.json` has one entry per phrase, each with a `real` half, an `air` half and 16 `beats`. All times are seconds into the take (`t - t0`).

| Field | Meaning |
|---|---|
| `beats[i].real.onset` | The microphone onset matched to beat `i`'s click (nearest within half a beat), or null if nothing was heard. |
| `beats[i].real.lagMs` | Onset minus click. `real.clickLagMs` is the phrase's median. |
| `beats[i].real.levelDb` | Peak level over 30 ms from the onset, dBFS: the label for how hard. |
| `beats[i].real.chroma` | 12 pitch classes (C = 0) over 200 ms after the attack, max 1: the label for which notes (a strum's chord). |
| `beats[i].air.intended` | The air click plus the real half's median lag: when the player meant to strike, assuming they land as late on air as on the table. |
| `beats[i].air.levelDb`, `.chroma` | Inherited from the real beat of the same index (the phrase asked for the same thing). |
| `avOffsetMs` | Median of (clap sound − visible clap), from the slate: positive means the microphone runs late against the camera. Reported, never applied. |
| `warnings` | Missing halves, unheard real beats, and sound on the air beats (click bleed, or a touched surface). |

Beside it: `<phrase>.real.features.jsonl`, `<phrase>.air.features.jsonl` and `slate.features.jsonl`, the take's own feature rows for each half, untouched, so anything computed later joins back on `t`; and `mic.wav`, to listen against the labels.

## Why the onset detector is not the latency probe's

`src/latency/onsets.ts` finds a slap with hysteresis: the envelope must fall back before another strike counts. A strummed chord rings through the next click, so that detector hears the first strum only. `detectOnsets` here looks for rises against the envelope's recent **maximum**: a chord's partials beat, so its envelope dips and recovers every few tens of milliseconds, and each recovery is a rise against the dip but never against the last peak, while a new strum or tap clears it.

## Files

- `lib_pair_take.ts`: the library (WAV reader, onsets, level, chroma, click matching, take reader, pairing, writers). Pure on import.
- `pair_take.ts`: the CLI (`npm run pair`).
- The routine itself: `src/app/enroll/realVsAirCues.ts` (cues and starter routines), `src/app/enroll/click.ts` (the metronome), the `microphone` stream in `src/app/recording/`.
- Tests: `test/cue/` (a synthetic take through the real trainer store, recorder plan and WAV encoder, then this pipeline, from the zip).
