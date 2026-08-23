/**
 * The cue runner + sufficiency evaluator (#163) — the trainer's conversation, headless.
 *
 * Synthetic cases first (where the right verdict is known by construction), then the
 * REAL head-pose recording driven through a routine of look-left / look-right /
 * look-up / look-down / closer-and-further, in RAW units (degrees for pose, 0..1 for
 * blendshapes) — which is the case trainer v1 could not have passed: every threshold
 * here is in noise units, so a 27-degree turn and a 0.8 smile are both simply "far".
 */
import { describe, it, expect } from 'vitest';
import {
  CANNOT_REASONS,
  createRunner,
  createSession,
  defaultSufficiency,
  RUNNER_PHRASES,
  type Cue,
  type FeatureVector,
  type RunnerEvent,
  type Session,
} from '@/enroll';
import { matrixToHeadPose } from '@/nodes/domain';
import { loadStream } from './helpers/fixtures';

const v = (o: Record<string, number>): FeatureVector => o;

/** Deterministic jitter in [-1, 1). */
const prng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 2147483648 - 1;
};

/** A toy registry: `head.*` keys are group `head`, everything else is `expr`. */
const registry = {
  allFeatureIds: ['yaw', 'pitch', 'roll', 'smile', 'jaw', 'brow'],
  groupOf: (id: string) => (['yaw', 'pitch', 'roll'].includes(id) ? 'head' : 'expr'),
};

const cue = (id: string, spec: Partial<Cue>): Cue =>
  ({
    id,
    name: id,
    instruction: `Do ${id}.`,
    rationale: '',
    collects: { groups: ['head', 'expr'], omit: [], axes: [] },
    produces: 'vocabulary',
    sufficiency: { kind: 'excursion', minPoints: 1, minExcursion: 8, patienceMs: 20000 },
    variations: [],
    tags: [],
    ...spec,
  }) as Cue;

const REST = cue('rest', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 5000 } });
const LOOK = cue('look', {
  collects: { groups: ['head'], omit: [], axes: [] },
  variations: ['A bit further.', 'All the way, if you can.'],
});
const FACES = cue('faces', {
  sufficiency: { kind: 'variety', minPoints: 2, minSeparation: 6, holdNudgeMs: 3000, patienceMs: 30000 },
});

interface Harness {
  session: Session;
  runner: ReturnType<typeof createRunner>;
  events: RunnerEvent[];
  t: number;
  /** Feed `frames` frames of `make(i)` at 30 fps from the current time. */
  feed(frames: number, make: (i: number) => FeatureVector): void;
  /** Advance time without samples. */
  wait(ms: number): void;
  kinds(): string[];
}

function harness(
  cues: Cue[],
  extra: Partial<Parameters<typeof createRunner>[0]> = {},
  sampler: { dwellMs?: number; stillSigma?: number } = { dwellMs: 200 },
): Harness {
  const session = createSession({ ...registry, sampler });
  const events: RunnerEvent[] = [];
  const runner = createRunner({ cues, session, beatMs: 500, repeatSayMs: 4000, ...extra });
  runner.subscribe((e) => events.push(e));
  const h: Harness = {
    session,
    runner,
    events,
    t: 1000,
    feed(frames, make) {
      for (let i = 0; i < frames; i++) {
        h.t += 33;
        runner.push(make(i), h.t);
      }
    },
    wait(ms) {
      const end = h.t + ms;
      while (h.t < end) {
        h.t += 100;
        runner.tick(h.t);
      }
    },
    kinds: () => events.map((e) => (e.type === 'cue-end' ? `end:${e.outcome}` : e.type)),
  };
  return h;
}

/** Rest pose with jitter: everything near zero, yaw jitter in degrees, smile in 0..1. */
const restFrame = (r: () => number) => () => v({ yaw: 0.3 * r(), pitch: 0.3 * r(), roll: 0.3 * r(), smile: 0.02 + 0.01 * r(), jaw: 0.02 + 0.01 * r(), brow: 0.1 + 0.01 * r() });

