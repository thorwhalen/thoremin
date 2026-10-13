/**
 * The beat servo: a recording that follows a conductor beat for beat (#187 PR 7; the
 * conducting research map §6.7, "a PLL between two beat grids").
 *
 * Where the pace controller (`pace.ts`) lets a song follow a DANCER loosely (an integer
 * ratio, a 10 % clamp, a gentle nudge), this one makes it follow a CONDUCTOR exactly: the
 * conductor's beat is the piece's beat, counted from its first stroke, and the song's
 * tracked beat `offset + b` must sound when the conductor's beat `b` does. Both read the
 * same two {@link MusicalTime}s and drive the same song player; they are two laws for
 * two leaders.
 *
 * The law is Personal Orchestra's proportional servo with a convergence horizon, in the
 * linearised form of §6.7: with the conductor's tempo `v` (beats per second), the song's
 * local tempo `v_s` (beats per second of AUDIO), and the phase error `e` in beats,
 *
 *     r = r0 + e / (v_s * dt),   r0 = v / v_s,   dt = horizonBeats / v
 *
 * which is `r = r0 * (1 + e / horizonBeats)`: held for `dt`, the song covers `horizonBeats
 * + e` beats while the conductor covers `horizonBeats`, so the error closes in one horizon
 * (exactly, while the two tempi hold). The correction is clamped to `maxCorrection` of
 * `r0` (the DJ literature's discomfort bound on a tempo adjustment) and the rate to the
 * player's own `minRate..maxRate`.
 *
 * The error is evaluated at the OUTPUT timestamp (Dannenberg's latency compensation):
 * the audio at the song's position now is heard `latency` seconds from now, so it is
 * compared with where the conductor will be THEN, `beatAt(lead, t + latency)`, not with
 * where he is now. Without it the song runs a constant `latency * v` beats late.
 *
 * The transport follows the conductor too. Before the first stroke (`ready`) and while he
 * holds (a stop, a fermata) the song pauses, cued silently to the beat he is on; on the
 * stroke that starts or releases it, the song is cued to the beat he will be on when it
 * is heard and plays. While running it is never sought, except when it is more than
 * `seekBeyondBeats` adrift (a rate cannot close that without an audible race), at most
 * once per `cueRefractoryS`.
 *
 * **The level (#376, absorbing #364 item 2).** A beat tracker may lock a song at double or
 * half the conducted tempo, and then one conducted beat is not one tracked beat: `r0`
 * reads near 2 or 0.5, hits the clamp and drifts, with a seek about once a second. So
 * the conductor's beat `b` maps to the song's beat `k * b` (plus the offset), with `k` in
 * `ratios` ({1/2, 1, 2} by default) chosen by ictus's one level relation (`level.ts`):
 * the `k` whose `r0` is nearest 1 when the conductor starts, then held while its `r0`
 * stays within `ratioCapture` (a conductor at 70 % of the recording's tempo is slow, not
 * at half time), and changed only after another has persisted `persistS`. A change keeps
 * the song where it is: the map is re-anchored at the conductor's beat, so nothing seeks.
 * The horizon and the seek threshold are in the CONDUCTOR's beats; the error stays in the
 * song's.
 *
 * Pure, causal and clock-free like the rest of ictus: the caller passes the time.
 */
import { beatAt, type MusicalTime } from './types';
import { conductorRatios, createLevelHold } from './level';

