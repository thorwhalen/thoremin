/**
 * The pending-event scheduler (#187 PR 5): each rule in `scheduler.ts`'s header, pinned.
 */
import { describe, expect, it } from 'vitest';
import { createScheduler, type ScheduleCommand, type ScoreEvent } from '@thoremin/ictus';

const ev = (key: number, start: number, duration = 1, channel = 0, velocity = 0.8): ScoreEvent => ({ key, channel, start, duration, velocity });

/** Drive the scheduler at a steady tempo with ticks every `dt` seconds. */
function run(events: ScoreEvent[], { bpm = 60, dt = 1 / 30, seconds = 6, horizon = 0.1, loopBeats = 0 } = {}) {
  const s = createScheduler(events, { loopBeats });
  const out: ScheduleCommand[] = [];
  for (let now = 0; now <= seconds + 1e-9; now += dt) out.push(...s.tick({ now, beat: (now * bpm) / 60, bpm, horizon }));
  return { s, out };
}

/** Every key's commands alternate on/off, starting with on, and times never decrease. */
function expectAlternating(out: ScheduleCommand[]) {
  const on = new Map<string, number>();
  for (const c of out) {
    const k = `${c.channel}:${c.key}`;
    if (c.type === 'noteOn') {
      expect(on.has(k), `double note-on ${k} at ${c.time}`).toBe(false);
      on.set(k, c.time);
    } else {
      expect(on.has(k), `orphan note-off ${k} at ${c.time}`).toBe(true);
      expect(c.time).toBeGreaterThanOrEqual(on.get(k)!);
      on.delete(k);
    }
  }
}

