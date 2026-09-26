/**
 * #225 — the conductor node feeds `ictus` once per NEW camera frame, not once per tick.
 *
 * The engine ticks at the display rate (60 Hz) over a 30 fps camera, so every camera
 * frame is seen on two ticks. Fed twice at two tick times, the detector's three-point
 * parabolic fit degenerates (two equal samples force the offset to ±half a step, so
 * the sub-frame information is lost) and the backward-difference velocity reads zero
 * every other sample. The fix: the same frame object again — or a distinct copy with
 * the same capture stamp, which is what a replayed recording of a live take delivers
 * — is not an observation; the follower free-runs on that tick instead.
 *
 * Observed three ways. The frame's `hands` is a counting getter, so a frame read on
 * two ticks doubles the count. The 60 Hz run over duplicated frames must produce the
 * same beat trajectory as the 30 Hz run over the originals to within a few
 * milliseconds — tighter than the one-tick (16.7 ms, 0.024 beat) shift a node that
 * sampled each frame on its SECOND tick would produce. And the same on the recorded
 * `conducting_44` fixture, as the issue asked.
 *
 * #226: a frame that carries its capture stamp is sampled at that time when the
 * engine runs in real time at speed 1, and at the tick time otherwise (a replay, a
 * batch run); a sample that would not advance the detector is skipped, not given an
 * invented time.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { conductorNode, type HandsFrame } from '@/nodes';
import { wrapPhase } from '@/ictus';
import { loadStream } from '../helpers/fixtures';

const FPS = 30;
const PERIOD = 0.7;
const RECORDED = { mirrorX: false, mirrorHandedness: false };
/** The engine resources of a real-time run at speed 1 (what the Applier publishes). */
const REALTIME = { timeScale: 1 };

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

async function run(frames: HandsFrame[], dt: number, resources: Record<string, unknown> = {}) {
  const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
  return replayNode(h, { hands: frames }, { dt, resources });
}

const beats = (outs: Record<string, unknown>[]) => outs.map((o) => o.beat as number);
const phases = (outs: Record<string, unknown>[]) => outs.map((o) => (o.time as { phase: number }).phase);
/** The distinct anchor times the follower reported over a run, in order. */
function anchorTimes(outs: Record<string, unknown>[]): number[] {
  const out: number[] = [];
  for (const o of outs) {
    const t = (o.time as { lastAnchorAt?: number }).lastAnchorAt;
    if (t !== undefined && t !== out[out.length - 1]) out.push(t);
  }
  return out;
}

/**
 * Largest |a[2i] - b[i]| from `fromSeconds` on: the 60 Hz run sampled at the
 * camera-frame ticks against the 30 Hz run. The first seconds are skipped because the
 * phase servo starts one tick apart in the two runs (the tick after the first stroke)
 * and converges over a few beats; a node that sampled each frame on its SECOND tick
 * would instead shift the follower's anchors by a constant 16.7 ms (0.024 beat at 70
 * bpm), which the servo tracks and never removes.
 */
function maxDiffAtFrames(a60: number[], b30: number[], fromSeconds = 4): number {
  let m = 0;
  for (let i = Math.round(fromSeconds * FPS); i < b30.length; i++) m = Math.max(m, Math.abs(a60[2 * i] - b30[i]));
  return m;
}

