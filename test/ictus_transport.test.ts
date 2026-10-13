/**
 * The transport rules (#377, body-movement A5), pure: start on the first anchor after a
 * ready pose and an upbeat, hold when the stroke is overdue with the arm raised and the body
 * still, stop when the arm is dropped and still, and a stated pose replacing any rule's
 * geometry (the seam a personal pose category plugs into, B4).
 */
import { describe, expect, it } from 'vitest';
import { createTransport, TRANSPORT_DEFAULTS, type TransportInput, type TransportStep } from '@thoremin/ictus';

const FPS = 30;
const P = 0.6;
const RAISED = 0.9;
const DROPPED = -0.05;
const STILL = 1;
const MOVING = 20;

type Frame = Omit<TransportInput, 't'>;
/** Run a list of (seconds, frame) segments at 30 fps from `t0`; returns every step with its time. */
function run(tr: ReturnType<typeof createTransport>, segments: [number, Frame | ((t: number) => Frame)][], t0 = 0): (TransportStep & { t: number })[] {
  const out: (TransportStep & { t: number })[] = [];
  let t = t0;
  for (const [s, f] of segments) {
    const end = t + s;
    for (; t < end - 1e-9; t += 1 / FPS) {
      const frame = typeof f === 'function' ? f(t) : f;
      out.push({ ...tr.step({ t, ...frame }), t });
    }
  }
  return out;
}
const phases = (steps: TransportStep[]) => steps.map((s) => s.phase).filter((p, i, a) => i === 0 || p !== a[i - 1]);

/** A frame that delivers an anchor at its own time, every `P` seconds from `from`. */
const beating = (from: number, frame: Frame = { raise: 0.7, motion: MOVING, period: P }) => (t: number): Frame => {
  const k = Math.round((t - from) / P);
  return Math.abs(t - from - k * P) < 0.5 / FPS && k >= 0 ? { ...frame, anchor: t } : frame;
};

