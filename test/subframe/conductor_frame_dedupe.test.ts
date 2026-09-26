/**
 * #225 — the conductor node feeds `ictus` once per NEW camera frame, not once per tick.
 *
 * The engine ticks at the display rate (60 Hz) over a 30 fps camera, so every camera
 * frame is seen on two ticks. Fed twice at two tick times, the detector's three-point
 * parabolic fit degenerates (two equal samples force the offset to ±half a step, so
 * the sub-frame information is lost) and the backward-difference velocity reads zero
 * every other sample. The fix: the same frame object again is not an observation; the
 * follower free-runs on that tick instead.
 *
 * Observed two ways: the frame's `hands` is a counting getter (the node may read a
 * frame once), and the 60 Hz run over duplicated frames must produce the same beat
 * trajectory as the 30 Hz run over the originals. Also (#226): a frame that carries
 * its capture time `t` is sampled at that time, and a frame whose `t` is in another
 * time base falls back to the tick time.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { conductorNode, type HandsFrame } from '@/nodes';
import { wrapPhase } from '@/ictus';

const FPS = 30;
const PERIOD = 0.7;
const RECORDED = { mirrorX: false, mirrorHandedness: false };

/** A conducting-like stroke of the wrist: lowest (largest y) at t = k*PERIOD + phase. */
function wristAt(t: number, phase: number): { x: number; y: number } {
  const u = (2 * Math.PI * (t - phase)) / PERIOD;
  return { x: 300 + 20 * Math.sin(u / 2), y: 300 + (100 * (Math.cos(u) + 1)) / 2 };
}

function frameAt(t: number, phase: number, reads?: { count: number }, extra: Partial<HandsFrame> = {}): HandsFrame {
  const w = wristAt(t, phase);
  const keypoints = Array.from({ length: 21 }, (_, i) => ({ x: w.x + i, y: w.y + i }));
  const hands = [{ handedness: 'Right' as const, keypoints }];
  const frame: HandsFrame = { width: 640, height: 480, hands, ...extra };
  if (reads) {
    Object.defineProperty(frame, 'hands', {
      get() {
        reads.count++;
        return hands;
      },
    });
  }
  return frame;
}

const seconds = 8;
const phase = 0.0123;

describe('conductor node over a 60 Hz tick and a 30 fps camera (#225)', () => {
  it('reads each camera frame on one tick only, and its beat matches the 30 Hz run', async () => {
    const reads30 = { count: 0 };
    const frames30 = Array.from({ length: Math.round(seconds * FPS) }, (_, i) => frameAt(i / FPS, phase, reads30));
    const h30 = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const outs30 = await replayNode(h30, { hands: frames30 }, { dt: 1 / FPS });
    expect(reads30.count).toBeGreaterThan(0);

    // 60 Hz: every camera frame is presented on two consecutive ticks. The node reads
    // a frame's hands a fixed number of times when it observes it, so the read count
    // over the duplicated stream equals the 30 Hz count exactly when each frame is
    // observed once.
    const reads60 = { count: 0 };
    const same = Array.from({ length: frames30.length }, (_, i) => frameAt(i / FPS, phase, reads60));
    const frames60 = same.flatMap((f) => [f, f]);
    const h60 = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const outs60 = await replayNode(h60, { hands: frames60 }, { dt: 1 / (2 * FPS) });
    expect(reads60.count).toBe(reads30.count);

    const last60 = outs60[outs60.length - 1];
    const last30 = outs30[outs30.length - 1];
    expect((last60.time as { state: string }).state).toBe('running');
    expect((last60.time as { anchors: number }).anchors).toBe((last30.time as { anchors: number }).anchors);
    expect(last60.bpm as number).toBeCloseTo(last30.bpm as number, 0);
    // The beat trajectories agree at every camera-frame time (the tick granularity of
    // the servo integration is the only difference left).
    for (let i = 0; i < outs30.length; i++) {
      const b30 = outs30[i].beat as number;
      const b60 = outs60[2 * i].beat as number;
      expect(Math.abs(b60 - b30)).toBeLessThan(0.05);
    }
    expect(last30.beat as number).toBeGreaterThan(seconds / PERIOD - 2);
  });

  it('a frame that carries its capture time is sampled at that time (#226)', async () => {
    // Frames stamped with a capture time 20 ms BEFORE the tick that consumes them:
    // the anchors (and so the phase) should be what the 30 Hz run reports shifted by
    // 20 ms, not by 0. Both runs are then compared to a third where the stamp is in
    // another time base (seconds since boot vs the tick clock) and must be ignored.
    const n = Math.round(seconds * FPS);
    const lag = 0.02;
    const stamped = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase, undefined, { t: i / FPS - lag, lag }));
    const foreign = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase, undefined, { t: 1e6 + i / FPS, lag }));
    const plain = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase));

    const run = async (frames: HandsFrame[]) => {
      const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS });
      return outs.map((o) => (o.time as { phase: number }).phase);
    };
    const pStamped = await run(stamped);
    const pForeign = await run(foreign);
    const pPlain = await run(plain);
    // Compare late in the run, once the servo has converged; phase differences are
    // wrapped so a beat boundary between the two runs does not read as a full beat.
    const late = pStamped.length - 30;
    let dStamped = 0;
    let dForeign = 0;
    for (let i = late; i < pStamped.length; i++) {
      dStamped += wrapPhase(pStamped[i] - pPlain[i]);
      dForeign += Math.abs(wrapPhase(pForeign[i] - pPlain[i]));
    }
    // The foreign stamp is ignored: identical to the plain run.
    expect(dForeign).toBe(0);
    // The honest stamp puts the beat EARLIER, so at a given tick the phase is further
    // along by about lag/PERIOD of a beat.
    expect(dStamped / 30).toBeGreaterThan(0.5 * (lag / PERIOD));
    expect(dStamped / 30).toBeLessThan(2 * (lag / PERIOD));
  });
});