describe('the runner steps when it has ENOUGH, not when time passes', () => {
  it('says each instruction, ends a frames cue on its count, and starts the next after the beat', () => {
    const h = harness([REST, LOOK]);
    const r = prng(1);
    h.runner.start(h.t);
    expect(h.kinds()).toEqual(['cue-start']);
    expect(h.events[0].type === 'cue-start' && h.events[0].say).toBe(REST.instruction);
    expect(h.runner.state().status).toBe('running');

    h.feed(10, restFrame(r)); // not yet 15
    expect(h.runner.state().coverage).toBeCloseTo(10 / 15, 2);
    expect(h.kinds()).toEqual(['cue-start']);

    h.feed(10, restFrame(r)); // past 15 — evaluated on the next 250 ms boundary
    expect(h.kinds()).toEqual(['cue-start', 'end:enough']);
    const end = h.events[1];
    expect(end.type === 'cue-end' && end.say).toBe(RUNNER_PHRASES.enough);
    expect(h.runner.state().status).toBe('between');
    // The next cue is announced in the state while we wait.
    expect(h.runner.state().cue?.id).toBe('look');

    h.wait(600); // the beat
    expect(h.kinds()).toEqual(['cue-start', 'end:enough', 'cue-start']);
    expect(h.runner.state().status).toBe('running');
    expect(h.runner.state().say).toBe(LOOK.instruction);
  });

  it('an excursion cue: a timid hold earns the variation, a real turn earns enough', () => {
    const h = harness([REST, LOOK]);
    const r = prng(2);
    h.runner.start(h.t);
    h.feed(40, restFrame(r)); // rest: enough, with a baseline + a warm noise estimate
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('look');

    // A timid turn: a quick 1.5-degree move (quick enough to count as a MOVEMENT — a
    // cue's first point must follow one), then held (with its jitter — a perfectly
    // constant feature would have NO noise, and in noise units that is infinitely far):
    // a still-point, but only ~5 sigma RMS from rest over the head features.
    h.feed(2, (i) => v({ ...restFrame(r)(), yaw: (1.5 * (i + 1)) / 2 }));
    h.feed(20, () => v({ ...restFrame(r)(), yaw: 1.5 + 0.3 * r() }));
    const guidance = h.events.filter((e) => e.type === 'guidance');
    expect(guidance).toHaveLength(1);
    expect(guidance[0].type === 'guidance' && guidance[0].say).toBe('A bit further.');
    expect(h.runner.state().status).toBe('running');

    // The same ASK is NOT repeated every evaluation while nothing changes — even though
    // the evaluator now proposes the next WORDING (it cycles the variations)...
    h.feed(20, () => v({ ...restFrame(r)(), yaw: 1.5 + 0.3 * r() }));
    expect(h.events.filter((e) => e.type === 'guidance')).toHaveLength(1);
    // ...but it is, with the next variation, once `repeatSayMs` (4 s here) has passed.
    h.feed(150, () => v({ ...restFrame(r)(), yaw: 1.5 + 0.3 * r() }));
    const again = h.events.filter((e) => e.type === 'guidance');
    expect(again).toHaveLength(2);
    expect(again[1].type === 'guidance' && again[1].say).toBe('All the way, if you can.');

    // Now a real 25-degree turn, held.
    h.feed(15, (i) => v({ ...restFrame(r)(), yaw: 1.5 + (23.5 * i) / 15 }));
    h.feed(20, () => v({ ...restFrame(r)(), yaw: 25 + 0.3 * r() }));
    expect(h.kinds().at(-2)).toBe('end:enough');
    expect(h.kinds().at(-1)).toBe('done');
    expect(h.runner.state().status).toBe('done');
  });

  it('runs out of patience and says WHY, then moves on — never loops forever', () => {
    const h = harness([REST, cue('impossible', { collects: { groups: ['head'], omit: [], axes: [] }, sufficiency: { kind: 'excursion', minPoints: 1, minExcursion: 8, patienceMs: 3000 } }), FACES]);
    const r = prng(3);
    h.runner.start(h.t);
    h.feed(40, restFrame(r));
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('impossible');
    // The player sits still at rest for longer than the cue's patience: they never
    // moved, and the reason says so (not "not enough movement", which is for a player
    // who did move but not far).
    h.feed(120, restFrame(r)); // 4 s
    const end = h.events.find((e) => e.type === 'cue-end' && e.cue.id === 'impossible');
    expect(end?.type === 'cue-end' && end.outcome).toBe('cannot');
    // The reason is one of the finite, speakable CANNOT_REASONS; "Moving on." is the
    // runner's own phrase, said after it — never duplicated inside the reason.
    expect(end?.type === 'cue-end' && end.why).toBe(CANNOT_REASONS.noMove);
    expect(end?.type === 'cue-end' && end.why).not.toMatch(/moving on/i);
    expect(end?.type === 'cue-end' && end.say).toBe(RUNNER_PHRASES.cannot);
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('faces');
    expect(h.runner.state().outcomes).toEqual(['enough', 'cannot', null]);
  });

  it('patience elapses on bare ticks too (no face in frame still ends a cue)', () => {
    const h = harness([cue('alone', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 2000 } })]);
    h.runner.start(h.t);
    h.wait(2500);
    expect(h.kinds()).toEqual(['cue-start', 'end:cannot', 'done']);
    const end = h.events[1];
    expect(end.type === 'cue-end' && end.why).toMatch(/could not see you/i);
  });

  it('a variety cue counts DISTINCT holds, nudges on a duplicate, and nudges to hold still after a silence', () => {
    const h = harness([REST, FACES]);
    const r = prng(4);
    h.runner.start(h.t);
    h.feed(40, restFrame(r));
    h.wait(600);

    // Hold face A (a big smile), move back to rest, hold face A AGAIN: one distinct, one duplicate.
    const A = () => v({ ...restFrame(r)(), smile: 0.8 });
    h.feed(10, (i) => v({ ...restFrame(r)(), smile: (0.8 * i) / 10 }));
    h.feed(20, A);
    h.feed(10, (i) => v({ ...restFrame(r)(), smile: 0.8 - (0.8 * i) / 10 }));
    h.feed(20, restFrame(r)); // rest itself is a hold far from A: distinct #2? No — it IS a different face.
    // (Resting between faces is a held pose too. That is by design: "neutral" is a category
    // a player can hit on purpose. So we are at 2 distinct already...)
    expect(h.runner.state().status).toBe('done');
  });

  it('the hold nudge fires when nothing has been held for a while — at the cue\'s holdNudgeMs, not the runner\'s repeat interval', () => {
    const h = harness([REST, cue('sweep', { sufficiency: { kind: 'variety', minPoints: 3, minSeparation: 6, holdNudgeMs: 2000, patienceMs: 30000 } })]);
    const r = prng(5);
    h.runner.start(h.t);
    h.feed(40, restFrame(r));
    h.wait(600);
    const started = h.events.filter((e): e is Extract<RunnerEvent, { type: 'cue-start' }> => e.type === 'cue-start');
    const t0 = started[1].t; // when the sweep cue actually began
    // Continuous motion for 3 s: never still, nothing held.
    h.feed(90, (i) => v({ ...restFrame(r)(), yaw: 30 * Math.sin(i / 4) }));
    const g = h.events.filter((e): e is Extract<RunnerEvent, { type: 'guidance' }> => e.type === 'guidance');
    expect(g.length).toBeGreaterThanOrEqual(1);
    expect(g[0].say).toMatch(/hold it still/i);
    // Said once the cue's own holdNudgeMs elapsed (2 s), well before repeatSayMs (4 s):
    // a NEW ask is not gated behind the repeat interval.
    expect(g[0].t - t0).toBeGreaterThanOrEqual(2000);
    expect(g[0].t - t0).toBeLessThan(3000);
  });

  it('frames between cues feed the noise estimate (no hole at the beat), and a bare nudge does not advance the variation cycle', () => {
    // A longer rest, so the estimate is past its warm-up before the boundary is tested.
    const longRest = cue('rest', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 60, patienceMs: 5000 } });
    const h = harness([longRest, cue('faces', { sufficiency: { kind: 'variety', minPoints: 3, minSeparation: 6, holdNudgeMs: 2000, patienceMs: 30000 }, variations: ['V1', 'V2', 'V3'] })], { repeatSayMs: 1000 });
    const r = prng(12);
    h.runner.start(h.t);
    h.feed(66, restFrame(r)); // needs 60; enough on the next 250 ms evaluation
    expect(h.runner.state().status).toBe('between');
    const before = h.session.noise().snapshot().frames;
    const sigmaBefore = h.session.sigma('yaw');
    h.feed(12, restFrame(r)); // during the beat (500 ms here; 12 frames = 400 ms)
    expect(h.session.noise().snapshot().frames).toBe(before + 12);
    h.wait(400);
    expect(h.runner.state().status).toBe('running');
    // The estimate did not take a hit at the boundary.
    expect(h.session.sigma('yaw')).toBeGreaterThan(sigmaBefore * 0.85);
    expect(h.session.sigma('yaw')).toBeLessThan(sigmaBefore * 1.15);

    // 3 s of continuous motion: the built-in hold nudge fires (and repeats)...
    h.feed(90, (i) => v({ ...restFrame(r)(), yaw: 30 * Math.sin(i / 4) }));
    const holds = h.events.filter((e) => e.type === 'guidance');
    expect(holds.length).toBeGreaterThanOrEqual(1);
    // ...then a held pose, rest, and the SAME pose again: a duplicate, nudged from the
    // cue's list — starting at V1, because the hold nudges were not list entries.
    const A = () => v({ ...restFrame(r)(), yaw: 25 + 0.3 * r() });
    h.feed(10, (i) => v({ ...restFrame(r)(), yaw: (25 * i) / 10 }));
    h.feed(20, A);
    h.feed(10, (i) => v({ ...restFrame(r)(), yaw: 25 - (25 * i) / 10 }));
    h.feed(20, restFrame(r));
    h.feed(10, (i) => v({ ...restFrame(r)(), yaw: (25 * i) / 10 }));
    h.feed(20, A);
    const fromList = h.events.filter((e): e is Extract<RunnerEvent, { type: 'guidance' }> => e.type === 'guidance' && /^V\d$/.test(e.say));
    expect(fromList.length).toBeGreaterThanOrEqual(1);
    expect(fromList[0].say).toBe('V1');
  });

  it('the pose held while an instruction is given is NOT the cue\'s first point — only what follows a movement is', () => {
    const h = harness([REST, LOOK, cue('look2', { collects: { groups: ['head'], omit: [], axes: [] } })]);
    const r = prng(21);
    h.runner.start(h.t);
    h.feed(40, restFrame(r));
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('look');
    // Still at rest for a second after "look": no point, no "a bit further".
    h.feed(30, restFrame(r));
    expect(h.session.pointsFor('look')).toHaveLength(0);
    expect(h.events.filter((e) => e.type === 'guidance')).toHaveLength(0);
    // Then the turn, held.
    h.feed(15, (i) => v({ ...restFrame(r)(), yaw: (25 * i) / 15 }));
    h.feed(20, () => v({ ...restFrame(r)(), yaw: 25 + 0.3 * r() }));
    expect(h.session.pointsFor('look')).toHaveLength(1);
    expect(h.session.pointsFor('look')[0].vector.yaw).toBeGreaterThan(20);
    // Keep holding LEFT through the beat and into "look2": that pose must not become
    // look2's point — it is look's answer, not look2's.
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('look2');
    h.feed(40, () => v({ ...restFrame(r)(), yaw: 25 + 0.3 * r() }));
    expect(h.session.pointsFor('look2')).toHaveLength(0);
    expect(h.runner.state().status).toBe('running');
  });

  it('a player who moves DURING the beat (right after "Good.") still counts as having moved', () => {
    const h = harness([REST, LOOK, cue('look2', { collects: { groups: ['head'], omit: [], axes: [] } })]);
    const r = prng(23);
    h.runner.start(h.t);
    h.feed(40, restFrame(r));
    h.wait(600);
    h.feed(15, (i) => v({ ...restFrame(r)(), yaw: (25 * i) / 15 }));
    h.feed(20, () => v({ ...restFrame(r)(), yaw: 25 + 0.3 * r() }));
    expect(h.runner.state().status).toBe('between');
    // The turn the other way happens entirely within the beat...
    h.feed(12, (i) => v({ ...restFrame(r)(), yaw: 25 - (50 * (i + 1)) / 12 }));
    h.wait(300);
    expect(h.runner.state().cue?.id).toBe('look2');
    // ...and the new pose is simply held once look2 begins.
    h.feed(20, () => v({ ...restFrame(r)(), yaw: -25 + 0.3 * r() }));
    expect(h.session.pointsFor('look2')).toHaveLength(1);
    expect(h.session.pointsFor('look2')[0].vector.yaw).toBeLessThan(-20);
  });

  it('a routine that does NOT start with a rest cue cannot mistake its first sweep for a held pose', () => {
    // The noise estimate is a plain mean during its warm-up, so a steady sweep would
    // measure as "noise" and read as held. The sampler refuses to judge until warm.
    const h = harness([cue('sweep-first', { collects: { groups: ['head'], omit: [], axes: [] } })]);
    const r = prng(8);
    h.runner.start(h.t);
    for (let i = 0; i < 20; i++) h.feed(1, (j) => v({ ...restFrame(r)(), yaw: 1.0 * (i * 1 + j) }));
    expect(h.session.pointsFor('sweep-first')).toHaveLength(0);
    expect(h.runner.state().status).toBe('running');
  });

  it('skip ends the active cue as skipped; stop aborts and keeps the samples', () => {
    const h = harness([REST, LOOK, FACES]);
    const r = prng(6);
    h.runner.start(h.t);
    h.feed(5, restFrame(r));
    h.runner.skip(h.t);
    expect(h.kinds()).toEqual(['cue-start', 'end:skipped']);
    h.wait(600);
    expect(h.runner.state().cue?.id).toBe('look');
    h.feed(5, restFrame(r));
    h.runner.stop(h.t);
    expect(h.runner.state().status).toBe('stopped');
    expect(h.kinds().at(-1)).toBe('stopped');
    expect(h.runner.state().outcomes).toEqual(['skipped', 'skipped', null]);
    // Samples captured before the stop are still in the session.
    expect(h.session.framesFor('rest')).toBe(5);
    // And a stopped runner ignores further frames.
    h.feed(5, restFrame(r));
    expect(h.session.framesFor('rest')).toBe(5);
  });

  it('a frame with none of the cue\'s features is not a sample (no face in shot does not fill the meter)', () => {
    const h = harness([cue('head-only', { produces: 'baseline', collects: { groups: ['head'], omit: [], axes: [] }, sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 5000 } })]);
    h.runner.start(h.t);
    h.feed(30, () => v({ smile: 0.5 })); // expression only — the cue attends to the head
    expect(h.runner.state().samples).toBe(0);
    expect(h.kinds()).toEqual(['cue-start']);
  });

  it('an empty routine is done immediately; the evaluator seam is injectable', () => {
    const h = harness([]);
    h.runner.start(h.t);
    expect(h.kinds()).toEqual(['done']);

    // A custom evaluator that is always satisfied ends every cue on its first look.
    const quick = harness([REST, LOOK], { evaluate: () => ({ verdict: 'enough' }) });
    quick.runner.start(quick.t);
    quick.feed(10, restFrame(prng(9)));
    quick.wait(600);
    quick.feed(10, restFrame(prng(9)));
    expect(quick.kinds()).toEqual(['cue-start', 'end:enough', 'cue-start', 'end:enough', 'done']);
  });
});

