/**
 * ictus's pulse follower (#186 PR F): period, phase and confidence from a CONTINUOUS
 * motion channel, with no octave assumed anywhere. Pure: synthetic channels with a
 * known period and phase. The real dancer is in `test/body_pulse.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { createPulseFollower, acfPeaks, fitSine, refinePeriod, PULSE_TRUSTED_CONFIDENCE, type PulseState } from '@thoremin/ictus';

const HZ = 30;
const QUARTER_FRAME = 1 / (4 * HZ);

/** Feed `seconds` of `f(t)` at 30 Hz; return every state. */
function run(f: (t: number) => number, seconds: number, opts = {}, from = 0): PulseState[] {
  const p = createPulseFollower(opts);
  const out: PulseState[] = [];
  for (let i = 0; i < seconds * HZ; i++) out.push(p.feed(from + i / HZ, f(from + i / HZ)));
  return out;
}

/** Signed distance (seconds) from `t` to the nearest point of the grid `t0 + kP`. */
const gridError = (t: number, t0: number, P: number) => ((((t - t0) / P) % 1) + 1.5) % 1 * P - P / 2;

describe('the pulse follower on a channel of known period and phase', () => {
  for (const P of [0.5, 0.8, 1.3, 1.86]) {
    it(`a ${P} s cycle: the period within 2 %, the anchors and the phase within a quarter frame`, () => {
      const t0 = 0.123;
      const states = run((t) => Math.cos((2 * Math.PI * (t - t0)) / P), 20);
      const s = states[states.length - 1];
      expect(Math.abs(s.level / P - 1)).toBeLessThan(0.02);
      expect(Math.abs(s.period / P - 1)).toBeLessThan(0.02);
      expect(s.tempo).toBeCloseTo(60 / s.period, 9);
      expect(s.state).toBe('running');
      expect(s.confidence).toBeGreaterThan(0.5);
      // Phase 0 is the channel's maximum: t0 + kP.
      expect(Math.abs(gridError(s.lastAnchorAt!, t0, P))).toBeLessThan(QUARTER_FRAME);
      const truePhase = ((((s.t - t0) / P) % 1) + 1) % 1;
      const phaseErrS = (((s.phase - truePhase + 1.5) % 1) - 0.5) * P;
      expect(Math.abs(phaseErrS)).toBeLessThan(QUARTER_FRAME);
      expect(Math.abs(gridError(s.nextBeatAt, t0, P))).toBeLessThan(QUARTER_FRAME);
    });
  }

  it('fast cycles are reported at their period, off whole samples too (not at a multiple the ACF ties with)', () => {
    for (let P = 0.31; P <= 0.6; P += 0.023) {
      const s = run((t) => Math.cos((2 * Math.PI * t) / P), 14).at(-1)!;
      expect(Math.abs(s.level / P - 1), `level at ${P.toFixed(3)}`).toBeLessThan(0.02);
      expect(Math.abs(s.period / P - 1), `period at ${P.toFixed(3)}`).toBeLessThan(0.02);
    }
  });

  it('confidence never drops on a steady cycle (anchors that are merely late do not decay it)', () => {
    // With the prior on the live clock it fell 0.15 to 0.35 between anchors, every cycle.
    for (const P of [1.2, 2.79]) {
      const conf = run((t) => Math.cos((2 * Math.PI * t) / P), 30).slice(12 * HZ).map((s) => s.confidence);
      const worstDrop = Math.min(...conf.slice(1).map((c, i) => c - conf[i]));
      expect(worstDrop, `drop at ${P}`).toBeGreaterThan(-0.03);
      expect(conf.at(-1)!, `final at ${P}`).toBeGreaterThan(0.8);
    }
  });

  it('noise is not a pulse: white noise never reaches the trusted confidence, red noise rarely', () => {
    // Red noise (a slowly wandering body) can look like a slow level for a second or two:
    // an 8 s window cannot rule out a 2.5 s cycle seen three times. Measured: 0 % of
    // ticks for white noise, 1 to 5 % for low-passed. A consumer holds below the trust.
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (const a of [0, 0.8, 0.95]) {
      let trusted = 0;
      let ticks = 0;
      for (let k = 0; k < 8; k++) {
        let y = 0;
        const xs = Array.from({ length: 30 * HZ }, () => (y = a * y + rand()));
        const states = run((t) => xs[Math.round(t * HZ)], 30);
        trusted += states.filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE).length;
        ticks += states.length;
      }
      if (a === 0) expect(trusted, 'white').toBe(0);
      else expect(trusted / ticks, `a=${a}`).toBeLessThan(0.06);
    }
  });

  it('reports nothing on a still or a random channel, and nothing before the first estimate', () => {
    const still = run(() => 1, 10);
    expect(still[still.length - 1].confidence).toBe(0);
    expect(Number.isNaN(still[still.length - 1].period)).toBe(true);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const noise = run(() => rand(), 15);
    expect(noise.filter((s) => s.confidence > 0.3)).toHaveLength(0);
    const early = run((t) => Math.sin(2 * Math.PI * t), 3.5);
    expect(early.every((s) => s.confidence === 0 && Number.isNaN(s.level))).toBe(true);
  });

  it('is causal and deterministic: the same samples give the same states; a non-increasing time is ignored', () => {
    const f = (t: number) => Math.sin((2 * Math.PI * t) / 0.7) + 0.1 * Math.sin(13 * t);
    expect(run(f, 12)).toEqual(run(f, 12));
    const p = createPulseFollower();
    for (let i = 0; i < 300; i++) p.feed(i / HZ, f(i / HZ));
    const before = p.state();
    expect(p.feed(5, 99)).toBe(before);
  });

  it('the published beat never steps back, also when the lock goes into hold', () => {
    for (const P of [0.7, 1.2]) {
      const p = createPulseFollower();
      let prev = -Infinity;
      for (let i = 0; i < 16 * HZ; i++) {
        const t = i / HZ;
        // Observed for 12 s, then 3 s unobserved (the prior holds), then back.
        const s = p.feed(t, t >= 12 && t < 15 ? NaN : Math.cos((2 * Math.PI * t) / P));
        if (s.confidence > 0 || s.state === 'hold') {
          expect(s.beat, `at ${t.toFixed(2)} (P ${P})`).toBeGreaterThanOrEqual(prev);
          prev = s.beat;
        }
      }
    }
  });

  it('an unobserved tick does not block a later sample stamped a little earlier', () => {
    const p = createPulseFollower();
    for (let i = 0; i < 10 * HZ; i++) p.feed(i / HZ, Math.cos((2 * Math.PI * i) / HZ / 0.8));
    p.feed(10.02, NaN);
    const before = p.state();
    expect(p.feed(10.0, 1)).not.toBe(before);
  });

  it('a long dropout starts over instead of extrapolating a stale lock', () => {
    const p = createPulseFollower();
    const f = (t: number) => Math.cos((2 * Math.PI * t) / 0.8);
    for (let i = 0; i < 12 * HZ; i++) p.feed(i / HZ, f(i / HZ));
    expect(p.state().confidence).toBeGreaterThan(0.5);
    for (let i = 12 * HZ; i < 17 * HZ; i++) p.feed(i / HZ, NaN);
    expect(p.state().confidence).toBe(0);
    expect(Number.isNaN(p.state().level)).toBe(true);
  });
});

