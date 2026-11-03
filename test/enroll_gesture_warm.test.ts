/**
 * A gesture cue withholds until the part that will gesture has a noise unit learned at rest
 * (#913). #857's rest cue made that likely, not certain: a hand that enters only with the gesture
 * cue warms on whatever it does first. So the guard is the session's: a feature first seen cold in
 * a gesture cue is judged when it warms, and a warm-up past its rest-jitter ceiling (the catalog's
 * `restJitter`: hand image positions) is forgotten and warmed again, while the runner says "hold
 * it still". The takes are the scripted hand (`./helpers/wave_take`), present only from the
 * moment the gesture cue starts.
 */
import { describe, it, expect } from 'vitest';
import { CueSchema, type Cue } from '@thoremin/sdk/enroll/cue';
import { createRunner, type RunnerEvent } from '@thoremin/sdk/enroll/runner';
import { createSession, type SessionOptions } from '@thoremin/sdk/enroll/session';
import { DEFAULT_NUDGES } from '@thoremin/sdk/enroll/sufficiency';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
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

/** The gesture cue starts with the take, and the hand is in view only from then: nothing warmed it. */
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
  return { traces: session.tracesFor(WAVE.id), sigma: session.sigma(WRIST), said, take };
}

describe('a gesture cue withholds until the gesturing hand is warm at rest (#913)', () => {
  it('the hand positions carry a rest-jitter ceiling, the joint angles none', () => {
    expect(FEATURE_BY_ID[WRIST].restJitter).toBe(0.003);
    expect(FEATURE_BY_ID['hand.right.index.pipAngle']?.restJitter).toBeUndefined();
  });

  // A second of stillness is the warm-up (30 frames), then the quiet the segmenter arms on.
  const STILL_FIRST_MS = 1300;

  it('a hand that enters with the cue and holds still a second first yields all its traces', () => {
    const r = run(STILL_FIRST_MS);
    expect(r.traces).toHaveLength(5);
    expect(r.sigma).toBeLessThan(FEATURE_BY_ID[WRIST].restJitter!);
  });

  it('one that waves at once is asked to hold still, and its unit is not learned from the wave', () => {
    const still = run(STILL_FIRST_MS).sigma;
    const r = run(100);
    expect(r.said).toContain(DEFAULT_NUDGES.hold);
    // Re-learned between the waves, at rest: the same unit as the hand that held still first.
    expect(r.sigma).toBeLessThan(FEATURE_BY_ID[WRIST].restJitter!);
    expect(r.sigma / still).toBeLessThan(2);
    // The waves after the first rest are cut; the first one, made cold, never is.
    expect(r.traces.length).toBeGreaterThanOrEqual(3);
    for (const t of r.traces) expect(t.samples[0].t).toBeGreaterThan(r.take.waves[0].endMs);
  });

  it('without the ceiling the wave becomes the unit, as before (the failure #913 names)', () => {
    const r = run(100, { restJitterOf: () => undefined });
    expect(r.sigma).toBeGreaterThan(FEATURE_BY_ID[WRIST].restJitter!);
    expect(r.sigma).toBeGreaterThan(3 * run(STILL_FIRST_MS).sigma);
    expect(r.traces.length).toBeLessThanOrEqual(1);
  });
});
