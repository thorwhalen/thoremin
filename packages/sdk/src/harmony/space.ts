/**
 * Harmonic spaces: chords and the named relations between them (H4 of #613,
 * `docs/design/harmonic-layers.md` §2.2). The video's harmonic map is one space (the seven chords
 * of a key, related by diatonic steps of a fourth, a third and a second); a Tonnetz is another
 * (the 24 major and minor triads, related by P, L and R); a "next chord" wheel walks a space's
 * relations from the chord in force. A layout places a space; a navigator moves in it.
 *
 * A relation is a function from a chord (in a key) to the chords it reaches. Two kinds are data:
 *
 * - **diatonic steps** `dia+k` / `dia-k` (k = 1..3): k steps along the key's seven chords by
 *   root; a step of 2 keeps two common tones, of 3 one, of 1 none.
 * - **uniform triadic transformations** (Hook): keep or flip the mode, and transpose a major
 *   root by one interval, a minor root by another. P, L and R are three of them, and so are their
 *   compounds (N, S, H) and the chromatic mediants: each is one row, `utt(...)`, and a player's own
 *   move would be one more. They apply to major and minor triads only.
 *
 * And a few functional moves that read the key (the dominant OF a chord: V/x).
 *
 * Spaces are built by combinators (`diatonicSpace`, `generated`, `union`, `restrict`,
 * `annotated`), so a new space is a composition, not new code. Pure: the chord model only.
 */
import { diatonicChords, chordId, type Chord, type Key } from './chord';

export type RelationFamily = 'diatonic' | 'neo-riemannian' | 'functional' | 'chromatic-mediant' | 'custom';

export interface Relation {
  /** Stable id: 'dia+3', 'P', 'L', 'R', 'N', 'S', 'H', 'dom', 'M+4', ... */
  id: string;
  /** What a player reads: "4th up", "parallel", "dominant of". */
  label: string;
  family: RelationFamily;
  /** The relation that undoes it ('dia+3' <-> 'dia-3'); P, L, R are their own. */
  inverse?: string;
  /** The chords it reaches from `from` in `key`; [] where it does not apply (P from a diminished triad). */
  apply(from: Chord, key: Key): Chord[];
}

/** One move in a space. */
export interface Edge {
  from: Chord;
  to: Chord;
  relation: string;
  /** Text to show on the move (an annotated space's). */
  caption?: string;
}

export interface HarmonicSpace {
  id: string;
  relations: readonly Relation[];
  /** The chords of the space in this key. */
  chords(key: Key): readonly Chord[];
  /** The moves out of a chord, in the relations' order (the order a radial layout uses). */
  neighbours(from: Chord, key: Key): readonly Edge[];
}

const pc = (n: number) => ((Math.round(n) % 12) + 12) % 12;
const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;

// ---- Diatonic steps -----------------------------------------------------------------------------

const STEP_LABEL: Readonly<Record<string, string>> = {
  '1': '2nd up',
  '2': '3rd up',
  '3': '4th up',
  '-1': '2nd down',
  '-2': '3rd down',
  '-3': '4th down',
};

/** `k` steps along the key's chords, by root (any quality on a diatonic root steps from there). */
export function diatonicStep(k: number): Relation {
  const id = `dia${k > 0 ? '+' : '-'}${Math.abs(k)}`;
  return {
    id,
    label: STEP_LABEL[String(k)] ?? `${k} steps`,
    family: 'diatonic',
    inverse: `dia${k > 0 ? '-' : '+'}${Math.abs(k)}`,
    apply(from, key) {
      const chords = diatonicChords(key);
      const d = chords.findIndex((c) => c.root === from.root);
      return d < 0 ? [] : [chords[(((d + k) % 7) + 7) % 7]];
    },
  };
}

export const DIATONIC_STEPS: readonly Relation[] = [3, -3, 2, -2, 1, -1].map(diatonicStep);

