/**
 * The sequence runner (#263) — scripted training over a target list, headless.
 *
 * Every case drives the runner on a deterministic clock: lead-in, per-target countdown,
 * settle (uncaptured) then capture, the injected verdict, loops, skip, redo, stop. The
 * timings are read back from `state()` exactly as a panel would show them (the next
 * target, the seconds left), so a UI that displays what this reports is correct by
 * construction.
 */
import { describe, expect, it } from 'vitest';
import {
  SEQUENCE_PHRASES,
  SequenceSpecSchema,
  createSequenceRunner,
  sayFor,
  sequenceDurationMs,
  sequenceLength,
  sequenceOf,
  type FeatureVector,
  type SequenceEvent,
  type TargetCheck,
} from '@thoremin/sdk/enroll';

const v = (x: number): FeatureVector => ({ x });

/** A three-note sequence: 1 s lead-in, 1 s countdown, 0.2 s settle, 1 s hold. */
const spec = sequenceOf(['D5', 'E5', 'F#5'], { leadInMs: 1000, countdownMs: 1000, settleMs: 200, holdMs: 1000 });

/** Run a runner from `t0`, pushing a frame every `dt` ms until `until`. */
function drive(runner: ReturnType<typeof createSequenceRunner>, t0: number, until: number, dt = 50, value = (t: number) => v(t)) {
  for (let t = t0; t <= until; t += dt) runner.push(value(t), t);
}

