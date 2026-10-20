/**
 * Any category reader steers the chord wheel (`steer` = `signs` or `categorizer`): ASL's sign
 * reading or the player's pose categorizer on the wheel's `categories` input. A signed letter A..G
 * goes to the chord of the key spelled on it, a categorizer's categories make the wheel's moves in
 * wedge order, a player's table overrides either, letters follow one another with no rest between,
 * the hand pushes no wedge meanwhile, and each reader's branch is composed only while it steers.
 */
import { describe, it, expect } from 'vitest';
import { createCategoryStepper } from '@thoremin/sdk/harmony/navigate';
import { categoryTargetFor, chordWheelNode, type ChordWheelStatus } from '@thoremin/ext-harmony/nodes/chord_wheel';
import type { CategoryScores, HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { ASL, FACES, HARMONY } from '../helpers/extensions';
import { palmAt, W, H } from './synthetic_chord_map';

const D: ScaleSpec = { root: 2, type: 'major', octaves: 2, baseOctave: 3 };
const SIGNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'L', 'Y'];
const POSES = ['arms up', 'arms out', 'hands on hips'];

const reading = (labels: string[], label: string | null): CategoryScores | undefined =>
  ({ present: true, label, labels, scores: labels.map((l) => (l === label ? 1 : 0)) });

/** Play a script of categories, `hold` ticks each (null: something read, no category). */
function play(labels: string[], script: (string | null)[], config: Record<string, unknown>, palms?: ({ x: number; y: number } | null)[], hold = 8) {
  const h = chordWheelNode.make(chordWheelNode.params.parse({}));
  const statuses: ChordWheelStatus[] = [];
  let i = 0;
  for (const [n, label] of script.entries()) {
    for (let k = 0; k < hold; k++, i++) {
      const t = i / 30;
      const palm = palms?.[n];
      const frame: HandsFrame = { t, width: W, height: H, hands: palm ? [palmAt(palm, 'Left')] : [] };
      const out = h.process(
        { hands: frame, config: { enabled: true, mirrorHandedness: false, ...config }, spec: D, categories: reading(labels, label) },
        { time: t, dt: 1 / 30, tick: i, resources: {} } as never,
      ) as unknown as { status: ChordWheelStatus; params: { voices: { present: boolean }[] } };
      statuses.push(out.status);
    }
  }
  return statuses;
}
const walk = (st: ChordWheelStatus[]) => st.map((s) => s.chord).filter((c, i, a) => c !== a[i - 1]);

describe('the category stepper, re-armed by a change', () => {
  it('commits a different category held long enough without a rest, never the same one twice', () => {
    const s = createCategoryStepper({ enterFrames: 2, rest: null, rearm: 'change' });
    expect(['A', 'A', 'A', 'B', 'B', 'A', 'A'].map((c) => s.push(c))).toEqual([null, 'A', null, null, 'B', null, 'A']);
    s.push(null);
    expect(['A', 'A'].map((c) => s.push(c))).toEqual([null, 'A']);
  });
});

describe('category targets', () => {
  it('a letter goes to its chord, any other sign makes no move; a categorizer makes the moves in wedge order', () => {
    expect(categoryTargetFor('signs', 'diatonic', undefined, 'F', 5)).toEqual({ kind: 'letter', letter: 'F' });
    expect(categoryTargetFor('signs', 'diatonic', undefined, 'L', 8)).toBeNull();
    expect(categoryTargetFor('categorizer', 'diatonic', undefined, 'arms up', 0)).toEqual({ kind: 'move', relation: 'dia+3' });
    expect(categoryTargetFor('categorizer', 'tonnetz', undefined, 'x', 7)).toEqual({ kind: 'move', relation: 'L' });
  });

  it("the player's table: a move, no move, or a letter's chord", () => {
    expect(categoryTargetFor('signs', 'diatonic', 'dia+1', 'Y', 9)).toEqual({ kind: 'move', relation: 'dia+1' });
    expect(categoryTargetFor('signs', 'diatonic', 'none', 'A', 0)).toBeNull();
    expect(categoryTargetFor('categorizer', 'diatonic', 'chord', 'arms up', 0)).toBeNull();
  });
});

describe('signs steer the chord wheel', () => {
  it("each letter held goes to its chord of the key, one after another with no rest", () => {
    // In D major F is F#m and C is C#dim, as the ASL chords spell them.
    expect(walk(play(SIGNS, ['A', 'F', 'C', 'G'], { steer: 'signs' }))).toEqual(['D', 'A', 'F#m', 'C#°', 'G']);
  });

  it('a sign that is no letter changes nothing, and a flicker shorter than the hold neither', () => {
    expect(walk(play(SIGNS, ['L', 'Y', null], { steer: 'signs' }))).toEqual(['D']);
    const st = play(SIGNS, ['E', 'B', 'E'], { steer: 'signs' }, undefined, 3);
    expect(walk(st)).toEqual(['D']);
  });

  it('reads the sign out, and plays the table the player set', () => {
    const st = play(SIGNS, ['Y'], { steer: 'signs', categoryMoves: { Y: 'dia+3' } });
    expect(st.at(-1)!).toMatchObject({ category: 'Y', steer: 'signs', chord: 'G', lastMove: '4th up' });
  });

  it('the signing hand pushes no wedge', () => {
    // The hand in the wheel's centre, then pushed up toward a move: a move were the hand steering.
    const palms = [{ x: 0.3, y: 0.5 }, { x: 0.3, y: 0.15 }, { x: 0.3, y: 0.15 }];
    expect(walk(play(SIGNS, ['H', 'H', 'H'], { steer: 'signs' }, palms))).toEqual(['D']);
    expect(walk(play(SIGNS, ['H', 'H', 'H'], { steer: 'hand' }, palms)).length).toBeGreaterThan(1);
  });
});

describe('a categorizer steers the chord wheel', () => {
  it('each category held makes its move; Neutral (no category) re-arms the same one', () => {
    expect(walk(play(POSES, ['arms up', null, 'arms up', 'arms out'], { steer: 'categorizer' }))).toEqual(['D', 'G', 'C#°', 'Em']);
  });

  it('ignores the categories while the hand steers', () => {
    expect(walk(play(POSES, ['arms up', null, 'arms out'], { steer: 'hand' }))).toEqual(['D']);
  });
});

describe.runIf(HARMONY)('category readers in the graph', () => {
  const settings = (steer: string) => ({ chordWheel: { enabled: true, steer }, asl: { enabled: true, chords: false }, poseCategorizer: { id: 'x' } }) as never;

  it.runIf(ASL)("signs: the sign reader's reading into the wheel, composed only while signs steer", () => {
    expect(branchIdsFor(settings('signs'))).toEqual(expect.arrayContaining(['chord-wheel', 'chord-wheel-signs']));
    expect(branchIdsFor(settings('hand'))).not.toContain('chord-wheel-signs');
    const { spec } = composeInstrumentGraph(['chord-wheel-signs'], { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'aslSigns', port: 'signs' }, to: { node: 'chordWheel', port: 'categories' } });
  });

  it.runIf(FACES)("categorizer: the pose categorizer's reading into the wheel", () => {
    expect(branchIdsFor(settings('categorizer'))).toEqual(expect.arrayContaining(['chord-wheel', 'chord-wheel-categorizer']));
    const { spec } = composeInstrumentGraph(['chord-wheel-categorizer'], { source: 'synthetic-hands' }, createAppRegistry());
    expect(spec.edges).toContainEqual({ from: { node: 'poseCat', port: 'category' }, to: { node: 'chordWheel', port: 'categories' } });
  });
});
