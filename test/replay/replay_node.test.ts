/**
 * The `replay-hands` source plays a recording the player loaded (the engine resource the Replay
 * tool fills) BY TIME: at its own pace whatever the tick rate, from its first frame when a new one
 * is loaded, looped or held at the end.
 */
import { describe, it, expect } from 'vitest';
import { replayHandsNode, HAND_REPLAY_RESOURCE_KEY, type HandReplay } from '@/nodes/sources/replay_hands';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { NodeContext } from '@thoremin/dag';

const frameN = (n: number): HandsFrame => ({ width: n + 1, height: 1, hands: [] });
const take = (id: number, loop: boolean): HandReplay => ({ id, frames: [0, 1, 2].map(frameN), times: [0, 1 / 30, 2 / 30], loop });

function play(getReplay: () => HandReplay | null, ticks: number, dt: number) {
  const inst = replayHandsNode.make(replayHandsNode.params.parse({}));
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const ctx = { tick: i, time: 100 + i * dt, dt, resources: { [HAND_REPLAY_RESOURCE_KEY]: getReplay } } as unknown as NodeContext;
    const { hands } = inst.process({}, ctx) as { hands: HandsFrame };
    out.push(hands.width - 1);
  }
  return out;
}

describe('replay-hands plays a loaded recording by time', () => {
  it('holds each 30 fps frame for two 60 fps ticks, and loops', () => {
    expect(play(() => take(1, true), 8, 1 / 60)).toEqual([0, 0, 1, 1, 2, 2, 0, 0]);
  });

  it('holds the last frame when not looping', () => {
    expect(play(() => take(1, false), 8, 1 / 30)).toEqual([0, 1, 2, 2, 2, 2, 2, 2]);
  });

  it('starts a newly loaded recording from its first frame', () => {
    let current = take(1, true);
    const inst = replayHandsNode.make(replayHandsNode.params.parse({}));
    const at = (i: number) => (inst.process({}, { tick: i, time: i / 30, dt: 1 / 30, resources: { [HAND_REPLAY_RESOURCE_KEY]: () => current } } as unknown as NodeContext) as { hands: HandsFrame }).hands.width - 1;
    expect([at(0), at(1)]).toEqual([0, 1]);
    current = take(2, true);
    expect([at(2), at(3)]).toEqual([0, 1]);
  });

  it('emits no hands with nothing loaded, and its own frames win over a loaded recording', () => {
    expect(play(() => null, 3, 1 / 30)).toEqual([640 - 1, 640 - 1, 640 - 1]);
    const own = replayHandsNode.make(replayHandsNode.params.parse({ frames: [frameN(7)] }));
    const ctx = { tick: 0, time: 0, dt: 0, resources: { [HAND_REPLAY_RESOURCE_KEY]: () => take(1, true) } } as unknown as NodeContext;
    expect((own.process({}, ctx) as { hands: HandsFrame }).hands.width).toBe(8);
  });
});

describe('replay-hands with every frame at one time', () => {
  it('loops without dividing by zero', () => {
    const same: HandReplay = { id: 9, frames: [0, 1].map(frameN), times: [0, 0], loop: true };
    const out = play(() => same, 4, 1 / 30);
    expect(out.every((x) => Number.isFinite(x))).toBe(true);
  });
});
