/**
 * The synthetic hands' conducting mode (`?synthetic.conduct=1`): one hand beats time with no
 * camera, so the browser can be shown conducting (the guide's picture of Conduct the Chords). Pinned
 * here: the conductor follows it at its period, in the app's own mirror settings and in a recording's.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import type { HandsFrame } from '@/nodes';
import { CONDUCTOR } from '../helpers/extensions';

const FPS = 30;
const SECONDS = 10;

function conductingFrames(): HandsFrame[] {
  const p = syntheticHandsNode.params.parse({ conduct: true });
  const h = syntheticHandsNode.make(p);
  return Array.from({ length: FPS * SECONDS }, (_, i) => (h.process({}, { tick: i, time: i / FPS, dt: 1 / FPS, resources: {} } as never) as { hands: HandsFrame }).hands);
}

describe.runIf(CONDUCTOR)('the synthetic hands conduct', () => {
  it('one hand drops once per beat', () => {
    const frames = conductingFrames();
    expect(frames[0].hands.map((h) => h.handedness)).toEqual(['Right']);
    const wristY = frames.map((f) => f.hands[0].keypoints[0].y);
    expect(Math.max(...wristY) - Math.min(...wristY)).toBeGreaterThan(0.1 * 480 * 0.9);
  });

  for (const [name, mirror] of [['the app', {}], ['a recording', { mirrorX: false, mirrorHandedness: false }]] as const) {
    it(`the conductor follows it at its period (${name}'s mirror settings)`, async () => {
      const frames = conductingFrames();
      const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...mirror }));
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS });
      const last = outs[outs.length - 1] as { bpm: number; time: { state: string; anchors: number } };
      expect(last.time.state).toBe('running');
      expect(last.time.anchors).toBeGreaterThan(5);
      expect(last.bpm).toBeGreaterThan(70);
      expect(last.bpm).toBeLessThan(90);
    });
  }
});