describe('no octave is assumed: the level is the period the channel repeats at', () => {
  const bar = 1.86;

  it('a bar-periodic pattern whose strongest motion is at the half bar reports the BAR', () => {
    // Most of the energy at the half bar, a smaller part at the bar: the signal repeats
    // only every bar. A follower that folds into a beat range reports the half bar.
    const f = (t: number) => 0.5 * Math.cos((2 * Math.PI * t) / bar) + Math.cos((4 * Math.PI * t) / bar);
    const s = run(f, 20).at(-1)!;
    expect(Math.abs(s.level / bar - 1)).toBeLessThan(0.02);
    expect(s.candidates.some((c) => Math.abs(c.period / (bar / 2) - 1) < 0.05)).toBe(true);
  });

  it('a six-beat pattern (2.79 s at 129.2 bpm) is reported at six beats, not folded to 1.39 or 0.70', () => {
    const six = (6 * 60) / 129.2;
    const s = run((t) => Math.cos((2 * Math.PI * t) / six), 24).at(-1)!;
    expect(Math.abs(s.level / six - 1)).toBeLessThan(0.02);
  });

  it('a pure cycle is reported at its period, not at a multiple its ACF ties with', () => {
    // A sinusoid repeats every P, 2P, 3P: the fundamental is the SHORTEST near-top lag.
    for (const P of [0.9, 1.3]) expect(Math.abs(run((t) => Math.sin((2 * Math.PI * t) / P), 16).at(-1)!.level / P - 1)).toBeLessThan(0.02);
  });

  it('follows a change to an unrelated level by persistence, not by a ratio', () => {
    const p = createPulseFollower();
    let phase = 0;
    let s!: PulseState;
    for (let i = 0; i < 40 * HZ; i++) {
      const t = i / HZ;
      phase += (2 * Math.PI) / HZ / (t < 15 ? 0.8 : bar);
      s = p.feed(t, Math.cos(phase));
      if (i === 15 * HZ - 1) expect(Math.abs(s.level / 0.8 - 1)).toBeLessThan(0.03);
    }
    expect(Math.abs(s.level / bar - 1)).toBeLessThan(0.03);
    expect(Math.abs(s.period / bar - 1)).toBeLessThan(0.03);
    expect(s.confidence).toBeGreaterThan(0.3);
  });
});

