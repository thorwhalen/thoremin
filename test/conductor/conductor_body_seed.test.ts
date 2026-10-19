/**
 * The body conductor starts at the score's marked tempo (#375; A2's note 5 on #386): the
 * detector's period and both priors' initial tempo come from the piece's first tempo mark,
 * also when the piece arrives after Start (it loads only once conducting is on), until the
 * first stroke. The hand conductor is never seeded (its path is unchanged).
 *
 * What this pins is that the seed REACHES the follower, by spying on the two factories.
 * Its effect on a clean conductor is nil (the priors re-estimate from the first stroke
 * interval, measured on A1's 4/4 clip): the level a body marks is A4's `relateLevel`.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as Ictus from '@thoremin/ictus';
import { CONDUCTOR } from '../helpers/extensions';

const calls = vi.hoisted(() => ({ ictus: [] as unknown[], impact: [] as unknown[] }));
vi.mock('@thoremin/ictus', async (importOriginal) => {
  const real = await importOriginal<typeof Ictus>();
  return {
    ...real,
    createIctus: (o: Parameters<typeof real.createIctus>[0]) => {
      calls.ictus.push(o);
      return real.createIctus(o);
    },
    createImpactDetector: (o: Parameters<typeof real.createImpactDetector>[0]) => {
      calls.impact.push(o);
      return real.createImpactDetector(o);
    },
  };
});

// The setup file preloads every listed extension (the conductor imports ictus): drop that copy so
// the node below is built against the spied factories.
vi.resetModules();
const { conductorNode } = await import('@/slices/conductor/nodes/conductor');
const { loadStream } = await import('../helpers/fixtures');
type BodyFrame = import('@/nodes').BodyFrame;

const FPS = 30;
const body = loadStream('video_body_conducting_44', 'camBody.body') as BodyFrame[];
const doc = { v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: 80 }], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 64 };
const ctx = (i: number) => ({ time: i / FPS, dt: 1 / FPS, tick: i, resources: {} }) as never;
type Seeded = { oscillator?: { initialTempo?: number }; trend?: { initialTempo?: number } };

async function run(source: 'hands' | 'body', docFrom: number, ticks = 120, rules = false) {
  calls.ictus.length = 0;
  calls.impact.length = 0;
  // The seed is the hand transport's: with the body's transport rules (#377) the start is the
  // ready pose and the upbeat, and nothing is seeded (the last test here).
  const h = conductorNode.make(conductorNode.params.parse({ enabled: true, source, mirrorX: false, mirrorHandedness: false, transport: { rules } }));
  for (let i = 0; i < ticks; i++) await h.process({ body: body[i], doc: i >= docFrom ? doc : undefined }, ctx(i));
}

describe.runIf(CONDUCTOR)("the body follower starts at the score's tempo", () => {
  it('a piece present at Start: the detector period and both priors', async () => {
    await run('body', 0);
    expect(calls.ictus).toHaveLength(1);
    const o = calls.ictus[0] as Seeded;
    expect(o.oscillator?.initialTempo).toBe(80);
    expect(o.trend?.initialTempo).toBe(80);
    expect((calls.impact[0] as { initialPeriod?: number }).initialPeriod).toBeCloseTo(60 / 80, 9);
  });

  it('a piece that arrives after Start, before the first stroke: the follower is rebuilt seeded', async () => {
    await run('body', 5);
    expect(calls.ictus).toHaveLength(2);
    expect((calls.ictus[0] as Seeded).oscillator?.initialTempo).toBeUndefined();
    expect((calls.ictus[1] as Seeded).oscillator?.initialTempo).toBe(80);
  });

  it('a piece that arrives after the first stroke does not restart the follower', async () => {
    await run('body', 90, 150);
    expect(calls.ictus).toHaveLength(1);
  });

  it('the hand conductor is never seeded', async () => {
    await run('hands', 0);
    expect(calls.ictus).toHaveLength(1);
    expect((calls.ictus[0] as Seeded).oscillator?.initialTempo).toBeUndefined();
    expect(calls.impact).toHaveLength(0);
  });

  it('with the body transport rules nothing is seeded: the beat moves at the marked tempo until the second stroke', async () => {
    await run('body', 0, 120, true);
    expect(calls.ictus).toHaveLength(1);
    expect((calls.ictus[0] as Seeded).oscillator?.initialTempo).toBeUndefined();
    expect((calls.impact[0] as { initialPeriod?: number }).initialPeriod).toBeUndefined();
  });
});
