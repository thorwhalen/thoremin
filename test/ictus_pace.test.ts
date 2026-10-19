/**
 * The pace controller (`@thoremin/ictus` `pace.ts`, #186 PR H): the song's rate from the
 * dancer's pulse. Pure, so the loop is closed here by hand: a song whose position
 * advances at the rate the controller chose on the previous tick (as the graph's delayed
 * edges do), against a dancer with a known period and phase.
 */
import { describe, it, expect } from 'vitest';
import {
  createPaceController,
  createPulseFollower,
  relatePeriods,
  PACE_DEFAULTS,
  PULSE_TRUSTED_CONFIDENCE,
  type MusicalTime,
  type PaceState,
  type PulseState,
} from '@thoremin/ictus';

const HZ = 30;
/** The Que Calor song's beat, seconds. */
const P0 = 60 / 129.2;

/** A dancer whose cycle starts at `t0 + k * period`, as the pulse follower reports it. */
function dancer(t: number, period: number, opts: { t0?: number; confidence?: number } = {}): PulseState {
  const beat = (t - (opts.t0 ?? 0)) / period;
  return {
    t,
    beat,
    phase: beat - Math.floor(beat),
    tempo: 60 / period,
    period,
    confidence: opts.confidence ?? 0.8,
    nextBeatAt: t + (Math.floor(beat) + 1 - beat) * period,
    beatsPerBar: 4,
    beatInBar: 0,
    state: 'running',
    anchors: 10,
    level: period,
    strength: 0.8,
    candidates: [{ period, r: 0.8 }],
  };
}

/** A song at native beat period `P0`, `pos` seconds in, played at `rate`, read at `t`.
 *  `jitter` moves each TRACKED beat by up to that fraction of a period (the tracker snaps
 *  a beat to an onset within a tenth of one), so the reported interval at the playhead,
 *  the distance between two such beats, is off by up to twice that; the music is steady. */
function songAt(t: number, pos: number, rate: number, playing = true, jitter = 0): MusicalTime {
  const beat = pos / P0;
  const k = Math.floor(beat);
  const off = (i: number) => jitter * Math.sin(i * 12.9898 + 78.233 * Math.cos(i));
  const period = (P0 * (1 + off(k + 1) - off(k))) / rate;
  return {
    t,
    beat,
    phase: beat - Math.floor(beat),
    tempo: 60 / period,
    period,
    confidence: 1,
    nextBeatAt: t + (Math.floor(beat) + 1 - beat) * period,
    beatsPerBar: 4,
    beatInBar: Math.floor(beat) % 4,
    state: playing ? 'running' : 'hold',
    anchors: 100,
  };
}

/** Close the loop for `seconds`: the song advances at the rate chosen last tick. */
function run(
  seconds: number,
  pulseAt: (t: number) => PulseState,
  opts: { base?: number; range?: number; jitter?: number; controller?: ReturnType<typeof createPaceController> } = {},
): PaceState[] {
  const c = opts.controller ?? createPaceController();
  const base = opts.base ?? 1;
  let pos = 0;
  let rate = base;
  let prevSong = songAt(0, 0, rate, true, opts.jitter);
  const out: PaceState[] = [];
  for (let i = 0; i < seconds * HZ; i++) {
    const t = i / HZ;
    if (i > 0) pos += rate / HZ;
    // What the player published last tick (the delayed edges).
    const s = c.step({ t, pulse: pulseAt(t), song: prevSong, rate, base, range: opts.range });
    out.push(s);
    rate = s.rate;
    prevSong = songAt(t, pos, rate, true, opts.jitter);
  }
  return out;
}

const late = (xs: PaceState[], fromS: number) => xs.slice(fromS * HZ);