describe('a tempo step (#339 item 1): the step detector follows the new tempo from the recent past', () => {
  /** A cosine of period `p0` that steps to `p1` at t = 20 s, phase-continuous, 50 s long. */
  const stepped = (p0: number, p1: number, opts = {}) => {
    const p = createPulseFollower(opts);
    let phase = 0;
    const out: Array<{ t: number; s: PulseState }> = [];
    for (let i = 0; i < 50 * HZ; i++) {
      const t = i / HZ;
      phase += (2 * Math.PI) / HZ / (t < 20 ? p0 : p1);
      out.push({ t: t - 20, s: p.feed(t, Math.cos(phase)) });
    }
    return out.filter((o) => o.t >= 0);
  };
  /** Seconds after the step from which every later tick is within 5 % of `p1` in period and trusted. */
  const settledAt = (out: ReturnType<typeof stepped>, p1: number) => {
    let bad = -1;
    out.forEach((o, i) => {
      if (!(Math.abs(o.s.period / p1 - 1) < 0.05 && o.s.confidence >= PULSE_TRUSTED_CONFIDENCE)) bad = i;
    });
    return bad + 1 >= out.length ? Infinity : out[bad + 1].t;
  };

  for (const [p0, p1] of [[1.2, 1.0], [1.0, 1.2], [0.8, 0.64]] as const) {
    it(`${p0} s -> ${p1} s: period and trust settle within 5 s (measured 3.6, 3.8, 2.8 s; without the detector 9 to 12 s), no undershoot beyond 5 %`, () => {
      const out = stepped(p0, p1);
      expect(settledAt(out, p1)).toBeLessThan(5);
      const slow = settledAt(stepped(p0, p1, { fastWindowS: 0 }), p1);
      expect(slow).toBeGreaterThan(8);
      const lo = Math.min(p0, p1);
      expect(Math.min(...out.map((o) => o.s.period).filter(Number.isFinite))).toBeGreaterThan(lo * 0.95);
      // the lock is not lost for long on the way (the old follower was untrusted for 3 to 5 s)
      expect(out.filter((o) => o.s.confidence < PULSE_TRUSTED_CONFIDENCE).length / HZ).toBeLessThan(1.5);
    });
  }

  it('a steady cycle is untouched by the detector: the same states with it off', () => {
    const f = (t: number) => Math.cos((2 * Math.PI * t) / 1.1);
    const on = run(f, 30);
    const off = run(f, 30, { fastWindowS: 0 });
    expect(on.map((s) => s.period)).toEqual(off.map((s) => s.period));
    expect(on.map((s) => s.confidence)).toEqual(off.map((s) => s.confidence));
  });

  it('a steady noisy fast cycle is not jumped to its octave by the detector (the review case: 0.45 to 0.6 s, noise 0.35 to 0.45)', () => {
    // Box-Muller on a fixed LCG, so the seeds are the same everywhere.
    const wrongSeconds = (P: number, sd: number, seed: number, opts: object) => {
      let z = seed;
      const u = () => ((z = (z * 16807) % 2147483647) / 2147483647);
      const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
      const f = createPulseFollower(opts);
      let bad = 0;
      for (let i = 0; i < 45 * HZ; i++) {
        const st = f.feed(i / HZ, Math.cos((2 * Math.PI * i) / HZ / P) + sd * gauss());
        if (i > 15 * HZ && Number.isFinite(st.level) && Math.abs(st.level / P - 1) > 0.1) bad++;
      }
      return bad / HZ;
    };
    let on = 0;
    let off = 0;
    for (const [P, sd] of [[0.6, 0.45], [0.5, 0.35], [0.45, 0.4]] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        on += wrongSeconds(P, sd, seed, {});
        off += wrongSeconds(P, sd, seed, { fastWindowS: 0 });
      }
    }
    // Measured before the guard: 45 s wrong on 20 seeds of the 0.6 case alone, against 1.4 s with the detector off.
    expect(on).toBeLessThanOrEqual(off + 3);
  });

  it('a level longer than the detector can see (a 1.9 s bar) is left to the full window', () => {
    const f = (t: number) => Math.cos((2 * Math.PI * t) / 1.9);
    expect(run(f, 30).map((s) => s.period)).toEqual(run(f, 30, { fastWindowS: 0 }).map((s) => s.period));
  });
});

