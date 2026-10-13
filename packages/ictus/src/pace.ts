/**
 * The pace controller: a song's playback rate that follows a dancer's pulse (#186 PR H;
 * the body research map §6.2, D-Jogger's strategy 4 translated to a dancer).
 *
 * It relates two {@link MusicalTime}s, the dancer's {@link PulseState} (one "beat" = one
 * cycle of the movement at the level the follower chose) and the song's (read off its
 * beat grid at the playback position, in ENGINE time, `songTimeAt`), and answers one
 * number: the rate to play the song at. Four steps, each a named option:
 *
 * 1. **The relation is an INTEGER ratio, never an octave.** One dancer cycle is `k` song
 *    beats, `k` in `1..maxRatio` or `1/2..1/maxRatio` (a dancer stepping twice a beat).
 *    The ratio chosen is the one whose matching rate is nearest the player's own tempo
 *    (`base`); one whose rate falls outside `captureRange` of it is no relation at all
 *    (the dancer is not dancing to this song), and the controller holds. The measured
 *    reason for integers rather than powers of two is the Que Calor dancer: the stride
 *    repeats once per bar (four song beats), the head at six, and nothing folds a six.
 *    Only the FOLLOWED level is related, not every entry of `candidates`: the follower
 *    measures a phase at its own level only, and a level without a phase cannot be
 *    phase-locked. Within the default capture the ratio is unique for `k <= 8` (adjacent
 *    ratios differ by at least 12.5 %).
 * 2. **A relation is followed only once it has persisted** for `persistS`, the first one
 *    and every change of it (a level switch in the follower is a change of ratio). That
 *    is the defence #339 asks for against a slow level faked by red noise, which reaches
 *    the follower's trust threshold for a second or two at a time.
 * 3. **The period**: the matching rate, smoothed by a first-order filter (`smoothS`,
 *    about 1 s) and clamped to `base * (1 +- range)` (10 % by default), inside the
 *    player's own limits (`minRate..maxRate`). The song's own period is averaged over
 *    the last `songPeriodS` seconds rather than read off the one beat interval at the
 *    playhead: a tracked beat is snapped to an onset within a tenth of a period, so one
 *    interval can be 20 % off, and a controller relating to it wobbles the tempo from
 *    beat to beat (measured by the PR's adversarial review: +-10 % beat jitter gave a
 *    rate wandering 0.96..1.10 for a dancer steady at 1.04).
 * 4. **The phase**: the dancer's cycle start (phase 0 of the pulse, plus `phaseOffset`
 *    song beats) should land on a song beat. When the error passes `phaseThreshold` (a
 *    twelfth of a beat, 30 degrees) the rate is nudged by `nudge` (3 %) toward closing
 *    it, and released once it is under `phaseRelease`. The audio is never sought: a jump
 *    is audible, a nudge is not.
 *
 * Below the pulse's trust threshold (`trustedConfidence`), or with no relation in
 * capture, the rate HOLDS: a dancer who stops does not stop the song, and a dancer who
 * wanders is not followed into noise. A song that is not playing resets the controller
 * to `base`.
 *
 * Pure, causal and clock-free like the rest of ictus: the caller passes the time.
 */
import { beatAt, wrapPhase, type MusicalTime } from './types';
import { PULSE_TRUSTED_CONFIDENCE, type PulseState } from './pulse';

export interface PaceOptions {
  /** The clamp around `base`, a fraction (0.1 = the rate stays within +-10 %). */
  range?: number;
  /** A ratio whose matching rate is further than this from `base` (a fraction) is no
   *  relation. Wider than `range`, so a dancer a little outside the clamp is still
   *  followed (to the clamp's edge) rather than dropped. */
  captureRange?: number;
  /** The largest integer ratio tried, both ways. */
  maxRatio?: number;
  /** Pulse confidence below which the rate holds. */
  trustedConfidence?: number;
  /** Seconds a relation must persist, trusted and unchanged, before it is followed. */
  persistS?: number;
  /** Time constant of the rate's first-order smoothing, seconds. */
  smoothS?: number;
  /** Phase error, in song beats, past which the rate is nudged. */
  phaseThreshold?: number;
  /** Phase error, in song beats, under which the nudge is released. */
  phaseRelease?: number;
  /** The nudge, a fraction of the rate. */
  nudge?: number;
  /** Where the dancer's cycle start should land, in song beats after a beat. */
  phaseOffset?: number;
  /** Seconds over which the song's own beat period is averaged. */
  songPeriodS?: number;
  /** The rates the song player can actually play (its own clamp): the controller's clamp
   *  never asks past them. */
  minRate?: number;
  maxRate?: number;
}

