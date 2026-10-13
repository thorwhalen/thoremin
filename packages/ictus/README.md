# ictus

Infer musical time (beat, phase, tempo, dynamics, articulation) from low-rate gesture. Pure TypeScript, causal, no framework, no clock, no DOM. In conducting, the *ictus* is the exact instant of the beat, the turning point where the gesture reverses; this module infers it from things that only imply it.

This directory is a package-in-waiting (thoremin #178 proposes extracting it as `ictus`): nothing in it imports from outside the directory, and its tests import only from `@thoremin/ictus`. thoremin's `conductor` node and the body epic's audio pacer (#186) are its first consumers.

## The shape

```
samples (t, x, y)  ──▶ [IctusDetector] ──▶ Anchor ──▶ [RhythmPrior] ──▶ MusicalTime ──▶ consumers
                                                 └──▶ [DynamicsEstimator] ──▶ dynamics, articulation
samples (t, x, y)  ──▶ [ImpactPredictor] ──▶ predict (early) / confirm (= Anchor) ──▶ [magnetise] ──▶ what to sound
```

- **Anchors are observations with likelihoods, never onsets.** The detector emits a beat *candidate* with a confidence; the prior decides whether it confirms the predicted beat, signals a tempo change, or is noise.
- **`RhythmPrior` is injected, and three come by name** (`createRhythmPrior`, `IctusOptions.prior`): the adaptive oscillator (Large-Kolen circle map with Antescofo's adaptive attentional focus κ; robust to a stray anchor, 65 to 75 ms late under an accelerando), the trend prior (a least-squares tempo trend; no lag, carried by a stray anchor for its whole memory) and the **blend**, the default since #232: the oscillator's grid until three of its innovations in a row share a sign, then the trend's, back the same way; the trend half starts over whenever the oscillator re-seeds its lock or the two periods disagree by a fifth, and the published whole-beat count never steps back (`blend_prior.ts` has the argument and the numbers). `trend` by name is `trend12q` (`TREND_DEFAULTS`), the blend's own trend half. A Kalman filter or a multi-agent tracker fits behind the same `advance / update / predict / state` interface.
- **`MusicalTime` is the single source of truth.** Consumers evaluate it at their *own* time with `beatAt(state, t)` (the audio output timestamp, say), which is how the 30 Hz frame rate stops being the timing resolution.
- **Everything is relative to the player.** Stroke amplitude is normalised against the player's own recent envelope; articulation against their own usual braking sharpness. No calibration step, no absolute units.

## Use

```ts
import { createIctus } from '@thoremin/ictus';

const ictus = createIctus({ detector: { mirrorX: true }, oscillator: { beatsPerBar: 4 } });
// each frame, with the wrist (or index tip) of the beating hand:
const s = ictus.feed({ t, x, y });
s.tempo;        // bpm
s.phase;        // 0..1 within the beat
s.confidence;   // 0..1 — blend the beat-agnostic fallback against this
s.state;        // 'ready' | 'running' | 'hold'
s.dynamics;     // 0..1 from stroke size
s.articulation; // 0..1, legato (0) .. staccato (1)
```

`feedAnchor(anchor)` skips the detector for a consumer with its own anchor source (audio onsets, a pose-based dancer pulse). `advance(t)` free-runs between observations.

## Where the ictus is

The research map (§3) says: the peak deceleration of the beating hand as it brakes into the turning point, with the braking sharpness as the confidence. v1 fires on the **turning point itself** (the deepest vertical position of the stroke, confirmed by the first sample that has come back from it), timed below the frame period by a three-point parabolic fit on the *raw position samples*, and measures the braking sharpness separately as the articulation axis. The samples are not prefiltered: a median-of-three (the detector until #231, kept as `prefilter: 'median'`) replaces the bottom sample by a neighbour exactly where the fit needs it, which cost 5 ms and a frame on every sharp turn; instead a spike — a jump faster than a hand can move — is bridged by its neighbours, and the turn is confirmed by the first sample that comes back decisively (a few hundredths of the stroke) or by the second that is not deeper: one sample after a sharp bottom, two after a soft one, which is where the median confirmed every turn (`detector.ts` has the argument). The departure is deliberate: at 30 Hz the speed near a turning point is V-shaped, so a parabola fitted to the speed minimum is biased by about half a frame, whereas the position is smooth there and the fit is exact to a few milliseconds. `Anchor.confidence` is the stroke's amplitude relative to the player's envelope (a small stroke is a doubtful beat); a refractory window of a quarter period keeps the rebound from firing. The vertical-velocity zero crossing (every rule-based conducting system since the Radio Baton) is the selectable cheaper detector, `mode: 'zeroCrossing'`.

## Impacts: predicting the strike before the frame that shows it

`impact.ts` is the second detector family: not "where is the beat in a conducting stroke" but "when will this stroke *hit*", answered before it does. A least-squares quadratic through the last approach samples is extrapolated to a plane — a known surface (`level`), or the player's own floor learned from confirmed reversals — and a prediction is committed once per stroke at the last sample that still leaves the consumer's required lead (`minLead`: audio output latency plus a frame), judging "last" by the gaps the samples have been coming at (a slow laptop's inference-paced 33 / 67 ms stamps, not just the last one). The reversal, when it is seen, confirms the stroke, and its departure tells a surface (a kink: approach and departure fits meet on the plane) from an air turn (a smooth vertex) so the floor and the braking lag are learned under the right rule. On the synthetic benchmark (`docs/research/subframe-impact-prediction.md`) a surface hit is predicted 43 ms early with a 6.6 ms spread against the frame-snapped detector's 10.8 ms one frame late; with the plane given, 5.4 ms.

`magnet.ts` pulls a predicted time toward a prior's nearest expected beat by a strength through the prior's attentional gate: the rhythmic twin of pitch magnetism, the dial between actuality and intent. `trend_prior.ts` is the second `RhythmPrior`, a least-squares tempo trend over the last anchors, for the case the oscillator lags: a player who is deliberately speeding up (the oscillator's grid runs 65 to 75 ms late under a 1.5 %-per-beat accelerando; the trend prior does not lag). `blend_prior.ts` is the third and the default: on the bench's accelerando its grid is 18 / 20 ms from the intended beat (surface / air) against the oscillator's 68 / 77 and the trend's 16 / 17, and at a steady tempo it is the oscillator within 0.2 ms. The air drum consumes the predictor and the conductor's grid. `lagGate` (#239) decides how much of a pull a grid has earned: the instrument keeps the last eight strokes' `confirmed impact - grid at commit`, and the pull is scaled by `max(0, 1 - |mean| / (3 se))`, so a grid sitting further off the strokes than their own scatter explains (a lagging follower) pulls nothing.

## What v1 leaves for later

The map's `predict(t)`, gains scaled by the inter-beat interval, and `Anchor.kind`. None is needed by the first consumers; each is an additive change behind the same interface. `MusicalTime.leadOffset` (the conductor's beat leads the sound by a per-person constant) exists as a field since #232; nothing measures it yet (a trainer cue will).

## Testing

Synthetic ictus trains pin the oscillator (lock in three beats, accelerando, dropped and doubled anchors, a rebound that must not flip the tempo, a half-period seed that must recover, hold and preparatory restart) and the blend (at rest it is the oscillator to the bit; the accelerando's grid error; the false-trigger rate at a steady humanised tempo; a rebound and a dropped beat with the trend engaged). Real conducting-pattern excerpts at a *stated* 70 bpm (`test/fixtures/conducting_*/`) pin the detector and the follower's predictions: `metrics.ts` ports the `mir_eval` F-measure, Cemgil accuracy and CMLt continuity, and `fitGrid` builds the reference grid from the stated tempo alone (only the phase is fitted), so the excerpts are ground truth without hand annotation. The tests import the fixture loader and the `HandsFrame` type from the repo; the core itself imports nothing from outside this directory.
