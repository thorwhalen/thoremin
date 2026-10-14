/**
 * ictus `createDanceLead` (#380, body-movement A8): a score's beat following a dancer's
 * pulse, by the dancer's loose law. Known answers from scripted pulses; the real dancer
 * is `test/dance_orchestra.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { createDanceLead, UNKNOWN_PULSE, type DanceLeadState, type PulseState } from '@thoremin/ictus';

const HZ = 30;

/** A steady dancer: one cycle every `period` s, phase 0 at `t0`. */
function pulseAt(t: number, period: number, t0 = 0, confidence = 0.8): PulseState {
  const beat = (t - t0) / period;
  const whole = Math.floor(beat);
  return {
    ...UNKNOWN_PULSE,
    t,
    beat,
    phase: beat - whole,
    tempo: 60 / period,
    period,
    confidence,
    nextBeatAt: t + (whole + 1 - beat) * period,
    state: 'running',
    // The fitted cycles: one at every phase 0 (the count, and the last one's time).
    anchors: whole,
    lastAnchorAt: t0 + whole * period,
    level: period,
    strength: 0.7,
    candidates: [{ period, r: 0.7 }],
  };
}

function run(seconds: number, pulse: (t: number) => PulseState, marked = 120, from = 0, lead = createDanceLead()): DanceLeadState[] {
  const out: DanceLeadState[] = [];
  for (let i = Math.round(from * HZ); i < Math.round(seconds * HZ); i++) out.push(lead.step({ t: i / HZ, pulse: pulse(i / HZ), marked }));
  return out;
}

/** The score's position in its 4-beat bar at each dancer cycle start: R of those phases. */
function barR(states: DanceLeadState[], cycleStarts: number[]): number {
  const ph = cycleStarts.map((t) => {
    const s = states.find((x) => x.t >= t - 1e-9)!;
    return (2 * Math.PI * (((s.beat % 4) + 4) % 4)) / 4;
  });
  return Math.hypot(ph.reduce((a, x) => a + Math.cos(x), 0), ph.reduce((a, x) => a + Math.sin(x), 0)) / ph.length;
}

