/**
 * Feature-vector node tests: unit (synthetic frames + the lab active-gating +
 * group filtering) and fixture-replay against the recorded face/hand videos.
 *
 * The replay role is the #119 verification gate: replaying a recorded raw-input
 * edge through the vector node must yield an all-FINITE vector (no NaN reaches the
 * recorder or the normalizer), with the expected keys, and behave sensibly
 * (openness swings across the open/close clip). The face fixture has blendshapes
 * only (no mesh/pose), so the geometry/gaze/head features are absent there by
 * design — exactly the present-gating being verified.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@/dag';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import { faceFeatureVectorNode, handFeatureVectorNode } from '@/nodes';
import { makeHandKeypoints, type FaceFrame, type FeatureVector, type HandsFrame } from '@/nodes';

const bareCtx = (resources: Record<string, unknown> = {}): NodeContext => ({ tick: 0, time: 0, dt: 1 / 30, resources });
const allFinite = (v: FeatureVector) => Object.values(v).every((x) => Number.isFinite(x));

// ---- unit: face-feature-vector --------------------------------------------

describe('face-feature-vector (unit)', () => {
  const frame: FaceFrame = {
    present: true,
    blendshapes: { jawOpen: 0.7, mouthSmileLeft: 0.3, mouthSmileRight: 0.5, browInnerUp: 0.2 },
  };

  it('emits finite blendshape features and never a tongue key', () => {
    const handlers = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({}));
    const { vector } = handlers.process({ face: frame }, bareCtx()) as { vector: FeatureVector };
    expect(vector['face.blendshape.jaw.open']).toBeCloseTo(0.7);
    expect(allFinite(vector)).toBe(true);
    expect(Object.keys(vector).some((k) => k.includes('tongue'))).toBe(false);
    // No mesh → geometry is absent (present-gated), not NaN-in-the-vector.
    expect(vector['face.geom.mouth.aspectRatio']).toBeUndefined();
  });

  it('the static groups param filters which groups compute', () => {
    const handlers = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({ groups: ['face.blendshape.jaw'] }));
    const { vector } = handlers.process({ face: frame }, bareCtx()) as { vector: FeatureVector };
    expect(vector['face.blendshape.jaw.open']).toBeCloseTo(0.7);
    expect(vector['face.au.au12_lipCornerPuller']).toBeUndefined(); // au group excluded
  });

  it('absent face → empty vector', () => {
    const handlers = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({}));
    const { vector } = handlers.process({ face: { present: false, blendshapes: {} } }, bareCtx()) as { vector: FeatureVector };
    expect(Object.keys(vector)).toHaveLength(0);
  });

  it('the live lab config gates activity (hidden lab → empty) and overrides groups', () => {
    // The PRODUCTION shape: `ctx.resources.controls` is the raw control store, whose lab
    // config is top-level since #136. This test used to drive only the nested
    // `overlay.featureLab` shape — and stayed green when #136 moved the field, because an
    // unreadable config reads as "headless", which means "always on". It was asserting a
    // shape production no longer produced. See test/feature_lab_config.test.ts, which
    // drives the real store end-to-end.
    const handlers = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({}));
    const hidden = bareCtx({ controls: () => ({ featureLab: { show: false, groups: ['face.blendshape.jaw'] } }) });
    expect(Object.keys((handlers.process({ face: frame }, hidden) as { vector: FeatureVector }).vector)).toHaveLength(0);
    const shown = bareCtx({ controls: () => ({ featureLab: { show: true, groups: ['face.blendshape.brow'] } }) });
    const { vector } = handlers.process({ face: frame }, shown) as { vector: FeatureVector };
    expect(vector['face.blendshape.brow.innerUp']).toBeCloseTo(0.2);
    expect(vector['face.blendshape.jaw.open']).toBeUndefined(); // brow-only via live config
  });

  it('still honours the COMPOSED overlay.featureLab shape (canvas-overlay / pre-#136 hosts)', () => {
    const handlers = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({}));
    const hidden = bareCtx({ controls: () => ({ overlay: { featureLab: { show: false, groups: [] } } }) });
    expect(Object.keys((handlers.process({ face: frame }, hidden) as { vector: FeatureVector }).vector)).toHaveLength(0);
  });
});

// ---- unit: hand-feature-vector --------------------------------------------

describe('hand-feature-vector (unit)', () => {
  function twoHandFrame(): HandsFrame {
    return {
      width: 640,
      height: 480,
      hands: [
        { handedness: 'Left', keypoints: makeHandKeypoints({ cx: 200, cy: 240, scale: 70, spread: 0.8, pinch: 0.1, handedness: 'Left' }) },
        { handedness: 'Right', keypoints: makeHandKeypoints({ cx: 440, cy: 240, scale: 70, spread: 0.3, pinch: 0.6, handedness: 'Right' }) },
      ],
    };
  }

  it('keys per-hand features by resolved side and adds two-hand features', () => {
    const handlers = handFeatureVectorNode.make(handFeatureVectorNode.params.parse({}));
    const { vector } = handlers.process({ hands: twoHandFrame() }, bareCtx()) as { vector: FeatureVector };
    expect(allFinite(vector)).toBe(true);
    // mirrorHandedness (default) swaps Left<->Right, so both displayed sides appear.
    expect(Object.keys(vector).some((k) => k.startsWith('hand.left.'))).toBe(true);
    expect(Object.keys(vector).some((k) => k.startsWith('hand.right.'))).toBe(true);
    expect(vector['hand.pair.distance']).toBeDefined(); // both hands present
  });

  it('no hands → empty vector; single hand → no pair features', () => {
    const handlers = handFeatureVectorNode.make(handFeatureVectorNode.params.parse({}));
    expect(Object.keys((handlers.process({ hands: { width: 640, height: 480, hands: [] } }, bareCtx()) as { vector: FeatureVector }).vector)).toHaveLength(0);
    const one: HandsFrame = { width: 640, height: 480, hands: [{ handedness: 'Right', keypoints: makeHandKeypoints({ cx: 320, cy: 240, scale: 70, spread: 0.5, pinch: 0.2, handedness: 'Right' }) }] };
    const { vector } = handlers.process({ hands: one }, bareCtx()) as { vector: FeatureVector };
    expect(vector['hand.pair.distance']).toBeUndefined();
  });
});

// ---- fixture replay --------------------------------------------------------

describe('face-feature-vector (fixture replay: video_face_expressions)', () => {
  const frames = loadStream('video_face_expressions', 'face.blendshapes') as FaceFrame[];

  it('replays the recorded blendshapes into an all-finite vector, no tongue', async () => {
    expect(frames.length).toBeGreaterThan(20);
    const out = (await replayNode(faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({})), { face: frames }, { dt: 1 / 30 })).map(
      (o) => o.vector as FeatureVector,
    );
    let present = 0;
    for (const v of out) {
      expect(allFinite(v)).toBe(true); // never a NaN in the vector
      expect(Object.keys(v).some((k) => k.includes('tongue'))).toBe(false);
      if (v['face.blendshape.jaw.open'] !== undefined) present++;
    }
    expect(present).toBe(out.length); // jawOpen present every recorded frame
  });
});

describe('hand-feature-vector (fixture replay: video_hand_open_close)', () => {
  const frames = loadStream('video_hand_open_close', 'src.hands') as HandsFrame[];

  it('replays recorded hands into a finite vector; openness swings across the clip', async () => {
    expect(frames.length).toBeGreaterThan(50);
    const out = (await replayNode(handFeatureVectorNode.make(handFeatureVectorNode.params.parse({})), { hands: frames }, { dt: 1 / 30 })).map(
      (o) => o.vector as FeatureVector,
    );
    const opennessKey = Object.keys(out.find((v) => Object.keys(v).length) ?? {}).find((k) => k.endsWith('.openness'))!;
    expect(opennessKey).toBeTruthy();
    const opennessSeries: number[] = [];
    for (const v of out) {
      expect(allFinite(v)).toBe(true);
      const o = v[opennessKey];
      if (typeof o === 'number') opennessSeries.push(o);
    }
    expect(opennessSeries.length).toBeGreaterThan(50);
    const swing = Math.max(...opennessSeries) - Math.min(...opennessSeries);
    expect(swing).toBeGreaterThan(0.1); // the hand opens and closes
  });
});
