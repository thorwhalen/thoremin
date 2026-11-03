/**
 * A gesture cue cannot judge a repetition until the gesturing part has a noise unit learned at
 * rest (#913). #857's rest cue made that likely, not certain: a hand that enters only with the
 * gesture cue warms on whatever it does first. Two guards, wherever the routine puts its rest:
 *
 * - the noise estimator judges a warm-up when it completes: one whose median ends above the
 *   feature's rest ceiling (the catalog's `restJitter`, a fraction of the hand's extent, for a
 *   hand's image positions) was motion, so the feature warms again, at most `maxRewarms` times;
 * - while an attended feature in view is cold, the session says `warming()` and the `repetitions`
 *   sufficiency asks the player to hold still.
 *
 * The takes are the scripted hand (`./helpers/wave_take`), in view only from the gesture cue's
 * start, or brought up waving during the beat before it.
 */
import { describe, it, expect } from 'vitest';
import { CueSchema, type Cue } from '@thoremin/sdk/enroll/cue';
import { createNoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { createRunner, type RunnerEvent } from '@thoremin/sdk/enroll/runner';
import { createSession, type SessionOptions } from '@thoremin/sdk/enroll/session';
import { DEFAULT_NUDGES } from '@thoremin/sdk/enroll/sufficiency';
import { FEATURE_BY_ID, restCeilingOf } from '@thoremin/sdk/features/catalog';
import { handExtent } from '@thoremin/sdk/features/hand_catalog';
import { waveTake } from './helpers/wave_take';

const WAVE: Cue = CueSchema.parse({
  id: 'wave',
  name: 'wave',
  instruction: 'Wave five times',
  gesture: 'wave',
  collects: { groups: ['hand.position.raw'] },
  produces: 'gesture',
  sufficiency: { kind: 'repetitions', minTraces: 5, patienceMs: 60000 },
});
const WRIST = 'hand.right.wrist.x';
/** A second of stillness is the warm-up (30 frames), then the quiet the segmenter arms on. */
const STILL_FIRST_MS = 1300;
const NO_CEILING: SessionOptions = { noise: { restCeiling: () => undefined } };

/** The gesture cue starts with the take, and the hand is in view only from then. */
function run(restMs: number, options: SessionOptions = {}) {
  const take = waveTake({ restMs });
  const session = createSession(options);
  const runner = createRunner({ cues: [WAVE], session });
  const said: string[] = [];
  runner.subscribe((e: RunnerEvent) => {
    if (e.type === 'guidance') said.push(e.say);
  });
  runner.start(0);
  for (const f of take.frames) runner.push(f.v, f.t);
  const ceiling = restCeilingOf(WRIST, take.frames[0].v)!;
  return { traces: session.tracesFor(WAVE.id), sigma: session.sigma(WRIST), ceiling, said, take };
}

describe('the rest ceiling (#913)', () => {
  it('is a hand position\'s, scaled by that hand\'s extent in the frame; joint angles and faces have none', () => {
    const v = waveTake({ waves: 0 }).frames[0].v;
    expect(FEATURE_BY_ID[WRIST].restJitter).toBe(0.01);
    expect(restCeilingOf(WRIST, v)).toBeCloseTo(0.01 * handExtent(v, 'hand.right.'), 12);
    expect(restCeilingOf('hand.right.index.pipAngle', v)).toBeUndefined();
    expect(restCeilingOf(WRIST, {})).toBeUndefined();
  });

  it('judges a side-relative hand id (the hand modality\'s projection, #754) against the unprefixed hand', () => {
    const v = waveTake({ waves: 0 }).frames[0].v;
    const projected = Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('hand.right.')).map(([k, x]) => [k.slice('hand.right.'.length), x]));
    expect(restCeilingOf('wrist.x', projected)).toBeCloseTo(restCeilingOf(WRIST, v)!, 12);
    expect(restCeilingOf('index.pipAngle', projected)).toBeUndefined();
    expect(restCeilingOf('wrist.x', {})).toBeUndefined();
  });

  it('the estimator warms a feature again after a warm-up above its ceiling, and keeps the lowest after maxRewarms', () => {
    // A feature that moves 1 a frame for its first 30 differences, then jitters 0.1.
    const noise = createNoiseEstimator({ restCeiling: () => 0.5, maxRewarms: 2 });
    let t = 0;
    const feed = (n: number, step: (i: number) => number) => {
      for (let i = 0; i < n; i++) noise.push({ f: step(i) }, (t += 33));
    };
    feed(31, (i) => i);
    expect(noise.isWarm('f')).toBe(false); // judged, and cold again
    feed(30, (i) => (i % 2) * 0.1);
    expect(noise.isWarm('f')).toBe(true);
    expect(noise.sigma('f')).toBeLessThan(0.5);
    // Always moving: two re-warms, then the lowest warm-up stands (a feature never stuck cold).
    const stubborn = createNoiseEstimator({ restCeiling: () => 0.5, maxRewarms: 2 });
    let x = 0;
    for (let i = 0; i <= 90; i++) stubborn.push({ f: (x += i <= 60 ? 1 : 2) }, i * 33);
    expect(stubborn.isWarm('f')).toBe(true);
    expect(stubborn.snapshot().sigma.f).toBe(1);
  });
});

describe('a gesture cue withholds until the gesturing hand is warm at rest (#913)', () => {
  it('a hand that enters with the cue and holds still a second first yields all its traces', () => {
    const r = run(STILL_FIRST_MS);
    expect(r.traces).toHaveLength(5);
    expect(r.sigma).toBeLessThan(r.ceiling);
  });

  it('one that waves at once is asked to hold still, and its unit is not learned from the wave', () => {
    const still = run(STILL_FIRST_MS).sigma;
    const r = run(100);
    expect(r.said).toContain(DEFAULT_NUDGES.hold);
    // Learned again between the waves, at rest: the same unit as the hand that held still first.
    expect(r.sigma).toBeLessThan(r.ceiling);
    expect(r.sigma / still).toBeLessThan(2);
    // The waves after the first rest are cut; the first, made cold, never is.
    expect(r.traces.length).toBeGreaterThanOrEqual(3);
    for (const t of r.traces) expect(t.samples[0].t).toBeGreaterThan(r.take.waves[0].endMs);
  });

  it('without a ceiling the wave becomes the unit (the failure #913 names)', () => {
    const r = run(100, NO_CEILING);
    expect(r.sigma).toBeGreaterThan(3 * run(STILL_FIRST_MS).sigma);
    expect(r.traces.length).toBeLessThanOrEqual(1);
  });

  it('a hand brought up waving during the beat before the cue is judged too', () => {
    // The hand waves from the start while no cue runs, then the gesture cue starts after the
    // waves, so its warm-up happened in the beat; the later waves of the same take are cut.
    const take = waveTake({ restMs: 100, waves: 8 });
    const cueAt = take.waves[2].endMs + 200;
    const go = (options: SessionOptions) => {
      const session = createSession(options);
      for (const f of take.frames) {
        if (f.t >= cueAt && !session.activeCue()) session.beginCue(WAVE);
        session.push(f.v, f.t);
      }
      return session.tracesFor(WAVE.id).length;
    };
    expect(go({})).toBeGreaterThanOrEqual(4);
    expect(go(NO_CEILING)).toBeLessThanOrEqual(1);
  });
});