export const PACE_DEFAULTS = {
  range: 0.1,
  captureRange: 0.15,
  maxRatio: 8,
  trustedConfidence: PULSE_TRUSTED_CONFIDENCE,
  persistS: 3,
  smoothS: 1,
  phaseThreshold: 1 / 12,
  phaseRelease: 1 / 48,
  nudge: 0.03,
  phaseOffset: 0,
  songPeriodS: 8,
  minRate: 0.5,
  maxRate: 2,
} as const satisfies Required<PaceOptions>;

/** One step's observation. */
export interface PaceInput {
  /** Now, seconds (engine time). */
  t: number;
  /** The dancer's pulse. */
  pulse: PulseState;
  /** The song's musical time, engine time (`songTimeAt`). May be a tick old: it is
   *  extrapolated to `t`. */
  song: MusicalTime;
  /** The rate the song was playing at when `song` was read (so the song's own period is
   *  `song.period * rate`). */
  rate: number;
  /** The player's own tempo (`songPrefs.rate`): the centre of the clamp. */
  base: number;
  /** A live override of {@link PaceOptions.range} (the player's follow range). */
  range?: number;
}

/**
 * - `idle`: no song playing; the rate is `base`.
 * - `waiting`: no trusted pulse, or none related to the song, and nothing followed yet.
 * - `locking`: a relation is persisting, not yet followed.
 * - `following`: the rate follows the dancer.
 * - `switching`: following, and a DIFFERENT ratio is persisting (the dancer changed
 *   step); the rate holds until it has.
 * - `holding`: was following; the pulse is untrusted or unrelated now, so the rate holds.
 */
export type PaceMode = 'idle' | 'waiting' | 'locking' | 'following' | 'switching' | 'holding';

export interface PaceState {
  t: number;
  mode: PaceMode;
  /** The rate to play the song at. */
  rate: number;
  /** Song beats per dancer cycle of the relation followed (or persisting); NaN without. */
  ratio: number;
  /** The period-matched rate before the phase nudge, clamped; NaN when not following. */
  target: number;
  /** Song beats, (-0.5, 0.5] of the phase unit: positive = the song is ahead of the
   *  dancer. NaN when not following. */
  phaseError: number;
  /** -1 slowing, +1 speeding, 0 released. */
  nudge: -1 | 0 | 1;
}

export interface PaceController {
  step(input: PaceInput): PaceState;
  state(): PaceState;
  reset(): void;
}

const clampTo = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** The integer ratios tried, as song beats per dancer cycle. */
export function paceRatios(maxRatio: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= maxRatio; k++) out.push(k);
  for (let k = 2; k <= maxRatio; k++) out.push(1 / k);
  return out;
}

/**
 * The integer ratio relating a dancer's period to a song's, and the rate that matches
 * them: the ratio whose rate is nearest `base` (in log terms), or null when even that one
 * is further than `captureRange` from `base`. `songPeriod` is the song's OWN beat period
 * (at rate 1), seconds; `dancerPeriod` one cycle of the movement, seconds.
 */
export function relatePeriods(
  dancerPeriod: number,
  songPeriod: number,
  base: number,
  opts: { maxRatio?: number; captureRange?: number } = {},
): { ratio: number; rate: number } | null {
  if (!(dancerPeriod > 0) || !(songPeriod > 0) || !(base > 0)) return null;
  const capture = opts.captureRange ?? PACE_DEFAULTS.captureRange;
  let best: { ratio: number; rate: number; d: number } | null = null;
  for (const ratio of paceRatios(opts.maxRatio ?? PACE_DEFAULTS.maxRatio)) {
    // One dancer cycle = `ratio` song beats: the song's engine period must be
    // dancerPeriod / ratio, so the rate is songPeriod / (dancerPeriod / ratio).
    const rate = (ratio * songPeriod) / dancerPeriod;
    const d = Math.abs(Math.log(rate / base));
    if (!best || d < best.d) best = { ratio, rate, d };
  }
  return best && best.d <= Math.log(1 + capture) ? { ratio: best.ratio, rate: best.rate } : null;
}

const IDLE = (t: number, base: number): PaceState => ({ t, mode: 'idle', rate: base, ratio: NaN, target: NaN, phaseError: NaN, nudge: 0 });

