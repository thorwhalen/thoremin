/**
 * The trainer's session (`createSession`, #163) at three edges `enroll.test.ts` does not reach:
 * a build over a take with no holds leaves nothing built (and a retrain says to build first),
 * declared invariance (#131, off by default) keeps every unassessed feature rather than
 * silencing it, and reset forgets the whole take, the noise estimate included.
 */
import { describe, expect, it } from 'vitest';
import { createSession } from '@thoremin/sdk/enroll/session';
import type { Cue } from '@thoremin/sdk/enroll/cue';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

const IDS = ['a', 'b', 'c'];
const registry = { allFeatureIds: IDS, groupOf: (id: string) => (IDS.includes(id) ? 'toy' : undefined) };
const cue = (id: string, produces: Cue['produces']): Cue =>
  ({
    id,
    name: id,
    instruction: `do ${id}.`,
    rationale: '',
    collects: { groups: ['toy'], omit: [], axes: [] },
    produces,
    sufficiency: produces === 'vocabulary' ? { kind: 'variety', minPoints: 2, minSeparation: 3, holdNudgeMs: 8000, patienceMs: 60000 } : { kind: 'frames', minFrames: 10, patienceMs: 20000 },
    variations: [],
    tags: [],
  }) as Cue;

/** A deterministic jitter in [-1, 1). */
const jitter = (() => {
  let s = 7;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
})();

/** Rest, then four held poses with moves between them, at 30 fps. */
function take(session: ReturnType<typeof createSession>) {
  let t = 0;
  const hold = (p: FeatureVector, frames: number) => {
    for (let i = 0; i < frames; i++) {
      const v: FeatureVector = {};
      for (const k of IDS) v[k] = p[k] + 0.01 * jitter();
      session.push(v, (t += 1000 / 30));
    }
  };
  session.beginCue(cue('rest', 'baseline'));
  hold({ a: 0, b: 0, c: 0 }, 30);
  session.endCue();
  session.beginCue(cue('faces', 'vocabulary'));
  const poses = [
    { a: 1, b: 0, c: 0 },
    { a: 0, b: 1, c: 0 },
    { a: 0, b: 0, c: 1 },
    { a: 1, b: 1, c: 0 },
  ];
  for (const p of poses) {
    hold({ a: 0.5, b: 0.5, c: 0.5 }, 3);
    hold(p, 30);
  }
  session.endCue();
}

describe('the trainer session at its edges', () => {
  it('a build with no holds builds nothing, and a retrain says to build first', () => {
    const session = createSession({ ...registry, sampler: { dwellMs: 200 } });
    session.beginCue(cue('rest', 'baseline'));
    session.push({ a: 0, b: 0, c: 0 }, 0);
    session.endCue();
    session.build();
    expect(session.built()).toBe(false);
    expect(session.features()).toEqual([]);
    expect(session.weights()).toEqual({});
    expect(() => session.retrain(2)).toThrow(/build\(\) over the current take/);
  });

  it('declared invariance keeps every unassessed feature: the model is the same as without it', () => {
    const plain = createSession({ ...registry, sampler: { dwellMs: 200 } });
    take(plain);
    plain.build();
    expect(plain.built()).toBe(true);
    expect(plain.points().length).toBeGreaterThanOrEqual(2);

    const declared = createSession({ ...registry, sampler: { dwellMs: 200 }, useDeclaredInvariance: true });
    take(declared);
    declared.build();
    expect(declared.built()).toBe(true);
    expect(declared.features().sort()).toEqual(plain.features().sort());
    for (const id of declared.features()) expect(declared.weights()[id]).toBeGreaterThan(0);
  });

  it('reset forgets the whole take', () => {
    const session = createSession({ ...registry, sampler: { dwellMs: 200 } });
    take(session);
    session.build();
    expect(session.baseline()).toBeDefined();
    session.beginCue(cue('faces', 'vocabulary'));
    session.reset();
    expect(session.activeCue()).toBeNull();
    expect(session.points()).toEqual([]);
    expect(session.framesFor('rest')).toBe(0);
    expect(session.baseline()).toBeUndefined();
    expect(session.built()).toBe(false);
    expect(session.features()).toEqual([]);
    expect(session.weights()).toEqual({});
    expect(session.ready()).toBe(false);
    expect(session.armed()).toBe(false);
  });
});