describe('createDanceLead', () => {
  it('stays silent until the relation has persisted, then starts on the next cycle, on a downbeat', () => {
    // 2 s cycles against 120 bpm: one cycle is a bar (k = 4), at the marked tempo.
    const states = run(12, (t) => pulseAt(t, 2, 0.3));
    expect(states.filter((s) => s.t < 2.9).every((s) => !s.started && s.tempo === 0)).toBe(true);
    const start = states.findIndex((s) => s.started);
    // Followed at 3 s (persisted), then armed until the cycle start at 4.3 s.
    expect(states[start].t).toBeGreaterThan(4.29);
    expect(states[start].t).toBeLessThan(4.3 + 1.5 / HZ);
    expect(states[start].beat).toBeLessThan(0.1);
    expect(states[start].ratio).toBe(4);
    expect(states.at(-1)!.tempo).toBeCloseTo(120, 0);
  });

  it('follows a dancer 3 % off the marked tempo, keeping the bars on the cycles', () => {
    const period = 2 / 1.03;
    const states = run(40, (t) => pulseAt(t, period, 0.7));
    const late = states.filter((s) => s.t >= 15);
    const mean = late.reduce((a, s) => a + s.tempo, 0) / late.length;
    expect(mean).toBeCloseTo(123.6, 0);
    expect(late.every((s) => s.mode === 'following' && Math.abs(s.phaseError) < 0.05)).toBe(true);
    const starts: number[] = [];
    for (let c = 0.7; c < 40; c += period) if (c >= 15) starts.push(c);
    expect(barR(states, starts)).toBeGreaterThan(0.99);
  });

  it('never leaves the clamp: a dancer 12 % fast plays the score 10 % fast', () => {
    const states = run(30, (t) => pulseAt(t, 2 / 1.12, 0.2));
    const started = states.filter((s) => s.started);
    expect(started.length).toBeGreaterThan(0);
    expect(started.every((s) => s.tempo >= 108 - 1e-9 && s.tempo <= 132 + 1e-9)).toBe(true);
    expect(started.at(-1)!.tempo).toBeCloseTo(132, 6);
  });

  it('a dancer who pauses does not stop the piece: the tempo holds, and is followed again', () => {
    const lead = createDanceLead();
    const period = 2 / 1.04;
    const moving = (t: number) => pulseAt(t, period, 0.1);
    const before = run(20, moving, 120, 0, lead);
    const held = before.at(-1)!.tempo;
    const paused = run(30, (t) => ({ ...moving(t), confidence: 0.05 }), 120, 20, lead);
    expect(paused.every((s) => s.started && s.mode === 'holding' && Math.abs(s.tempo - held) < 0.5)).toBe(true);
    for (let i = 1; i < paused.length; i++) expect(paused[i].beat).toBeGreaterThan(paused[i - 1].beat);
    const after = run(45, moving, 120, 30, lead);
    expect(after.at(-1)!.mode).toBe('following');
    expect(Math.abs(after.at(-1)!.phaseError)).toBeLessThan(0.1);
  });

  it('a dancer far from the marked tempo is not followed: the piece never starts', () => {
    // 1.25 s cycles are 2.5 beats at 120 bpm: two beats is 20 % slow, three 20 % fast.
    const states = run(20, (t) => pulseAt(t, 1.25));
    expect(states.every((s) => !s.started)).toBe(true);
  });

  it('the phase offset puts the cycle start that many beats after a grid beat', () => {
    const lead = createDanceLead({ phaseOffset: 1 });
    const states = run(30, (t) => pulseAt(t, 2, 0.5), 120, 0, lead);
    // Cycle starts at 0.5 + 2n: the score should read beat 1 of its bar there.
    for (const t of [20.5, 24.5, 28.5]) {
      const s = states.find((x) => x.t >= t - 1e-9)!;
      expect(((s.beat % 4) + 4) % 4).toBeCloseTo(1, 1);
    }
  });

  it('a pause while armed disarms: the start is on a cycle start after the dancer resumes, never mid-cycle', () => {
    const lead = createDanceLead();
    // Armed once the relation has persisted (3 s), then a pause before the next cycle.
    run(3.5, (t) => pulseAt(t, 2, 0.05), 120, 0, lead);
    expect(lead.state().mode).toBe('armed');
    run(8, (t) => ({ ...pulseAt(t, 2, 0.05), confidence: 0.05 }), 120, 3.5, lead);
    expect(lead.state().started).toBe(false);
    // The dancer resumes 0.6 of a cycle into a cycle (the follower re-anchored elsewhere).
    const resumed = run(14, (t) => pulseAt(t, 2, 2.8), 120, 8, lead);
    const first = resumed.find((s) => s.started)!;
    expect(first.t).toBeGreaterThan(8.7);
    expect(first.beat).toBeLessThan(0.1);
    // Started on a cycle start of the resumed dance (2.8 + 2n).
    expect(Math.abs(((first.t - 2.8) / 2) % 1)).toBeLessThan(0.05);
  });

  it("after the dancer's bar jumps, the phase law walks the score back onto the cycles (none: the offset stays)", () => {
    // 2.06 s cycles (a dancer 3 % slow); at 20 s the dance jumps half a cycle (a seam).
    const period = 2.06;
    const pulse = (t: number) => pulseAt(t, period, t < 20 ? 0.2 : 0.2 + period / 2);
    const barAt = (states: DanceLeadState[], t: number) => {
      const s = states.find((x) => x.t >= t - 1e-9)!;
      return ((s.beat % 4) + 4) % 4;
    };
    const starts = (from: number, to: number) => {
      const out: number[] = [];
      for (let n = 0; 0.2 + period / 2 + n * period < to; n++) if (0.2 + period / 2 + n * period >= from) out.push(0.2 + period / 2 + n * period);
      return out;
    };
    const law = run(70, pulse);
    const none = run(70, pulse, 120, 0, createDanceLead({ maxCorrection: 0 }));
    expect(barR(law, starts(50, 70))).toBeGreaterThan(0.99);
    // Back on the bar: the cycle start reads the first beat again.
    const b = barAt(law, starts(60, 70)[0]);
    expect(Math.min(b, 4 - b)).toBeLessThan(0.1);
    // Without the phase law the tempo still follows, but the bar stays half off.
    const off = barAt(none, starts(60, 70)[0]);
    expect(Math.abs(off - 2)).toBeLessThan(0.3);
  });

  it('reset stops the piece and starts again from the beat given', () => {
    const lead = createDanceLead();
    run(10, (t) => pulseAt(t, 2), 120, 0, lead);
    expect(lead.state().started).toBe(true);
    lead.reset(8);
    expect(lead.state().started).toBe(false);
    const again = run(20, (t) => pulseAt(t, 2), 120, 10, lead);
    const first = again.find((s) => s.started)!;
    expect(first.beat).toBeGreaterThanOrEqual(8);
    expect(first.beat).toBeLessThan(8.1);
  });
});

