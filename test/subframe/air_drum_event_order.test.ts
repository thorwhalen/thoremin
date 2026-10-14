/**
 * Two event-order behaviours of the air drum's `process()` (#475), pinned with a SCRIPTED
 * predictor so the batches are exact rather than whatever a fixture happens to produce.
 *
 * 1. A stroke's prediction and its confirmation decided under different sub-frame
 *    standings (#318), and a confirmation and the next stroke's prediction arriving in
 *    one `push()` batch: the confirmation of a prediction already sounded is routed to the
 *    frame-snapped path (`onSnapped`), which clears the stick's commit before its
 *    `decided` early return and so neither sounds it again nor measures a lag from it; a
 *    batch is routed in order, so a confirmation never wipes the commit of the prediction
 *    that follows it in the same batch.
 * 2. The magnet's outcome for a prediction reads the lag gate as it stood at the START of
 *    the tick (`DrumTick.gate`), even when a confirmation earlier in the same batch has
 *    just pushed the lag that would open it.
 *
 * The predictor is replaced through `vi.mock` of `@thoremin/ictus`: the node builds its
 * own, and these are statements about what the NODE does with a given event order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replayNode } from '@thoremin/dag';
import type { HandsFrame } from '@/nodes';
import type { ImpactEvent, ImpactPredictor, MusicalTime } from '@thoremin/ictus';
import { LAG_MIN_STROKES } from '@thoremin/ictus';
import type { DrumHit, AirDrumStatus } from '@thoremin/ext-air/nodes/air_drum';
import { knownOutputStage } from '../helpers/timing';

/** One scripted event: a prediction of impact `t`, or the confirmation of impact `t`
 *  whose prediction was `predicted` (the predictor's own `committed`). */
type Step = { kind: 'predict'; t: number } | { kind: 'confirm'; t: number; predicted: number | null };

const script = vi.hoisted(() => ({ byFrame: new Map<number, Step[]>(), frame: 0 }));

vi.mock('@thoremin/ictus', async (importOriginal) => {
  const real = await importOriginal<typeof import('@thoremin/ictus')>();
  const createImpactPredictor = (): ImpactPredictor => ({
    push(sample) {
      const steps = script.byFrame.get(script.frame++) ?? [];
      return steps.map((s): ImpactEvent =>
        s.kind === 'predict'
          ? { kind: 'predict', t: s.t, at: sample.t, lead: s.t - sample.t, strength: 1, confidence: 1, crossing: s.t, provisional: false, floor: 0.6 }
          : { kind: 'confirm', t: s.t, at: sample.t, predicted: s.predicted, correction: s.predicted === null ? null : s.t - s.predicted, strength: 1, confidence: 1, vertex: s.t, crossing: s.t, floor: 0.6, depth: 0.6, top: 0.4, fit: null },
      );
    },
    setPeriod() {},
    setMinLead() {},
    setFloor() {},
    top: () => NaN,
    level: () => 0.6,
    lag: () => 0,
    envelope: () => 0.1,
    lastKind: () => 'surface',
    dropStroke() {},
    unlearnedConfirmations: () => 0,
    reset() {},
  });
  return { ...real, createImpactPredictor };
});

// The test setup preloads the extensions, so the node module is already cached with the
// real predictor: load a fresh copy that sees the mock.
vi.resetModules();
const { airDrumNode, SUBFRAME_DWELL_FRAMES } = await import('@thoremin/ext-air/nodes/air_drum');

const FPS = 30;
const N = 150;
/** A still hand (the mirrored webcam labels the player's right hand 'Left'): the events
 *  are the script's, and a still stick is never a carried one. */
const frames: HandsFrame[] = Array.from({ length: N }, () => ({
  width: 640,
  height: 480,
  hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: 320, y: 300 })) }],
}));
/** A running grid, a beat every 0.5 s on the whole half-seconds. */
const PERIOD = 0.5;
const grid: MusicalTime[] = frames.map((_, k) => {
  const t = k / FPS;
  const beat = t / PERIOD;
  return { t, beat, phase: beat - Math.floor(beat), tempo: 60 / PERIOD, period: PERIOD, confidence: 1, nextBeatAt: (Math.floor(beat) + 1) * PERIOD, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 8 };
});

const quiet = knownOutputStage(0, 'measured', { dominantSource: 'estimated', stampNoise: 0.0005 }).timing();
const noisy = { ...quiet, stampNoise: 0.03 };

async function play(steps: Record<number, Step[]>, opts: { noisyFrom?: number; magnetism?: number } = {}) {
  script.byFrame = new Map(Object.entries(steps).map(([k, v]) => [Number(k), v]));
  script.frame = 0;
  let tick = 0;
  const resources = { timing: () => (tick++ >= (opts.noisyFrom ?? Infinity) ? noisy : quiet) };
  const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, magnetism: opts.magnetism ?? 0 }));
  const outs = await replayNode(h, { hands: frames, time: grid }, { dt: 1 / FPS, resources });
  const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
  return { hits, statuses: outs.map((o) => o.status as AirDrumStatus) };
}

beforeEach(() => {
  script.byFrame = new Map();
  script.frame = 0;
});

