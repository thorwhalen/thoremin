/**
 * The audio glitch counter (#240, step 4 of the timing plan): the guard on the
 * low-latency hint. Two readings: Chromium's `playbackStats` underrun counters, and the
 * output timestamp pair's clock step everywhere else. The clock path is a heuristic, so
 * its tests pin what it must NOT count as much as what it must: the pair's bounce, the
 * slow drift between the audio and system clocks, a hidden tab's gap, a suspended
 * context.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { GlitchCounter, GLITCH_STEP_S, GLITCH_RECENT_WINDOW_S, type GlitchAudioLike } from '@thoremin/sdk/timing/glitches';
import { TimingTracker } from '@thoremin/sdk/timing/tracker';

/** A context whose output pair is driven by a script: the audio clock runs at `rate`
 *  against the performance clock, plus whatever dropouts the test injects. */
function scriptedContext() {
  let perfMs = 1000;
  let ctxS = 0;
  const ac = {
    state: 'running' as string,
    currentTime: 0,
    getOutputTimestamp: () => ({ contextTime: ctxS, performanceTime: perfMs }),
  };
  return {
    ac,
    /** Advance both clocks by one output callback; `bounceMs` displaces the reading. */
    step(periodMs: number, { rate = 1, bounceMs = 0, dropoutMs = 0 } = {}) {
      perfMs += periodMs + dropoutMs;
      ctxS += (periodMs * rate) / 1000;
      ac.currentTime = ctxS;
      const reading = { contextTime: ctxS, performanceTime: perfMs + bounceMs };
      ac.getOutputTimestamp = () => reading;
      return perfMs;
    },
  };
}

/** A deterministic bounce in [-amp, amp] ms. */
const bounce = (i: number, ampMs: number) => ampMs * Math.sin(i * 2.399) * ((i * 7919) % 3 === 0 ? 1 : 0.4);

describe('GlitchCounter, the clock reading', () => {
  it('counts nothing over a steady output whose pair bounces by a callback buffer', () => {
    const c = scriptedContext();
    const g = new GlitchCounter();
    for (let i = 0; i < 2000; i++) g.observe(c.ac, c.step(1000 / 60, { bounceMs: bounce(i, 5) }));
    expect(g.reading()).toMatchObject({ total: 0, recent: 0, source: 'clock' });
  });

  it('counts nothing for the slow drift between the audio and system clocks (200 ppm, ten minutes)', () => {
    const c = scriptedContext();
    const g = new GlitchCounter();
    for (let i = 0; i < 60 * 60 * 10; i++) g.observe(c.ac, c.step(1000 / 60, { rate: 1 - 200e-6, bounceMs: bounce(i, 2) }));
    expect(g.reading().total).toBe(0);
  });

  it('counts each dropout longer than the step once, and the level after it is the new normal', () => {
    const c = scriptedContext();
    const g = new GlitchCounter();
    let now = 0;
    for (let i = 0; i < 300; i++) {
      const dropoutMs = i === 100 || i === 200 ? 10.7 : 0;
      now = c.step(1000 / 60, { bounceMs: bounce(i, 2), dropoutMs });
      g.observe(c.ac, now);
    }
    expect(g.reading()).toMatchObject({ total: 2, recent: 2, source: 'clock' });
    expect(Number.isNaN(g.reading().underrunS)).toBe(true);
    // A minute later the recent count is empty; the total stays.
    for (let i = 0; i < 60 * (GLITCH_RECENT_WINDOW_S + 1); i++) g.observe(c.ac, c.step(1000 / 60));
    expect(g.reading()).toMatchObject({ total: 2, recent: 0 });
  });

  it('does not count a dropout shorter than the step (stated: the clock reading cannot see it)', () => {
    const c = scriptedContext();
    const g = new GlitchCounter();
    for (let i = 0; i < 300; i++) g.observe(c.ac, c.step(1000 / 60, { dropoutMs: i === 150 ? GLITCH_STEP_S * 1000 * 0.5 : 0 }));
    expect(g.reading().total).toBe(0);
  });

  it('restarts instead of counting across a sampling gap (a hidden tab) or a suspended context', () => {
    const c = scriptedContext();
    const g = new GlitchCounter();
    for (let i = 0; i < 100; i++) g.observe(c.ac, c.step(1000 / 60));
    // A hidden tab: no readings for two seconds, and the pair jumps meanwhile.
    c.step(2000, { dropoutMs: 50 });
    for (let i = 0; i < 100; i++) g.observe(c.ac, c.step(1000 / 60));
    c.ac.state = 'suspended';
    g.observe(c.ac, c.step(1000 / 60, { dropoutMs: 500 }));
    c.ac.state = 'running';
    for (let i = 0; i < 100; i++) g.observe(c.ac, c.step(1000 / 60));
    expect(g.reading().total).toBe(0);
  });

  it('ignores a context with no output pair, or one that reports zeros before its first render', () => {
    const g = new GlitchCounter();
    g.observe({ state: 'running' }, 1000);
    g.observe({ state: 'running', getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }, 1016);
    expect(g.reading()).toMatchObject({ total: 0, source: 'none' });
  });
});

/**
 * A pair whose `performanceTime` is the moment of the CALL while the context time moves
 * once per output callback (the adversarial review's model of Firefox): the offset is a
 * sawtooth one callback wide. Ticks at ~60 Hz with jitter, and occasional main-thread
 * stalls of up to a few frames (inference).
 */