describe('the tempo follows a settled period only (#464)', () => {
  // A dancer stepping a bar every 2.06 s against 120 bpm (2 s bars): 3 % slow, inside what
  // the phase law alone can follow.
  const P = 2.06;
  const tempoAt = (states: DanceLeadState[], t: number) => states.find((s) => s.t >= t - 1e-9)!.tempo;

  it('a sure pulse: the tempo follows the dancer from the start (as before)', () => {
    const states = run(20, (t) => pulseAt(t, P, 0.3, 0.8));
    const start = states.find((s) => s.started)!;
    expect(start.tempo).toBeLessThan(120 * 0.99);
    expect(tempoAt(states, 18)).toBeCloseTo((4 * 60) / P, 0);
  });

  it('a trusted but unsure pulse: the marked tempo, bent by the phase law only, until three cycles are followed', () => {
    const states = run(30, (t) => pulseAt(t, P, 0.3, 0.3));
    const start = states.findIndex((s) => s.started);
    const t0 = states[start].t;
    // Until the fourth cycle start, the tempo is the marked one times the phase correction
    // (at most 5 %), never the smoothed dancer's rate on its own.
    const early = states.filter((s) => s.started && s.t < t0 + 3 * P - 0.1);
    expect(early.every((s) => Math.abs(s.rate - 1) < 1e-9)).toBe(true);
    // ...and then it follows the dancer.
    expect(tempoAt(states, 28)).toBeCloseTo((4 * 60) / P, 0);
  });

  it.each([0.08, 0.1, -0.1])('an unsure dancer %s off the marked tempo stays within 0.25 beat of the grid (the phase-error handover)', (off) => {
    // A step the marked tempo does not suit, at a confidence that never reaches 0.4: the
    // lead hands the tempo over once the cycle is 0.2 beat off, so the error never builds
    // up through the three cycles (at the clamp's edge, 10 %, it would stay).
    const period = 2 / (1 - off);
    const states = run(90, (t) => pulseAt(t, period, 0.3, 0.3));
    const starts = Array.from({ length: 45 }, (_, j) => 0.3 + j * period).filter((t) => t < 89 && states[Math.floor(t * HZ)].started);
    expect(starts.length).toBeGreaterThan(20);
    for (const t of starts) {
      const s = states[Math.floor(t * HZ)];
      const x = (s.beat + ((t - s.t) * s.tempo) / 60) / 4;
      expect(Math.abs(x - Math.round(x)) * 4).toBeLessThan(0.25);
    }
  });

  it('the confidence reaching the threshold hands the tempo to the dancer at once', () => {
    const states = run(20, (t) => pulseAt(t, P, 0.3, t < 9 ? 0.3 : 0.5));
    const at = states.filter((s) => s.started && s.t > 9);
    expect(at.some((s) => s.rate < 0.99)).toBe(true);
    const before = states.filter((s) => s.started && s.t < 9);
    expect(before.every((s) => s.rate === 1)).toBe(true);
  });
});

