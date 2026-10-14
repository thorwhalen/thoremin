/**
 * ictus — the shared vocabulary.
 *
 * The package infers musical time (beat, phase, tempo) from things that only *imply*
 * it: a hand or wrist trajectory sampled at 30-60 Hz, a dancer's motion envelope, an
 * onset stream. Everything here is causal (no method needs the future) and clock-free
 * (every method takes the current time; nothing reads a clock), which is what lets the
 * same code serve a real-time instrument and an offline analysis.
 *
 * The shape is the one `docs/research/rhythm-from-gesture-research-map.md` §6 sketches
 * and `docs/research/conducting-and-virtual-orchestra-research-map.md` §7 specifies:
 * a detector turns samples into {@link Anchor}s (observations with likelihoods, never
 * hard onsets); a {@link RhythmPrior} decides what each anchor means; the
 * {@link MusicalTime} it publishes is the single source of truth every consumer reads.
 */

/** One observation of the tracked point. `y` grows DOWNWARD by default (image
 *  coordinates), so the ictus — the bottom of the stroke — is a local MAXIMUM of `y`;
 *  see {@link DetectorOptions.yDown}. Units are the caller's; the detector normalises
 *  amplitudes against the player's own recent strokes, so pixels and unit squares both
 *  work. */
export interface Sample {
  /** Seconds. Must be non-decreasing. */
  t: number;
  x: number;
  y: number;
  z?: number;
}

/**
 * A timing anchor: a beat CANDIDATE with a confidence, never a beat. The prior decides
 * whether it confirms the predicted beat, signals a tempo change, or is noise.
 */
export interface Anchor {
  /** Seconds; refined below the sample period by parabolic interpolation. */
  t: number;
  /** 0..1. How much the prior should trust this anchor's timing. */
  confidence: number;
  /** The stroke's amplitude relative to the player's recent envelope, 0..1+. The
   *  dynamics estimator reads this. */
  strength: number;
  /** Braking sharpness of the stroke into the turning point (peak deceleration over
   *  mean approach speed, 1/s). The articulation axis: high = staccato "click", low =
   *  legato. NaN when it could not be measured. */
  sharpness: number;
  /** Signed lateral travel of the stroke (x at the ictus minus x at the previous
   *  ictus), in the caller's units, mirrored so positive means the player's right.
   *  The beat-pattern recogniser reads this; 0 for the first anchor. */
  lateral: number;
  /** The stroke's own excursion in the detector's unit (torso lengths for the body's impact
   *  detector), and the channel it was measured on; absent where a detector does not
   *  report them. The body's expression reads it against the player's last 20 s (#378). */
  amplitude?: number;
  channel?: string;
}

/** What the prior expects next. */
export interface Prediction {
  /** When the next beat is expected, in seconds. */
  expectedAt: number;
  /** Half-width of the attentional window around it, in seconds: an anchor outside
   *  it barely moves the state. */
  window: number;
  /** Current phase in the beat, 0..1 (0 = on the beat). */
  phase: number;
}

/** The follower's state machine. `ready`: no lock yet (fewer than two consistent
 *  anchors); `running`: locked and predicting; `hold`: the expected beat did not
 *  arrive — a fermata, a stop, or a lost hand — so the beat is frozen until a
 *  preparatory anchor restarts it. */
export type FollowerState = 'ready' | 'running' | 'hold';

/**
 * The single source of truth: musical time as inferred at `t`. Consumers never
 * interpolate the frame clock; they call {@link beatAt} with their OWN time (the audio
 * output timestamp, say), which is how the 30 Hz frame rate stops being the timing
 * resolution.
 */
