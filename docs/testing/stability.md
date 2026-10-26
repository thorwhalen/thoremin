# The chord instruments on real hands: stability

The chord instruments (Chord Map and its variants, Chord Wheel, ASL Chords, Sign Map, Sign Wheel) had been tested only on synthetic palms placed exactly, hand-made sign readings and scripted vectors. A real hand jitters, turns, is lost for a frame, and is sometimes given the wrong side's label by the hand model. This harness replays REAL hand landmarks through each instrument's actual graph (the seed's settings, the branches the app derives, the graph the app composes) and measures what a player hears go wrong.

Run it with `npm run stability` (prints the table), or `npm run stability -- --update` to rewrite the table below and `docs/testing/data/stability-baseline.json`. `test/stability/stability.test.ts` holds every number to that baseline: a number may not get worse, and a number that got better has to be written down.

## The streams

All are real MediaPipe hand landmarks, at the live pipeline's rate (30 fps).

| Stream | What it is | What the player meant |
|---|---|---|
| `signs-gaps` | A real signer fingerspelling (SignAlphaSet, CC BY 4.0; no ASL model is trained on it), each sign clip followed by 0.8 s with no hand: the hand comes in and leaves each time. Fixture `real_hands_signs`. | A chord letter (A to G) claims its chord in the instrument's key. Other letters and the gaps claim nothing. |
| `signs-flow` | The same signer, the clips joined with a 0.2 s dropout between them: one letter after the next. | As above. |
| `map-script` | The Chord Map played by a REAL held hand (the stillest second of the signer's open-palm B clips, with its own jitter and lost frames), placed by script: holds on four cell centres, a hold on the edge between two cells and one where three meet, a slow sweep along a row, the hand gone and back. | Inside a cell (within 0.35 cell widths of its centre), that cell's chord, found by holding a still hand there. The edge and vertex holds claim nothing: either chord is right, changing between them is not. |
| `choir` | A choir conductor's two hands, 20 s (Wikimedia Commons, CC BY 3.0). Fixture `real_hands_choir`. | Nothing: these hands are not playing the instrument. |
| `conducting` | An orchestral conductor's hands (the committed `conducting_44`). | Nothing. |

## The metrics

| Metric | What it counts |
|---|---|
| Sounding s | Seconds with a chord in force. On `choir` for a sign instrument, every one of them is a false reading. |
| Changes / held s | Chord changes while the hand is held still (seen, moving slower than 0.05 frame widths a second). A held hand should hold its chord. |
| Flickers / min | A chord, or a silence between two chords, that lasts under 200 ms (6 frames): a stutter or a wrong chord passed through. |
| Short chords | Chords that last 200 to 400 ms between two others: heard as a wrong chord on the way. |
| Entry flickers | Flickers within 0.5 s of the hand coming into view. |
| Chords with no hand | A chord that starts or changes while no hand is seen. |
| Latency | From the player's intended change (a sign clip starting, the palm entering a cell) to the first frame the output is on the new chord and stays there for 200 ms; median and 90th percentile. `Missed` counts intended chords never reached while they were intended. |
| Sound blips | Sound of at most two frames with silence on both sides, read from the pitch classes the voices sound (the melody voice included): a click. |

## Now

The current numbers, which the test holds (rewritten by `npm run stability -- --update`):

<!-- stability:table -->
| Instrument | Stream | Sounding s | Changes / held s | Flickers / min | Short chords | Entry flickers | Chords with no hand | Latency median (p90) ms | Missed | Sound blips |
|---|---|---|---|---|---|---|---|---|---|---|
| Chord Map | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Map | conducting | 3.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Chord Map Paths | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map Paths | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Map Paths | conducting | 3.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Chord Map Strum | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map Strum | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Wheel | choir | 20.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Chord Wheel | conducting | 13.3 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| ASL Chords | signs-gaps | 25.7 | 0.08 | 0.00 | 0 | 0 | 0 | 1367 (3167) | 1/8 | 0 |
| ASL Chords | signs-flow | 28.2 | 0.15 | 0.00 | 0 | 0 | 0 | 1033 (2500) | 1/9 | 0 |
| ASL Chords | choir | 20.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Sign Map | signs-gaps | 41.0 | 0.16 | 0.00 | 0 | 0 | 1 | 1600 (3400) | 3/8 | 0 |
| Sign Map | signs-flow | 28.0 | 0.30 | 0.00 | 0 | 0 | 0 | 1267 (3100) | 1/9 | 0 |
| Sign Map | choir | 0.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Sign Wheel | signs-gaps | 38.1 | 0.08 | 0.00 | 0 | 0 | 1 | 1533 (3333) | 3/8 | 0 |
| Sign Wheel | signs-flow | 28.1 | 0.30 | 0.00 | 0 | 0 | 0 | 1200 (3033) | 1/9 | 0 |
| Sign Wheel | choir | 19.8 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
<!-- /stability:table -->

## Before the fixes

The baseline as first measured on main (2026-10-26), kept as it was so each fix's before and after can be read here:

| Instrument | Stream | Sounding s | Changes / held s | Flickers / min | Short chords | Entry flickers | Chords with no hand | Latency median (p90) ms | Missed | Sound blips |
|---|---|---|---|---|---|---|---|---|---|---|
| Chord Map | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Map | conducting | 3.7 | 0.00 | 0.00 | 2 | 0 | 0 | - | - | 8 |
| Chord Map Paths | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map Paths | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Map Paths | conducting | 3.7 | 0.00 | 0.00 | 2 | 0 | 0 | - | - | 8 |
| Chord Map Strum | map-script | 27.5 | 0.10 | 0.00 | 1 | 0 | 0 | 0.00 (33) | 0/12 | 0 |
| Chord Map Strum | choir | 20.0 | 0.00 | 3.00 | 11 | 1 | 0 | - | - | 0 |
| Chord Wheel | choir | 20.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Chord Wheel | conducting | 13.3 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| ASL Chords | signs-gaps | 25.7 | 0.08 | 0.00 | 0 | 0 | 0 | 1367 (3167) | 1/8 | 0 |
| ASL Chords | signs-flow | 28.2 | 0.15 | 0.00 | 0 | 0 | 0 | 1033 (2500) | 1/9 | 0 |
| ASL Chords | choir | 20.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Sign Map | signs-gaps | 41.0 | 0.16 | 0.00 | 0 | 0 | 1 | 1600 (3400) | 3/8 | 0 |
| Sign Map | signs-flow | 28.0 | 0.30 | 0.00 | 0 | 0 | 0 | 1267 (3100) | 1/9 | 0 |
| Sign Map | choir | 0.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |
| Sign Wheel | signs-gaps | 40.2 | 0.08 | 24 | 0 | 5 | 1 | 1533 (3333) | 3/8 | 0 |
| Sign Wheel | signs-flow | 28.2 | 0.30 | 2.05 | 0 | 1 | 0 | 1200 (3033) | 1/9 | 0 |
| Sign Wheel | choir | 20.0 | 0.00 | 0.00 | 0 | 0 | 0 | - | - | 0 |

## What the numbers said

- **The sign instruments are slow, and the reader misses letters.** From the start of a sign clip to its chord takes a median 1.0 to 1.6 s, and one to three of the eight or nine chord letters are never reached: the reader reads a real B as "hello" after four frames, and never reads this signer's C. That is the recogniser's accuracy on a signer it was not trained on, not the instruments' logic.
- **ASL Chords plays on hands that are not signing.** On the choir conductor it holds a chord for the whole 20 s: the reader names a chord letter in a conducting hand and the instrument keeps it.
- **Sign Wheel flickers as a hand comes in** (24 a minute on `signs-gaps`, five at entry): for about five frames it plays a passing letter's move or the previous chord before the sign settles. Sign Map, which waits for a letter to be read for a moment, does not.
- **The Chord Map holds a real held hand well**, edge and vertex included, at the palm size of a player about a metre from a laptop camera. What it does audibly: it passes through the cells between two chords on the way (a short chord), and its melody voice sounds for one or two frames at a time while no chord is held (eight blips in 13.5 s of the conductor), when the hand model gives both hands the same side's label.
- **Two hands with the same label are common on real streams**: 38 and 40 of the two-hand frames of the 4/4 and 3/4 conductor clips (12 %), 167 of 878 (19 %) of the whole Allelulias take. Every instrument that picks a hand by its label loses it on those frames.

The fixes are separate pull requests, each with its before and after on these streams.

## Adding an instrument or a stream

An instrument is a line of `INSTRUMENTS` in `scripts/stability/suite.ts` (its seed's name and the streams to play it on); a stream is a case of `buildCase` there, from a committed fixture. Then `npm run stability -- --update`. A new fixture must come from a source whose licence allows redistribution, with its attribution in the fixture's README, and a row in `docs/research/datasets.md`. The fixtures are built by `scripts/stability/build_fixtures.ts` from the landmark streams kept in the app-data dir.
