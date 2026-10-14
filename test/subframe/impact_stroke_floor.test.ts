/**
 * The impact predictor's per-stroke floor (#353): `setFloor` names the depth the stroke in
 * progress is heading for, and while one is named a stroke starts where the point stops
 * descending short of a stroke (an arm that carried the stick down to a lower pad and
 * waits there), not at the least depth since the last confirmation.
 *
 * The take: air strokes (a cosine ease, still at the bottom) alternating between two
 * floors, 0.6 from a top at 0.3 and 0.8 from a top at 0.5, the hand carried between the
 * tops along a smoothstep and held there before each fall. One learned floor sits between
 * the two after a change, so every stroke is predicted against the wrong depth; the
 * stroke's own floor named puts each prediction on its impact.
 */
import { describe, it, expect } from 'vitest';
import { createImpactPredictor, type ImpactEvent, type Sample } from '@thoremin/ictus';

const FPS = 60;
const STROKES = [
  { top: 0.3, floor: 0.6 },
  { top: 0.5, floor: 0.8 },
];

/** A speed gate between the carry (0.75 per second at most) and the strokes (3), as the air
 *  drum sets one: a carry as deep as a stroke is told from one by its speed. */
const GATES = { minApproachSpeed: 1.5 };

/** The take's samples and each stroke's impact (time, floor, the top it fell from). */
function take(n: number, strokes = STROKES): { samples: Sample[]; impacts: { t: number; floor: number; top: number }[] } {
  const samples: Sample[] = [];
  const impacts: { t: number; floor: number; top: number }[] = [];
  let t = 0;
  let y = STROKES[0].top;
  const push = () => {
    samples.push({ t, x: 0.5, y });
    t += 1 / FPS;
  };
  const phase = (seconds: number, at: (u: number) => number) => {
    const k = Math.round(seconds * FPS);
    for (let i = 1; i <= k; i++) {
      y = at(i / k);
      push();
    }
  };
  phase(0.5, () => y);
  for (let s = 0; s < n; s++) {
    const { top, floor } = strokes[s % strokes.length];
    const from = y;
    phase(0.4, (u) => from + (top - from) * u * u * (3 - 2 * u));
    phase(0.12, () => top);
    phase(0.15, (u) => top + ((floor - top) * (1 - Math.cos(Math.PI * u))) / 2);
    impacts.push({ t: t - 1 / FPS, floor, top });
    phase(0.2, (u) => floor - ((floor - top) * (1 - Math.cos(Math.PI * u))) / 2);
  }
  phase(0.5, () => y);
  return { samples, impacts };
}

/** Every event of the take, the stroke's floor named before each push when `name` says. */
function run(name: 'none' | 'floor' | 'nan', strokes = STROKES): ImpactEvent[] {
  const { samples, impacts } = take(12, strokes);
  const p = createImpactPredictor(GATES);
  const events: ImpactEvent[] = [];
  let k = 0;
  for (const s of samples) {
    while (k < impacts.length - 1 && s.t > impacts[k].t + 0.1) k++;
    if (name === 'floor' && k >= 2) p.setFloor(impacts[k].floor);
    if (name === 'nan') p.setFloor(NaN);
    events.push(...p.push(s));
  }
  return events;
}

/** Each prediction's error against the impact it predicts, ms, from the third stroke on. */
function errors(events: ImpactEvent[], strokes = STROKES): number[] {
  const { impacts } = take(12, strokes);
  return impacts.slice(2).map((imp) => {
    const pred = events.find((e) => e.kind === 'predict' && Math.abs(e.t - imp.t) < 0.1);
    return pred ? (pred.t - imp.t) * 1000 : NaN;
  });
}

describe('the impact predictor with a per-stroke floor (#353)', () => {
  it('predicts each stroke against its own floor: as on a floor that never changes, where one learned floor is off by tens of ms', () => {
    const shared = errors(run('none'));
    const named = errors(run('floor'));
    // The same strokes on one floor: the predictor's own error on an air stroke (its
    // commit-time fit cannot see the brake, #352), which naming the floor cannot remove.
    const deep = [STROKES[1]];
    const one = errors(run('none', deep), deep);
    expect([...shared, ...named, ...one].every(Number.isFinite)).toBe(true);
    const mae = (xs: number[]) => xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length;
    // One learned floor: every change of floor misses the impact by 30 to 80 ms.
    expect(mae(shared)).toBeGreaterThan(30);
    // Named: within 2 ms of the one-floor take, stroke for stroke.
    for (const e of named) expect(Math.abs(e - one[one.length - 1])).toBeLessThan(2);
  });

  it('reports the floor each event was taken against, and a stroke carried down starts at its wait', () => {
    const events = run('floor');
    const { impacts } = take(12);
    for (const imp of impacts.slice(2)) {
      const pred = events.find((e) => e.kind === 'predict' && Math.abs(e.t - imp.t) < 0.1)!;
      const conf = events.find((e) => e.kind === 'confirm' && Math.abs(e.t - imp.t) < 0.1);
      expect(pred.floor).toBe(imp.floor);
      expect(conf?.kind === 'confirm' && conf.floor).toBe(imp.floor);
      // The deep strokes come after a carry down: their top is the wait, not the last top.
      expect(conf?.kind === 'confirm' && conf.top).toBeCloseTo(imp.top, 9);
    }
    // With no floor named, the least depth since the last confirmation is the top, as before.
    const plain = run('none').filter((e) => e.kind === 'confirm');
    expect(plain.filter((e) => e.kind === 'confirm' && e.top < 0.31).length).toBe(plain.length);
  });

  it('is the predictor it was when no floor is named: NaN before every push changes nothing', () => {
    expect(run('nan')).toEqual(run('none'));
  });

  it('forgets a named floor on reset', () => {
    const p = createImpactPredictor({ ...GATES, level: 0.6 });
    p.setFloor(0.8);
    p.reset();
    const { samples } = take(1);
    const pred = samples.flatMap((s) => p.push(s)).find((e) => e.kind === 'predict');
    expect(pred?.floor).toBe(0.6);
  });
});