export interface ServoOptions {
  /** The convergence horizon, in the conductor's beats. */
  horizonBeats?: number;
  /** The largest correction, a fraction of the tempo-matched rate `r0`. */
  maxCorrection?: number;
  /** The rates the song player can play (its own clamp). */
  minRate?: number;
  maxRate?: number;
  /** A running song further than this from the conductor, in the conductor's beats, is
   *  cued, not chased. */
  seekBeyondBeats?: number;
  /** A paused song further than this from its cue, in beats, is cued again. */
  cueTolerance?: number;
  /** Seconds after a cue during which no other cue is issued. */
  cueRefractoryS?: number;
  /** Seconds after a cue during which the song's reported position is not trusted (a
   *  seek takes a tick or two to show in it): the rate holds at the tempo match. */
  settleS?: number;
  /** Song beats per conductor beat that may relate the two (#376). */
  ratios?: readonly number[];
  /** The followed ratio is kept while its `r0` is within this fraction of 1 (in log
   *  terms); past it, the nearest other ratio takes over once it has persisted. */
  ratioCapture?: number;
  /** Seconds a different ratio must persist before it is followed. */
  persistS?: number;
}

export const SERVO_DEFAULTS = {
  horizonBeats: 1,
  maxCorrection: 0.25,
  minRate: 0.5,
  maxRate: 2,
  seekBeyondBeats: 2,
  cueTolerance: 0.02,
  cueRefractoryS: 1,
  settleS: 0.1,
  ratios: conductorRatios(),
  ratioCapture: 0.5,
  persistS: 3,
} as const satisfies Required<ServoOptions>;

export interface ServoInput {
  /** Now, seconds (engine time). */
  t: number;
  /** The leader: the conductor's musical time (its beat = the piece's beat). */
  lead: MusicalTime;
  /** The song's musical time at its playback position, engine time (`songTimeAt`). May
   *  be a tick old: it is extrapolated to `t`. */
  song: MusicalTime;
  /** The rate the song was playing at when `song` was read (its own period is
   *  `song.period * rate`). */
  rate: number;
  /** Seconds from now until the audio at the song's position now is heard (the output
   *  stage). */
  latency: number;
  /** The song's beat on which the conductor's beat 0 lands. */
  offset?: number;
}

/**
 * - `idle`: no song to lead (no ruler).
 * - `cueing`: the conductor has not started; the song waits, cued to his first beat.
 * - `following`: the song plays, servoed onto the conductor.
 * - `holding`: the conductor holds (a stop, a fermata); the song waits on his beat.
 */
export type ServoMode = 'idle' | 'cueing' | 'following' | 'holding';

/** A request to move the song to a beat (the song player turns it into a position). */
export interface ServoCue {
  /** A fresh id per request: the player seeks when it changes. */
  id: number;
  /** The song's (fractional) beat to move to. */
  beat: number;
}

export interface ServoState {
  t: number;
  mode: ServoMode;
  /** The rate to play the song at. */
  rate: number;
  /** Whether the song should be playing. */
  playing: boolean;
  /** The last cue issued (null before any). */
  cue: ServoCue | null;
  /** Song beats, positive = the song is ahead of the conductor; NaN unless following. */
  error: number;
  /** Song beats per conductor beat (1 until the conductor starts). */
  ratio: number;
}

export interface BeatServo {
  step(input: ServoInput): ServoState;
  state(): ServoState;
  reset(): void;
}

const clampTo = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/**
 * The servo's rate for one step: `r0 * (1 + e / horizonBeats)`, the correction clamped to
 * `maxCorrection` and the rate to `minRate..maxRate`. `leadPeriod` is the conductor's
 * seconds per beat, `songOwnPeriod` the song's seconds of audio per beat at its position,
 * `error` the conductor's beat minus the song's, both at the output timestamp.
 */
export function servoRate(leadPeriod: number, songOwnPeriod: number, error: number, opts: ServoOptions = {}): number {
  const o = { ...SERVO_DEFAULTS, ...opts };
  const r0 = songOwnPeriod / leadPeriod;
  const correction = clampTo(error / o.horizonBeats, -o.maxCorrection, o.maxCorrection);
  return clampTo(r0 * (1 + correction), o.minRate, o.maxRate);
}

/** Whether the leader's beat is advancing: past his first stroke, not holding, at a
 *  finite tempo. Not only `running`: the conductor node advances the score's beat while
 *  its follower is still `ready` (finding the tempo, on the speed fallback), and the
 *  recording starts when the score would. */
