/**
 * `captureTime` (#337 item 1): the one call every reader of a camera frame's time makes,
 * so a honoured `clock` stamp is moved back by the capture lag the timing resource has
 * learned (the prior without one) in the pluck nodes as in the tracker's frame age; every
 * other stamp source, and a stamp that is not honoured, is read as before.
 */
import { describe, it, expect } from 'vitest';
import { type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime, sampleTime, CAPTURE_LAG_PRIOR_S, TIMING_RESOURCE_KEY, ABSENT_TIMING } from '@thoremin/sdk/timing/tracker';
import { airBassNode, type NoteEvent } from '@thoremin/ext-air/nodes/air_bass';
import { bassTake } from '../air/synthetic_bass';

const origin = performance.timeOrigin;
const LAG = 0.05;
const withLag = { [TIMING_RESOURCE_KEY]: { ...ABSENT_TIMING, captureLag: { value: LAG, source: 'measured' as const } }, timeScale: 1 };

describe('captureTime', () => {
  const clock = { t: 10, tSource: 'clock' as const, tOrigin: origin };
  it('moves a honoured clock stamp back by the learned capture lag, the prior when none is installed', () => {
    expect(captureTime(clock, { time: 10.01, resources: withLag })).toBeCloseTo(10 - LAG, 9);
    expect(captureTime(clock, { time: 10.01, resources: { timeScale: 1 } })).toBeCloseTo(10 - CAPTURE_LAG_PRIOR_S, 9);
    expect(captureTime(clock, { time: 10.01, resources: withLag })).toBe(sampleTime(clock, { time: 10.01, resources: withLag }, LAG));
  });
  it('leaves capture, presentation and estimated stamps, and a stamp that is not honoured, alone', () => {
    for (const tSource of ['capture', 'presentation', 'estimated'] as const) expect(captureTime({ ...clock, tSource }, { time: 10.01, resources: withLag })).toBe(10);
    expect(captureTime({ ...clock, tOrigin: origin - 1000 }, { time: 10.01, resources: withLag })).toBe(10.01);
    expect(captureTime({ ...clock }, { time: 10.01, resources: { ...withLag, timeScale: 2 } })).toBe(10.01);
    expect(captureTime(undefined, { time: 10.01, resources: withLag })).toBe(10.01);
  });
});

describe('the air-bass node reads the capture time', () => {
  /** Play a take, each frame stamped with the tick's own time by `tSource`. */
  function play(frames: HandsFrame[], tSource: 'capture' | 'clock') {
    const h = airBassNode.make(airBassNode.params.parse({}));
    const notes: NoteEvent[] = [];
    for (const f of frames) {
      const frame: HandsFrame = { ...f, tSource, tOrigin: origin };
      const out = h.process({ hands: frame, config: { enabled: true, mirrorHandedness: false }, scale: [28, 31, 33, 35, 38, 40, 43, 45, 47, 50], octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: withLag } as never) as { notes: NoteEvent[] };
      notes.push(...out.notes);
    }
    return notes;
  }
  it('a clock-stamped take is sampled the capture lag earlier than the same take stamped by the camera', () => {
    const frames = bassTake({ duration: 4, neck: () => 6.5 });
    const cap = play(frames, 'capture');
    const clk = play(frames, 'clock');
    expect(cap.length).toBeGreaterThan(2);
    expect(clk.length).toBe(cap.length);
    // Predicted notes are scheduled from the sample's time: the clock take's are earlier.
    const shifts = cap.map((n, i) => n.t - clk[i].t).filter((_, i) => cap[i].predicted && clk[i].predicted);
    expect(shifts.length).toBeGreaterThan(0);
    for (const s of shifts) expect(s).toBeGreaterThan(0);
  });
});
