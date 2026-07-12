/**
 * Tests `gesture-classifier`: discrete pose classification, enter/exit edge
 * events, hysteresis, and a replay from the real hand fixtures (the open/close
 * clip should produce fist↔open transitions; the pinch clip should detect pinch).
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import { gestureClassifierNode, ABSENT_HAND, type HandFeatures, type GestureEvent, type Pose } from '@/nodes';

function feat(right: Partial<typeof ABSENT_HAND>): HandFeatures {
  return { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND, present: true, ...right } };
}

const params = () => gestureClassifierNode.params.parse({});

describe('gesture-classifier (unit)', () => {
  it('classifies fist / open / pinch and emits enter+exit edges on change', async () => {
    const frames = [
      feat({ openness: 0.1, pinch: 0 }), // fist
      feat({ openness: 0.9, pinch: 0 }), // open
      feat({ openness: 0.5, pinch: 0.9 }), // pinch (wins over openness)
    ];
    const outs = await replayNode(gestureClassifierNode.make(params()), { features: frames });
    const poses = outs.map((o) => (o.poses as Record<string, Pose>).right);
    expect(poses).toEqual(['fist', 'open', 'pinch']);

    // tick0: enter fist; tick1: exit fist + enter open; tick2: exit open + enter pinch
    const ev = outs.map((o) => o.events as GestureEvent[]);
    expect(ev[0]).toEqual([{ hand: 'right', pose: 'fist', edge: 'enter' }]);
    expect(ev[1]).toEqual([
      { hand: 'right', pose: 'fist', edge: 'exit' },
      { hand: 'right', pose: 'open', edge: 'enter' },
    ]);
    expect(ev[2][0]).toMatchObject({ pose: 'open', edge: 'exit' });
    expect(ev[2][1]).toMatchObject({ pose: 'pinch', edge: 'enter' });
  });

  it('hysteresis prevents chatter near the open threshold', async () => {
    // openAbove=0.6, hysteresis=0.05 → once open, stays open until openness < 0.55.
    const frames = [feat({ openness: 0.62 }), feat({ openness: 0.57 }), feat({ openness: 0.5 })];
    const outs = await replayNode(gestureClassifierNode.make(params()), { features: frames });
    const poses = outs.map((o) => (o.poses as Record<string, Pose>).right);
    expect(poses[0]).toBe('open');
    expect(poses[1]).toBe('open'); // 0.57 still open thanks to hysteresis
    expect(poses[2]).toBe('neutral'); // 0.5 drops out
  });

  it('absent hand → absent pose, no events', async () => {
    const [out] = await replayNode(gestureClassifierNode.make(params()), {
      features: [{ left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } } as HandFeatures],
    });
    expect((out.poses as Record<string, Pose>).right).toBe('absent');
    expect(out.events as GestureEvent[]).toEqual([]);
  });
});

describe('gesture-classifier from video fixtures', () => {
  it('open/close clip yields fist and open poses; pinch clip detects pinch', async () => {
    const load = (scn: string) => loadStream(scn, 'feat.features') as HandFeatures[];

    // This AI-generated clip's tracked openness peaks ~0.5, so use an openAbove
    // the data supports (a real reminder that thresholds are camera/hand-tunable).
    const tuned = gestureClassifierNode.params.parse({ openAbove: 0.4 });
    const oc = await replayNode(gestureClassifierNode.make(tuned), { features: load('video_hand_open_close') });
    const ocPoses = new Set(oc.flatMap((o) => Object.values(o.poses as Record<string, Pose>)));
    expect(ocPoses.has('fist')).toBe(true);
    expect(ocPoses.has('open')).toBe(true);

    const pinch = await replayNode(gestureClassifierNode.make(params()), { features: load('video_hand_pinch') });
    const pinchEvents = pinch.flatMap((o) => o.events as GestureEvent[]).filter((e) => e.pose === 'pinch');
    expect(pinchEvents.length).toBeGreaterThan(0);
  });
});
