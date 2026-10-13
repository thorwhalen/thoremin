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
});
