/**
 * The synthetic hand's strike mode (`?synthetic.strike=1`, the browser smoke's drummer): its stick
 * SWINGS about the wrist, which is what the air drum's stick tip reads as a stroke (a hand that
 * only translates is an arm carrying the stick). Replayed through the `air-drum` node: a stroke
 * every 0.9 s becomes a hit, at the camera's 30 Hz and at the browser's 60 Hz and above, whatever
 * the phase of the frames against the strokes, and the default sweeping hand never drums.
 *
 * #890: at 60 Hz every step of the stroke's fall was smaller than the falling segment's jitter
 * tolerance, which was then taken step to step, so the whole fall read as a stick held at the top,
 * the segment shrank to the last three samples and every stroke was judged carried: no hit, no
 * floor learned. A 0.9 s stroke is 54 frames at 60 Hz, so the frames' phase against the strokes was
 * fixed for a whole page, and a page passed only on the strokes a late frame happened to split.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { airDrumNode, fallingSegment, type AirDrumStatus, type TrackSample } from '@thoremin/ext-air/nodes/air_drum';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';

/** The drum's status after `seconds` of the synthetic hand at `hz`, its clock starting at `t0`
 *  (the phase of the frames against the strokes). */
async function hitsOver(seconds: number, strike: boolean, { hz = 30, t0 = 0 } = {}): Promise<AirDrumStatus> {
  const src = syntheticHandsNode.make(syntheticHandsNode.params.parse({ strike }));
  const frames: unknown[] = [];
  for (let i = 0; i < seconds * hz; i++) frames.push(((await src.process!({}, { time: t0 + i / hz, tick: i, dt: 1 / hz, resources: {} } as never)) as { hands: unknown }).hands);
  const outs = await replayNode(airDrumNode.make(airDrumNode.params.parse({ enabled: true })), { hands: frames as never }, { dt: 1 / hz });
  return outs.at(-1)!.status as AirDrumStatus;
}

describe('synthetic-hands strike mode', () => {
  it('a swinging stick is hit after hit on the stick tip, mostly predicted', async () => {
    const s = await hitsOver(10, true);
    expect(s.hits).toBeGreaterThanOrEqual(9);
    expect(s.predicted).toBeGreaterThanOrEqual(s.hits - 3);
  });
  it('the default sweeping hand never drums', async () => {
    expect((await hitsOver(10, false)).hits).toBe(0);
  });
  it.each([60, 120])('hits on every stroke at %d Hz, at any phase of the frames (#890)', async (hz) => {
    for (let k = 0; k < 8; k++) {
      const s = await hitsOver(10, true, { hz, t0: (k / 8) * (1 / hz) + k * 0.11 });
      expect(s.hits, `phase ${k}`).toBeGreaterThanOrEqual(9);
      expect(s.ready.left, `phase ${k}: the floor is learned`).toBe(true);
    }
  });
});

describe('fallingSegment', () => {
  /** A fall from 0.2 to 0.6 in 0.15 s after a hold at the top, sampled at `hz`. */
  const fall = (hz: number): TrackSample[] => {
    const out: TrackSample[] = [];
    for (let t = 0; t <= 0.35 + 1e-9; t += 1 / hz) {
      const u = Math.min(1, Math.max(0, (t - 0.2) / 0.15));
      out.push({ t, x: 0.5, y: 0.2 + 0.4 * Math.sin((u * Math.PI) / 2) });
    }
    return out;
  };
  it.each([30, 60, 240])('keeps the whole fall at %d Hz, whatever the step size against the tolerance', (hz) => {
    const samples = fall(hz);
    const seg = fallingSegment(samples, 0.35, 0.1);
    // Departs within the tolerance of the top, ends at the bottom: the fall, not its last steps.
    expect(seg[0].y).toBeLessThanOrEqual(0.2 + 0.1);
    expect(seg[seg.length - 1].y - seg[0].y).toBeGreaterThan(0.4 - 0.1);
  });
});
