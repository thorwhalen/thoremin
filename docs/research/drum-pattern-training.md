# Drum pattern training: fit a player's tempo and positions to a short score, then play them back snapped and humanised

Issue #269, part of the sequence-training stream (#263). This is the design record, written before the code, with the three decisions the maintainer left open (a cursor, a metronome, which sound to feed back) taken with reasons. The pieces it stands on: the impact predictor and the timing magnet in `src/ictus` (#235, #239), the editable pads (#256), the score document (#187), and the trainer's click (#247).

## 0. The short version

- A **pattern** is a short `ScoreDoc` with one percussion part (the schema already has the flag): a bar or two of kick, snare, hi-hat and the rest in beats, written in a one-line grid notation and shipped as a handful of starters (a rock beat, its backbeat variations, a simple fill). A drum's General MIDI note number maps to the air drum's sound set.
- **Training** is a take: the pattern is shown as a strip (one row per drum, sixteenths as columns) over the pads' own layout, a count-in click gives the tempo, and the player plays the pattern through a few times. The hits the air drum already emits (`DrumHit`: time, pad, landing point, hardness) are captured at human frequency, like the shape tap.
- The **fit** is offline and pure: the phase and tempo of the player's hits against the stated tempo (`fitGrid`, then a straight-line refinement of tempo over the matched hits), the assignment of hits to the score's events, and from it three things: the player's **tempo**, their **feel** (the mean timing offset of each event, in fractions of a beat, and its spread) and their **positions** (which pad, and where on it, each score drum is actually struck). That is the pattern **model**, a zodal record.
- **Playback** ("snapped") is a mode of the air drum: with a pattern model loaded, a `RhythmPrior` initialised at the learned tempo follows the player's hits, each hit is assigned to the nearest score event at the running phase, and it sounds at that event's grid time plus the player's learned offset for it, with the pull of the timing magnet turned all the way up. The result is the pattern quantised to the grid and humanised by the two things the fit kept: the player's local tempo, and their own feel and positions.
- Decisions: a **cursor**, yes, on the strip in the panel (it is the only way a player knows where in a two-bar pattern they are); a **metronome**, yes for the count-in and the first pass, then optional (the tempo must be anchored for the fit to mean anything, and after one pass the player is the clock); the **feedback sound** during training is the player's raw hit as the instrument plays it today (honest, and what they are used to), during playback the snapped one (the point of the exercise), never the score's intended sound on its own (that is a backing track, not an instrument).

## 1. The request

"The drums could use a few short scores of typical repeated drum patterns. The user would play this pattern a few times and this could be used to match both tempo and positions that the execution of these patterns entail. Better of course if this is done with clear visual positions of the various percussions, so the user has a guide. I am not sure if it's good to have a cursor that shows them which part of the score they're at, if there should be a metronome or not, and if the sound should be played (where it is supposed to be, I guess, not where the user is playing them, or maybe yes, but where they'd be resolved after the smoothing). What I would like to get to is that if a user, after training it, does that beat they would be able to hear the beat quantised to the right place, so it sounds good, with only the variations of the local tempo and the particular position that make a difference (humanising over a straight fixed-tempo MIDI playing of the pattern)."

## 2. What exists, and the gap

`src/ictus` is pure and causal: the impact predictor commits a stroke's landing about 50 ms before it lands with a 7 ms spread on a surface (as early, at frame accuracy, in the air), a `RhythmPrior` (an adaptive oscillator or the tempo-trend fit) turns anchors into a running beat, and `magnetise` pulls a time toward the prior's nearest expected beat through a confidence-scaled gate [1]. The air drum applies the magnet against the **conductor's** beat only, at a dial that defaults to 0, because #239 found that a pull toward a late grid makes both actuality and intent worse: the magnet is only as good as the prior [2]. The metrics module has `fitGrid` (a stated tempo, the phase fitted by F-measure) and the beat-tracking scores.