describe('relatePeriods: an integer ratio, never an octave', () => {
  it('relates a bar, six beats, a beat and half a beat', () => {
    expect(relatePeriods(4 * P0, P0, 1)).toEqual({ ratio: 4, rate: 1 });
    expect(relatePeriods(6 * P0, P0, 1)?.ratio).toBe(6);
    expect(relatePeriods(P0, P0, 1)?.ratio).toBe(1);
    expect(relatePeriods(P0 / 2, P0, 1)?.ratio).toBe(0.5);
    // A dancer 5 % quick on the bar: the song must play 5 % fast.
    const r = relatePeriods((4 * P0) / 1.05, P0, 1)!;
    expect(r.ratio).toBe(4);
    expect(r.rate).toBeCloseTo(1.05, 6);
  });

  it('finds no relation when every ratio is further than the capture from the base', () => {
    // 4.5 beats: between 4 and 5, about 11 % from either, outside a 10 % capture.
    expect(relatePeriods(4.5 * P0, P0, 1, { captureRange: 0.1 })).toBeNull();
    expect(relatePeriods(4.5 * P0, P0, 1, { captureRange: 0.15 })).not.toBeNull();
    expect(relatePeriods(NaN, P0, 1)).toBeNull();
  });

  it('is relative to the player\'s own tempo', () => {
    // The player slowed the song to 0.8: a dancer at the song's own bar is 25 % quick on
    // four beats but 6 % slow on three, and three is nearer the tempo the player chose.
    expect(relatePeriods(4 * P0, P0, 0.8)).toEqual({ ratio: 3, rate: expect.closeTo(0.75, 6) });
    expect(relatePeriods((4 * P0) / 0.8, P0, 0.8)).toEqual({ ratio: 4, rate: expect.closeTo(0.8, 6) });
  });
});

describe('the closed loop', () => {
  it('follows a dancer 6 % quick on the bar, in tempo and in phase, inside the clamp', () => {
    const D = (4 * P0) / 1.06;
    const s = run(40, (t) => dancer(t, D, { t0: 0.37 }));
    // Locks only after the ratio has persisted.
    const first = s.findIndex((x) => x.mode === 'following');
    expect(first / HZ).toBeGreaterThanOrEqual(PACE_DEFAULTS.persistS - 1 / HZ);
    expect(first / HZ).toBeLessThan(PACE_DEFAULTS.persistS + 0.1);
    expect(s.slice(0, first).every((x) => x.mode === 'locking' && x.rate === 1)).toBe(true);
    // Never outside the clamp.
    expect(s.every((x) => x.rate >= 0.9 - 1e-9 && x.rate <= 1.1 + 1e-9)).toBe(true);
    // The last 10 s: on the dancer's tempo and inside a twelfth of a beat of its phase.
    const end = late(s, 30);
    expect(end.every((x) => x.mode === 'following' && x.ratio === 4)).toBe(true);
    const mean = end.reduce((a, x) => a + x.rate, 0) / end.length;
    expect(mean).toBeCloseTo(1.06, 2);
    expect(end.every((x) => Math.abs(x.phaseError) <= PACE_DEFAULTS.phaseThreshold)).toBe(true);
    expect(end.every((x) => x.nudge === 0)).toBe(true);
  });

  it('closes a phase error from either side by nudging, never by seeking', () => {
    for (const t0 of [0.1, 0.25, 0.4]) {
      const s = run(40, (t) => dancer(t, 4 * P0, { t0 }));
      const nudged = s.filter((x) => x.nudge !== 0);
      expect(nudged.length).toBeGreaterThan(0);
      // A nudge is the rate times 1 +- 3 %, inside the clamp.
      expect(Math.max(...s.map((x) => Math.abs(x.rate - 1)))).toBeLessThanOrEqual(PACE_DEFAULTS.nudge + 1e-9);
      expect(late(s, 30).every((x) => Math.abs(x.phaseError) <= PACE_DEFAULTS.phaseThreshold)).toBe(true);
    }
  });

  it('clamps a dancer just outside the range, and drops one with no relation in capture', () => {
    const near = run(20, (t) => dancer(t, (4 * P0) / 1.13));
    expect(late(near, 12).every((x) => x.mode === 'following' && x.rate <= 1.1 + 1e-9)).toBe(true);
    expect(Math.max(...late(near, 12).map((x) => x.rate))).toBeCloseTo(1.1, 6);
    // 2.5 song beats: 20 % from two and from three, outside the 15 % capture.
    const far = run(20, (t) => dancer(t, 2.5 * P0));
    expect(far.every((x) => x.mode === 'waiting' && x.rate === 1)).toBe(true);
  });

  it('a beat tracker\'s jitter in the song\'s period does not wobble the tempo (the averaged period)', () => {
    // Each reported beat interval up to 10 % off: the review measured a rate wandering
    // 0.96..1.10 when the controller read the one interval at the playhead.
    const s = late(run(40, (t) => dancer(t, (4 * P0) / 1.04), { jitter: 0.1 }), 20);
    expect(s.every((x) => x.mode === 'following')).toBe(true);
    const target = s.map((x) => x.target);
    const mean = target.reduce((a, x) => a + x, 0) / target.length;
    expect(mean).toBeCloseTo(1.04, 2);
    expect(Math.max(...target.map((x) => Math.abs(x - mean)))).toBeLessThan(0.015);
  });

  it('never asks past the player\'s own limits', () => {
    // Tempo slider at 2, range 30 %, a dancer 12 % quick: 2.24 is unplayable; 2 is the most.
    const s = run(20, (t) => dancer(t, (4 * P0) / 2.24), { base: 2, range: 0.3 });
    expect(Math.max(...s.map((x) => x.rate))).toBeLessThanOrEqual(2);
    const end = late(s, 12);
    expect(end.every((x) => x.mode === 'following' && x.target === 2)).toBe(true);
  });

  it('the follow range is live, and widens the capture with it', () => {
    // One song beat per step, 20 % quick (the half and double are much further).
    const D = P0 / 1.2;
    expect(run(15, (t) => dancer(t, D)).every((x) => x.mode !== 'following')).toBe(true);
    const wide = run(15, (t) => dancer(t, D), { range: 0.25 });
    expect(late(wide, 10).every((x) => x.mode === 'following')).toBe(true);
    expect(late(wide, 12).every((x) => Math.abs(x.rate - 1.2) < 0.04)).toBe(true);
  });
});