export interface MusicalTime {
  /** The time this state was last advanced to, seconds. */
  t: number;
  /** Continuous beat position at `t` (integer part = beats since lock). */
  beat: number;
  /** Fractional position within the current beat, 0..1. */
  phase: number;
  /** Beats per minute. */
  tempo: number;
  /** Seconds per beat (`60 / tempo`). */
  period: number;
  /** 0..1. Circular concentration of recent phase errors, decayed while anchors are
   *  missing. What a consumer blends the beat-agnostic fallback against. */
  confidence: number;
  /** Predicted time of the next beat, seconds. */
  nextBeatAt: number;
  beatsPerBar: number;
  /** 0-based beat within the bar, derived from `beat` and `beatsPerBar` unless a meter
   *  recogniser overrides it. */
  beatInBar: number;
  state: FollowerState;
  /** Anchors accepted since the last reset. */
  anchors: number;
  /** The refined time of the last accepted anchor, seconds; absent before the first.
   *  What a scheduler aligns to, and what a test reads to check the follower's
   *  timing without re-deriving it from the beat. */
  lastAnchorAt?: number;
  /** A looped piece's next wrap (#508): when the beat reaches `at` (at the tempo it moves
   *  at now) it jumps to `to`, continuing by the overshoot. What lets a scheduler commit
   *  the top's first notes ahead like any other, instead of meeting the jump as a rewind
   *  and playing the top "due now", up to a frame late. Absent: no wrap is expected. */
  wrap?: { at: number; to: number };
  /** The player's own lead, seconds: how far ahead of the sound their beat lands
   *  (the research map's per-person conductor lead; a conductor's ictus precedes the
   *  orchestra's onset by a constant that differs by person and by piece). RESERVED:
   *  no prior sets it and no scheduler reads it yet (`scheduler.ts` places notes by the
   *  beat alone). When a trainer cue measures it (#232 added the field), the intended
   *  rule is that a beat sounds at `nextBeatAt + leadOffset`; until a scheduler applies
   *  it, setting it changes nothing. */
  leadOffset?: number;
}

/** A tempo/phase model over sparse anchors. Implementations: the adaptive oscillator
 *  (v1), the trend prior (a least-squares tempo trend), and the blend of the two
 *  (`blend_prior.ts`, the default since #232); a Kalman filter or a multi-agent
 *  tracker later, behind the same interface. */
export interface RhythmPrior {
  /** Move the state forward to `t` without an observation (free-run). */
  advance(t: number): void;
  /** Fold an anchor in. Advances to `anchor.t` first. */
  update(anchor: Anchor): void;
  /** What is expected next, as of the last advance. */
  predict(): Prediction;
  /** The current state. A fresh object each call (safe to hand to consumers). */
  state(): MusicalTime;
  reset(): void;
}

/** Evaluate the beat position of a state at an arbitrary time (free-running
 *  extrapolation at the state's tempo). Frozen in `hold`. */
export function beatAt(state: MusicalTime, t: number): number {
  if (state.state === 'hold') return state.beat;
  return state.beat + (t - state.t) / state.period;
}

/** Wrap a phase difference into (-0.5, 0.5]. */
export function wrapPhase(phase: number): number {
  let e = phase - Math.floor(phase);
  if (e > 0.5) e -= 1;
  return e;
}

/** One tracked point of a {@link ChannelFrame}, in the caller's units (`y` down, as
 *  {@link Sample}). `visibility` is the tracker's 0..1 confidence that the point is
 *  seen; absent means seen. */
export interface ChannelPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/**
 * One frame of several named tracked points: what an {@link AnchorDetector} reads. A
 * one-point detector (the hand's stroke detector) reads one channel; a multi-joint
 * detector (the body's impact detector) reads several. A channel absent from a frame
 * is not seen in it.
 */
export interface ChannelFrame {
  /** Seconds. Must be non-decreasing. */
  t: number;
  channels: Readonly<Record<string, ChannelPoint | undefined>>;
  /** The body's own length unit in the channels' units (the image torso length, say).
   *  A detector that works in body units divides by its running median; absent means
   *  the channels are already in the unit the caller wants. */
  scale?: number;
}

/**
 * The anchor-detector seam (#374): frames in, beat candidates out. The hand's stroke
 * detector (`createStrokeDetector`), the body's impact detector
 * (`createImpactDetector`) and any later source sit behind it, so a follower takes a
 * detector the way it takes a {@link RhythmPrior}: by instance.
 */
export interface AnchorDetector {
  /** Feed one frame. Returns an anchor when this frame confirmed a beat candidate, else
   *  null. Frames must arrive in time order. */
  push(frame: ChannelFrame): Anchor | null;
  /** The follower's current period (seconds), so refractory windows track the tempo. */
  setPeriod(period: number): void;
  reset(): void;
}
