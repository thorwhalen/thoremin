# The sound mapper's latency and accuracy budget

Written 2026-10-29 for lane B of [#866](https://github.com/thorwhalen/thoremin/issues/866). The design is [`docs/design/audio-input.md`](../design/audio-input.md); the literature is [`docs/research/live-audio-to-audio.md`](live-audio-to-audio.md) (its reference numbers are cited here as [L-n]).

The sound mapper hears a tap (a fingertip on a table, a pot), recognises which surface it was and plays the sample mapped to it. It must feel like playing: the sample must sound close enough to the tap that the player hears one event. This document says how close, where the time goes, what the mapper measures today, and how a real device is measured.

## 1. The target

- **Perception.** The classic criterion for an "intimate" controller is about 10 ms of latency with under 1 ms of jitter (Wessel and Wright, secondary) [L-16]; percussionists are the strictest players; Lago and Kon argue 20 to 30 ms is often acceptable and that jitter matters more than the mean [L-17].
- **The owner's target** (the lane brief): under about 20 to 25 ms of trigger latency above the device's own, with the reasoning written down. We aim lower: **the mapper's own share (onset to the first sample of the answer) is held under 5 ms at the 95th percentile**, so that on a device with a 10 to 20 ms microphone-to-speaker round trip the total stays inside the 10 to 25 ms band. The device's share is not ours to cut, but it is ours to measure (section 5).

## 2. Where the time goes

A tap at time 0 in the room is heard as the sample at:

`input stage` + `mapper` + `output stage`

- **Input stage**: microphone, the converter, the OS input buffer, the browser's capture path. With `echoCancellation`, `noiseSuppression` and `autoGainControl` off (each adds processing delay and smears or gates transients [L-42]). Browsers barely report it: Chromium's `MediaStreamTrack.getSettings().latency` is a setting, not a measurement. `packages/sdk/src/timing/input_stage.ts` keeps it as a number with a source; the stated prior is 10 ms.
- **The mapper**: from the onset sample to the first sample of the answer in the worklet's output. It is `window - preRoll` samples plus at most one detector hop (32 samples, 0.67 ms), because the answer starts at the exact sample where the decision became possible, inside the same render quantum, not at the next quantum. The quantum (128 frames, 2.67 ms) does not add to it: the worklet consumes a whole input quantum before producing the matching output quantum, and that pairing is part of the device path the browser already counts.
- **Output stage**: the context's `outputLatency` (or the timing resource's measured pair, `packages/sdk/src/timing/output_stage.ts`), plus the speaker. A context created with `latencyHint: 0` (the per-device low-latency pref, #240) asks for the smallest buffer.

## 3. The trade-off the mapper chooses

A struck sound's first milliseconds separate surfaces less well than its first ten or twenty [L-13]; every millisecond of window is latency. The mapper resolves it with **sound early, decide late** (`packages/sdk/src/audio/mapper.ts`): the sample sounds on the short window's decision (4 ms), and the class is decided again on the long one (12 ms). A changed decision fades the first sample out over 3 ms and fades in the corrected one, started as far into itself as the first had played, so the hit stays where it was struck and a wrong sound is heard for 8 ms at most, never left ringing.

## 4. What it measures (offline, deterministic)

The offline harness (`packages/sdk/src/audio/offline.ts`, `evaluate.ts`) runs the mapper over a take one 128-frame quantum at a time, exactly as the worklet does, and reads the latency from the OUTPUT (the first sample of the answer after the true onset), the accuracy from the decisions, and the cost from a clock around each `process` call.

**Synthetic taps** (`packages/sdk/src/audio/synthetic_taps.ts`: four modal surfaces, a table's middle and edge, a pot, a mug; mode frequencies varied 3 %, amplitudes by strike position, level by a factor of 7; mains hum and noise; taught from 8 spaced taps per surface, tested on 160 taps played 150 to 400 ms apart with tails overlapping; `npx vite-node scripts/audio/sweep_synthetic.ts`):

| fast / refine (ms) | detected | fast accuracy | final accuracy | revised | heard p50 / p95 (ms) | quantum p50 / p99 (us) |
|---|---|---|---|---|---|---|
| 2 / - | 160/160 | 0.713 | 0.713 | 0 | 1.50 / 2.42 | 11.7 / 70.9 |
| 3 / - | 160/160 | 0.769 | 0.769 | 0 | 2.50 / 3.42 | 8.1 / 38.7 |
| 4 / - | 160/160 | 0.875 | 0.875 | 0 | 3.50 / 4.42 | 9.4 / 36.4 |
| 6 / - | 160/160 | 0.956 | 0.956 | 0 | 5.50 / 6.42 | 8.0 / 63.7 |
| 8 / - | 160/160 | 0.981 | 0.981 | 0 | 7.50 / 8.42 | 7.7 / 37.8 |
| 12 / - | 160/160 | 0.975 | 0.975 | 0 | 11.50 / 12.42 | 7.7 / 58.4 |
| 20 / - | 160/160 | 1.000 | 1.000 | 0 | 19.50 / 20.42 | 7.7 / 66.0 |
| 3 / 12 | 160/160 | 0.769 | 0.975 | 37 | 2.50 / 3.42 | 8.4 / 64.2 |
| **4 / 12 (default)** | 160/160 | 0.875 | 0.975 | 18 | 3.50 / 4.42 | 7.8 / 56.7 |
| 4 / 20 | 160/160 | 0.875 | 1.000 | 20 | 3.50 / 4.42 | 7.7 / 60.9 |

So the default sounds 3.5 ms after the onset (4.4 ms at the 95th percentile), is right 7 times in 8 on that first sound, and right 39 times in 40 once corrected 8 ms later. Its cost is about 8 us of a 2667 us quantum (0.3 %), under 70 us at the 99th percentile.

**Real struck sounds** (a local corpus gathered with the fleet's `foley` package from Wikimedia Commons, CC0 and CC-BY: 54 one-shot clips of five classes, glass, wood, metal pole, pans and cans, a plastic bin; not committed; `npx vite-node scripts/audio/eval_corpus.ts -- <dir> --split hits|clips`):

| split | fast 4 ms | fast 12 ms | fast 20 ms | 4 / 12 final |
|---|---|---|---|---|
| teach on the first hits of every clip, test on its later hits (`hits`) | 0.465 | 0.628 | 0.667 | 0.628 |
| teach on some clips, test on other clips of the class (`clips`) | 0.269 | 0.300 | 0.331 | 0.300 |

These are far below the synthetic numbers, and they are not the player's task. Each class in that corpus is several objects recorded by several people with several microphones (the "wood" class is a dozen hollow logs; "pans and cans" are different cans in fast rolls), so a class is not one surface, and the `clips` split asks the mapper to recognise an object it never heard. The player teaches one table and one pot in one room through one microphone, which the `hits` split approaches and the synthetic take models. The honest conclusion: **the real-room number is not known until the owner records one** (section 6), and the mapper's design (the player teaches; nearest example; a reject radius) is the literature's answer for exactly that per-user case [L-11], [L-14].

Two findings from the real corpus changed the defaults:

- **Background subtraction is off.** Subtracting the spectrum of the window before an onset (a previous tap's tail) raised synthetic accuracy at 6 ms from 0.89 to 0.93 and lowered real within-clip accuracy at 12 ms from 0.69 to 0.56: when the SAME surface is struck again, its tail has the same modes as the new attack, and subtracting it erases what identifies the surface. The option stays (`subtractTail`).
- **The rise test is per band and against the recent peak.** Against the recent minimum, the per-hop energy of a ringing tail (a hop is shorter than a low mode's period) swings by 20 dB and fired a false onset every refractory period (65 onsets for 32 taps); against the whole signal, a soft table tap under a loud ringing pot was missed (9 % of taps).

## 5. The ratchet

`test/audio/trigger_budget.test.ts` runs the default mapper over the seeded synthetic takes and compares with `test/audio/trigger.baseline.json`: fast and final accuracy may only go up, heard latency (p95 and max) only down; the baseline itself must stay inside the budget (p95 at most 5 ms, final accuracy at least 0.95). It also checks that every tap is found and none invented, that the decisions are identical whatever the quantum size (64, 128, 512: sample-accurate), that a revised hit's corrected sample continues where the first had got to, and that a quantum costs under a tenth of its duration (loose, for CI machines). A PR that improves a number runs `THOREMIN_AUDIO_BASELINE=update npx vitest run test/audio/trigger_budget.test.ts` and commits the baseline.

## 6. Measuring a real device (manual: needs a room, a microphone and ears)

The offline numbers are the mapper's share. The device's share, and the real-room accuracy, need a take. The procedure (the owner's, tracked as a `manual-task` issue):

1. **Loopback (the device's round trip).** In the sound mapper, with a sample mapped and the speaker on (not headphones), tap a hard surface near the laptop. Record the room with a second device (a phone at the laptop, its own microphone) at 48 kHz. In the recording, each tap and the sample it triggered are two onsets; the distance between them is tap-to-sound, glass to air, everything included. The same pairing as the latency probe's strike test (`src/latency/onsets.ts`), whose two-detector logic (broadband strike, the answer in its own band) applies if the mapped sample is a tone burst. Expect: the mapper's 3.5 ms plus the device's round trip. Ten taps give a mean and a spread; the spread is the jitter.
2. **A real-room teaching take.** Teach three surfaces (the table's middle, its edge, a pot) with eight taps each, then play a minute mixing them, then a second minute while saying aloud (or writing down) which surface each tap was. Export the take (the trainer's recorder, `src/app/recording/`) and its spoken labels; `scripts/audio/eval_corpus.ts` takes a folder of labelled clips, so cut the take into one clip per tap.
3. **What to report**: the loopback mean and spread, the final accuracy and the confusion, and whether the corrected sample (a revision) is audible as a flam.

## 7. Notes for whoever tunes this next

- The fast window is the one knob that trades latency for first-sound accuracy; the refining window costs nothing audible (the first sound already played) and is cheap to lengthen. 8 ms alone was 0.98 on synthetic taps: a player who prefers no correction can choose it and pay 4 ms.
- `refPeak` (the taught taps' median peak) scales velocity; a player who teaches softly and plays hard will hear everything loud.
- More taught examples help less than examples taught the way one plays (soft and hard, middle and edge of the same surface): the classifier keeps every example, so a surface struck in two places is two clusters of one class.
