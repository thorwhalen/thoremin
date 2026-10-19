/**
 * Voice leading (H3 of #613, `docs/design/harmonic-layers.md` §2.6): the realization strategies
 * that remember. The video's tool voices every change with common tones held (its chapter "Chord
 * Degrees with Common Tone Voice Leading"); thoremin's idioms stack every chord the same way from
 * its root, so a change jumps. These strategies plug into the realization pipeline's seams:
 *
 * - `voiceLed` (VOICING): the bass placed where the idioms put it (an octave below the chord's
 *   register), then the upper voices arranged to move as little as possible from the previous
 *   chord's upper voices: common tones held, the others by the nearest step. With nothing to
 *   lead from (the first chord, or after a rest), the upper voices sit around a tenth above the
 *   bass, the idioms' own register. Honours the bass index and any number of tones (a seventh,
 *   a reduction), the contracts the H2 review set.
 * - `smooth` (BASS): the chord tone nearest the previous bass, so the bass walks by step and a
 *   chord may sound in inversion (C to G becomes C to G/B).
 * - `diatonicSeventh` (COLORATION): the seventh the key gives the chord (Cmaj7, Dm7, G7, Bø7 in C),
 *   the head-pose chord's brow rule as a strategy.
 *
 * The search is exhaustive over a small space (at most three upper voices, two or three octave
 * placements each), so it is exact and deterministic. A voicing's cost is its motion, plus a
 * nudge for each fault an arranger avoids: drifting from home, a muddy low interval, parallel
 * fifths and octaves (F to G moves in contrary motion, not three voices up a step); ties go to the
 * smaller span, then the lower voicing. Pure: no DOM, no audio.
 */
import type { BassRule, Coloration, Tone, Voicer, VoicingMemory } from './strategies';

/** The most upper voices a voice-led chord keeps: with the bass, the four a chord voice block holds. */
export const MAX_UPPER_VOICES = 3;
/** The widest the upper voices may spread, semitones (a twelfth). */
const MAX_UPPER_SPAN = 19;
/** The lowest an upper voice may sit above the bass, semitones (a minor third). */
const MIN_ABOVE_BASS = 3;
/** The low-interval limits (the arranger's rule of thumb): the lowest bass each interval from the
 *  bass to the next voice sounds clear on (a minor third from C3, a major third or a fourth from
 *  Bb2, a fifth from Bb1). Below it the voicing pays {@link LOW_INTERVAL_COST} semitones of motion:
 *  a nudge, so a held common tone still wins over a clearer but jumpier voicing. */
const LOW_INTERVAL_LIMIT: Readonly<Record<number, number>> = { 1: 52, 2: 51, 3: 48, 4: 46, 5: 46, 6: 47, 7: 34 };
const LOW_INTERVAL_COST = 2;
/** What each pair of voices moving in parallel fifths or octaves costs, semitones of motion. */
const PARALLEL_COST = 3;
/** The highest an upper voice may sit above the bass's anchor, semitones. */
const MAX_ABOVE_ANCHOR = 28;
/** Where the upper voices sit with nothing to lead from: around a tenth above the bass. */
const HOME_ABOVE_BASS = 16;
/** How far the upper voices' centre may drift from home before each further semitone costs as
 *  much as a semitone of motion (so a long progression does not wander up or down). The open
 *  (spread) idiom's centre is within it, so leading never moves more than spread would. */
const HOME_BAND = 6;
/** The bass's window around its anchor (an octave below the chord's register): one placement. */
const BASS_BELOW = 7;
const BASS_ABOVE = 4;

const pc = (n: number) => ((Math.round(n) % 12) + 12) % 12;

/** The note of pitch class `p` in [lo, hi] (the window is 12 wide: exactly one). */
function placeIn(p: number, lo: number): number {
  return lo + pc(p - lo);
}

/** Which pitch classes the upper voices carry: every chord tone, then, past the limit, the bass's
 *  own pitch class goes first (it is already sounding), then the fifth, then the last added. */
export function upperPitchClasses(tones: readonly Tone[], bassPc: number, max = MAX_UPPER_VOICES): number[] {
  let kept = tones.filter((t, i, all) => all.findIndex((u) => pc(u.midi) === pc(t.midi)) === i);
  if (kept.length > max) kept = kept.filter((t) => pc(t.midi) !== bassPc);
  if (kept.length > max) {
    const fifth = kept.findIndex((t) => t.role === '5');
    if (fifth >= 0) kept = kept.filter((_, i) => i !== fifth);
  }
  return kept.slice(0, max).map((t) => pc(t.midi));
}

/** The motion from one set of voices to another: paired in order when the sizes match (the
 *  minimal pairing for non-crossing voices), else each voice to its nearest in the other set. */
export function motion(from: readonly number[], to: readonly number[]): number {
  if (from.length === 0 || to.length === 0) return 0;
  if (from.length === to.length) return from.reduce((s, f, i) => s + Math.abs(f - to[i]), 0);
  const near = (x: number, set: readonly number[]) => Math.min(...set.map((y) => Math.abs(x - y)));
  return to.reduce((s, t) => s + near(t, from), 0) + from.reduce((s, f) => s + near(f, to), 0);
}

/** How many pairs of voices move in parallel perfect fifths or octaves (both moving, the same
 *  way, a fifth or an octave apart before and after), voices paired in order; 0 when the two
 *  voicings differ in size. */
