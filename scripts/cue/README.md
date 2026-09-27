# scripts/cue — real-versus-air takes into labelled pairs (#247)

Every air-instrument model so far learns from other people's footage, where the air version has no ground truth and the real version has a different player (`docs/research/air-instruments.md` §6.4). A real-versus-air take gives paired data instead: the same player performing the same cued phrase on a real surface or instrument, where the microphone hears the ground truth, and then in the air, to the same click.

```bash
npm run pair -- ~/Downloads/real-vs-air-2026-09-27T10-00-00.zip
```

That extracts the take to `~/.local/share/thoremin/takes/cue/<name>/`, pairs it, prints one line per phrase, and writes `~/.local/share/thoremin/datasets/cue/<stem>/`. Nothing is written into the repository: a take is the player's body and room. `THOREMIN_DATA_DIR` moves the root; `--out <dir>` moves the output.

## Recording a take (the one page for the player)

**You need:** Chrome (it records the microphone as Opus; Safari's AAC adds its own encoder delay), a table, **headphones**, and about three minutes. Headphones, because the microphone must hear only your taps: a click from the speakers is recorded on top of the tap it prompted, and it cannot be removed afterwards by its time, because the taps land on the clicks by design.

**Bluetooth headphones are fine.** They deliver every click 150 to 300 ms late, but steadily. That delay becomes part of your lag behind the click, which the table half measures and the air half inherits, so the labels come out right; the pairing warns if the delay did not hold steady. What matters is the **microphone**: use the computer's own, not the headphones'. A Bluetooth headset's microphone switches it to the phone-call profile (8 to 16 kHz, heavy processing, more latency, and call-quality sound in your ears), which blurs the onsets. The recorder switches away from a headset's microphone by itself when the computer's is available, and the pairing warns if a take was recorded through one anyway (by its name, its rate, or claps with no high frequencies).

**Set up, before pressing Start:**

1. Connect the headphones.
2. In **System Settings → Sound → Input**, choose the computer's own microphone (**MacBook Air Microphone** or **MacBook Pro Microphone**). macOS often switches the input to the headset when it connects.
3. In Chrome, open `chrome://settings/content/microphone` and choose the same microphone in the menu at the top: Chrome's own choice overrides the system's.
4. Sit at the table with the camera seeing both hands and the table top in front of you, hands about half a metre from the camera, in good light.

**Run:** open thoremin, then **Trainer** in the tools bar, choose the routine **Real vs air: taps**, press **Start**, and allow the camera and the microphone (if Chrome asks which microphone, pick the computer's). Play to what you **hear**, not to the counter on screen (with Bluetooth, the counter runs ahead of the sound). Each phrase starts with three seconds to read the instruction on screen, then four low count-in clicks, then sixteen higher clicks to play on (the first of every four is higher still). Play on the sixteen, not on the count-in.

1. **Clap** once on each click (eight claps), where the camera can see your hands.
2. **Taps, on the table:** the fingers of one hand, on each click.
3. **Taps, in the air:** the same, just above the table, without touching it.
4. **Alternating, on the table:** left, right, left, right.
5. **Alternating, in the air.**
6. **Soft and hard, on the table:** four soft, four hard, four soft, four hard.
7. **Soft and hard, in the air:** the same pattern, as if striking.
8. **Clap again**, eight claps, to finish.

It stops by itself after about two and a half minutes and saves `real-vs-air-<date>.zip` to Downloads (or to the folder the Record button is set to). Then run the command above. (For an agent to run it, move the zip where it can read: on the maintainer's Mac, `$PP/_tmp/thoremin-cue/`.)

With a guitar, the routine **Real vs air: guitar** does the same for strums: a chord on each click, changing every four, then the same chords on air guitar.

## What the take holds

A normal recording folder (`docs/design/recording-v2.md`): the clean camera, `features.jsonl` (the hand feature vectors), `mic.wav` and `mic.webm` (the room, recorded raw: no echo cancellation, noise suppression or gain control, which would treat a tap as noise), and `annotations.jsonl`: an interval per cue, a point per verdict, and a point per click (`click:count`, `click:beat`) stamped with the time it was scheduled to sound. The manifest's `meta.trainer.cues` holds the routine's full cue specs, so the take says which cue was the real or air half of which phrase at what tempo.

## What the pairs are

`pairs.json` has one entry per phrase, each with a `real` half, an `air` half and 16 `beats`. All times are seconds into the take (`t - t0`).

Times are on one of three clocks, and the field names say which. The **engine clock** (`performance.now()`) is the clicks'. The **mic clock** is `t0` plus the time into the microphone file: it runs tens of milliseconds late (the recorder starts after `t0`, plus input latency) and drifts. The **row clock** is the feature rows' `t`. The claps at the start and end measure the mic-to-row mapping (`micToRows`: offset and drift), and the `*Row` fields apply it: those are the labels to train on the rows with. The mic-clock fields are kept beside them, raw.

| Field | Meaning |
|---|---|
| `beats[i].real.onset` | Mic clock: the microphone onset matched to beat `i`'s click, or null if nothing was heard. Matched around the player's lag read off the whole phrase (`gridLag`: where the onsets fall in the beat), not to the nearest click, because a Bluetooth delay plus the player's own lag can put a tap nearer the next click than its own. |
| `beats[i].real.onsetRow` | The same instant on the row clock. |
| `beats[i].real.lagMs` | Onset minus click: the player's lag plus the microphone's offset. `real.clickLagMs` is the phrase's median. |
| `beats[i].real.levelDb` | Peak level over 30 ms from the onset, dBFS: the label for how hard. |
| `beats[i].real.chroma` | 12 pitch classes (C = 0) over 200 ms after the attack, max 1: the label for which notes (a strum's chord). |
| `beats[i].air.intended` | Mic clock: the air click plus the real half's median lag, i.e. where the strike would have sounded, assuming the player lands as late in the air as on the table. |
| `beats[i].air.intendedRow` | The same on the row clock: the air half's training label. |
| `beats[i].air.levelDb`, `.chroma` | Inherited from the real beat of the same index (the phrase asked for the same thing). |
| `micToRows` | `offsetMs` (median of clap heard − clap seen, at the first usable slate, `atS`) and `driftMsPerS` (from the last). Null without a usable slate, and then so are the `*Row` fields. See "The slates". |
| `slates` | Each slate's claps (click, heard on the mic clock, seen on the row clock), its `offsetMs` and `madMs`. |
| `warnings` | Missing halves, which real beats were unheard, a phrase left unlabelled because two beat numberings fit equally (fast tempos with taps missing at an end), a lag that scattered or stepped (a Bluetooth delay that moved), sound on the air beats (click bleed, or a touched surface), a missing slate, a low sample rate. |

Beside it: `<phrase>.real.features.jsonl`, `<phrase>.air.features.jsonl` and one `<slate cue>.features.jsonl` per slate, the take's own feature rows for each half, untouched, so anything computed later joins back on `t`; and `mic.wav`, to listen against the labels.

## The onset detector

`src/latency/onsets.ts` finds a slap with hysteresis: the envelope must fall back before another strike counts. A strummed chord rings through the next click, so that detector hears the first strum only. `detectOnsets` here looks for rises against the envelope's recent **maximum** (a chord's partials beat, so the envelope dips and recovers; each recovery is a rise against the dip, never against the last peak), on two signals, and takes the union:

- the **level**: a knock on wood with a fingertip is mostly 100 to 500 Hz and rises plainly in the level;
- the **first difference**, which weighs each partial by its frequency: a string's ringing is its low partials and a pluck's attack its high ones, so a strum over a chord still ringing from the last one is a large rise in the difference and hardly any in the level. Its window is 10 ms, so a downstrum spread over 30 to 50 ms counts as one attack.

Neither alone is enough (the level misses re-strums; the difference misses low knocks). Measured on synthetic audio (`test/cue/pair_take.test.ts`, `test/helpers/strum.ts`): all 16 strums of one chord at 70 bpm for rings of 0.6 and 1.5 s and strum spreads of 0 to 50 ms; all 16 tonal knocks at 90 to 800 Hz; taps 16 dB over a -50 dBFS room (not at 6 dB: the pairing then names the unheard beats); no onset in a minute of room noise. On 60 s of real drum audio against librosa's onset labels: recall 1.00, precision 0.70 (dense music has onsets librosa merges; here matching takes the onset nearest each click), onsets 17 ms earlier than librosa's (librosa marks the peak of onset strength, this marks the attack's first sample). Tuned for 44.1 and 48 kHz; the pipeline warns below. Any other detector plugs in through `pairTake(..., { detect })`.

## The slates

A slate gives an offset only with at least 5 claps both heard and seen and a per-clap spread (MAD) under 20 ms; "seen" is the minimum of `hand.pair.distance`, interpolated between camera frames. With both slates usable, the drift is their slope, unless it exceeds 0.3 ms/s (no audio clock drifts that much, so a slate is wrong): then the first slate's offset is used alone, with a warning. With one usable slate there is no drift correction (at 100 ppm that is about 14 ms by the end of the routine).

## Files

- `lib_pair_take.ts`: the library (WAV reader, onsets, level, chroma, click matching, take reader, pairing, writers). Pure on import.
- `pair_take.ts`: the CLI (`npm run pair`).
- The routine itself: `src/app/enroll/realVsAirCues.ts` (cues and starter routines), `src/app/enroll/click.ts` (the metronome), the `microphone` stream in `src/app/recording/`.
- Tests: `test/cue/` (a synthetic take through the real trainer store, recorder plan and WAV encoder, with a microphone that starts late and drifts, then this pipeline, from a Finder-style zip). The browser capture itself (`SessionRecorder` opening the microphone, the WAV decode) is build-checked only, like the rest of the recorder's capture paths; the first real take is its live check.
