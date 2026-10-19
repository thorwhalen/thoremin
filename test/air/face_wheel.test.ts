/**
 * The face as harmonic expression (H6 of #613, first slice): face expressions steer the chord
 * wheel, each one a MOVE from the chord in force. The category stepper (one move per expression,
 * re-armed by a neutral face), the default moves (a smile to the dominant, a sad face to the
 * relative minor; on the Tonnetz wheel, sad flips to the parallel minor), a player's own table, the
 * face branch composed only while the face steers, and the Face Wheel instrument.
 */
import { describe, it, expect } from 'vitest';
import { createCategoryStepper } from '@thoremin/sdk/harmony/navigate';
import { chordWheelNode, faceMoveFor, type ChordWheelStatus } from '@thoremin/ext-air/nodes/chord_wheel';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { ExpressionScores } from '@thoremin/sdk/music/expression';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import { AIR } from '../helpers/extensions';

const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const face = (label: ExpressionScores['label'] | null): ExpressionScores | undefined =>
  label === null ? undefined : ({ present: true, label, scores: [], thresholds: [], fired: [] } as ExpressionScores);

describe('the category stepper', () => {
  it('commits an expression once after it is held, and again only after a neutral face', () => {
    const s = createCategoryStepper({ enterFrames: 3, rest: 'neutral' });
    expect(['happy', 'happy', 'happy', 'happy', 'happy'].map((c) => s.push(c))).toEqual([null, null, 'happy', null, null]);
    expect(s.push('sad')).toBeNull(); // not re-armed: no neutral face in between
    s.push('neutral');
    expect(['sad', 'sad', 'sad'].map((c) => s.push(c))).toEqual([null, null, 'sad']);
    s.push(null); // nothing read also re-arms
    expect(['happy', 'sad', 'happy', 'happy', 'happy'].map((c) => s.push(c))).toEqual([null, null, null, null, 'happy']); // a flicker restarts the count
  });
});

/** Play a script of expressions, `hold` ticks each. */
function play(script: (ExpressionScores['label'] | null)[], config: Record<string, unknown>, hold = 8) {
  const h = chordWheelNode.make(chordWheelNode.params.parse({}));
  const statuses: ChordWheelStatus[] = [];
  let i = 0;
  for (const label of script) {
    for (let k = 0; k < hold; k++, i++) {
      const t = i / 30;
      const out = h.process({ hands: { t, width: 640, height: 480, hands: [] }, config: { enabled: true, steer: 'face', ...config }, spec: C, expression: face(label) }, { time: t, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as { status: ChordWheelStatus };
      statuses.push(out.status);
    }
  }
  return statuses;
}
const walk = (st: ChordWheelStatus[]) => st.map((s) => s.chord).filter((c, i, a) => c !== a[i - 1]);

describe('the face steers the chord wheel', () => {
  it('makes the default moves: a smile to the dominant, a sad face to the relative minor', () => {
    expect(walk(play(['neutral', 'happy', 'neutral', 'sad', 'neutral'], {}))).toEqual(['C', 'G', 'Em']);
    // Held, an expression moves once; it does not keep walking.
    expect(walk(play(['neutral', 'happy', 'happy', 'happy'], {}))).toEqual(['C', 'G']);
  });

  it('on the Tonnetz wheel a sad face flips to the parallel minor, a smile to the relative', () => {
    expect(walk(play(['neutral', 'sad', 'neutral', 'happy'], { moves: 'tonnetz' }))).toEqual(['C', 'Cm', 'Eb']);
  });

  it('plays the player\'s own table, and no move where it says none', () => {
    expect(walk(play(['neutral', 'happy', 'neutral', 'disgusted'], { faceMoves: { happy: 'dia+3' } }))).toEqual(['C', 'F']);
    expect(faceMoveFor('diatonic', 'none', 'happy')).toBeNull();
    expect(faceMoveFor('diatonic', '', 'sad')).toBe('dia-2');
  });

  it('sounds while the face is seen, and reads the expression out', () => {
    const st = play(['happy'], {}, 12);
    expect(st.at(-1)!).toMatchObject({ face: 'happy', steer: 'face', chord: 'G' });
    expect(play([null], {}, 30).at(-1)!.face).toBeNull();
  });

  it('ignores the face while the hand alone steers', () => {
    expect(walk(play(['neutral', 'happy', 'neutral', 'sad'], { steer: 'hand' }))).toEqual(['C']);
  });
});

describe.runIf(AIR)('the face wheel in the graph', () => {
  it('composes the face model only while the face steers, and the Face Wheel does', () => {
    const settings = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Face Wheel')!.layer);
    const ids = branchIdsFor(settings);
    expect(ids).toEqual(expect.arrayContaining(['chord-wheel', 'chord-wheel-face']));
    const hand = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Chord Wheel')!.layer);
    expect(branchIdsFor(hand)).not.toContain('chord-wheel-face');
    const { spec } = composeInstrumentGraph(['chord-wheel-face'], { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'faceExpr', port: 'expression' }, to: { node: 'chordWheel', port: 'expression' } });
    expect(spec.nodes.some((n) => n.id === 'chordWheel')).toBe(true); // required transitively
  });
});