describe('holding', () => {
  it('a dancer who stops does not stop the song: the rate holds, then follows again without a new lock', () => {
    const D = (4 * P0) / 1.05;
    const s = run(30, (t) => dancer(t, D, { confidence: t > 12 && t < 18 ? PULSE_TRUSTED_CONFIDENCE / 2 : 0.8 }));
    const before = s[12 * HZ - 1];
    expect(before.mode).toBe('following');
    const held = s.slice(12 * HZ + 1, 18 * HZ);
    expect(held.every((x) => x.mode === 'holding' && x.nudge === 0)).toBe(true);
    expect(new Set(held.map((x) => x.rate)).size).toBe(1);
    expect(Math.abs(held[0].rate - before.rate)).toBeLessThan(0.035);
    // The same ratio again: followed at once.
    expect(s[18 * HZ + 1].mode).toBe('following');
  });

  it('a new ratio must persist before it is followed (a level switch, or a level faked by noise)', () => {
    // The dancer's level reads as two beats for 2 s (shorter than persistS), then the bar.
    const s = run(25, (t) => dancer(t, t > 10 && t < 12 ? 2 * P0 : 4 * P0));
    const blip = s.slice(10 * HZ + 1, 12 * HZ);
    expect(blip.every((x) => x.mode === 'switching' && x.ratio === 2)).toBe(true);
    expect(s.slice(12 * HZ + 1).every((x) => x.ratio === 4)).toBe(true);
    // Held long enough, it is adopted.
    const switched = run(25, (t) => dancer(t, t > 10 ? 2 * P0 : 4 * P0));
    expect(switched.at(-1)!.ratio).toBe(2);
    expect(switched.at(-1)!.mode).toBe('following');
  });

  it('a paused song idles at the player\'s tempo, and keeps the lock (#346 item 5)', () => {
    const c = createPaceController();
    const D = (4 * P0) / 1.05;
    run(10, (t) => dancer(t, D), { controller: c });
    expect(c.state().mode).toBe('following');
    const s = c.step({ t: 10, pulse: dancer(10, D), song: songAt(10, 5, 1, false), rate: 1.05, base: 0.9 });
    expect(s).toMatchObject({ mode: 'idle', rate: 0.9 });
    // A long pause, then playing again: followed at once, the rate where it was, no relock.
    const back = c.step({ t: 40, pulse: dancer(40, D), song: songAt(40, 5, 1), rate: 1, base: 1 });
    expect(back.mode).toBe('following');
    expect(back.ratio).toBe(4);
    // Where it was, within the phase nudge (3 %) the new position may call for.
    expect(Math.abs(back.rate - 1.05)).toBeLessThan(0.04);
  });

  it('a reset (a different song) forgets the lock', () => {
    const c = createPaceController();
    const D = (4 * P0) / 1.05;
    run(10, (t) => dancer(t, D), { controller: c });
    c.reset();
    const back = c.step({ t: 10.1, pulse: dancer(10.1, D), song: songAt(10.1, 5, 1), rate: 1, base: 1 });
    expect(back.mode).toBe('locking');
  });

  it('a level half-seen before a pause does not count the pause as persistence', () => {
    const c = createPaceController();
    const D = (4 * P0) / 1.05;
    run(10, (t) => dancer(t, D), { controller: c });
    // A different level starts to be seen, then the song pauses for a long time.
    c.step({ t: 10.1, pulse: dancer(10.1, 2 * P0), song: songAt(10.1, 5, 1), rate: 1, base: 1 });
    c.step({ t: 10.2, pulse: dancer(10.2, 2 * P0), song: songAt(10.2, 5, 1, false), rate: 1, base: 1 });
    const back = c.step({ t: 60, pulse: dancer(60, 2 * P0), song: songAt(60, 5, 1), rate: 1, base: 1 });
    expect(back.mode).toBe('switching');
  });
});