// ---- Uniform triadic transformations ------------------------------------------------------------

/** A uniform triadic transformation: keep or flip the mode; a major root moves by `major`
 *  semitones, a minor root by `minor`. Applies to major and minor triads only. */
export function utt(spec: { id: string; label: string; family: RelationFamily; flip: boolean; major: number; minor: number; inverse?: string }): Relation {
  return {
    id: spec.id,
    label: spec.label,
    family: spec.family,
    inverse: spec.inverse ?? spec.id,
    apply(from) {
      if (from.quality !== 'maj' && from.quality !== 'min') return [];
      const major = from.quality === 'maj';
      const root = pc(from.root + (major ? spec.major : spec.minor));
      const quality = spec.flip === major ? 'min' : 'maj';
      return [{ root, quality }];
    },
  };
}

/** P, L, R and their compounds: each keeps the mode-flip and two transpositions as data. */
export const NEO_RIEMANNIAN: readonly Relation[] = [
  utt({ id: 'P', label: 'parallel', family: 'neo-riemannian', flip: true, major: 0, minor: 0 }),
  utt({ id: 'L', label: 'leading-tone exchange', family: 'neo-riemannian', flip: true, major: 4, minor: 8 }),
  utt({ id: 'R', label: 'relative', family: 'neo-riemannian', flip: true, major: 9, minor: 3 }),
  // Compounds: N = RLP (C to f), S = LPR (C to c#), H = LPL (C to ab, the hexatonic pole).
  utt({ id: 'N', label: 'Nebenverwandt', family: 'neo-riemannian', flip: true, major: 5, minor: 7 }),
  utt({ id: 'S', label: 'slide', family: 'neo-riemannian', flip: true, major: 1, minor: 11 }),
  utt({ id: 'H', label: 'hexatonic pole', family: 'neo-riemannian', flip: true, major: 8, minor: 4 }),
];

/** The chromatic mediants: same mode, the root a major or minor third away (the film-music moves). */
export const CHROMATIC_MEDIANTS: readonly Relation[] = [
  utt({ id: 'M+4', label: 'major 3rd up', family: 'chromatic-mediant', flip: false, major: 4, minor: 4, inverse: 'M-4' }),
  utt({ id: 'M-4', label: 'major 3rd down', family: 'chromatic-mediant', flip: false, major: 8, minor: 8, inverse: 'M+4' }),
  utt({ id: 'M+3', label: 'minor 3rd up', family: 'chromatic-mediant', flip: false, major: 3, minor: 3, inverse: 'M-3' }),
  utt({ id: 'M-3', label: 'minor 3rd down', family: 'chromatic-mediant', flip: false, major: 9, minor: 9, inverse: 'M+3' }),
];

// ---- Functional moves ---------------------------------------------------------------------------

/** The dominant OF a chord (V/x): the major triad a fifth above its root. */
export const DOMINANT_OF: Relation = {
  id: 'dom',
  label: 'dominant of',
  family: 'functional',
  apply: (from) => [{ root: pc(from.root + 7), quality: 'maj' }],
};

/** Every relation by id: what a stored move (a face category's target) names. */
export const RELATIONS: ReadonlyMap<string, Relation> = new Map([...DIATONIC_STEPS, ...NEO_RIEMANNIAN, ...CHROMATIC_MEDIANTS, DOMINANT_OF].map((r) => [r.id, r]));

// ---- Spaces -------------------------------------------------------------------------------------

function neighboursBy(relations: readonly Relation[], contains: (c: Chord, key: Key) => boolean) {
  return (from: Chord, key: Key): Edge[] =>
    relations.flatMap((relation) => relation.apply(from, key).filter((to) => contains(to, key)).map((to) => ({ from, to, relation: relation.id })));
}