describe('conductor node over a 60 Hz tick and a 30 fps camera (#225)', () => {
  it('reads each camera frame on one tick only, and its beat matches the 30 Hz run to within a few ms', async () => {
    const reads30 = { count: 0 };
    const frames30 = Array.from({ length: Math.round(seconds * FPS) }, (_, i) => frameAt(i / FPS, phase, reads30));
    const outs30 = await run(frames30, 1 / FPS);
    expect(reads30.count).toBeGreaterThan(0);

    // 60 Hz: every camera frame is presented on two consecutive ticks. The node reads
    // a frame's hands a fixed number of times when it observes it, so the read count
    // over the duplicated stream equals the 30 Hz count exactly when each frame is
    // observed once.
    const reads60 = { count: 0 };
    const same = Array.from({ length: frames30.length }, (_, i) => frameAt(i / FPS, phase, reads60));
    const outs60 = await run(
      same.flatMap((f) => [f, f]),
      1 / (2 * FPS),
    );
    expect(reads60.count).toBe(reads30.count);

    const last60 = outs60[outs60.length - 1];
    const last30 = outs30[outs30.length - 1];
    expect((last60.time as { state: string }).state).toBe('running');
    expect((last60.time as { anchors: number }).anchors).toBe((last30.time as { anchors: number }).anchors);
    expect(last60.bpm as number).toBeCloseTo(last30.bpm as number, 0);
    // The beat trajectories agree at every camera-frame time. The only difference left
    // is the servo's integration step; a node that sampled each frame on its second
    // tick would be 0.024 beat (16.7 ms) off.
    expect(maxDiffAtFrames(beats(outs60), beats(outs30))).toBeLessThan(0.006);
    expect(last30.beat as number).toBeGreaterThan(seconds / PERIOD - 2);
    // The follower's anchors are the SAME times in both runs, and each is within the
    // 8 ms bound test/ictus_detector.test.ts pins for the detector at 30 fps.
    const a60 = anchorTimes(outs60);
    expect(a60).toEqual(anchorTimes(outs30));
    expect(a60.length).toBeGreaterThanOrEqual(8);
    for (const t of a60) {
      const k = Math.round((t - phase) / PERIOD);
      expect(Math.abs(t - (phase + k * PERIOD))).toBeLessThan(0.008);
    }
  });

  it('the same on the recorded conducting_44 fixture (the issue\'s acceptance case)', async () => {
    const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const outs30 = await run(frames, 1 / FPS);
    const outs60 = await run(
      frames.flatMap((f) => [f, f]),
      1 / (2 * FPS),
    );
    // Identical anchors (the sub-frame refined times, to the bit): the 60 Hz tick
    // added no observation and moved none. A node sampling each frame on its second
    // tick would shift every one of these by 16.7 ms.
    const a60 = anchorTimes(outs60);
    expect(a60.length).toBeGreaterThanOrEqual(8);
    expect(a60).toEqual(anchorTimes(outs30));
    expect(maxDiffAtFrames(beats(outs60), beats(outs30))).toBeLessThan(0.03);
  });

  it('a distinct copy with the same capture stamp is not a new observation either (a replayed live take)', async () => {
    const n = Math.round(seconds * FPS);
    const stamped = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase, undefined, { t: 1000 + i / FPS, tSource: 'capture' }));
    const outs30 = await run(stamped, 1 / FPS);
    // Each camera frame as two parsed copies (what the recorder wrote on two ticks).
    const copies = stamped.flatMap((f) => [{ ...f }, { ...f }]);
    const outs60 = await run(copies, 1 / (2 * FPS));
    expect((outs60[outs60.length - 1].time as { anchors: number }).anchors).toBe((outs30[outs30.length - 1].time as { anchors: number }).anchors);
    expect(maxDiffAtFrames(beats(outs60), beats(outs30))).toBeLessThan(0.006);
  });
});

describe('conductor node sample time (#226)', () => {
  const n = Math.round(seconds * FPS);
  const lag = 0.02;
  const plain = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase));
  /** Stamped 20 ms BEFORE the tick that consumes them, in the tick's time base. */
  const stamped = Array.from({ length: n }, (_, i) => frameAt(i / FPS, phase, undefined, { t: i / FPS - lag, tSource: 'capture', lag }));

  /** Mean wrapped phase difference over the last second (once the servo has converged). */
  const meanShift = (a: number[], b: number[]) => {
    const from = a.length - FPS;
    let sum = 0;
    for (let i = from; i < a.length; i++) sum += wrapPhase(a[i] - b[i]);
    return sum / FPS;
  };

  it('in real time at speed 1 the stamp is the sample time: the beat lands earlier by the lag', async () => {
    const pPlain = phases(await run(plain, 1 / FPS, REALTIME));
    const pStamped = phases(await run(stamped, 1 / FPS, REALTIME));
    const shift = meanShift(pStamped, pPlain);
    // Earlier anchors: at a given tick the phase is further along by about lag/PERIOD.
    expect(shift).toBeGreaterThan(0.5 * (lag / PERIOD));
    expect(shift).toBeLessThan(2 * (lag / PERIOD));
  });

  it('under a batch or scaled clock, or without a source, the stamp is ignored', async () => {
    const pPlain = phases(await run(plain, 1 / FPS));
    expect(phases(await run(stamped, 1 / FPS))).toEqual(pPlain); // no timeScale: batch
    expect(phases(await run(stamped, 1 / FPS, { timeScale: 0.5 }))).toEqual(pPlain);
    const unsourced = stamped.map((f) => ({ ...f, tSource: undefined }));
    expect(phases(await run(unsourced, 1 / FPS, REALTIME))).toEqual(phases(await run(plain, 1 / FPS, REALTIME)));
  });

  it('a stamp that does not advance the detector is skipped, not given an invented time', async () => {
    // The first ten frames are unstamped (a synthetic source), then the webcam takes
    // over with stamps 20 ms behind the tick: the first stamped frame lands behind the
    // last tick-timed sample and must be dropped rather than clamped to a microstep
    // (which would spike the speed fallback for tens of seconds).
    const swap = plain.slice(0, 10).concat(stamped.slice(10));
    const outsSwap = await run(swap, 1 / FPS, REALTIME);
    const outsStamped = await run(stamped, 1 / FPS, REALTIME);
    const bSwap = beats(outsSwap);
    const bStamped = beats(outsStamped);
    // Same anchors and the same trajectory once past the swap.
    expect((outsSwap[outsSwap.length - 1].time as { anchors: number }).anchors).toBe((outsStamped[outsStamped.length - 1].time as { anchors: number }).anchors);
    let m = 0;
    for (let i = 60; i < n; i++) m = Math.max(m, Math.abs(bSwap[i] - bStamped[i]));
    expect(m).toBeLessThan(0.02);
  });
});