The pads (#256) are eight fixed slots with a shape, position, colour and sound; a hit carries its landing point and the pad it fell in. The score document carries a percussion flag on a part and notes in beats, but nothing maps a General MIDI drum number to a sound or a pad. The trainer's click (#247) plays a deterministic schedule on its own audio context, mapped to the engine clock, so what is heard and what is recorded agree.

The gap is a **pattern**: a grid that is the player's own, not the conductor's. Given one, the magnet has a prior worth pulling toward, and the #239 trade-off changes: a pull toward a grid the player is *trying* to play is intent, and the fit tells us their tempo and feel rather than guessing them.

## 3. Patterns as data

`src/music/drum_patterns.ts`. A pattern is written as rows of a grid, one row per drum, one character per subdivision:

```
kick   x...x...x...x...
snare  ....x.......x...
hihat  x.x.x.x.x.x.x.x.
```

`x` is a hit, `X` an accent, `.` nothing; the row's length is the pattern's length in subdivisions (sixteenths by default), so a two-bar pattern is a 32-character row. The DSL compiles to a `ScoreDoc` (one part, `percussion: true`, notes in beats at the pattern's stated tempo, velocity from the accent) so a pattern is a score like any other and could one day be imported from a MIDI file. A drum name maps to a General MIDI note number (`src/music/gm_drums.ts`: kick 36, snare 38, closed hi-hat 42, open hi-hat 46, crash 49, ride 51, toms 45/47/48/50) and from there to the air drum's `DrumSound`. The starters: the basic rock beat; the same with an open hi-hat on the "and" of four; a half-time feel; a shuffle; a one-bar snare fill. Tempos stated at 90 or 100 bpm, since the air drum's stroke is slower than a stick's.

## 4. The training take

Reachable from the air drum's settings (and, once the instrument spec's `training` field lands, from every instrument's panel the same way): pick a pattern, press Start. The panel shows the strip with a cursor and the pads' layout with each score drum's pad lit, a count-in of one bar clicks at the stated tempo, then the pattern runs for `passes` bars (four by default) with the click on for the first pass and off after unless the player keeps it. The player plays; the air drum sounds their hits as it does today; the take captures every `DrumHit` from the node's `hits` output through a holder polled at human frequency (the shape tap's pattern), stamped on the engine clock. The take ends, and the fit runs.

Three decisions, with the reasons.

**A cursor: yes, on the strip.** A one-bar pattern the player can keep in their head; a two-bar one with a fill in the second they cannot, and the strip without a cursor is a picture, not a guide. The cursor runs on the click's clock during the count-in and the first pass, and on the fitted phase of the player's own hits after that (a `RhythmPrior` at the stated tempo, fed the hits as anchors), so it follows the player rather than dragging them. It is drawn in the panel, not on the video: the video already carries the pads, and a second moving thing there is clutter. If the strip on the video turns out to be wanted, it is an overlay element like the pads.

**A metronome: for the count-in and the first pass, then the player's choice.** The fit needs an anchor: a take with no reference has a phase and a tempo, but no way to tell "played the pattern at 80 instead of 100" from "played a different pattern". The count-in fixes what the player is aiming at; the first pass keeps them there while they find the pads; after that the click is off by default, because the question the fit answers is what *their* tempo and feel are, and a click for the whole take answers what their offset from a click is, which is #247's question, not this one. The click is the trainer's own player (`src/app/enroll/click.ts`), never the instrument's bus, so hushing the instrument does not hush it, and the take records the click times, so an offline check can always say how the fit relates to the reference.

**The feedback sound: the player's raw hit while training, the snapped hit in playback, never the score alone.** During training the instrument must sound as it will sound, or the player is training against a different instrument; and it must sound *where they hit*, because the raw hit is the evidence the fit is about to use, and a player who hears the intended sound at the intended time while hitting late learns nothing about being late. The score's own sound is a backing track, useful as a preview button ("hear the pattern") before the take, not as feedback. In playback the snapped hit is the point: the pattern quantised, with the player's feel put back in.

## 5. The fit

`src/drums/pattern_fit.ts`, pure, over `DrumHit[]` and a pattern.

1. **Phase and tempo.** `fitGrid` at the stated tempo gives the phase that best matches the hits to a beat grid (F-measure, ties broken toward the centre of the run). Then the matched hits and their beats give a least-squares line, time against beat: its slope is the player's period, its intercept the phase. One more pass of matching at the fitted tempo, and the line is refit. This is the same shape as the trend prior's fit, offline and over the whole take.
2. **Assignment.** Each hit is assigned to the nearest score event whose drum could be it (same pad, or a pad the drum's sound is on), within half a subdivision at the fitted tempo; unassigned hits are extras (a flam, a mistake), unhit events are misses. The take's F-measure against the score is the pattern's **accuracy**, shown after the take.
3. **Feel.** For every score event, the mean and spread of its assigned hits' offsets from the grid, in fractions of a beat, over the passes. The grid each offset is measured against is the **pass's own line** (its own tempo and phase, refit over that pass's hits), not the take's: a player's tempo drifts, and against one line over four passes a steady slowing of six percent reads as a feel that changes sign from the first pass to the last, which the synthetic take showed at once. Playback follows the local tempo too, so the feel is measured the way it will be applied. That is the player's feel on that pattern: the snare a little late, the hi-hat's off-beats pushed. With four passes an event has four samples; the spread says whether the offset is a habit or noise, and an event whose spread is wider than its mean offset gets no offset in playback.
On 1, **the tempo search.** The stated tempo is only where the search starts: a coarse scan from seventy to a hundred and thirty percent of it, in steps of two and a half percent, each with the beat grid's best phase and every beat of the pattern's length tried as the pattern's first beat (a beat grid says where the beats are, not which one is beat one), keeps the tempo and phase that explain the most hits closest, and then the line is refit. A player who plays the count-in's 96 at 88 is fitted at 88.
On 2, **same sound, strictly.** A hit of a sound the pattern uses must go to an event of that sound: the second kick of a flam is an extra, not the hi-hat under it. A hit of a sound the pattern has no event for may be the player's substitute for any drum, which is how a drum's pad is learned when it is not the pad whose sound it is.
4. **Positions.** For every score drum, the pad its assigned hits fell in most often (the pad the player *uses* for that drum, which may not be the pad whose sound it is), and the mean landing point on it. In playback the drum sounds when that pad is hit, and centre-to-rim shading uses the mean as the player's centre, so their own habit is the middle of the drum, not the pad's geometric centre.

The model: `{ pattern, tempo, phase, feel: per event {offset, spread, n}, positions: per drum {pad, centre}, accuracy, takenAt }`, a zodal record in a `drumPatternModels` collection, one per pattern per browser.

## 6. Playback: snapped and humanised

A pattern mode on the air drum (a dial, `airDrum.pattern`: the model's id, or off). With a model:

- A `RhythmPrior` is created at the learned tempo and fed the player's hits as anchors; the conductor's beat is not used. The trend prior is the right one here (it followed accelerando best in the sub-frame work [1]).
- Each predicted hit is assigned to the nearest score event at the prior's phase (the same rule as the fit's), and its sounding time becomes the event's grid time plus the event's learned offset. This is `magnetise` with the magnetism at 1 and the grid the pattern's, plus the offset. The #239 truncation (`max(now, pulled)`) is the place to be careful: a pull toward a beat already past cannot be honoured, so the assignment is made at the predictor's commit time, about 50 ms before the stroke lands, and a hit assigned to a past event sounds now. The sub-frame lead is what makes snapping toward an *earlier* grid time possible at all.
- The drum that sounds is the event's, on the pad the model says the player uses for it, shaded from the player's own centre.

What the player hears: the pattern on the grid, at their tempo as it drifts, with their own feel, and nothing else of the stroke timing. What they lose: the ability to play something other than the pattern while the mode is on, which is why it is a mode, with the strip and the mode's name on the panel.

## 7. Verification

- Synthetic takes (`test/drums/pattern_fit.test.ts`, self-made, committed): the rock beat played four times by a synthetic player slowing 1.5 bpm a pass, with the snare a twentieth of a beat late and the first off-beat hi-hats early, per-drum pads and centres, and 0.012 beats of jitter. The fit recovers the mean tempo within 1 bpm, the snare's lateness within 0.03 of a beat and as a habit (kept in playback), the kick on one as no habit (on the grid), every pad and the snare's centre; started late and played at 88 against a stated 96, the tempo within 1 bpm and every event matched; one dropped snare and one stray tom read as one miss and one extra; a take of nothing is null; a flam's second kick is an extra, not the hi-hat under it. The `an.impacts` clip sets are the harder bench: hits from the real predictor over rendered strokes.
- Live (a #146 entry): the strip readable while playing; the count-in tempo playable in the air; whether the snapped playback "sounds good" to the maintainer, which is the stated goal and the only test of it.

## 8. What is not decided here

- Whether feel should be learned per event or per drum-and-beat-position (the snare's backbeat late, wherever it is). Per event first; per position is a pooling of it.
- How many passes. Four is a guess; the spread per event says when more are needed, and the panel can say "one more".
- Where the strip goes when the instrument spec's `training` field lands: this doc assumes the air drum's settings, as the sequence trainer sits in the flute's.

## REFERENCES

[1] thoremin, [Sub-frame impact prediction](subframe-impact-prediction.md): the predictor's lead and spread; the magnet trade-off (§3.7); the trend prior under accelerando.

[2] thoremin, issue #239: magnetism 0.5 helps at 0 ms pipeline delay and hurts at 40 ms; the dial defaults to 0 pending a prior worth pulling toward.

[3] thoremin, [Air instruments](air-instruments.md) §7.3: strokes and drums at frame resolution; the stick tip as the tracked point.

[4] thoremin, [Rhythm from gesture: research map](rhythm-from-gesture-research-map.md): why rhythm is inferred against a prior, never measured frame to onset.
