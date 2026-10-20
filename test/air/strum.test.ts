/**
 * The strum decision the air guitar and the chord map share (`@thoremin/sdk/gesture/strum`, the SDK's since #674):
 * strokes of a steady down-and-up motion are predicted ahead of the frame that shows them; the
 * lead the output needs is read LIVE at each sample (a changed setting applies at once, and the
 * learned stroke floor is kept, which rebuilding the detector would lose); a repeated sample
 * time is not a new camera frame. The review of the chord map found the first version froze the
 * lead at construction; this pins the fix.
 */
import { describe, it, expect } from 'vitest';
import { createStrumDetector, type Strum } from '@thoremin/sdk/gesture/strum';

const FPS = 30;
const PERIOD = 0.5;
const DEPTH = 0.15;
const y = (t: number) => 0.5 + DEPTH * (1 - Math.cos((2 * Math.PI * t) / PERIOD)) * 0.5;

function run(seconds: number, leadAt: (t: number) => number) {
  const d = createStrumDetector({ minLead: 0.05, minStroke: 0.03, minSpeed: 0.5 });
  const strums: (Strum & { decidedAt: number; asked: number })[] = [];
  let readyLost = false;
  let wasReady = false;
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    const t = i / FPS;
    const asked = leadAt(t);
    for (const s of d.push({ t, x: 0.2, y: y(t) }, t, asked)) strums.push({ ...s, decidedAt: t, asked });
    if (wasReady && !d.ready()) readyLost = true;
    wasReady ||= d.ready();
  }
  return { strums, ready: wasReady, readyLost };
}

describe('the strum detector', () => {
  it('predicts most strokes ahead, with at least the lead asked for', () => {
    const { strums, ready } = run(4, () => 0.05);
    const predicted = strums.filter((s) => s.predicted);
    expect(ready).toBe(true);
    expect(strums.length).toBeGreaterThanOrEqual(6);
    expect(predicted.length / strums.length).toBeGreaterThanOrEqual(0.5);
    for (const s of predicted) expect(s.lead).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('reads the lead live: raising it mid-take applies at once and keeps the learned floor', () => {
    // (A stroke can only be committed once its approach is seen: on this motion no lead above
    // about 0.13 s is reachable, so the raise is to 0.1 s.)
    const { strums, readyLost } = run(6, (t) => (t < 3 ? 0.05 : 0.1));
    const before = strums.filter((s) => s.predicted && s.decidedAt < 3);
    const after = strums.filter((s) => s.predicted && s.decidedAt >= 3);
    expect(after.length).toBeGreaterThan(2);
    for (const s of after) expect(s.lead).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(Math.min(...after.map((s) => s.lead))).toBeGreaterThan(Math.max(...before.map((s) => s.lead)));
    expect(readyLost).toBe(false);
  });

  it('ignores a sample that is not a new camera frame', () => {
    const d = createStrumDetector({ minLead: 0.05, minStroke: 0.03, minSpeed: 0.5 });
    let n = 0;
    for (let i = 0; i < 4 * FPS; i++) {
      const t = i / FPS;
      n += d.push({ t, x: 0.2, y: y(t) }, t, 0.05).length;
      // The same frame seen again on a later engine tick.
      n += d.push({ t, x: 0.2, y: y(t) }, t + 0.01, 0.05).length;
    }
    const once = run(4, () => 0.05).strums.length;
    expect(n).toBe(once);
  });
});
