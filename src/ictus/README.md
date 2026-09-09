# ictus

Infer musical time (beat, phase, tempo, dynamics, articulation) from low-rate gesture. Pure TypeScript, causal, no framework, no clock, no DOM. In conducting, the *ictus* is the exact instant of the beat, the turning point where the gesture reverses; this module infers it from things that only imply it.

This directory is a package-in-waiting (thoremin #178 proposes extracting it as `ictus`): nothing in it imports from outside the directory, and its tests import only from `@/ictus`. thoremin's `conductor` node and the body epic's audio pacer (#186) are its first consumers.

## The shape

```
samples (t, x, y)  ──▶ [IctusDetector] ──▶ Anchor ──▶ [RhythmPrior] ──▶ MusicalTime ──▶ consumers
                                                 └──▶ [DynamicsEstimator] ──▶ dynamics, articulation
```

- **Anchors are observations with likelihoods, never onsets.** The detector emits a beat *candidate* with a confidence; the prior decides whether it confirms the predicted beat, signals a tempo change, or is noise.
- **`RhythmPrior` is injected.** v1 is an adaptive oscillator (Large-Kolen circle map with Antescofo's adaptive attentional focus κ). A Kalman filter or a multi-agent tracker fits behind the same `advance / update / predict / state` interface.
- **`MusicalTime` is the single source of truth.** Consumers evaluate it at their *own* time with `beatAt(state, t)` (the audio output timestamp, say), which is how the 30 Hz frame rate stops being the timing resolution.
- **Everything is relative to the player.** Stroke amplitude is normalised against the player's own recent envelope; articulation against their own usual braking sharpness. No calibration step, no absolute units.

## Use

```ts
import { createIctus } from '@/ictus';

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

Peak deceleration of the beating hand as it brakes into the turning point (the perception literature), refined below the frame period by a three-point parabolic fit of the speed minimum, with a refractory window of a quarter period so the rebound cannot fire. The vertical-velocity zero crossing (every rule-based conducting system since the Radio Baton) is the selectable cheaper detector, `mode: 'zeroCrossing'`. See `docs/research/conducting-and-virtual-orchestra-research-map.md` §3.

## Testing

Synthetic ictus trains pin the oscillator (lock in three beats, accelerando, dropped and doubled anchors, hold and preparatory restart). Real conducting-pattern excerpts at a *stated* 70 bpm (`test/fixtures/conducting_*/`) pin the detector: `metrics.ts` ports the `mir_eval` F-measure, Cemgil accuracy and CMLt continuity, and `fitGrid` builds the reference grid from the stated tempo alone (only the phase is fitted), so the excerpts are ground truth without hand annotation.