describe('red noise through the real pulse follower', () => {
  // #339 item 2: a slowly wandering channel reaches the follower's trust threshold in 1 to
  // 5 % of ticks, as a 1.8 to 2.9 s level held a second or two. The controller's
  // persistence is the second defence: it should almost never follow one.
  it('almost never follows a low-passed noise channel', () => {
    let following = 0;
    let eagerFollowing = 0;
    let trusted = 0;
    let total = 0;
    for (const [seed, a] of [
      [1, 0.8],
      [2, 0.9],
      [3, 0.95],
      [4, 0.9],
    ] as const) {
      let x = seed * 9973;
      const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const f = createPulseFollower();
      const c = createPaceController();
      const eager = createPaceController({ persistS: 0 });
      let eagerRate = 1;
      let eagerPos = 0;
      let eagerSong = songAt(0, 0, 1);
      let v = 0;
      let pos = 0;
      let rate = 1;
      let prevSong = songAt(0, 0, 1);
      for (let i = 0; i < 90 * HZ; i++) {
        const t = i / HZ;
        if (i > 0) pos += rate / HZ;
        v = a * v + (1 - a) * rand();
        const p = f.feed(t, v);
        if (p.confidence >= PULSE_TRUSTED_CONFIDENCE) trusted++;
        const s = c.step({ t, pulse: p, song: prevSong, rate, base: 1 });
        if (s.mode === 'following') following++;
        // The same loop without the persistence, to show it is what does the work.
        if (i > 0) eagerPos += eagerRate / HZ;
        const e = eager.step({ t, pulse: p, song: eagerSong, rate: eagerRate, base: 1 });
        if (e.mode === 'following') eagerFollowing++;
        eagerRate = e.rate;
        eagerSong = songAt(t, eagerPos, eagerRate);
        total++;
        rate = s.rate;
        prevSong = songAt(t, pos, rate);
      }
    }
    // Measured: the follower trusts about 2 % of these ticks (227 of 10 800); without the
    // persistence the controller follows every one of them, with it none.
    expect(trusted).toBeGreaterThan(50);
    expect(eagerFollowing).toBeGreaterThan(50);
    expect(following / total).toBeLessThan(0.002);
  });
});