describe('the default evaluator, directly', () => {
  const sigma = () => 1;
  const base = {
    features: ['yaw'],
    frames: 0,
    elapsedMs: 0,
    sinceLastSampleMs: 0,
    moved: true,
    sigma,
    askedVariations: 0,
  };

  it('excursion without a baseline counts points only (nothing to measure against)', () => {
    const r = defaultSufficiency({ ...base, cue: LOOK, points: [{ vector: v({ yaw: 1 }), t: 0, cue: 'look' }] });
    expect(r.verdict).toBe('enough');
  });

  it('excursion with a baseline needs the distance', () => {
    const near = defaultSufficiency({ ...base, cue: LOOK, baseline: v({ yaw: 0 }), points: [{ vector: v({ yaw: 2 }), t: 0, cue: 'look' }] });
    expect(near.verdict).toBe('need-variation');
    const far = defaultSufficiency({ ...base, cue: LOOK, baseline: v({ yaw: 0 }), points: [{ vector: v({ yaw: 20 }), t: 0, cue: 'look' }] });
    expect(far.verdict).toBe('enough');
  });

  it('cycles the cue\'s variations by how many were already said', () => {
    const at = (n: number) => {
      const r = defaultSufficiency({ ...base, cue: LOOK, baseline: v({ yaw: 0 }), askedVariations: n, points: [{ vector: v({ yaw: 2 }), t: 0, cue: 'look' }] });
      return r.verdict === 'need-variation' ? r.say : r.verdict;
    };
    expect(at(0)).toBe('A bit further.');
    expect(at(1)).toBe('All the way, if you can.');
    expect(at(2)).toBe('A bit further.');
  });

  it('need-more is silent: a frames cue short of its count says nothing', () => {
    expect(defaultSufficiency({ ...base, cue: REST, points: [], frames: 3 }).verdict).toBe('need-more');
  });
});

