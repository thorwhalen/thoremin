/**
 * Tests the `face-features` node: blendshapes → normalized expression controls.
 * Unit cases (synthetic blendshapes) + a replay against the real
 * `video_face_expressions` fixture (decoded once via MediaPipe FaceLandmarker).
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import { faceFeaturesNode, type FaceFeatures, type FaceFrame } from '@/nodes';
const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

function frame(blendshapes: Record<string, number>): FaceFrame {
  return { present: true, blendshapes };
}

describe('face-features node (unit)', () => {
  const params = faceFeaturesNode.params.parse({});

  it('maps blendshapes to expression controls', async () => {
    const [out] = await replayNode(faceFeaturesNode.make(params), {
      face: [frame({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6, jawOpen: 0.5, browInnerUp: 0.9 })],
    });
    const f = out.features as FaceFeatures;
    expect(f.present).toBe(true);
    expect(f.smile).toBeCloseTo(0.7, 5); // avg(0.8, 0.6)
    expect(f.mouthOpen).toBeCloseTo(0.5, 5); // jawOpen
    expect(f.browRaise).toBeCloseTo(0.3, 5); // avg(0.9, 0, 0)
  });

  it('absent face → all controls zero', async () => {
    const [out] = await replayNode(faceFeaturesNode.make(params), {
      face: [{ present: false, blendshapes: {} } as FaceFrame],
    });
    const f = out.features as FaceFeatures;
    expect(f.present).toBe(false);
    expect(f.smile).toBe(0);
    expect(f.mouthOpen).toBe(0);
  });

  it('clamps with gain and eases with smoothing', async () => {
    // gain pushes a small smile to full; smoothing eases in over ticks.
    const handlers = faceFeaturesNode.make(faceFeaturesNode.params.parse({ gain: 3, smoothing: 0.6 }));
    const frames = Array.from({ length: 8 }, () => frame({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5 }));
    const outs = (await replayNode(handlers, { face: frames })).map((o) => (o.features as FaceFeatures).smile);
    expect(outs[0]).toBeLessThan(outs[1]); // easing in
    expect(outs[7]).toBeGreaterThan(outs[0]);
    expect(outs[7]).toBeLessThanOrEqual(1); // clamped (0.5*3 would be 1.5)
  });
});

describe('face-features from the video_face_expressions fixture', () => {
  it('detects a face and smile/mouthOpen/browRaise vary through the expression sweep', async () => {
    const faces = loadStream('video_face_expressions', 'face.blendshapes') as FaceFrame[];

    const outs = (await replayNode(faceFeaturesNode.make(faceFeaturesNode.params.parse({})), { face: faces })).map(
      (o) => o.features as FaceFeatures,
    );
    const present = outs.filter((f) => f.present);
    expect(present.length / outs.length).toBeGreaterThan(0.8);
    expect(span(present.map((f) => f.smile))).toBeGreaterThan(0.3);
    expect(span(present.map((f) => f.mouthOpen))).toBeGreaterThan(0.2);
    expect(span(present.map((f) => f.browRaise))).toBeGreaterThan(0.2);
    // All controls stay in range.
    expect(present.every((f) => f.smile >= 0 && f.smile <= 1 && f.mouthOpen >= 0 && f.mouthOpen <= 1)).toBe(true);
  });
});
