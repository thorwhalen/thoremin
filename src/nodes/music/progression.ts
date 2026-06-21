/**
 * `progression` node — music-logic layer. Holds a diatonic chord progression
 * (Roman numerals in a key, e.g. I–IV–V–vi in C) and selects the current chord
 * from a continuous `position` input (0..1). Pair with `chord` to drive harmony
 * from a gesture: hand x → position → chord symbol → voiced synth params.
 *
 * This is the "guide toward tonal patterns" piece — the player moves freely, but
 * the harmony stays in-key. Pure + deterministic (Tonal.js), unit-testable.
 */
import { z } from 'zod';
import { Key } from 'tonal';
import { defineNode } from '@/dag';

const Params = z
  .object({
    /** Tonic key for the Roman-numeral progression, e.g. "C", "G", "Eb". */
    key: z.string().default('C'),
    /** The progression as Roman numerals. */
    romanNumerals: z.array(z.string()).default(['I', 'IV', 'V', 'vi']),
  })
  // Fail fast on a key Tonal can't resolve to 7 diatonic triads (e.g. 'H',
  // 'Dm', '') — otherwise it would silently degrade to a single-chord loop.
  .refine((p) => Key.majorKey(p.key).triads.length === 7, {
    message: 'key must be a valid major key (e.g. "C", "G", "Eb")',
    path: ['key'],
  });
type Params = z.infer<typeof Params>;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const ROMAN_TO_DEGREE: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
};

/** Roman numeral → scale degree (1..7); case is ignored (key sets quality). */
function romanToDegree(rn: string): number {
  const key = rn.replace(/[^ivxIVX]/g, '').toLowerCase();
  return ROMAN_TO_DEGREE[key] ?? 1;
}

export const progressionNode = defineNode<Params>({
  type: 'progression',
  title: 'Progression',
  description: 'Roman-numeral progression in a key + position (0..1) → current chord symbol.',
  inputs: [{ name: 'position', kind: 'number', default: 0 }],
  outputs: [
    { name: 'chord', kind: 'chord-symbol' },
    { name: 'index', kind: 'number' },
  ],
  params: Params,
  make(p) {
    // Resolve Roman numerals → diatonic chord symbols once. Using the key's
    // diatonic triads gives correct qualities (vi in C → "Am", not "A").
    const triads = Key.majorKey(p.key).triads;
    const chords =
      triads.length === 7 ? p.romanNumerals.map((rn) => triads[romanToDegree(rn) - 1]) : [p.key];
    const n = chords.length;
    return {
      process(inputs) {
        if (n === 0) return { chord: p.key, index: 0 };
        const pos = typeof inputs.position === 'number' ? clamp01(inputs.position) : 0;
        // Map 0..1 across the chords; the top edge maps to the last chord.
        const index = Math.min(n - 1, Math.floor(pos * n));
        return { chord: chords[index], index };
      },
    };
  },
});
