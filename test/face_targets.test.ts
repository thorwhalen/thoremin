/**
 * Face expressions as harmonic expression in the face chord (H6 of #613): an expression's target
 * beyond its degree. The target strings round-trip; a MOVE is made once when its expression
 * begins, from the chord in force (a degree expression sets that chord, as before); a FUNCTION
 * picks the nearest chord with it; the SEVENTH colours the chord in force while held; a personal
 * category with a degree of its own keeps it; a five-note chord source plays degrees only.
 */
import { describe, it, expect } from 'vitest';
import { formatTarget, parseTarget } from '@thoremin/sdk/harmony/target';
import { expressionChordNode, functionDegree, movedDegree } from '@/nodes/music/expression_chord';
import { freqToMidi, type ScaleSpec } from '@thoremin/sdk/music/theory';
import type { ExpressionLabel, ExpressionScores } from '@thoremin/sdk/music/expression';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';

const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const expr = (label: ExpressionLabel, personal?: ExpressionScores['personal']): ExpressionScores => ({ present: true, label, scores: [], thresholds: [], fired: [], ...(personal ? { personal } : {}) }) as ExpressionScores;

/** Play a script of labels (each held `hold` ticks); the pitch classes sounding at the end of each. */
function play(script: ExpressionLabel[], targets: Record<string, string>, opts: { spec?: ScaleSpec; personal?: (l: ExpressionLabel) => ExpressionScores['personal']; categoryDegrees?: Record<string, number> } = {}, hold = 6) {
  const h = expressionChordNode.make(expressionChordNode.params.parse({}));
  const heard: number[][] = [];
  let i = 0;
  for (const label of script) {
    let out: { params: SynthParams } | undefined;
    for (let k = 0; k < hold; k++, i++) {
      out = h.process(
        { expression: expr(label, opts.personal?.(label)), spec: opts.spec ?? C, faceMapping: 'chord', octaveShift: 0, targets, categoryDegrees: opts.categoryDegrees },
        { time: i / 30, dt: 1 / 30, tick: i, resources: {} } as never,
      ) as unknown as { params: SynthParams };
    }
    heard.push([...new Set(out!.params.voices.filter((v) => v.present && v.gain > 0).map((v) => Math.round(freqToMidi(v.freq)) % 12))].sort((a, b) => a - b));
  }
  return heard;
}
const C_MAJ = [0, 4, 7];
const F_MAJ = [0, 5, 9];
const D_MIN = [2, 5, 9];
const A_MIN = [0, 4, 9];
const G_MAJ = [2, 7, 11];

describe('target strings', () => {
  it('round-trip, and anything unknown reads as the degree', () => {
    for (const t of ['', 'move:dia+3', 'move:P', 'fn:T', 'fn:D', 'ctl:seventh']) expect(formatTarget(parseTarget(t))).toBe(t);
    for (const t of ['move:nope', 'fn:X', 'ctl:louder', 'garbage', undefined, null]) expect(parseTarget(t)).toEqual({ kind: 'degree' });
  });
});

describe('the face chord with targets', () => {
  it('makes a move once when its expression begins, from the chord in force', () => {
    // happy moves a fourth up; sad plays its degree (vi, Am) as before.
    const heard = play(['neutral', 'happy', 'happy', 'neutral', 'sad', 'happy'], { happy: 'move:dia+3' });
    expect(heard).toEqual([[], F_MAJ, F_MAJ, [], A_MIN, D_MIN]); // from the tonic to F; from Am a fourth up to Dm
  });

  it('chooses a function: the nearest chord with it', () => {
    expect(movedDegree(C, 0, 'dia+3')).toBe(3);
    expect(functionDegree(C, 0, 'D')).toBe(4); // C to G moves less than C to B°
    expect(functionDegree(C, 5, 'S')).toBe(3); // Am to F (2 common tones) before Am to Dm
    const heard = play(['neutral', 'surprised'], { surprised: 'fn:D' });
    expect(heard[1]).toEqual(G_MAJ);
  });

  it('adds the seventh to the chord in force while held, and lets it go', () => {
    const heard = play(['neutral', 'happy', 'kiss', 'happy'], { kiss: 'ctl:seventh' });
    expect(heard[1]).toEqual(C_MAJ); // happy's degree: I
    expect(heard[2]).toEqual([0, 4, 7, 11]); // Cmaj7
    expect(heard[3]).toEqual(C_MAJ);
  });

  it('a personal category with a degree of its own keeps it; one without takes its expression\'s target', () => {
    const personal = (label: ExpressionLabel) => ({ categorizer: 'mine', noneName: 'rest', id: label === 'neutral' ? null : label === 'happy' ? 'a' : 'b', name: null, ids: ['a', 'b'], names: ['A', 'B'], standsFor: ['happy', 'sad'] as ExpressionLabel[] });
    expect(play(['neutral', 'happy'], { happy: 'move:dia+3' }, { personal })[1]).toEqual(F_MAJ);
    expect(play(['neutral', 'happy'], { happy: 'move:dia+3' }, { personal, categoryDegrees: { a: 1 } })[1]).toEqual(D_MIN);
  });

  it('keeps a held move\'s place over a change of key (IV stays IV)', () => {
    const h = expressionChordNode.make(expressionChordNode.params.parse({}));
    const G: ScaleSpec = { root: 7, type: 'major', octaves: 2, baseOctave: 3 };
    let out: { params: SynthParams } | undefined;
    for (let i = 0; i < 20; i++) {
      const spec = i < 10 ? C : G;
      out = h.process({ expression: expr(i < 2 ? 'neutral' : 'happy'), spec, faceMapping: 'chord', octaveShift: 0, targets: { happy: 'move:dia+3' } }, { time: i / 30, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as { params: SynthParams };
    }
    const pcs = [...new Set(out!.params.voices.filter((v) => v.present && v.gain > 0).map((v) => Math.round(freqToMidi(v.freq)) % 12))].sort((a, b) => a - b);
    expect(pcs).toEqual([0, 4, 7]); // IV of G is C
  });

  it('reads a move the face chord cannot make (it would leave the key) as the degree', () => {
    expect(play(['neutral', 'happy'], { happy: 'move:P' })).toEqual(play(['neutral', 'happy'], {}));
  });

  it('plays degrees only on a five-note chord source', () => {
    const pent: ScaleSpec = { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3 };
    const withTargets = play(['neutral', 'happy'], { happy: 'move:dia+3' }, { spec: pent });
    const without = play(['neutral', 'happy'], {}, { spec: pent });
    expect(withTargets).toEqual(without);
  });
});
