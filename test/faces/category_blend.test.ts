/**
 * The category blend node (#372): only the categories the player set pull, a choice of target
 * alone changes nothing, nothing read holds the value, another categorizer starts afresh, and
 * tension leaves as whole steps through hysteresis and a dwell, so a membership's jitter near a
 * step's edge never adds and drops a tone while a shape is held (the adversarial review's case: a
 * category set to 0.5, its neighbours 0.45 and 0.55, membership leaking 2 to 5 %).
 */
import { describe, expect, it } from 'vitest';
import { categoryBlendNode, MIN_MEMBERSHIP, type BlendControls } from '@thoremin/ext-faces/nodes/category_blend';
import { DEFAULT_CATEGORIZER_CHORDS, UNSET_BLEND_VALUE, type CategorizerChordsDial } from '@thoremin/ext-faces/schema';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';

const IDS = ['cat-1', 'cat-2', 'cat-3'];
const DT = 1 / 30;
const reading = (scores: number[]): CategoryScores => ({ present: true, label: 'x', labels: IDS, ids: IDS, scores });
const dial = (blend: CategorizerChordsDial['blend'], values: Record<string, number>, id = 'hand:x'): Partial<CategorizerChordsDial> => ({
  ...DEFAULT_CATEGORIZER_CHORDS,
  id,
  blend,
  blendValues: { ...DEFAULT_CATEGORIZER_CHORDS.blendValues, ...values },
});

function run() {
  const node = categoryBlendNode.make(categoryBlendNode.params.parse({}));
  let t = 0;
  return (category: CategoryScores | undefined, config: Partial<CategorizerChordsDial>) => {
    t += DT;
    return (node.process({ category, config }, { time: t, dt: DT } as never) as { controls: BlendControls }).controls;
  };
}

/** A deterministic jitter in [-1, 1]. */
const jitter = (i: number) => Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 78.233) * 0.5;

describe('the category blend node', () => {
  it('off, or a target with no category set, says nothing: choosing a target alone changes no chord', () => {
    const step = run();
    expect(step(reading([1, 0, 0]), dial('off', { 'cat-1': 1 }))).toEqual({});
    expect(DEFAULT_CATEGORIZER_CHORDS.blendValues['cat-1']).toBe(UNSET_BLEND_VALUE);
    expect(step(reading([1, 0, 0]), dial('brightness', {}))).toEqual({});
    expect(step(reading([1, 0, 0]), dial('tension', {}))).toEqual({});
  });

  it('only the set categories pull; nothing read holds the value', () => {
    const step = run();
    const cfg = dial('brightness', { 'cat-1': 0.9 });
    let out: BlendControls = {};
    for (let i = 0; i < 60; i++) out = step(reading([0.3, 0.7, 0]), cfg);
    expect(out.brightness).toBeCloseTo(0.9, 3);
    // The rest: the categories' total membership under the floor holds the last value.
    for (let i = 0; i < 30; i++) out = step(reading([MIN_MEMBERSHIP / 4, MIN_MEMBERSHIP / 4, 0]), cfg);
    expect(out.brightness).toBeCloseTo(0.9, 3);
    for (let i = 0; i < 30; i++) out = step({ present: false, label: null, labels: IDS, ids: IDS, scores: [0, 0, 0] }, cfg);
    expect(out.brightness).toBeCloseTo(0.9, 3);
  });

  it('another categorizer starts from its own first reading', () => {
    const step = run();
    for (let i = 0; i < 60; i++) step(reading([1, 0, 0]), dial('brightness', { 'cat-1': 1, 'cat-2': 0 }));
    expect(step(reading([0, 1, 0]), dial('brightness', { 'cat-1': 1, 'cat-2': 0 }, 'hand:other')).brightness).toBe(0);
  });

  it('tension never toggles while a shape is held near a step edge, and still moves between shapes', () => {
    const step = run();
    const cfg = dial('tension', { 'cat-1': 0.45, 'cat-2': 0.5, 'cat-3': 0.55 });
    const levels: number[] = [];
    for (let i = 0; i < 300; i++) {
      const leak = 0.02 + 0.03 * Math.abs(jitter(i));
      const a = leak * (0.5 + 0.5 * jitter(i + 1000));
      levels.push(step(reading([a, 1 - leak, leak - a]), cfg).tension!);
    }
    const changes = levels.slice(1).filter((v, i) => v !== levels[i]).length;
    expect(changes).toBe(0);
    for (const v of levels) expect(Math.abs(v * 3 - Math.round(v * 3))).toBeLessThan(1e-9);
    // A real move to a shape set to 1 reaches the top step.
    const far = dial('tension', { 'cat-1': 0, 'cat-2': 1 });
    let out: BlendControls = {};
    for (let i = 0; i < 60; i++) out = step(reading([0, 1, 0]), far);
    expect(out.tension).toBeCloseTo(1, 9);
    for (let i = 0; i < 60; i++) out = step(reading([1, 0, 0]), far);
    expect(out.tension).toBe(0);
  });
});
