/**
 * The `hands-dwell` node (#314): the hand stream with its labels held by the handedness dwell, for
 * the instruments that pick a hand by label (the air instruments). At dwell 0 it is the identity;
 * above it a one-frame relabel of a single hand does not reach a consumer, in the CAMERA's own
 * convention (so each instrument's `labelFor` finds the hand it always found), with the mirror swap
 * either way round.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { makeHandKeypoints, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { handsDwellNode } from '@/nodes/features/hands_dwell';
import { airDrumNode, type AirDrumStatus } from '@thoremin/ext-air/nodes/air_drum';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';

const hand = (handedness: 'Left' | 'Right'): Hand => ({ handedness, keypoints: makeHandKeypoints({ cx: 300, cy: 240, scale: 80, spread: 0.5, pinch: 0, handedness }), score: 1 });
const frame = (...hands: Hand[]): HandsFrame => ({ width: 640, height: 480, hands });
const run = async (frames: HandsFrame[], params: Record<string, unknown>) =>
  (await replayNode(handsDwellNode.make(handsDwellNode.params.parse(params)), { hands: frames }, { dt: 1 / 30 })).map((o) => (o.hands as HandsFrame).hands.map((h) => h.handedness));

/** A steady 'Left' hand with a one-frame flicker to 'Right' every fifth frame. */
const flicker = (n: number) => Array.from({ length: n }, (_, i) => frame(hand(i % 5 === 4 ? 'Right' : 'Left')));

describe('hands-dwell', () => {
  it('is the identity at dwell 0: the very frames come back', async () => {
    const frames = flicker(10);
    const outs = await replayNode(handsDwellNode.make(handsDwellNode.params.parse({})), { hands: frames }, { dt: 1 / 30 });
    outs.forEach((o, i) => expect(o.hands).toBe(frames[i]));
  });

  it('holds a one-frame flicker of a single hand, in the camera\'s own labels', async () => {
    const labels = await run(flicker(20), { handednessDwellFrames: 3, mirrorHandedness: true });
    expect(new Set(labels.flat())).toEqual(new Set(['Left']));
    // Not mirrored: the same, with the labels the camera used.
    expect(new Set((await run(flicker(20), { handednessDwellFrames: 3, mirrorHandedness: false })).flat())).toEqual(new Set(['Left']));
  });

  it('lets a real, sustained swap through after the dwell', async () => {
    const frames = [...Array.from({ length: 10 }, () => frame(hand('Left'))), ...Array.from({ length: 10 }, () => frame(hand('Right')))];
    const labels = (await run(frames, { handednessDwellFrames: 3 })).flat();
    expect(labels.slice(0, 10).every((l) => l === 'Left')).toBe(true);
    expect(labels.at(-1)).toBe('Right');
    // The switch comes a few frames late, not at once.
    expect(labels[10]).toBe('Left');
  });

  it('leaves two hands as the camera labelled them', async () => {
    const two = Array.from({ length: 6 }, () => frame(hand('Left'), hand('Right')));
    expect(await run(two, { handednessDwellFrames: 3 })).toEqual(two.map(() => ['Left', 'Right']));
  });

  it('an air instrument fed through it keeps its hand across a flicker the raw stream would break', async () => {
    // The synthetic striker is the right hand (the camera's "Left" when mirrored); relabel one
    // frame in six as the other hand, which the raw air drum would take for the other player hand.
    const src = syntheticHandsNode.make(syntheticHandsNode.params.parse({ strike: true }));
    const raw: HandsFrame[] = [];
    for (let i = 0; i < 300; i++) raw.push(((await src.process!({}, { time: i / 30, tick: i, dt: 1 / 30, resources: {} } as never)) as { hands: HandsFrame }).hands);
    // The synthetic hand reads 'Right' to the node; flicker it to 'Left' on every sixth frame.
    const flickering = raw.map((f, i) => (i % 6 === 5 ? { ...f, hands: f.hands.map((h) => ({ ...h, handedness: 'Left' as const })) } : f));
    const drum = async (frames: HandsFrame[]) =>
      ((await replayNode(airDrumNode.make(airDrumNode.params.parse({ enabled: true, mirrorHandedness: false })), { hands: frames as never }, { dt: 1 / 30 })).at(-1)!.status as AirDrumStatus).hits;
    const throughDwell = (await replayNode(handsDwellNode.make(handsDwellNode.params.parse({ handednessDwellFrames: 3, mirrorHandedness: false })), { hands: flickering }, { dt: 1 / 30 })).map((o) => o.hands as HandsFrame);
    const clean = await drum(raw);
    expect(clean).toBeGreaterThanOrEqual(9);
    expect(await drum(throughDwell)).toBeGreaterThanOrEqual(clean - 1);
    expect(await drum(flickering)).toBeLessThan(clean);
  });
});