describe('air drum event order (#475)', () => {
  it('the script drives the node: a prediction sounds ahead, its confirmation measures the lag and sounds nothing', async () => {
    const { hits, statuses } = await play({ 20: [{ kind: 'predict', t: 0.8 }], 25: [{ kind: 'confirm', t: 0.81, predicted: 0.8 }] });
    expect(hits.map((h) => [h.tick, h.impactT, h.predicted])).toEqual([[20, 0.8, true]]);
    // One lag, the confirmed impact against the beat nearest the commit (0.81 - 1.0).
    expect(statuses[N - 1].magnetLag).toBeCloseTo(-0.19, 9);
  });

  it('a prediction sounded while predicting, confirmed after the standing flipped to off-stamps: sounded once, no lag; the next stroke in the same batch sounds once, frame-snapped', async () => {
    // Noisy from frame 7: the standing flips after the dwell, at frame 7 + DWELL - 1 = 21,
    // the frame after the prediction.
    const noisyFrom = 21 - (SUBFRAME_DWELL_FRAMES - 1);
    const { hits, statuses } = await play(
      {
        20: [{ kind: 'predict', t: 0.8 }],
        // The confirmation of 0.8 and the next stroke's prediction, one batch.
        26: [{ kind: 'confirm', t: 0.81, predicted: 0.8 }, { kind: 'predict', t: 1.1 }],
        33: [{ kind: 'confirm', t: 1.1, predicted: 1.1 }],
      },
      { noisyFrom },
    );
    expect(statuses[20].subframe).toBe('on');
    expect(statuses[21].subframe).toBe('off-stamps');
    // 0.8 once (its prediction); 1.1 once, at its confirmation (never predicted ahead).
    expect(hits.map((h) => [h.tick, h.predicted])).toEqual([[20, true], [33, false]]);
    expect(hits[0].impactT).toBe(0.8);
    expect(hits[1].t).toBeCloseTo(33 / FPS, 9);
    expect(hits[1].velocity).toBeGreaterThan(0);
    // The snapped path measures no lag: neither confirmation reached the gate.
    expect(statuses[N - 1].magnetLag).toBeNaN();
  });

  it('while predicting, a confirmation and the next prediction in one batch are taken in order: each stroke sounds once, both lags measured', async () => {
    const { hits, statuses } = await play({
      20: [{ kind: 'predict', t: 0.8 }],
      26: [{ kind: 'confirm', t: 0.81, predicted: 0.8 }, { kind: 'predict', t: 1.1 }],
      33: [{ kind: 'confirm', t: 1.09, predicted: 1.1 }],
    });
    expect(hits.map((h) => [h.tick, h.impactT, h.predicted])).toEqual([[20, 0.8, true], [26, 1.1, true]]);
    // Both strokes' lags: 0.81 - 1.0 and 1.09 - 1.0.
    expect(statuses[N - 1].magnetLag).toBeCloseTo((-0.19 + 0.09) / 2, 9);
  });

  it('the magnet reads the lag gate as it stood at the start of the tick, not after a confirmation earlier in the same batch', async () => {
    // Strokes 10 ms either side of the beats: an unbiased grid the gate opens to once
    // LAG_MIN_STROKES lags are in. The LAG_MIN_STROKES-th confirmation arrives in the
    // same batch as the next stroke's prediction.
    const beats = [1, 1.5, 2, 2.5, 3, 3.5];
    const off = (i: number) => (i % 2 ? -0.01 : 0.01);
    const impact = (i: number) => beats[i] + off(i);
    const steps: Record<number, Step[]> = {};
    const add = (frame: number, s: Step) => (steps[frame] ??= []).push(s);
    for (let i = 0; i < beats.length; i++) {
      add(Math.round((impact(i) - 0.2) * FPS), { kind: 'predict', t: impact(i) });
      add(Math.round((impact(i) + 0.05) * FPS), { kind: 'confirm', t: impact(i), predicted: impact(i) });
    }
    // Move stroke LAG_MIN_STROKES's prediction into the batch of the confirmation before it.
    const k = LAG_MIN_STROKES;
    const batchFrame = Math.round((impact(k - 1) + 0.05) * FPS);
    for (const [f, ss] of Object.entries(steps)) steps[Number(f)] = ss.filter((s) => !(s.kind === 'predict' && s.t === impact(k)));
    add(batchFrame, { kind: 'predict', t: impact(k) });
    expect(steps[batchFrame].map((s) => s.kind)).toEqual(['confirm', 'predict']);

    const { hits, statuses } = await play(steps, { magnetism: 1 });
    expect(hits.length).toBe(beats.length);
    const byImpact = (i: number) => hits.find((h) => Math.abs(h.impactT - impact(i)) < 1e-9)!;
    // Before the batch, the gate is closed (warming): nothing pulled.
    expect(statuses[batchFrame - 1].magnetGate).toBe(0);
    // The batch's confirmation opened the gate...
    expect(statuses[batchFrame].magnetGate).toBeGreaterThan(0.5);
    // ...but the prediction in the same batch was decided with the gate at its start.
    expect(byImpact(k).tick).toBe(batchFrame);
    expect(byImpact(k).pull).toBe(0);
    // The next stroke, in a later tick, is pulled toward its beat.
    expect(byImpact(k + 1).pull).not.toBe(0);
    expect(Math.abs(byImpact(k + 1).t - beats[k + 1])).toBeLessThan(Math.abs(off(k + 1)));
  });
});
