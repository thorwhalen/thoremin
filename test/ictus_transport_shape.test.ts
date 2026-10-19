/**
 * The transport's `upbeat: 'shape'` rule (D15) at the unit level, on arm-height trajectories (torso lengths)
 * rather than a pose stream: what the adversarial review found and the cases the scripted conductor cannot
 * make: the ready height taken again (a raise in two steps, a re-ready after the prepared timeout), a glitched
 * frame (one frame of the elbow standing in for an unseen wrist, a NaN), a slow tempo, 20 and 60 fps, a live
 * switch of the mode, and that the shape settings change nothing while the mode is `speed`.
 */
import { describe, expect, it } from 'vitest';
import { createTransport, type TransportOptions, type TransportPhase } from '@thoremin/ictus';

/** Run a height trajectory through a transport at `fps`; the phases seen, and when the piece started. */
function drive(raise: (t: number) => number | undefined, seconds: number, options: TransportOptions = { upbeat: 'shape' }, { fps = 30, anchors = [] as number[], motion = 1 } = {}) {
  const tr = createTransport(options);
  const phases: TransportPhase[] = [];
  let started = NaN;
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    // An anchor reaches the frame a step after its time (the detector confirms late).
    const a = anchors.find((x) => t >= x + 1 / fps - 1e-9 && t < x + 2 / fps - 1e-9);
    const s = tr.step({ t, raise: raise(t), motion, ...(a !== undefined ? { anchor: a } : {}) });
    if (phases.at(-1) !== s.phase) phases.push(s.phase);
    if (s.started && Number.isNaN(started)) started = t;
  }
  return { phases, started, tr };
}

const smooth = (u: number) => u * u * (3 - 2 * u);
/** A real upbeat from `base`: up by `rise` over `up` s, down to `below` under `base` over `down` s; the downbeat is at its end. */
const upbeat = (t: number, at: number, base: number, { rise = 0.3, up = 0.33, down = 0.33, below = 0.35 } = {}) => {
  const u = t - at;
  if (u < 0) return base;
  if (u < up) return base + rise * Math.sin((Math.PI / 2) * (u / up));
  if (u < up + down) return base + rise - (rise + below) * smooth((u - up) / down);
  return base - below;
};
const downbeatAt = (at: number, up = 0.33, down = 0.33) => at + up + down;

describe('the ready height is taken again', () => {
  it('a raise in two steps (0.6, then 1.0), then a real upbeat, starts', () => {
    const raise = (t: number) => (t < 1 ? -0.05 : t < 1.6 ? 0.6 : t < 2.6 ? 1.0 : upbeat(t, 3.4, 1.0));
    const { phases, started } = drive(raise, 6, undefined, { anchors: [downbeatAt(3.4)] });
    expect(phases).toContain('prepared');
    expect(started).toBeGreaterThan(downbeatAt(3.4) - 0.01);
    expect(started).toBeLessThan(downbeatAt(3.4) + 0.2);
  });

  it('a quick dip that times out, a re-ready at a new height, then a real upbeat, starts', () => {
    const dip = (t: number) => (t < 2 ? 0.7 : t < 2.3 ? 0.7 - 0.3 * smooth((t - 2) / 0.3) : t < 2.45 ? 0.4 : t < 2.75 ? 0.4 + 0.3 * smooth((t - 2.45) / 0.3) : 0.7);
    const raise = (t: number) => (t < 1 ? -0.05 : t < 1.4 ? 0.7 : t < 5.5 ? (t < 5 ? dip(t - 1.4 + 1.4) : 0.95) : upbeat(t, 6.5, 0.95));
    const { phases, started } = drive(raise, 9, undefined, { anchors: [downbeatAt(6.5)] });
    expect(phases.filter((p) => p === 'prepared').length).toBeGreaterThan(0);
    expect(started).toBeGreaterThan(downbeatAt(6.5) - 0.01);
    expect(started).toBeLessThan(downbeatAt(6.5) + 0.2);
  });
});