describe('createScheduler', () => {
  it('commits each onset ahead of its beat, at the predicted time, within the horizon', () => {
    const { out } = run([ev(60, 1), ev(62, 2), ev(64, 3)], { bpm: 60, horizon: 0.1 });
    const ons = out.filter((c) => c.type === 'noteOn');
    expect(ons.map((c) => c.key)).toEqual([60, 62, 64]);
    for (const [i, c] of ons.entries()) expect(c.time).toBeCloseTo(i + 1, 6); // 60 bpm: beat b at b s
    expectAlternating(out);
  });

  it('never commits further ahead than the horizon', () => {
    const s = createScheduler([ev(60, 1), ev(62, 1.5)]);
    // At beat 0.95, 120 bpm: beat 1 is 25 ms away, beat 1.5 is 275 ms away.
    const cmds = s.tick({ now: 10, beat: 0.95, bpm: 120, horizon: 0.1 });
    expect(cmds).toEqual([{ type: 'noteOn', channel: 0, key: 60, velocity: 0.8, time: expect.closeTo(10.025, 6) }]);
  });

  it('a committed onset is never moved: a later tempo change only shapes what is not yet committed', () => {
    const s = createScheduler([ev(60, 1), ev(62, 2)]);
    const first = s.tick({ now: 0, beat: 0.95, bpm: 60, horizon: 0.1 });
    expect(first).toHaveLength(1);
    // The tempo doubles: nothing is re-sent for key 60, and 62 is predicted at the new tempo.
    const later = s.tick({ now: 0.5, beat: 1.95, bpm: 120, horizon: 0.1 });
    expect(later.filter((c) => c.type === 'noteOn' && c.key === 60)).toHaveLength(0);
    const on62 = later.find((c) => c.type === 'noteOn' && c.key === 62)!;
    expect(on62.time).toBeCloseTo(0.525, 6);
  });

  it('held (bpm 0) commits nothing ahead and releases nothing sounding: a fermata sustains', () => {
    const s = createScheduler([ev(60, 0, 1), ev(62, 1, 1)]);
    s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.1 });
    expect(s.sounding).toBe(1);
    for (let i = 1; i < 100; i++) expect(s.tick({ now: i * 0.1, beat: 0.5, bpm: 0, horizon: 0.1 })).toEqual([]);
    expect(s.sounding).toBe(1);
  });

  it('a note on the beat the follower stops at sounds at once and holds (the fermata note)', () => {
    const s = createScheduler([ev(60, 0, 1), ev(67, 1, 2)]);
    s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.05 });
    const atStop = s.tick({ now: 1, beat: 1, bpm: 0, horizon: 0.05 });
    expect(atStop.map((c) => `${c.type}:${c.key}`)).toEqual(['noteOff:60', 'noteOn:67']);
    expect(s.tick({ now: 5, beat: 1, bpm: 0, horizon: 0.05 })).toEqual([]);
    expect(s.sounding).toBe(1);
  });

  it('a note entirely behind the beat is skipped; one still under way starts now', () => {
    const s = createScheduler([ev(60, 0, 0.5), ev(62, 0.5, 0.5), ev(64, 1, 4)]);
    const cmds = s.tick({ now: 3, beat: 2, bpm: 60, horizon: 0.1 });
    expect(cmds).toEqual([{ type: 'noteOn', channel: 0, key: 64, velocity: 0.8, time: 3 }]);
    expect(s.skipped).toBe(2);
  });

  it('a zero-length (grace) note behind the beat is skipped too; on the beat it plays (review)', () => {
    const s = createScheduler([ev(60, 1, 0), ev(62, 3, 0)]);
    // A forward jump from beat 0.5 to 2 passes the grace note at 1.
    s.tick({ now: 0, beat: 0.5, bpm: 60, horizon: 0.1 });
    expect(s.tick({ now: 0.1, beat: 2, bpm: 60, horizon: 0.1 })).toEqual([]);
    expect(s.skipped).toBe(1);
    expect(s.tick({ now: 1, beat: 3, bpm: 60, horizon: 0.1 }).map((c) => c.key)).toEqual([62]);
    // A restart (stop, then a tick) inside the look-back window does not replay it.
    s.stop(2);
    expect(s.tick({ now: 3, beat: 3.5, bpm: 60, horizon: 0.1 }).filter((c) => c.type === 'noteOn')).toEqual([]);
  });

  it('two parts in unison on one channel are one voice that ends with the longer note', () => {
    const { out } = run([ev(67, 1, 1), ev(67, 1, 2)], { seconds: 5 });
    expect(out.map((c) => `${c.type}@${c.time.toFixed(2)}`)).toEqual(['noteOn@1.00', 'noteOff@3.00']);
  });

  it('a key struck again while sounding is released just before the new onset; on/off alternate', () => {
    // Overlapping same key on one channel (two parts sharing a channel, staggered).
    const { out } = run([ev(60, 1, 2), ev(60, 2, 2)], { seconds: 6 });
    expectAlternating(out);
    const times = out.map((c) => `${c.type}@${c.time.toFixed(3)}`);
    expect(times).toEqual(['noteOn@1.000', 'noteOff@1.995', 'noteOn@2.000', 'noteOff@4.000']);
  });

  it('a repeated key never starts at or before its own committed release, whatever the tempo does', () => {
    const s = createScheduler([ev(60, 0, 1), ev(60, 1.02, 1)]);
    const out: ScheduleCommand[] = [];
    out.push(...s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.2 }));
    out.push(...s.tick({ now: 0.85, beat: 0.85, bpm: 60, horizon: 0.2 })); // release committed at 1.0
    out.push(...s.tick({ now: 0.9, beat: 0.99, bpm: 600, horizon: 0.2 })); // tempo leaps: 1.02 is 3 ms away
    expectAlternating(out);
    const off = out.find((c) => c.type === 'noteOff')!;
    const on2 = out.filter((c) => c.type === 'noteOn')[1];
    expect(on2.time).toBeGreaterThan(off.time);
  });

  it('a rewind releases everything at once and plays from the new position', () => {
    const s = createScheduler([ev(60, 0, 4), ev(64, 2, 4)]);
    for (let now = 0; now <= 3; now += 0.05) s.tick({ now, beat: now, bpm: 60, horizon: 0.1 });
    expect(s.sounding).toBe(2);
    const cmds = s.tick({ now: 3.1, beat: 0, bpm: 60, horizon: 0.1 });
    expect(cmds.filter((c) => c.type === 'noteOff').map((c) => c.time)).toEqual([3.1, 3.1]);
    expect(cmds.filter((c) => c.type === 'noteOn').map((c) => c.key)).toEqual([60]);
  });

  it('stop releases every voice and the next tick starts over', () => {
    const s = createScheduler([ev(60, 0, 4)]);
    s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.1 });
    expect(s.stop(1)).toEqual([{ type: 'noteOff', channel: 0, key: 60, time: 1 }]);
    expect(s.sounding).toBe(0);
    expect(s.tick({ now: 2, beat: 0, bpm: 60, horizon: 0.1 }).map((c) => c.type)).toEqual(['noteOn']);
  });

  it('durationScale shortens a note when its onset is committed (staccato)', () => {
    const s = createScheduler([ev(60, 0, 1)]);
    const out = [...s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.1, durationScale: 0.5 })];
    for (let now = 0.05; now <= 2; now += 0.05) out.push(...s.tick({ now, beat: now, bpm: 60, horizon: 0.1 }));
    const off = out.find((c) => c.type === 'noteOff')!;
    expect(off.time).toBeCloseTo(0.5, 6);
  });

  it('loops the events every loopBeats', () => {
    const { out } = run([ev(60, 0, 0.5), ev(62, 1, 0.5)], { loopBeats: 2, seconds: 5.5 });
    const ons = out.filter((c) => c.type === 'noteOn').map((c) => `${c.key}@${c.time.toFixed(2)}`);
    expect(ons).toEqual(['60@0.00', '62@1.00', '60@2.00', '62@3.00', '60@4.00', '62@5.00']);
    expectAlternating(out);
  });

  it('a whole movement at a wavering tempo keeps every key alternating and skips nothing', () => {
    const events: ScoreEvent[] = [];
    for (let b = 0; b < 200; b += 0.25) events.push(ev(48 + ((b * 4) % 24), b, 0.3 + (b % 1), Math.floor(b) % 3));
    const s = createScheduler(events);
    const out: ScheduleCommand[] = [];
    let beat = 0;
    for (let now = 0; beat < 205; now += 1 / 30) {
      const bpm = 90 + 30 * Math.sin(now / 3);
      out.push(...s.tick({ now, beat, bpm, horizon: 0.09 }));
      beat += (bpm / 60) / 30;
    }
    out.push(...s.stop(1e6));
    expectAlternating(out);
    expect(s.skipped).toBe(0);
    expect(out.filter((c) => c.type === 'noteOn').length).toBeGreaterThan(0);
  });

  it('ignores a tick whose clock is not finite, instead of looping forever (#355)', () => {
    const s = createScheduler([ev(60, 0), ev(62, 1)], { loopBeats: 2 });
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(s.tick({ now: 0, beat: bad, bpm: 60, horizon: 0.1 })).toEqual([]);
      expect(s.tick({ now: bad, beat: 0, bpm: 60, horizon: 0.1 })).toEqual([]);
      expect(s.tick({ now: 0, beat: 0, bpm: 60, horizon: bad })).toEqual([]);
    }
    expect(s.tick({ now: 0, beat: 0, bpm: Infinity, horizon: 0.1 })).toEqual([]);
    // ... and the position it never took leaves a later finite tick working.
    expect(s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.1 }).filter((c) => c.type === 'noteOn').map((c) => c.key)).toEqual([60]);
  });
});