describe('written fermatas and the end of the piece under a dancer (#463)', () => {
  // 2 s cycles against 120 bpm: one cycle is a bar (k = 4), at the marked tempo.
  const P = 2;
  const steps = (seconds: number, input: { fermatas?: number[]; end?: number }) => {
    const lead = createDanceLead();
    const out: DanceLeadState[] = [];
    for (let i = 0; i < Math.round(seconds * HZ); i++) out.push(lead.step({ t: i / HZ, pulse: pulseAt(i / HZ, P, 0.3), marked: 120, ...input }));
    return out;
  };
  /** Beats off the bar line at each of the dancer's cycle starts once started (not during a
   *  fermata, where the beat is frozen on the fermata by design). */
  const offBar = (states: DanceLeadState[]) =>
    Array.from({ length: 30 }, (_, j) => 0.3 + j * P)
      .filter((t) => t < states.at(-1)!.t && states[Math.floor(t * HZ)].started && states[Math.floor(t * HZ)].mode !== 'fermata')
      .map((t) => {
        const s = states[Math.floor(t * HZ)];
        const x = (s.beat + ((t - s.t) * s.tempo) / 60) / 4;
        return Math.abs(x - Math.round(x)) * 4;
      });

  it('a fermata holds for one dancer cycle (k beats), reports tempo 0, then goes on; the bars stay on the dancer', () => {
    const plain = steps(40, {});
    const start = plain.find((s) => s.started)!.beat;
    const f = Math.ceil(start) + 10.5;
    const held = steps(40, { fermatas: [f] });
    const holding = held.filter((s) => s.mode === 'fermata');
    expect(holding.length).toBeGreaterThan(0);
    expect(holding.every((s) => s.beat === f && s.tempo === 0 && s.started)).toBe(true);
    // One cycle long, at the tempo it had (120 bpm, k = 4: 2 s), within a frame.
    expect(Math.abs(holding.length / HZ - P)).toBeLessThan(1.5 / HZ);
    // After it, the beat is k beats behind where it would have been: the bars are kept.
    const later = 36;
    const i = Math.round(later * HZ);
    expect(plain[i].beat - held[i].beat).toBeCloseTo(4, 1);
    expect(Math.max(...offBar(held))).toBeLessThan(0.05);
    // Never backwards.
    for (let j = 1; j < held.length; j++) expect(held[j].beat).toBeGreaterThanOrEqual(held[j - 1].beat);
  });

  it('two fermatas in a row each hold; one at the start beat is not re-held after its release', () => {
    const plain = steps(40, {});
    const start = Math.ceil(plain.find((s) => s.started)!.beat);
    const held = steps(40, { fermatas: [start + 3, start + 9] });
    const runs = held.reduce((n, s, j) => n + (s.mode === 'fermata' && held[j - 1]?.mode !== 'fermata' ? 1 : 0), 0);
    expect(runs).toBe(2);
  });

  it('the end loops to the top on a dancer cycle start: the bars stay on the dancer', () => {
    // A 30-beat piece loops at 32 (whole cycles of 4 beats).
    const states = steps(60, { end: 30 });
    const wraps = states.filter((s, j) => j > 0 && s.beat < states[j - 1].beat);
    expect(wraps.length).toBeGreaterThanOrEqual(2);
    for (const w of wraps) expect(w.beat).toBeLessThan(0.2);
    expect(states.at(-1)!.loops).toBe(wraps.length);
    expect(states.every((s) => s.beat < 32)).toBe(true);
    expect(Math.max(...offBar(states))).toBeLessThan(0.05);
  });

  it('no end, or an end of 0: no loop', () => {
    expect(steps(40, {}).at(-1)!.loops).toBe(0);
    expect(steps(40, { end: 0 }).at(-1)!.loops).toBe(0);
  });
});
