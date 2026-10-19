/**
 * The synthetic hand's strike mode (`?synthetic.strike=1`, the browser smoke's drummer): its stick
 * SWINGS about the wrist, which is what the air drum's stick tip reads as a stroke (a hand that
 * only translates is an arm carrying the stick). Replayed through the `air-drum` node at 30 Hz:
 * a stroke every 0.9 s becomes a hit, and the default sweeping hand never drums.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { airDrumNode, type AirDrumStatus } from '@thoremin/ext-air/nodes/air_drum';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';

async function hitsOver(seconds: number, strike: boolean): Promise<AirDrumStatus> {
  const src = syntheticHandsNode.make(syntheticHandsNode.params.parse({ strike }));
  const frames: unknown[] = [];
  for (let i = 0; i < seconds * 30; i++) frames.push(((await src.process!({}, { time: i / 30, tick: i, dt: 1 / 30, resources: {} } as never)) as { hands: unknown }).hands);
  const outs = await replayNode(airDrumNode.make(airDrumNode.params.parse({ enabled: true })), { hands: frames as never }, { dt: 1 / 30 });
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
});