const running = (m: MusicalTime): boolean => m.state !== 'hold' && m.anchors > 0 && Number.isFinite(m.period) && m.period > 0;

export function createBeatServo(options: ServoOptions = {}): BeatServo {
  const o = { ...SERVO_DEFAULTS, ...options };
  let cue: ServoCue | null = null;
  let nextId = 1;
  let lastCueT = -Infinity;
  let rate = 1;
  let last: ServoState = { t: 0, mode: 'idle', rate: 1, playing: false, cue: null, error: NaN, ratio: 1 };
  const level = createLevelHold({ ratios: o.ratios, captureRange: o.ratioCapture, persistS: o.persistS, persistFirst: false, sticky: true });
  /** Song beats added to `k * b + offset`: what keeps the song in place when `k` changes. */
  let shift = 0;

  const cueTo = (t: number, beat: number): void => {
    cue = { id: nextId++, beat };
    lastCueT = t;
  };

  return {
    step({ t, lead, song, rate: songRate, latency, offset = 0 }) {
      const L = Number.isFinite(latency) && latency > 0 ? latency : 0;
      // A song with no ruler (no grid, or not loaded) cannot be led.
      let k = level.ratio() ?? 1;
      if (!(song.period > 0) || !(songRate > 0)) {
        last = { t, mode: 'idle', rate, playing: false, cue, error: NaN, ratio: k };
        return last;
      }
      const songBeat = beatAt(song, t);
      const free = t - lastCueT >= o.cueRefractoryS;

      if (!running(lead)) {
        // Waiting (no stroke yet) or holding: the song waits on the conductor's beat.
        const target = k * lead.beat + shift + offset;
        if (free && Math.abs(songBeat - target) > o.cueTolerance && (cue === null || Math.abs(cue.beat - target) > o.cueTolerance)) cueTo(t, target);
        last = { t, mode: lead.anchors > 0 && lead.state === 'hold' ? 'holding' : 'cueing', rate, playing: false, cue, error: NaN, ratio: k };
        return last;
      }

      // Where the conductor will be when the audio read now is heard.
      const leadBeat = beatAt(lead, t + L);
      const songOwnPeriod = song.period * songRate;
      // The level: chosen when he starts, then held (see the header).
      const rel = level.step(t, lead.period, songOwnPeriod);
      if (rel.adopted && rel.ratio !== null && rel.ratio !== k) {
        // Re-anchor at his beat, so the song's target does not move.
        shift += (k - rel.ratio) * leadBeat;
        k = rel.ratio;
      }
      const target = k * leadBeat + shift + offset;
      if (!last.playing || (free && Math.abs(target - songBeat) > o.seekBeyondBeats * k)) {
        // Starting (the first stroke, or the one that releases a hold), or adrift: cue to
        // the beat that will be sounding when this is heard, at the tempo-matched rate.
        cueTo(t, target);
        rate = servoRate(lead.period / k, songOwnPeriod, 0, o);
        last = { t, mode: 'following', rate, playing: true, cue, error: 0, ratio: k };
        return last;
      }
      // Just after a cue the song's reported beat may still be the pre-seek one: the rate
      // holds at the tempo match until the seek shows.
      const e = t - lastCueT >= o.settleS ? target - songBeat : 0;
      // In the conductor's beats, the servo's law is the 1:1 one (`servoRate`).
      rate = servoRate(lead.period / k, songOwnPeriod, e / k, o);
      last = { t, mode: 'following', rate, playing: true, cue, error: -e, ratio: k };
      return last;
    },
    state: () => last,
    reset() {
      cue = null;
      lastCueT = -Infinity;
      rate = 1;
      level.reset();
      shift = 0;
      last = { t: 0, mode: 'idle', rate: 1, playing: false, cue: null, error: NaN, ratio: 1 };
    },
  };
}
