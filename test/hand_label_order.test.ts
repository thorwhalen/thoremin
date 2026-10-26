/**
 * Two hands the hand model gave the SAME label are two hands: `createLabelOrder` tells them apart by
 * where they are, and `hands-dwell` applies it at any dwell, so every instrument that picks a hand
 * by its label finds both. Checked on hand-made frames and on real takes.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { makeHandKeypoints, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { createLabelOrder } from '@thoremin/sdk/features/handedness';
import { handsDwellNode } from '@/nodes/features/hands_dwell';
import { loadRecords } from './helpers/fixtures';

const hand = (handedness: 'Left' | 'Right', cx: number): Hand => ({ handedness, keypoints: makeHandKeypoints({ cx, cy: 240, scale: 60, spread: 0.5, pinch: 0, handedness }), score: 1 });
const frame = (...hands: Hand[]): HandsFrame => ({ width: 640, height: 480, hands });

describe('createLabelOrder', () => {
  it('passes distinct labels, one hand and no hand through', () => {
    const o = createLabelOrder();
    expect(o.step([{ label: 'Left', x: 100 }, { label: 'Right', x: 500 }])).toEqual(['Left', 'Right']);
    expect(o.step([{ label: 'Left', x: 100 }])).toEqual(['Left']);
    expect(o.step([])).toEqual([]);
  });

  it('before any evidence, the hand further left in the image is Right (the model on an unmirrored frame)', () => {
    expect(createLabelOrder().step([{ label: 'Left', x: 500 }, { label: 'Left', x: 100 }])).toEqual(['Left', 'Right']);
    expect(createLabelOrder().step([{ label: 'Right', x: 100 }, { label: 'Right', x: 500 }])).toEqual(['Right', 'Left']);
  });

  it('follows the order the recent frames showed (a mirrored camera reverses it)', () => {
    const o = createLabelOrder();
    for (let i = 0; i < 10; i++) o.step([{ label: 'Left', x: 100 }, { label: 'Right', x: 500 }]);
    expect(o.step([{ label: 'Left', x: 120 }, { label: 'Left', x: 480 }])).toEqual(['Left', 'Right']);
    o.reset();
    expect(o.step([{ label: 'Left', x: 120 }, { label: 'Left', x: 480 }])).toEqual(['Right', 'Left']);
  });
});

describe('hands-dwell tells two same-labelled hands apart', () => {
  const run = async (frames: HandsFrame[], params: Record<string, unknown> = {}) =>
    (await replayNode(handsDwellNode.make(handsDwellNode.params.parse(params)), { hands: frames }, { dt: 1 / 30 })).map((o) => o.hands as HandsFrame);

  it('at dwell 0 too, and a frame whose labels differ is returned as is', async () => {
    const good = frame(hand('Right', 150), hand('Left', 450));
    const twin = frame(hand('Left', 160), hand('Left', 440));
    const [a, b] = await run([good, twin]);
    expect(a).toBe(good);
    expect(b.hands.map((h) => h.handedness)).toEqual(['Right', 'Left']);
  });

  it('on real takes: no two-hand frame keeps one label, and the relabel follows the hands', async () => {
    for (const [scenario, key] of [['real_hands_choir', 'src.hands'], ['conducting_44', 'src.hands'], ['conducting_34', 'src.hands']] as const) {
      const frames = loadRecords(scenario, key).map((r) => r.value as HandsFrame);
      const out = await run(frames);
      let twins = 0;
      let followed = 0;
      let last: Record<string, number> | null = null;
      frames.forEach((f, i) => {
        const o = out[i].hands;
        if (f.hands.length !== 2) return;
        expect(o[0].handedness, `${scenario} frame ${i}`).not.toBe(o[1].handedness);
        if (f.hands[0].handedness !== f.hands[1].handedness) {
          last = Object.fromEntries(f.hands.map((h) => [h.handedness, h.keypoints[0].x]));
          return;
        }
        twins += 1;
        // The hand now called Right is the one nearer where the Right hand last was.
        if (last && Math.abs(o.find((h) => h.handedness === 'Right')!.keypoints[0].x - last.Right) <= Math.abs(o.find((h) => h.handedness === 'Left')!.keypoints[0].x - last.Right)) followed += 1;
      });
      expect(twins, scenario).toBeGreaterThan(0);
      expect(followed / twins, scenario).toBeGreaterThanOrEqual(0.9);
    }
  });
});