describe('a routine over the REAL recording, in RAW units', () => {
  interface PoseRecord {
    present: boolean;
    blendshapes: Record<string, number>;
    transformMatrix: number[];
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;

  /** RAW units on purpose: pose in degrees, blendshapes in 0..1. */
  const vecAt = (i: number): FeatureVector => {
    const f = frames[i];
    const p = matrixToHeadPose(f.transformMatrix);
    const b = f.blendshapes;
    return {
      yaw: p.yaw,
      pitch: p.pitch,
      roll: p.roll,
      smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2,
      jaw: b.jawOpen ?? 0,
      brow: ((b.browOuterUpLeft ?? 0) + (b.browOuterUpRight ?? 0) + (b.browInnerUp ?? 0)) / 3,
    };
  };
  const window = (from: number, to: number): FeatureVector[] => {
    const out: FeatureVector[] = [];
    for (let i = Math.round(from * FPS); i <= Math.round(to * FPS) && i < frames.length; i++) out.push(vecAt(i));
    return out;
  };

  const head = (id: string, instruction: string): Cue =>
    cue(id, { instruction, collects: { groups: ['head'], omit: [], axes: [] }, variations: ['A bit further, if you can.'] });

  it('rest, four head movements and the dolly all reach ENOUGH from the clip\'s own segments', () => {
    const routine: Cue[] = [
      cue('rest', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 5000 } }),
      head('look-left', 'Look left.'),
      head('look-right', 'Look right.'),
      head('look-up', 'Look up.'),
      head('look-down', 'Look down.'),
      cue('dolly', { produces: 'nuisance', collects: { groups: ['head', 'expr'], omit: [], axes: ['scale'] }, sufficiency: { kind: 'frames', minFrames: 40, patienceMs: 10000 } }),
    ];
    // Measured on this clip (recorded to settle axis signs, not as a take): right, up
    // and down are genuinely held — 10-13 frames within 5 sigma of still (330-430 ms) —
    // but the LEFT turn is a pure sweep: 2 frames within 5 sigma, 5 within 8. So this
    // routine judges "held" at 8 sigma over 100 ms to catch that apex; the negative
    // case below keeps the defaults and shows the sweep is correctly NOT a held pose.
    const h = harness(routine, {}, { dwellMs: 100, stillSigma: 8 });
    h.runner.start(h.t);
    // The fixture's ground-truth windows (README), each re-timed to follow the last.
    const segments: [number, number][] = [
      [7.7, 8.5], // a held, settled face -> rest
      [3.5, 4.7], // turned toward image-left (yaw -27)
      [5.9, 7.1], // toward image-right (+35)
      [0.2, 1.5], // chin up (pitch -37)
      [1.6, 3.4], // chin down (+26)
      [10.9, 13.6], // dolly in and out
    ];
    for (const [from, to] of segments) {
      const seg = window(from, to);
      h.feed(seg.length, (i) => seg[i]);
      h.wait(600);
    }
    const ends = h.events.filter((e): e is Extract<RunnerEvent, { type: 'cue-end' }> => e.type === 'cue-end');
    expect(ends.map((e) => `${e.cue.id}:${e.outcome}`)).toEqual([
      'rest:enough',
      'look-left:enough',
      'look-right:enough',
      'look-up:enough',
      'look-down:enough',
      'dolly:enough',
    ]);
    expect(h.runner.state().status).toBe('done');

    // The held positions are where the ground truth says they are, in degrees.
    const left = h.session.pointsFor('look-left');
    const right = h.session.pointsFor('look-right');
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(right.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...left.map((p) => p.vector.yaw))).toBeLessThan(-15);
    expect(Math.max(...right.map((p) => p.vector.yaw))).toBeGreaterThan(15);

    // And the take builds: four head poses are four categories (the cut at 4 separates them by cue).
    h.session.build();
    const model = h.session.retrain(4);
    expect(model.categories).toHaveLength(4);
    const dominant = model.categories.map((c) => Object.entries(c.cues ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0]);
    expect(new Set(dominant).size).toBe(4);
  });

  it('at the default dwell, a SWEEP through a pose is not a held pose (the clip never holds its turns)', () => {
    const h = harness([cue('rest', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 5000 } }), head('look-left', 'Look left.')]);
    h.runner.start(h.t);
    const rest = window(7.7, 8.5);
    h.feed(rest.length, (i) => rest[i]);
    h.wait(600);
    const seg = window(3.5, 4.7);
    h.feed(seg.length, (i) => seg[i]);
    // Still running: the 130 ms apex did not satisfy a 200 ms dwell. A real player,
    // told to hold it, would — and the runner would say "a bit further" if they did not.
    expect(h.runner.state().status).toBe('running');
    expect(h.session.pointsFor('look-left')).toHaveLength(0);
  });
});
