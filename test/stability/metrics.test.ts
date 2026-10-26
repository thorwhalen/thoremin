/**
 * The stability metrics on hand-made timelines: each counts the thing it names, and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { heldFromMotion, latencyStats, stabilityMetrics, type Timeline } from '../../scripts/stability/lib_metrics';

const tl = (out: (string | null)[], over: Partial<Timeline> = {}): Timeline => ({
  t: out.map((_, i) => i / 30),
  out,
  hand: out.map(() => true),
  held: out.map(() => true),
  ...over,
});
const rep = <T,>(x: T, n: number): T[] => Array(n).fill(x);

describe('stability metrics', () => {
  it('a held chord that never changes scores zero everywhere', () => {
    const m = stabilityMetrics(tl(rep('C', 60)));
    expect([m.changes, m.flickers, m.shortChords, m.blips, m.spuriousNoHand]).toEqual([0, 0, 0, 0, 0]);
    expect(m.heldS).toBeCloseTo(2);
  });

  it('counts a stutter (A, B for two frames, A) as one flicker and two changes while held', () => {
    const m = stabilityMetrics(tl([...rep('A', 20), 'B', 'B', ...rep('A', 20)]));
    expect(m.flickers).toBe(1);
    expect(m.changesWhileHeld).toBe(2);
    expect(m.changesPerHeldS).toBeCloseTo(2 / m.heldS);
  });

  it('a chord of 8 frames is a short chord, not a flicker', () => {
    const m = stabilityMetrics(tl([...rep('A', 20), ...rep('B', 8), ...rep('C', 20)]));
    expect([m.flickers, m.shortChords]).toEqual([0, 1]);
  });

  it('a sound of two frames between silences is a blip; a release to silence is not a flicker', () => {
    const m = stabilityMetrics(tl([...rep(null, 10), 'x', 'x', ...rep(null, 10), ...rep('C', 20), null, null]));
    expect(m.blips).toBe(1);
    expect(m.flickers).toBe(1); // the blip itself is a short run; the trailing release is not
  });

  it('a chord that starts with no hand seen is spurious; one that stops is not', () => {
    const hand = [...rep(true, 10), ...rep(false, 20)];
    const m = stabilityMetrics(tl([...rep('C', 10), ...rep(null, 10), ...rep('D', 10)], { hand, held: hand }));
    expect(m.spuriousNoHand).toBe(1);
  });

  it('flickers in the first half second after the hand appears are entry flickers', () => {
    const hand = [...rep(false, 10), ...rep(true, 40)];
    const m = stabilityMetrics(tl([...rep(null, 10), 'E', 'E', ...rep('C', 38)], { hand }));
    expect([m.flickers, m.entryFlickers]).toEqual([1, 1]);
  });

  it('latency runs from the intended change to the output settling on it; a target never reached is missed', () => {
    const target = [...rep('A', 30), ...rep('B', 30), ...rep('C', 30)];
    const out = [...rep('A', 30), ...rep('A', 9), ...rep('B', 21), ...rep('B', 30)];
    const l = latencyStats(tl(out, { target }));
    expect(l.n).toBe(3);
    expect(l.missed).toBe(1);
    expect(l.maxMs).toBeCloseTo(300); // B settled 9 frames after it was meant; A at once
    expect(l.p90Ms).toBeCloseTo(300);
  });

  it('a hand is held while its point moves slower than the limit', () => {
    const t = Array.from({ length: 20 }, (_, i) => i / 30);
    const still = t.map(() => ({ x: 0.5, y: 0.5 }));
    const moving = t.map((s) => ({ x: s, y: 0.5 }));
    expect(heldFromMotion(t, still, { maxSpeed: 0.05 }).slice(5).every(Boolean)).toBe(true);
    expect(heldFromMotion(t, moving, { maxSpeed: 0.05 }).some(Boolean)).toBe(false);
  });
});