describe('a looped piece whose follower announces the wrap (#508)', () => {
  /** A 4-beat piece looped by the follower (the beat jumps 4 -> 0), at 120 bpm. */
  const EVENTS = [ev(60, 0, 0.5), ev(62, 1, 0.5), ev(64, 2, 0.5), ev(65, 3, 0.5)];
  const LENGTH = 4;
  const BPM = 120;
  function loop({ announce, dt, t0 = 0, passes = 3 }: { announce: boolean; dt: number; t0?: number; passes?: number }) {
    const s = createScheduler(EVENTS);
    const out: ScheduleCommand[] = [];
    for (let now = t0; now <= (passes * LENGTH * 60) / BPM; now += dt) {
      const virtual = ((now - t0) * BPM) / 60;
      const beat = virtual % LENGTH;
      out.push(...s.tick({ now, beat, bpm: BPM, horizon: 0.1, ...(announce ? { wrap: { at: LENGTH, to: 0 } } : {}) }));
    }
    return out;
  }
  const ons = (out: ScheduleCommand[]) => out.filter((c) => c.type === 'noteOn');

  it('sounds every note of every pass at its predicted time, within a millisecond, whatever the tick phase', () => {
    for (const t0 of [0, 0.004, 0.011, 0.02, 0.029]) {
      const out = loop({ announce: true, dt: 1 / 30, t0 });
      const on = ons(out);
      // Three passes of four notes; the first note of a pass is the wrap itself.
      expect(on.length).toBeGreaterThanOrEqual(11);
      for (const c of on) {
        const k = EVENTS.findIndex((e) => e.key === c.key);
        const pass = Math.round((c.time - t0 - EVENTS[k].start * 0.5) / ((LENGTH * 60) / BPM));
        expect(Math.abs(c.time - (t0 + EVENTS[k].start * 0.5 + pass * 2)), `key ${c.key} t0 ${t0}`).toBeLessThan(1e-3);
      }
      expectAlternating(out);
    }
  });

  it('carries a sounding note across the wrap and does not restart anything', () => {
    // A note spanning the wrap point: written 3.5 .. 4.25 is clipped by nothing here, so
    // use one ending at 4.25 -> after the wrap it ends 0.25 beats into the next pass.
    const s = createScheduler([ev(60, 0, 0.5), ev(67, 3.5, 0.75)]);
    const out: ScheduleCommand[] = [];
    for (let now = 0; now <= 4.2; now += 1 / 30) {
      out.push(...s.tick({ now, beat: ((now * BPM) / 60) % LENGTH, bpm: BPM, horizon: 0.1, wrap: { at: LENGTH, to: 0 } }));
    }
    const g = out.filter((c) => c.key === 67);
    expect(g.map((c) => c.type)).toEqual(['noteOn', 'noteOff', 'noteOn', 'noteOff']);
    expect(g[0].time).toBeCloseTo(1.75, 6);
    expect(g[1].time).toBeCloseTo(2.125, 3); // 4.25 beats at 120 bpm
    expect(g[2].time).toBeCloseTo(3.75, 6);
  });

  it('without the announcement the first note of a pass is met as a rewind, up to a frame late (the control)', () => {
    const late = ons(loop({ announce: false, dt: 1 / 30, t0: 0.011 })).map((c) => {
      const k = EVENTS.findIndex((e) => e.key === c.key);
      return c.time - (0.011 + EVENTS[k].start * 0.5 + Math.round((c.time - 0.011 - EVENTS[k].start * 0.5) / 2) * 2);
    });
    expect(Math.max(...late)).toBeGreaterThan(0.005);
  });

  it('a jump the follower did not announce is still a rewind: everything released', () => {
    const s = createScheduler(EVENTS);
    s.tick({ now: 0, beat: 0, bpm: BPM, horizon: 0.1, wrap: { at: LENGTH, to: 0 } });
    s.tick({ now: 1, beat: 1.9, bpm: BPM, horizon: 0.1, wrap: { at: LENGTH, to: 0 } });
    const out = s.tick({ now: 1.033, beat: 0.1, bpm: BPM, horizon: 0.1, wrap: { at: LENGTH, to: 0 } });
    expect(out.some((c) => c.type === 'noteOff')).toBe(true);
  });
});