describe('the long-level window (#339 item 2): a slow level must show in a longer ACF too', () => {
  const LONG = { longWindowS: 12 };

  it('is off by default: the same states as with it set to 0', () => {
    const f = (t: number) => Math.cos((2 * Math.PI * t) / 2.2);
    expect(run(f, 30).map((s) => s.confidence)).toEqual(run(f, 30, { longWindowS: 0 }).map((s) => s.confidence));
  });

  it('red noise is trusted at a slow level about half as often (measured 7.35 % to 3.08 % of ticks at a = 0.95, 16 runs of 40 s)', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    let off = 0;
    let on = 0;
    for (let k = 0; k < 8; k++) {
      let y = 0;
      const xs = Array.from({ length: 40 * HZ }, () => (y = 0.95 * y + rand()));
      const f = (t: number) => xs[Math.round(t * HZ)];
      off += run(f, 40).filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE).length;
      on += run(f, 40, LONG).filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE).length;
    }
    expect(off).toBeGreaterThan(0);
    expect(on).toBeLessThan(0.7 * off);
  });

  it('a steady slow cycle keeps its lock and its confidence; a level under 1.5 s is untouched', () => {
    for (const P of [1.86, 2.79]) {
      const s = run((t) => Math.cos((2 * Math.PI * t) / P), 30, LONG).at(-1)!;
      expect(Math.abs(s.period / P - 1), `period at ${P}`).toBeLessThan(0.02);
      expect(s.confidence, `confidence at ${P}`).toBeGreaterThan(0.8);
    }
    const f = (t: number) => Math.cos((2 * Math.PI * t) / 1.1);
    const on = run(f, 30, LONG);
    const off = run(f, 30);
    expect(on.map((s) => s.period)).toEqual(off.map((s) => s.period));
    expect(on.map((s) => s.confidence)).toEqual(off.map((s) => s.confidence));
  });
});

describe('the parts', () => {
  it('acfPeaks: the per-lag normalisation does not crush a slow, perfectly regular cycle', () => {
    for (const P of [0.5, 1.5, 2.4]) {
      const x = Array.from({ length: 8 * HZ }, (_, i) => Math.sin((2 * Math.PI * i) / HZ / P));
      // (Its multiples tie with it: choosing among them is the follower's job.)
      const at = acfPeaks(x, { minLag: 8, maxLag: 90 }).find((p) => Math.abs(p.lag / HZ / P - 1) < 0.03);
      expect(at, `period ${P}`).toBeDefined();
      expect(at!.r, `strength at ${P}`).toBeGreaterThan(0.9);
    }
  });

  it('fitSine recovers phase and amplitude over a span that is not a whole number of periods, on a drift; refinePeriod sharpens a period', () => {
    const P = 1.3;
    const x = Array.from({ length: 200 }, (_, i) => 2 * Math.cos((2 * Math.PI * (i / HZ - 0.4)) / P) + 0.05 * i);
    const { phi, amp } = fitSine(x, P, { t0: 0, hz: HZ });
    expect(amp).toBeCloseTo(2, 3);
    expect((phi / (2 * Math.PI)) * P).toBeCloseTo(0.4, 3);
    expect(Math.abs(refinePeriod(x, P * 1.015, { t0: 0, hz: HZ }) / P - 1)).toBeLessThan(0.002);
  });
});