export function parallels(from: readonly number[], to: readonly number[]): number {
  if (from.length !== to.length) return 0;
  let n = 0;
  for (let i = 0; i < from.length; i++) {
    for (let j = i + 1; j < from.length; j++) {
      const a = pc(from[j] - from[i]);
      const b = pc(to[j] - to[i]);
      const di = to[i] - from[i];
      const dj = to[j] - from[j];
      if ((a === 0 || a === 7) && a === b && di !== 0 && Math.sign(di) === Math.sign(dj)) n++;
    }
  }
  return n;
}

/** Every ascending, distinct arrangement of the pitch classes in [lo, hi] within the span limit. */
function arrangements(pcs: readonly number[], lo: number, hi: number): number[][] {
  const options = pcs.map((p) => {
    const out: number[] = [];
    for (let n = placeIn(p, lo); n <= hi; n += 12) out.push(n);
    return out;
  });
  const result: number[][] = [];
  const walk = (i: number, acc: number[]) => {
    if (i === options.length) {
      const sorted = [...acc].sort((a, b) => a - b);
      if (new Set(sorted).size === sorted.length && sorted[sorted.length - 1] - sorted[0] <= MAX_UPPER_SPAN) result.push(sorted);
      return;
    }
    for (const n of options[i]) walk(i + 1, [...acc, n]);
  };
  walk(0, []);
  return result;
}

/**
 * The voice-led voicing of `tones` (root first, in register) with `tones[bass]` lowest, shifted by
 * `register` octaves, led from `memory`. Ascending MIDI; [] for no tones.
 */
export function voiceLead(tones: readonly Tone[], bass: number, register: number, memory: VoicingMemory): number[] {
  if (tones.length === 0) return [];
  const anchor = tones[0].midi - 12 + 12 * register;
  const b = tones[Math.min(Math.max(0, bass), tones.length - 1)];
  const bassNote = placeIn(b.midi, anchor - BASS_BELOW);
  const bassFits = bassNote <= anchor + BASS_ABOVE ? bassNote : bassNote - 12;
  const pcs = upperPitchClasses(tones, pc(b.midi));
  const candidates = arrangements(pcs, Math.max(bassFits + MIN_ABOVE_BASS, anchor + MIN_ABOVE_BASS), anchor + MAX_ABOVE_ANCHOR);
  if (candidates.length === 0) return [bassFits];
  const prevUpper = memory.last.length > 1 ? memory.last.slice(1) : [];
  const home = bassFits + HOME_ABOVE_BASS;
  const centre = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  const drift = (v: number[]) => Math.max(0, Math.abs(centre(v) - home) - HOME_BAND);
  // The cost of an upper voicing: its motion from the previous chord's (or, with none, its
  // distance from home), its drift past the home band, a muddy low interval, parallel fifths and
  // octaves with the previous chord.
  const voicingCost = (v: number[]) =>
    (prevUpper.length ? motion(prevUpper, v) + drift(v) + PARALLEL_COST * parallels(memory.last, [bassFits, ...v]) : v.reduce((s, n) => s + Math.abs(n - home), 0)) + muddy(v);
  const muddy = (v: number[]) => (bassFits < (LOW_INTERVAL_LIMIT[v[0] - bassFits] ?? -Infinity) ? LOW_INTERVAL_COST : 0);
  const cost = (v: number[]) => voicingCost(v);
  const span = (x: number[]) => x[x.length - 1] - x[0];
  // Least cost; on a tie, the smaller span, then the lower.
  const better = (v: number[], w: number[]) => {
    const dc = cost(v) - cost(w);
    if (dc !== 0) return dc < 0;
    if (span(v) !== span(w)) return span(v) < span(w);
    return v[0] < w[0];
  };
  let best = candidates[0];
  for (const v of candidates.slice(1)) if (better(v, best)) best = v;
  return [bassFits, ...best];
}

export const voiceLedVoicer: Voicer = { id: 'voiceLed', voice: (tones, bass, c, memory) => voiceLead(tones, bass, c.register, memory) };

/** The chord tone nearest the previous bass (circularly, in semitones); the root with no memory
 *  or on a tie, so a held progression walks by step and resolves to root position when it can. */
export const smoothBass: BassRule = {
  id: 'smooth',
  bass(tones, memory) {
    if (memory.bass === null || tones.length === 0) return 0;
    const dist = (t: Tone) => {
      const d = pc(t.midi - memory.bass!);
      return Math.min(d, 12 - d);
    };
    let best = 0;
    tones.forEach((t, i) => {
      if (dist(t) < dist(tones[best])) best = i;
    });
    return best;
  },
};

/** The key's seventh above the root, added when the key has one (a scale tone a minor or major
 *  seventh above): Cmaj7, Dm7, G7, Bø7 in C major. No key, or none in it: the chord as it is. */
export const diatonicSeventh: Coloration = {
  id: 'diatonicSeventh',
  color(tones, _controls, context) {
    if (tones.length === 0 || tones.some((t) => t.role === '7' || t.role === 'b7' || t.role === 'bb7')) return [...tones];
    const scale = context?.scale;
    if (!scale || scale.length < 7) return [...tones];
    const root = tones[0].midi;
    for (const [iv, role] of [
      [10, 'b7'],
      [11, '7'],
    ] as const) {
      if (scale.includes(pc(root + iv))) return [...tones, { midi: root + iv, role }];
    }
    return [...tones];
  },
};
