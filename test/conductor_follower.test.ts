/**
 * The conductor's follower core as a factory (#557, #600 S7): `createConductorFollower` owns the
 * state the `conductor` node keeps between ticks and hands back the steps a tick is made of, so
 * the node's `make()` is wiring. The conducting golden (`conductor_golden.test.ts`) pins the
 * whole; this pins each step on its own, so a later change to one is caught where it happens.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createConductorFollower } from '@/nodes/features/conductor_follower';
import { DEFAULT_CONDUCTOR_DIAL, type ConductorDialParams } from '@/nodes/features/conductor.schema';

const ctx = (time: number, dt = 1 / 30): NodeContext => ({ tick: Math.round(time * 30), time, dt, resources: {} });
const on: ConductorDialParams = { ...DEFAULT_CONDUCTOR_DIAL, enabled: true };

describe('createConductorFollower', () => {
  it('resolveConfig: the dial overrides the build-time params, cached by reference; garbage falls back to them', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const raw = { enabled: true, beatsPerBar: 3 };
    const c = f.resolveConfig(raw);
    expect(c).toMatchObject({ enabled: true, beatsPerBar: 3, prior: DEFAULT_CONDUCTOR_DIAL.prior });
    expect(f.resolveConfig(raw)).toBe(c);
    expect(f.resolveConfig({ beatsPerBar: 'three' })).toEqual(DEFAULT_CONDUCTOR_DIAL);
    expect(f.resolveConfig(undefined)).toEqual(DEFAULT_CONDUCTOR_DIAL);
  });

  it('idleTick: off is a frozen beat, a silent score, no transport', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const out = f.idleTick(ctx(1), DEFAULT_CONDUCTOR_DIAL, 4);
    expect(out).toMatchObject({ beat: 0, bpm: 0, velocityScale: 0, enabled: false, leadsScore: false, transport: 'off', recordingTime: undefined });
    expect(out.time).toMatchObject({ t: 1, beat: 0, tempo: 0, beatsPerBar: 4, state: 'ready' });
  });

  it('beatsPerBar and markRatio: the dial without a score; beat, half, bar, and auto off the score is a beat', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    expect(f.beatsPerBar({ ...on, beatsPerBar: 3 })).toBe(3);
    expect(f.markRatio({ ...on, markLevel: 'beat' }, null, 0, 4)).toBe(1);
    expect(f.markRatio({ ...on, markLevel: 'half' }, null, 0, 4)).toBe(2);
    expect(f.markRatio({ ...on, markLevel: 'bar' }, null, 0, 3)).toBe(3);
    expect(f.markRatio({ ...on, markLevel: 'auto', conducts: 'recording' }, null, 0, 4)).toBe(1);
  });

  it('gridFor: the stroke grid is multiples of k from the top without a score', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    expect(f.gridFor(1)(2.2, Math.ceil)).toBe(3);
    expect(f.gridFor(2)(2.2, Math.ceil)).toBe(4);
    expect(f.gridFor(2)(2.9, Math.round)).toBe(2);
  });

  it('prepareFollower: made on first use, kept while the key holds, re-made when the source changes', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const a = f.prepareFollower(on, ctx(0));
    expect(f.prepareFollower(on, ctx(0.1))).toBe(a);
    const b = f.prepareFollower({ ...on, source: 'body' }, ctx(0.2));
    expect(b).not.toBe(a);
  });

  it('feedHands with no hand in frame free-runs the follower and starts nothing', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const ic = f.prepareFollower(on, ctx(0));
    const fed = f.feedHands({}, ctx(0.5), on, ic);
    expect(fed).toMatchObject({ stopped: false, started: false, released: false });
    expect(fed.s.anchors).toBe(0);
  });

  it('a tick before any stroke: the beat stays frozen and the time says so', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const ic = f.prepareFollower(on, ctx(0));
    const fed = f.feedHands({}, ctx(0.5), on, ic);
    const grid = f.gridFor(1);
    f.place(fed, fed.s, grid);
    const bpm = f.advanceBeat(on, ctx(0.5), fed.s, 1, grid, f.bodyHolding());
    expect(bpm).toBe(0);
    const time = f.timeOf(ctx(0.5), on, fed.s, bpm, false);
    expect(time).toMatchObject({ beat: 0, tempo: 0, period: Infinity, anchors: 0 });
  });

  it('emit: the velocity scale spans the dial\'s dynamics range; a recording leader exposes its time', () => {
    const f = createConductorFollower(DEFAULT_CONDUCTOR_DIAL);
    const c: ConductorDialParams = { ...on, dynMin: 0.2, dynMax: 1 };
    const time = f.timeOf(ctx(1), c, f.prepareFollower(c, ctx(1)).state(), 0, false);
    expect(f.emit({ time, bpm: 0, dynamics: 0.5, articulation: 0.5, enabled: true, c }).velocityScale).toBeCloseTo(0.6);
    const rec = f.emit({ time, bpm: 0, dynamics: 0.5, articulation: 0.5, enabled: true, c: { ...c, conducts: 'recording' } });
    expect(rec.recordingTime).toBe(time);
    expect(rec.leadsScore).toBe(false);
  });
});