function callTimePair(callbackMs: number, seed = 1) {
  let wallMs = 1000;
  let lostMs = 0; // context time lost to dropouts
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const ac = {
    state: 'running',
    getOutputTimestamp: () => {
      const ctxMs = Math.floor((wallMs - lostMs) / callbackMs) * callbackMs;
      return { contextTime: ctxMs / 1000, performanceTime: wallMs };
    },
  };
  return {
    ac,
    tick(dropoutMs = 0) {
      lostMs += dropoutMs;
      const stall = rand() < 0.05 ? rand() * 60 : 0;
      wallMs += 1000 / 60 + (rand() - 0.5) * 4 + stall;
      return wallMs;
    },
  };
}

describe('GlitchCounter, a pair taken at the call (Firefox-shaped)', () => {
  for (const callbackMs of [10.7, 21.3, 42.7]) {
    it(`counts nothing over ten minutes of a ${callbackMs} ms sawtooth, stalls included`, () => {
      const c = callTimePair(callbackMs);
      const g = new GlitchCounter();
      for (let i = 0; i < 60 * 60 * 10; i++) g.observe(c.ac, c.tick());
      expect(g.reading().total).toBe(0);
    });
  }

  it('still counts a dropout well beyond the sawtooth (100 ms against a 10.7 ms callback)', () => {
    const c = callTimePair(10.7, 7);
    const g = new GlitchCounter();
    for (let i = 0; i < 600; i++) g.observe(c.ac, c.tick(i === 300 ? 100 : 0));
    expect(g.reading().total).toBe(1);
  });
});

describe('GlitchCounter, the playbackStats reading (Chromium)', () => {
  it('counts underrun events after the first reading, with the seconds lost, and prefers them to the clock', () => {
    const stats = { underrunEvents: 3, underrunDuration: 0.02 };
    const ac: GlitchAudioLike = { state: 'running', playbackStats: stats, getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 5 }) };
    const g = new GlitchCounter();
    g.observe(ac, 1000); // the base: three underruns from before the instrument played
    expect(g.reading()).toMatchObject({ total: 0, source: 'playbackStats', underrunS: 0 });
    stats.underrunEvents = 5;
    stats.underrunDuration = 0.03;
    g.observe(ac, 1016);
    expect(g.reading().total).toBe(2);
    expect(g.reading().underrunS).toBeCloseTo(0.01, 9);
    // A reset (a route change) re-bases; the counts so far are kept.
    g.reset();
    stats.underrunEvents = 9;
    g.observe(ac, 1032);
    expect(g.reading().total).toBe(2);
    stats.underrunEvents = 10;
    g.observe(ac, 1048);
    expect(g.reading().total).toBe(3);
  });

  it('re-bases across a sampling gap (a hidden tab): underruns meanwhile are not the player\'s', () => {
    const stats = { underrunEvents: 0, underrunDuration: 0 };
    const g = new GlitchCounter();
    g.observe({ state: 'running', playbackStats: stats }, 0);
    stats.underrunEvents = 12; // while hidden
    g.observe({ state: 'running', playbackStats: stats }, 5000);
    expect(g.reading().total).toBe(0);
    stats.underrunEvents = 13;
    g.observe({ state: 'running', playbackStats: stats }, 5016);
    expect(g.reading().total).toBe(1);
  });

  it('re-bases when the counters go back (a new context)', () => {
    const stats = { underrunEvents: 4, underrunDuration: 0 };
    const g = new GlitchCounter();
    g.observe({ state: 'running', playbackStats: stats }, 0);
    stats.underrunEvents = 1;
    g.observe({ state: 'running', playbackStats: stats }, 16);
    stats.underrunEvents = 2;
    g.observe({ state: 'running', playbackStats: stats }, 32);
    expect(g.reading().total).toBe(1);
  });
});

describe('the timing tracker carries the count', () => {
  it('reads the glitches per tick into reading().audio.glitches, re-basing on an audio epoch', () => {
    const stats = { underrunEvents: 0, underrunDuration: 0 };
    let now = 0;
    const ac = { state: 'running', currentTime: 0, sampleRate: 48000, playbackStats: stats };
    const tracker = new TimingTracker({ audio: () => ac, now: () => now });
    const tick = (n: number) => tracker.onValue('other', null, { tick: n, time: now / 1000 } as unknown as NodeContext);
    tick(0);
    stats.underrunEvents = 2;
    now = 16;
    tick(1);
    expect(tracker.reading().audio.glitches).toMatchObject({ total: 2, recent: 2, source: 'playbackStats' });
    tracker.bumpEpoch();
    stats.underrunEvents = 7;
    now = 32;
    tick(2);
    expect(tracker.reading().audio.glitches.total).toBe(2);
  });

  it('passes its glitches options to the counter it owns (#392): a shorter recent window forgets sooner', () => {
    const run = (glitches?: { recentWindowS: number }) => {
      const stats = { underrunEvents: 0, underrunDuration: 0 };
      let now = 0;
      const ac = { state: 'running', currentTime: 0, sampleRate: 48000, playbackStats: stats };
      const tracker = new TimingTracker({ audio: () => ac, now: () => now, glitches });
      const tick = (n: number) => tracker.onValue('other', null, { tick: n, time: now / 1000 } as unknown as NodeContext);
      tick(0);
      stats.underrunEvents = 2;
      now = 16;
      tick(1);
      now = 5000;
      tick(2);
      return tracker.reading().audio.glitches;
    };
    expect(run()).toMatchObject({ total: 2, recent: 2 });
    expect(run({ recentWindowS: 1 })).toMatchObject({ total: 2, recent: 0 });
  });
});