describe('the sequence runner', () => {
  it('defaults the spec and measures its length and duration', () => {
    const s = SequenceSpecSchema.parse({ targets: [{ label: 'D5' }, { label: 'E5', holdMs: 4000 }], loops: 2 });
    expect(s.leadInMs).toBe(3000);
    expect(s.countdownMs).toBe(3000);
    expect(s.holdMs).toBe(2300);
    expect(sequenceLength(s)).toBe(4);
    // lead-in + 2 loops x (countdown + hold(D5) + countdown + hold(E5))
    expect(sequenceDurationMs(s)).toBe(3000 + 2 * (3000 + 2300 + 3000 + 4000));
    expect(() => SequenceSpecSchema.parse({ targets: [] })).toThrow();
    expect(() => SequenceSpecSchema.parse({ targets: [{ label: '  ' }] })).toThrow();
  });

  it('walks lead-in, countdown, hold for each target, and says what a voice would', () => {
    const runner = createSequenceRunner({ spec });
    const events: SequenceEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.start(0);
    expect(runner.state().phase).toBe('lead-in');
    expect(runner.state().next?.label).toBe('D5');
    expect(runner.state().countdown).toBe(1);

    runner.tick(999);
    expect(runner.state().phase).toBe('lead-in');
    runner.tick(1000);
    let s = runner.state();
    expect(s.phase).toBe('countdown');
    expect(s.current?.label).toBe('D5');
    expect(s.next?.label).toBe('E5');
    expect(s.remainingMs).toBe(1000);
    expect(s.countdown).toBe(1);

    runner.tick(2000);
    s = runner.state();
    expect(s.phase).toBe('hold');
    expect(s.capturing).toBe(false); // the settle
    runner.push(v(1), 2100);
    expect(runner.state().samples).toBe(0);
    runner.push(v(2), 2200);
    expect(runner.state().samples).toBe(1);
    expect(runner.state().capturing).toBe(true);
    drive(runner, 2250, 2950);
    expect(runner.state().samples).toBe(16);

    // The hold ends at 3000: the result is in, the next countdown has begun.
    runner.tick(3000);
    s = runner.state();
    expect(s.phase).toBe('countdown');
    expect(s.current?.label).toBe('E5');
    expect(s.next?.label).toBe('F#5');
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ loop: 0, index: 0, label: 'D5', outcome: 'held' });
    expect(s.results[0].samples).toHaveLength(16);
    expect(s.progress).toBeCloseTo(1 / 3);

    const says = events.map((e) => ('say' in e ? e.say : e.type));
    expect(says.slice(0, 4)).toEqual([SEQUENCE_PHRASES.leadIn, sayFor.next('D5'), sayFor.hold('D5'), SEQUENCE_PHRASES.held]);
  });

  it('finishes with a done event, the last target reporting no next', () => {
    const runner = createSequenceRunner({ spec });
    const events: SequenceEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.start(0);
    // Last target's countdown begins at 1000 + 2 x 2000 = 5000; its hold at 6000; ends 7000.
    drive(runner, 0, 5000);
    expect(runner.state().current?.label).toBe('F#5');
    expect(runner.state().next).toBeNull();
    drive(runner, 5050, 7000);
    const s = runner.state();
    expect(s.phase).toBe('done');
    expect(s.index).toBe(-1);
    expect(s.results.map((r) => r.label)).toEqual(['D5', 'E5', 'F#5']);
    expect(s.results.every((r) => r.outcome === 'held')).toBe(true);
    expect(s.progress).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', say: SEQUENCE_PHRASES.done, t: 7000 });
    expect(sequenceDurationMs(spec)).toBe(7000);
  });

  it('reports an empty hold when nothing was pushed, and does not stall on it', () => {
    const runner = createSequenceRunner({ spec });
    runner.start(0);
    for (let t = 0; t <= 3000; t += 100) runner.tick(t);
    const s = runner.state();
    expect(s.results[0]).toMatchObject({ label: 'D5', outcome: 'empty', verdict: null });
    expect(s.phase).toBe('countdown');
    expect(s.current?.label).toBe('E5');
  });

  it('asks the injected check and carries its verdict, saying what it looked like', () => {
    const check: TargetCheck = (label, samples) =>
      samples.length === 0 ? { kind: 'unknown' } : label === 'E5' ? { kind: 'mismatch', read: 'D5', margin: 2.5 } : { kind: 'ok' };
    const runner = createSequenceRunner({ spec, check });
    const says: string[] = [];
    runner.subscribe((e) => {
      if (e.type === 'target-end') says.push(e.say);
    });
    runner.start(0);
    drive(runner, 0, 7000);
    const r = runner.state().results;
    expect(r[0].verdict).toEqual({ kind: 'ok' });
    expect(r[1].verdict).toEqual({ kind: 'mismatch', read: 'D5', margin: 2.5 });
    expect(r[2].verdict).toEqual({ kind: 'ok' });
    expect(says).toEqual([SEQUENCE_PHRASES.held, sayFor.mismatch('D5'), SEQUENCE_PHRASES.held]);
  });

  it('loops through the list, next wrapping into the next loop', () => {
    const two = sequenceOf(['A', 'B'], { leadInMs: 0, countdownMs: 500, settleMs: 0, holdMs: 500, loops: 2 });
    const runner = createSequenceRunner({ spec: two });
    runner.start(0);
    expect(runner.state()).toMatchObject({ phase: 'countdown', loop: 0, index: 0 });
    drive(runner, 0, 1000);
    // B's countdown (loop 0): next is A of loop 1.
    expect(runner.state()).toMatchObject({ phase: 'countdown', loop: 0, index: 1 });
    expect(runner.state().next?.label).toBe('A');
    drive(runner, 1050, 2000);
    expect(runner.state()).toMatchObject({ phase: 'countdown', loop: 1, index: 0 });
    drive(runner, 2050, 4000);
    const s = runner.state();
    expect(s.phase).toBe('done');
    expect(s.results.map((r) => `${r.loop}:${r.label}`)).toEqual(['0:A', '0:B', '1:A', '1:B']);
    expect(sequenceLength(two)).toBe(4);
  });

  it('skips a target without keeping samples, and redoes one from its countdown', () => {
    const runner = createSequenceRunner({ spec });
    runner.start(0);
    drive(runner, 0, 2500); // inside D5's hold, with samples
    expect(runner.state().samples).toBeGreaterThan(0);
    runner.skip(2500);
    let s = runner.state();
    expect(s.results[0]).toMatchObject({ label: 'D5', outcome: 'skipped' });
    expect(s.results[0].samples).toHaveLength(0);
    expect(s).toMatchObject({ phase: 'countdown', index: 1 });

    // Redo E5 while it is being held: back to its countdown, samples dropped.
    drive(runner, 2550, 4000);
    expect(runner.state()).toMatchObject({ phase: 'hold', index: 1 });
    runner.redo(4000);
    s = runner.state();
    expect(s).toMatchObject({ phase: 'countdown', index: 1, samples: 0 });
    expect(s.remainingMs).toBe(1000);
    // Its eventual result replaces nothing (it had none) and appears once.
    drive(runner, 4050, 6000);
    expect(runner.state().results.filter((r) => r.label === 'E5')).toHaveLength(1);
  });

  it('redoes the last target after the end, replacing its result', () => {
    const one = sequenceOf(['G4'], { leadInMs: 0, countdownMs: 0, settleMs: 0, holdMs: 500 });
    const runner = createSequenceRunner({ spec: one });
    runner.start(0);
    expect(runner.state().phase).toBe('hold'); // zero lead-in and countdown go straight in
    drive(runner, 0, 500, 50, () => v(1));
    expect(runner.state().phase).toBe('done');
    expect(runner.state().results[0].samples.every((s) => s.x === 1)).toBe(true);
    runner.redo(1000);
    expect(runner.state()).toMatchObject({ phase: 'hold', index: 0 });
    drive(runner, 1000, 1500, 50, () => v(2));
    const r = runner.state().results;
    expect(r).toHaveLength(1);
    expect(r[0].samples.every((s) => s.x === 2)).toBe(true);
  });

  it('stops, keeping results, and ignores pushes afterwards', () => {
    const runner = createSequenceRunner({ spec });
    const events: SequenceEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.start(0);
    drive(runner, 0, 3500);
    runner.stop(3500);
    expect(runner.state().phase).toBe('stopped');
    expect(runner.state().results).toHaveLength(1);
    runner.push(v(9), 4000);
    runner.tick(9000);
    expect(runner.state().phase).toBe('stopped');
    expect(events.at(-1)).toEqual({ type: 'stopped', t: 3500 });
  });

  it('honours a per-target hold length', () => {
    const s = SequenceSpecSchema.parse({ targets: [{ label: 'A', holdMs: 300 }, { label: 'B' }], leadInMs: 0, countdownMs: 0, settleMs: 0, holdMs: 1000 });
    const runner = createSequenceRunner({ spec: s });
    runner.start(0);
    expect(runner.state().remainingMs).toBe(300);
    drive(runner, 0, 300);
    expect(runner.state()).toMatchObject({ phase: 'hold', index: 1, remainingMs: 1000 });
  });
});