export function createPaceController(options: PaceOptions = {}): PaceController {
  const o = { ...PACE_DEFAULTS, ...options };
  let followed: number | null = null;
  let candidate: { ratio: number; since: number } | null = null;
  let smoothed = NaN;
  let nudge: -1 | 0 | 1 = 0;
  let lastT = NaN;
  let last: PaceState = IDLE(0, 1);
  /** The song's own beat period at recent steps, for the average. */
  let periods: Array<{ t: number; p: number }> = [];

  const reset = () => {
    followed = null;
    candidate = null;
    smoothed = NaN;
    nudge = 0;
    lastT = NaN;
    periods = [];
  };

  return {
    step({ t, pulse, song, rate, base, range }) {
      const dt = Number.isFinite(lastT) ? Math.max(0, t - lastT) : 0;
      lastT = t;
      const r = range !== undefined && range >= 0 && range < 1 ? range : o.range;
      const lo = Math.max(o.minRate, base * (1 - r));
      const hi = Math.min(o.maxRate, base * (1 + r));
      if (song.state !== 'running' || !(song.period > 0) || !(rate > 0) || !(base > 0)) {
        reset();
        lastT = t;
        last = IDLE(t, base > 0 ? base : 1);
        return last;
      }
      // What plays while nothing new is followed: the smoothed rate without its nudge (or
      // `base` before any), kept inside the clamp of the CURRENT base (the player may have
      // moved the tempo slider).
      const held = clampTo(Number.isFinite(smoothed) ? smoothed : base, lo, hi);
      const trusted = pulse.state === 'running' && pulse.confidence >= o.trustedConfidence && pulse.period > 0;
      // The capture is never narrower than the clamp: a player who widens the range to
      // 30 % means a dancer 25 % off is followed.
      // The song's own period, averaged (see step 3 above).
      periods.push({ t, p: song.period * rate });
      while (periods.length > 1 && periods[0].t < t - o.songPeriodS) periods.shift();
      const songPeriod = periods.reduce((a, x) => a + x.p, 0) / periods.length;
      const rel = trusted ? relatePeriods(pulse.period, songPeriod, base, { maxRatio: o.maxRatio, captureRange: Math.max(o.captureRange, r) }) : null;

      if (!rel) {
        candidate = null;
        nudge = 0;
        if (Number.isFinite(smoothed)) smoothed = clampTo(smoothed, lo, hi);
        last = { t, mode: followed === null ? 'waiting' : 'holding', rate: followed === null ? base : held, ratio: followed ?? NaN, target: NaN, phaseError: NaN, nudge: 0 };
        return last;
      }

      if (rel.ratio !== followed) {
        if (candidate?.ratio !== rel.ratio) candidate = { ratio: rel.ratio, since: t };
        if (t - candidate.since < o.persistS) {
          nudge = 0;
          last = { t, mode: followed === null ? 'locking' : 'switching', rate: followed === null ? base : held, ratio: rel.ratio, target: NaN, phaseError: NaN, nudge: 0 };
          return last;
        }
        // Adopted: start from what plays now, so the change is smoothed, not stepped.
        followed = rel.ratio;
        if (!Number.isFinite(smoothed)) smoothed = held;
      }
      candidate = null;

      const target = clampTo(rel.rate, lo, hi);
      smoothed = clampTo(smoothed + (target - smoothed) * (1 - Math.exp(-dt / o.smoothS)), lo, hi);

      // The phase, in song beats, both extrapolated to now. A dancer cycle of k >= 1
      // beats should start on a beat (the error is taken mod one beat); one of 1/k beat
      // repeats k times a beat (mod 1/k).
      const unit = Math.min(1, followed);
      const diff = beatAt(song, t) - beatAt(pulse, t) * followed - o.phaseOffset;
      const e = wrapPhase(diff / unit) * unit;
      const abs = Math.abs(e);
      // Positive error: the song is ahead, so slow it.
      const want: -1 | 1 = e > 0 ? -1 : 1;
      if (nudge === 0 && abs > o.phaseThreshold * unit) nudge = want;
      else if (nudge !== 0 && (abs < o.phaseRelease * unit || nudge !== want)) nudge = 0;

      last = { t, mode: 'following', rate: clampTo(smoothed * (1 + nudge * o.nudge), lo, hi), ratio: followed, target, phaseError: e, nudge };
      return last;
    },
    state: () => last,
    reset() {
      reset();
      last = IDLE(0, 1);
    },
  };
}
