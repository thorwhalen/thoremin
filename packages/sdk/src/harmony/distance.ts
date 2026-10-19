/**
 * How far apart two chords sound (H4 of #613, `docs/design/harmonic-layers.md` §2.2). Kept apart
 * from the spaces on purpose: adjacency on a lattice is not voice-leading distance (on the
 * Tonnetz C to F is two steps and C to f three, although C to f moves less), so a layout says
 * which moves are one step and a distance says how far chords sound. Layouts, weights and tension
 * models read these; nothing else does.
 *
 * - `commonTones`: the pitch classes two chords share.
 * - `voiceLeadingCost`: the least total motion, in semitones, from one chord's pitch classes to
 *   the other's, each voice by its shortest way round the octave, a smaller chord's tones doubled
 *   as needed (Tymoczko's measure under octave equivalence). Exact: chords here have at most four
 *   distinct tones, so every assignment is tried.
 *
 * Pure: the chord model only.
 */
import { pitchClasses, type Chord } from './chord';

const pc = (n: number) => ((n % 12) + 12) % 12;
const step = (a: number, b: number) => {
  const d = pc(b - a);
  return Math.min(d, 12 - d);
};

/** The pitch classes two chords share. */
export function commonTones(a: Chord, b: Chord): number[] {
  const bs = new Set(pitchClasses(b));
  return [...new Set(pitchClasses(a))].filter((p) => bs.has(p));
}

/** Every way to give each of `n` voices one of `m` targets so that every target is used (n >= m). */
function* covers(n: number, m: number): Generator<number[]> {
  const pick = new Array<number>(n).fill(0);
  const total = m ** n;
  for (let k = 0; k < total; k++) {
    let x = k;
    for (let i = 0; i < n; i++) {
      pick[i] = x % m;
      x = Math.floor(x / m);
    }
    if (new Set(pick).size === m) yield [...pick];
  }
}

/** The least total semitone motion between two chords' pitch classes (octave-equivalent). */
export function voiceLeadingCost(a: Chord, b: Chord): number {
  const from = [...new Set(pitchClasses(a))];
  const to = [...new Set(pitchClasses(b))];
  const [voices, targets] = from.length >= to.length ? [from, to] : [to, from];
  let best = Infinity;
  for (const assign of covers(voices.length, targets.length)) {
    let cost = 0;
    for (let i = 0; i < voices.length; i++) cost += step(voices[i], targets[assign[i]]);
    if (cost < best) best = cost;
  }
  return best;
}
