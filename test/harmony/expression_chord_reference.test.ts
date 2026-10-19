/**
 * The face chord with targets (H6 of #613) against its predecessor, copied verbatim
 * (`./reference/expression_chord_before_h6.ts`): with no targets, or every target empty (what
 * every instrument saved before targets existed heals to), random expression scripts (the general
 * model's labels, a personal categorizer's readings with and without its own degrees, neutral,
 * absences, the face mapping switching), every voicing and rendering, several chord sources,
 * uneven ticks. Equal output, tick for tick: what a returning player hears does not change.
 */
import { describe, it, expect } from 'vitest';
import { expressionChordNode } from '@/nodes/music/expression_chord';
import { expressionChordNode as referenceNode } from './reference/expression_chord_before_h6';
import { DEFAULT_EXPRESSION_TARGETS } from '@/settings/schema';
import { EXPRESSIONS, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { RENDERINGS, VOICINGS } from '@thoremin/sdk/music/voicing';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECS: ScaleSpec[] = [
  { root: 0, type: 'major', octaves: 2, baseOctave: 3 },
  { root: 9, type: 'minor', octaves: 2, baseOctave: 3 },
  { root: 2, type: 'pentatonic', octaves: 1, baseOctave: 4 },
];
const IDIOMS = VOICINGS.filter((v) => v !== 'voiceLed');
const PERSONAL = { categorizer: 'mine', noneName: 'rest', ids: ['a', 'b', 'c'], names: ['A', 'B', 'C'], standsFor: ['happy', 'sad', 'kiss'] } as const;

describe('the face chord equals its predecessor with no targets', () => {
  for (const [name, targets] of [['absent', undefined], ['all empty', DEFAULT_EXPRESSION_TARGETS]] as const) {
    it(`on 300 random scripts of 120 ticks (targets ${name})`, () => {
      const r = rng(name === 'absent' ? 64 : 65);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
      for (let n = 0; n < 300; n++) {
        const a = expressionChordNode.make(expressionChordNode.params.parse({}));
        const b = referenceNode.make(referenceNode.params.parse({}));
        const spec = pick(SPECS);
        let expr: ExpressionScores | undefined;
        for (let tick = 0; tick < 120; tick++) {
          if (r() < 0.12) {
            const personal = r() < 0.3;
            const id = pick([null, 'a', 'b', 'c']);
            expr = r() < 0.05 ? undefined : ({ present: r() > 0.05, label: pick(EXPRESSIONS), scores: [], thresholds: [], fired: [], ...(personal ? { personal: { ...PERSONAL, id, name: id } } : {}) } as ExpressionScores);
          }
          const inputs = {
            expression: expr,
            spec,
            faceMapping: tick % 40 < 36 ? 'chord' : 'timbre',
            octaveShift: pick([0, 0, 1]),
            chordConfig: { voicing: IDIOMS[n % IDIOMS.length], rendering: RENDERINGS[(n + tick) % RENDERINGS.length], bpm: 100, gain: 0.3, sound: 'warmPad' },
            degrees: n % 3 === 0 ? { happy: 4, sad: -1 } : undefined,
            categoryDegrees: n % 2 === 0 ? { b: 2 } : undefined,
            targets,
          };
          const ctx = { time: tick / 30, dt: pick([1 / 30, 1 / 60, Number.NaN]), tick, resources: {} } as never;
          expect(a.process(inputs, ctx), `script ${n}, tick ${tick}`).toEqual(b.process(inputs, ctx));
        }
      }
    });
  }
});