describe('the transport rules', () => {
  it('starts on the first anchor after the ready pose and the upbeat, and accepts nothing before', () => {
    const tr = createTransport();
    const steps = run(tr, [
      [1, beating(0.1, { raise: 0.3, motion: MOVING })], // walking in, lifting the arms: anchors, no ready
      [0.6, { raise: RAISED, motion: STILL }], // ready
      [0.2, { raise: RAISED, motion: MOVING }], // the upbeat
      [1.5, beating(1.85)],
    ]);
    expect(phases(steps)).toEqual(['idle', 'armed', 'prepared', 'running']);
    const accepted = steps.filter((s) => s.accept);
    expect(accepted[0].t).toBeGreaterThan(1.8);
    expect(steps.filter((s) => s.started).map((s) => s.t)).toEqual([accepted[0].t]);
    // Every anchor after the start is accepted.
    expect(accepted.length).toBeGreaterThanOrEqual(3);
  });

  it('the ready pose must last readyS, and a dropped arm disarms before the upbeat', () => {
    const tr = createTransport();
    const short = run(tr, [[TRANSPORT_DEFAULTS.readyS * 0.5, { raise: RAISED, motion: STILL }], [0.2, { raise: DROPPED, motion: STILL }]]);
    expect(phases(short)).toEqual(['idle']);
    const disarmed = run(tr, [[0.6, { raise: RAISED, motion: STILL }], [0.3, { raise: DROPPED, motion: 4 }]], 1);
    expect(phases(disarmed)).toEqual(['idle', 'armed', 'idle']);
  });

  it('between the ready pose and the upbeat the motion may pass through the band between still and moving', () => {
    const tr = createTransport();
    const steps = run(tr, [[0.6, { raise: RAISED, motion: STILL }], [0.3, { raise: 0.6, motion: 7 }], [0.1, { raise: 0.5, motion: MOVING }]]);
    expect(phases(steps)).toEqual(['idle', 'armed', 'prepared']);
  });

  it('past the upbeat with no downbeat it returns to waiting', () => {
    const tr = createTransport();
    const steps = run(tr, [[0.6, { raise: RAISED, motion: STILL }], [0.1, { raise: RAISED, motion: MOVING }], [TRANSPORT_DEFAULTS.prepareTimeoutS + 0.2, { raise: DROPPED, motion: STILL }]]);
    expect(phases(steps)).toEqual(['idle', 'armed', 'prepared', 'idle']);
  });

  const started = () => {
    const tr = createTransport();
    run(tr, [[0.6, { raise: RAISED, motion: STILL }], [0.1, { raise: RAISED, motion: MOVING }], [0.05, { raise: RAISED, motion: MOVING, anchor: 0.7 }]]);
    expect(tr.phase()).toBe('running');
    return tr;
  };

  it('holds after holdAfterPeriods with the arm raised and the body still, waiting from waitAfterPeriods; the next anchor releases', () => {
    const tr = started();
    const steps = run(tr, [[0.05, { raise: 0.7, motion: MOVING, anchor: 0.75, period: P }], [2, { raise: 0.7, motion: STILL, period: P }]], 0.75);
    const wait = steps.find((s) => s.waiting)!;
    const hold = steps.find((s) => s.hold)!;
    expect(wait.t - 0.75).toBeCloseTo(TRANSPORT_DEFAULTS.waitAfterPeriods * P, 1);
    expect(hold.t - 0.75).toBeCloseTo(TRANSPORT_DEFAULTS.holdAfterPeriods * P, 1);
    const release = tr.step({ t: 3, raise: 0.7, motion: MOVING, anchor: 2.98, period: P });
    expect(release).toMatchObject({ phase: 'running', accept: true, hold: false, started: false });
  });

  it('does not hold while the body moves (the prior free-runs), nor with the arm dropped', () => {
    const tr = started();
    const moving = run(tr, [[2, { raise: 0.7, motion: MOVING, period: P }]], 0.75);
    expect(moving.some((s) => s.hold || s.waiting)).toBe(false);
    const tr2 = started();
    const low = run(tr2, [[0.5, { raise: 0.3, motion: STILL, period: P }]], 0.75);
    expect(low.some((s) => s.hold)).toBe(false);
  });

  it('stops after stopAfterPeriods dropped and still, from running or holding, then waits for the ready pose again', () => {
    for (const before of [MOVING, STILL]) {
      const tr = started();
      run(tr, [[1.5, { raise: 0.7, motion: before, period: P }]], 0.75);
      const steps = run(tr, [[0.3, { raise: 0.1, motion: MOVING, period: P }], [2, { raise: DROPPED, motion: STILL, period: P }]], 2.25);
      const stop = steps.find((s) => s.stopped)!;
      expect(stop.phase).toBe('idle');
      const dropFrom = steps.find((s) => s.t >= 2.55 - 1e-9)!.t;
      expect(stop.t - dropFrom).toBeCloseTo(TRANSPORT_DEFAULTS.stopAfterPeriods * P, 1);
      expect(steps.filter((s) => s.stopped)).toHaveLength(1);
    }
  });

  it('before a stroke period is known the fallback period is used', () => {
    const tr = started();
    const steps = run(tr, [[2, { raise: DROPPED, motion: STILL }]], 0.75);
    expect(steps.find((s) => s.stopped)!.t - 0.75).toBeCloseTo(TRANSPORT_DEFAULTS.stopAfterPeriods * TRANSPORT_DEFAULTS.fallbackPeriodS, 1);
  });

  it('a stated pose replaces the rule geometry (the override seam), keeping the timing', () => {
    // Ready from a category with the arms down and moving.
    const tr = createTransport();
    const armed = run(tr, [[0.6, { raise: DROPPED, motion: 4, pose: { ready: true } }]]);
    expect(phases(armed)).toEqual(['idle', 'armed']);
    // A stated `ready: false` vetoes the geometry.
    const tr2 = createTransport();
    expect(phases(run(tr2, [[1, { raise: RAISED, motion: STILL, pose: { ready: false } }]]))).toEqual(['idle']);
    // A cut-off category with the arm raised and moving stops; a hold category holds.
    const tr3 = started();
    const stop = run(tr3, [[1, { raise: RAISED, motion: MOVING, period: P, pose: { cutoff: true } }]], 0.75);
    expect(stop.some((s) => s.stopped)).toBe(true);
    const tr4 = started();
    const hold = run(tr4, [[1.5, { raise: DROPPED, motion: MOVING, period: P, pose: { hold: true } }]], 0.75);
    expect(hold.some((s) => s.hold)).toBe(true);
  });

  it('run() enters running as if an anchor had been accepted (a live change of source)', () => {
    const tr = createTransport();
    tr.run(5);
    expect(tr.phase()).toBe('running');
    expect(tr.step({ t: 5.1, raise: 0.7, motion: MOVING, anchor: 5.1, period: P })).toMatchObject({ accept: true, started: false });
  });

  it('configure() changes thresholds live and keeps the phase', () => {
    const tr = started();
    tr.configure({ holdAfterPeriods: 4 });
    expect(tr.phase()).toBe('running');
    const steps = run(tr, [[3, { raise: 0.7, motion: STILL, period: P }]], 0.75);
    expect(steps.find((s) => s.hold)!.t - 0.7).toBeCloseTo(4 * P, 1);
  });
});