describe('a glitched frame is not an upbeat', () => {
  const steadyThenUpbeat = (glitch: (t: number, h: number) => number | undefined) => (t: number) => glitch(t, t < 1 ? -0.05 : t < 3 ? 0.9 : upbeat(t, 3, 0.9));
  it('one frame of a low reading (the elbow standing in for an unseen wrist) while ready starts nothing; the real upbeat still does', () => {
    const { phases, started } = drive(steadyThenUpbeat((t, h) => (Math.abs(t - 2.2) < 1 / 60 ? 0.2 : h)), 5.5, undefined, { anchors: [downbeatAt(3)] });
    // Nothing prepared before the real upbeat's fall (which comes after 3.33 s).
    const tr = createTransport({ upbeat: 'shape' });
    let early = false;
    for (let i = 0; i <= 3.3 * 30; i++) {
      const t = i / 30;
      const s = tr.step({ t, raise: steadyThenUpbeat((tt, h) => (Math.abs(tt - 2.2) < 1 / 60 ? 0.2 : h))(t), motion: 1 });
      if (s.phase === 'prepared') early = true;
    }
    expect(early).toBe(false);
    expect(phases).toContain('prepared');
    expect(started).toBeGreaterThan(downbeatAt(3) - 0.01);
  });
  it('one NaN frame after a rise completes nothing', () => {
    const raise = (t: number) => (t < 1 ? -0.05 : t < 2 ? 0.9 : t < 2.3 ? 0.9 + 0.2 * smooth((t - 2) / 0.3) : t < 3.5 ? 1.1 : 1.1);
    const tr = createTransport({ upbeat: 'shape' });
    let prepared = false;
    for (let i = 0; i <= 5 * 30; i++) {
      const t = i / 30;
      const r = Math.abs(t - 2.4) < 1 / 60 ? Number.NaN : raise(t);
      if (tr.step({ t, raise: r, motion: 1, ...(t > 3.5 ? { anchor: t - 0.03 } : {}) }).phase === 'prepared') prepared = true;
    }
    expect(prepared).toBe(false);
  });
  it('one frame of a high reading is no rise', () => {
    const raise = (t: number) => (t < 1 ? -0.05 : Math.abs(t - 2) < 1 / 60 ? 1.4 : 0.9);
    const { phases } = drive(raise, 5);
    expect(phases).not.toContain('prepared');
  });
});

describe('tempo and frame rate', () => {
  it('the same upbeat starts at 20, 30 and 60 fps', () => {
    for (const fps of [20, 30, 60]) {
      const raise = (t: number) => (t < 1 ? -0.05 : t < 3 ? 0.9 : upbeat(t, 3, 0.9));
      const { started } = drive(raise, 5.5, undefined, { fps, anchors: [downbeatAt(3)] });
      expect(started, `${fps} fps`).toBeGreaterThan(downbeatAt(3) - 0.01);
      expect(started, `${fps} fps`).toBeLessThan(downbeatAt(3) + 0.2);
    }
  });
  it('a slow tempo (the fall takes 2 s) starts once fallWithinS allows it, and not before', () => {
    const slow = (t: number) => (t < 1 ? -0.05 : t < 3 ? 0.9 : upbeat(t, 3, 0.9, { up: 0.6, down: 2, rise: 0.25, below: 0.3 }));
    const anchors = [downbeatAt(3, 0.6, 2)];
    expect(drive(slow, 7, { upbeat: 'shape' }, { anchors }).phases).not.toContain('running');
    const wide = drive(slow, 7, { upbeat: 'shape', fallWithinS: 1.5 }, { anchors });
    expect(wide.started).toBeGreaterThan(anchors[0] - 0.01);
    expect(wide.started).toBeLessThan(anchors[0] + 0.2);
  });
});

describe('modes', () => {
  it('a live switch from speed to shape keeps the phase and then reads the shape', () => {
    const tr = createTransport({});
    const raise = (t: number) => (t < 1 ? -0.05 : t < 3 ? 0.9 : upbeat(t, 3.2, 0.9));
    let started = NaN;
    for (let i = 0; i <= 6 * 30; i++) {
      const t = i / 30;
      if (i === Math.round(1.8 * 30)) tr.configure({ upbeat: 'shape' });
      const a = t >= downbeatAt(3.2) + 1 / 30 - 1e-9 && t < downbeatAt(3.2) + 2 / 30 - 1e-9 ? downbeatAt(3.2) : undefined;
      const s = tr.step({ t, raise: raise(t), motion: 1, ...(a !== undefined ? { anchor: a } : {}) });
      if (s.started && Number.isNaN(started)) started = t;
    }
    expect(started).toBeGreaterThan(downbeatAt(3.2) - 0.01);
    expect(started).toBeLessThan(downbeatAt(3.2) + 0.2);
  });

  it('while the mode is speed the shape settings change nothing', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const steps = Array.from({ length: 3000 }, (_, i) => ({ t: i / 30, raise: rnd() < 0.05 ? undefined : rnd() * 1.3 - 0.1, motion: rnd() < 0.05 ? undefined : rnd() * 20, anchor: rnd() < 0.04 ? i / 30 : undefined }));
    const a = createTransport({});
    const b = createTransport({ upbeat: 'speed', riseMin: 0.5, dipBelow: 0.3, fallWithinS: 2, fastFall: 0.6, steadyBand: 0.001 });
    for (const s of steps) expect(b.step(s)).toEqual(a.step(s));
  });
});
