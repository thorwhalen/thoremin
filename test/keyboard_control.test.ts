import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { keyboardControlNode } from '@/nodes';

describe('keyboard-control', () => {
  it('arrow keys shift octave (clamped) and adjust magnetism; m toggles mute', async () => {
    const pressedFrames = [
      [], // tick 0: defaults
      ['ArrowUp'], // octave +1
      ['ArrowUp'], // octave +2 (then clamp)
      ['ArrowUp'], // stays at +2 (octaveMax)
      ['ArrowDown', 'ArrowDown'], // back to 0
      ['ArrowLeft'], // magnetism 0.8 -> 0.7
      ['m'], // mute on
      ['m'], // mute off
    ];
    const outs = await replayNode(
      keyboardControlNode.make(
        keyboardControlNode.params.parse({ magnetismStep: 0.1, magnetismStart: 0.8, octaveMin: -2, octaveMax: 2 }),
      ),
      { pressed: pressedFrames },
    );

    expect(outs[0]).toMatchObject({ octaveShift: 0, mute: false });
    expect(outs[1].octaveShift).toBe(1);
    expect(outs[2].octaveShift).toBe(2);
    expect(outs[3].octaveShift).toBe(2); // clamped
    expect(outs[4].octaveShift).toBe(0);
    expect(outs[5].magnetism).toBeCloseTo(0.7, 6);
    expect(outs[6].mute).toBe(true);
    expect(outs[7].mute).toBe(false);
  });
});