/** The key's seven chords, related by diatonic steps (the video's three dimensions by default). */
export function diatonicSpace(relations: readonly Relation[] = DIATONIC_STEPS, id = 'diatonic'): HarmonicSpace {
  return {
    id,
    relations,
    chords: (key) => diatonicChords(key),
    neighbours: neighboursBy(relations, (c, key) => diatonicChords(key).some((d) => same(c, d))),
  };
}

/**
 * The closure of some seed chords under some relations: every chord reachable from the seeds,
 * optionally kept `within` a predicate (and at most `limit` chords). PLR from C major is the 24
 * major and minor triads. Computed once per key.
 */
export function generated(relations: readonly Relation[], { id, seeds, within, limit = 256 }: { id: string; seeds: (key: Key) => readonly Chord[]; within?: (c: Chord, key: Key) => boolean; limit?: number }): HarmonicSpace {
  const cache = new Map<string, Chord[]>();
  const keyId = (k: Key) => `${k.tonic}:${k.scale}`;
  const chords = (key: Key): Chord[] => {
    const hit = cache.get(keyId(key));
    if (hit) return hit;
    const seen = new Map<string, Chord>();
    const queue = seeds(key).filter((c) => !within || within(c, key));
    for (const c of queue) seen.set(chordId(c), c);
    while (queue.length && seen.size < limit) {
      const c = queue.shift()!;
      for (const r of relations) {
        for (const to of r.apply(c, key)) {
          const k = chordId(to);
          if (seen.has(k) || (within && !within(to, key))) continue;
          seen.set(k, to);
          queue.push(to);
        }
      }
    }
    const out = [...seen.values()];
    cache.set(keyId(key), out);
    return out;
  };
  return {
    id,
    relations,
    chords,
    neighbours: neighboursBy(relations, (c, key) => chords(key).some((d) => same(c, d))),
  };
}

/** The Tonnetz's space: the major and minor triads under P, L and R, from the key's tonic triad. */
export function tonnetzSpace(relations: readonly Relation[] = NEO_RIEMANNIAN.slice(0, 3)): HarmonicSpace {
  return generated(relations, { id: 'tonnetz', seeds: (key) => [diatonicChords(key)[0]] });
}

/** Both spaces' chords and relations (a key's chords plus their applied dominants). */
export function union(a: HarmonicSpace, b: HarmonicSpace, id = `${a.id}+${b.id}`): HarmonicSpace {
  const relations = [...a.relations, ...b.relations.filter((r) => !a.relations.some((x) => x.id === r.id))];
  const chords = (key: Key) => {
    const out = [...a.chords(key)];
    for (const c of b.chords(key)) if (!out.some((d) => same(c, d))) out.push(c);
    return out;
  };
  return { id, relations, chords, neighbours: neighboursBy(relations, (c, key) => chords(key).some((d) => same(c, d))) };
}

/** A space's chords that satisfy `pred` (and the moves between them). */
export function restrict(space: HarmonicSpace, pred: (c: Chord, key: Key) => boolean, id = `${space.id}|restricted`): HarmonicSpace {
  return {
    id,
    relations: space.relations,
    chords: (key) => space.chords(key).filter((c) => pred(c, key)),
    neighbours: (from, key) => space.neighbours(from, key).filter((e) => pred(e.to, key)),
  };
}

/** A space whose moves carry captions: the relation's label by default, or a caption set (a
 *  player's words, an imported set, the computed set of `./captions`) read from the move, its
 *  relation and the key, falling back to the label. */
export function annotated(space: HarmonicSpace, captions: (edge: Edge, relation: Relation | undefined, key: Key) => string | undefined = () => undefined): HarmonicSpace {
  const byId = new Map(space.relations.map((r) => [r.id, r]));
  return {
    ...space,
    neighbours: (from, key) =>
      space.neighbours(from, key).map((e) => {
        const r = byId.get(e.relation);
        return { ...e, caption: captions(e, r, key) ?? r?.label ?? e.relation };
      }),
  };
}
