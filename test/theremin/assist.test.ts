/**
 * The physical theremin's assistance chain (`src/slices/theremin/lib/assist.ts`): level 0 is an
 * exact pass-through; correction pulls toward the semitones or the scale, with hysteresis; the
 * smoothing quiets jitter; the vibrato aid keeps a wrist vibrato through a full correction.
 */
import { describe, it, expect } from 'vitest';
import { THEREMIN } from '../helpers/extensions';
import { assistDefaults, createAssistChain, effectiveAssist, nearestInScale, pullToward, wobbleStats, ASSIST_TUNING, type AssistSettings } from '@/slices/theremin/lib/assist';

const DT = 1 / 30;
const OFF: AssistSettings = { level: 0, custom: false, snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 0 };
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** A deterministic pseudo-random stream (no Math.random in tests). */
function noise(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31 - 0.5;
  };
}

const run = (input: number[], settings: AssistSettings, scale = C_MAJOR) => {
  const chain = createAssistChain();
  return input.map((p) => chain.step(p, DT, effectiveAssist(settings), scale));
};

describe.runIf(THEREMIN)('assistance level 0', () => {
  it('turns every stage off', () => {
    expect(effectiveAssist({ ...OFF, custom: true, correction: 1, smoothing: 1, vibratoAid: 1 })).toEqual({ snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 0 });
  });

  it('is an exact pass-through, vibrato and jitter included', () => {
    const rnd = noise(7);
    const input = Array.from({ length: 300 }, (_, i) => 60 + 5 * Math.sin(i / 40) + 0.4 * Math.sin(2 * Math.PI * 6 * i * DT) + rnd());
    const out = run(input, OFF);
    out.forEach((r, i) => expect(r.pitch).toBe(input[i]));
    expect(out.every((r) => r.target === null)).toBe(true);
  });
});

describe.runIf(THEREMIN)('the level drives the stages', () => {
  it('every stage grows with the level, and the snap moves to the scale past the middle', () => {
    const lo = assistDefaults(0.2);
    const hi = assistDefaults(0.9);
    expect(hi.correction).toBeGreaterThan(lo.correction);
    expect(hi.smoothing).toBeGreaterThan(lo.smoothing);
    expect(hi.vibratoAid).toBeGreaterThan(lo.vibratoAid);
    expect(lo.snap).toBe('chromatic');
    expect(hi.snap).toBe('scale');
  });

  it('a tuned stage is the player\'s own (custom), the level still gating it', () => {
    const s: AssistSettings = { level: 0.3, custom: true, snap: 'scale', correction: 0.9, smoothing: 0, vibratoAid: 0 };
    expect(effectiveAssist(s).correction).toBe(0.9);
    expect(effectiveAssist({ ...s, custom: false }).correction).toBeCloseTo(0.3);
  });
});

describe.runIf(THEREMIN)('pitch correction', () => {
  it('pulls toward the nearest semitone or scale note, by its strength', () => {
    expect(pullToward(60.4, 60, 0)).toBe(60.4);
    expect(pullToward(60.4, 60, 1)).toBe(60);
    expect(pullToward(60.4, 60, 0.5)).toBeCloseTo(60.2);
    expect(nearestInScale(61.2, C_MAJOR)).toBe(62); // C# is not in C major: D is nearer than C
    expect(nearestInScale(73.4, C_MAJOR)).toBe(74);
  });

  it('full correction to the scale lands on scale notes only', () => {
    const input = Array.from({ length: 120 }, (_, i) => 60 + i / 10);
    const out = run(input, { level: 1, custom: true, snap: 'scale', correction: 1, smoothing: 0, vibratoAid: 0 });
    for (const r of out) expect(C_MAJOR).toContain(((Math.round(r.pitch) % 12) + 12) % 12);
    for (const r of out) expect(Math.abs(r.pitch - Math.round(r.pitch))).toBeLessThan(1e-9);
  });

  it('holds its note through a hand on the boundary (hysteresis): no warble between two notes', () => {
    const rnd = noise(3);
    const input = Array.from({ length: 200 }, () => 60.5 + 0.08 * rnd());
    const out = run(input, { level: 1, custom: true, snap: 'chromatic', correction: 1, smoothing: 0, vibratoAid: 0 });
    const changes = out.slice(1).filter((r, i) => r.target !== out[i].target).length;
    expect(changes).toBe(0);
  });
});

describe.runIf(THEREMIN)('smoothing', () => {
  it('quiets a held hand\'s jitter, and follows a move', () => {
    const rnd = noise(11);
    const held = Array.from({ length: 150 }, () => 64 + 0.3 * rnd());
    const out = run(held, { level: 1, custom: true, snap: 'chromatic', correction: 0, smoothing: 0.8, vibratoAid: 0 });
    const rms = (xs: number[]) => Math.sqrt(xs.slice(1).reduce((a, x, i) => a + (x - xs[i]) ** 2, 0) / (xs.length - 1));
    expect(rms(out.map((r) => r.pitch))).toBeLessThan(rms(held) / 3);
    const move = [...Array(30).fill(60), ...Array(60).fill(67)];
    const moved = run(move, { level: 1, custom: true, snap: 'chromatic', correction: 0, smoothing: 0.8, vibratoAid: 0 });
    expect(moved[moved.length - 1].pitch).toBeGreaterThan(66.8);
  });
});

describe.runIf(THEREMIN)('the vibrato aid', () => {
  const vibrato = (n: number, rateHz = 6, depth = 0.4) => Array.from({ length: n }, (_, i) => 64.1 + depth * Math.sin(2 * Math.PI * rateHz * i * DT));
  const depthOf = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / 2;

  it('detects a 6 Hz wrist vibrato, and not the tracker\'s jitter', () => {
    const v = run(vibrato(90), { level: 1, custom: true, snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 1 });
    expect(v[v.length - 1].vibrato).toBe(1);
    const rnd = noise(5);
    const j = run(Array.from({ length: 90 }, () => 64 + 0.4 * rnd()), { level: 1, custom: true, snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 1 });
    expect(Math.max(...j.map((r) => r.vibrato))).toBeLessThan(0.5);
    // And not a steady glide.
    const g = run(Array.from({ length: 90 }, (_, i) => 60 + i * 0.1), { level: 1, custom: true, snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 1 });
    expect(Math.max(...g.map((r) => r.vibrato))).toBeLessThan(0.5);
  });

  it('a full correction flattens the vibrato without the aid, and keeps it with the aid', () => {
    const input = vibrato(120);
    const tail = (xs: { pitch: number }[]) => xs.slice(60).map((r) => r.pitch);
    const without = run(input, { level: 1, custom: true, snap: 'chromatic', correction: 1, smoothing: 0.5, vibratoAid: 0 });
    const withAid = run(input, { level: 1, custom: true, snap: 'chromatic', correction: 1, smoothing: 0.5, vibratoAid: 1 });
    expect(depthOf(tail(without))).toBeLessThan(0.05);
    expect(depthOf(tail(withAid))).toBeGreaterThan(0.35);
    // Centred on the corrected note.
    const mean = tail(withAid).reduce((a, x) => a + x, 0) / 60;
    expect(Math.abs(mean - 64)).toBeLessThan(0.15);
  });

  it('measures the vibrato\'s rate from its period', () => {
    const w = vibrato(24, 5).map((p) => ({ dt: DT, w: p - 64.1 }));
    const st = wobbleStats(w, ASSIST_TUNING);
    expect(st.rate).toBeGreaterThan(4.2);
    expect(st.rate).toBeLessThan(6);
    expect(st.periodicity).toBeGreaterThan(0.8);
  });
});
