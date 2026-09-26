/**
 * The chord-shape featurizer: which catalog features it selects, that a vector is
 * fixed-dimensional, that it is invariant to where, how big and how turned the hand is
 * (in the image plane without world landmarks; in 3-D with them, the path real footage
 * takes), that a mirrored hand gives the same shape vector, and that the fretting-hand
 * pick does what the sources say, including refusing a lone hand on the wrong side.
 */
import { describe, expect, it } from 'vitest';
import { HAND_SIDE_FEATURES } from '@/features/catalog';
import { chordShapeFeatureIds, chordShapeFeaturizer, chordShapeVector, frettingHand } from '../../scripts/air/lib_chord_shape_features';
import { SHAPES, frameOf, syntheticHand } from './synthetic_hand';

const pose = { cx: 320, cy: 240, scale: 120 };

describe('chordShapeFeatureIds', () => {
  it('selects the pose-invariant hand features and nothing positional', () => {
    const ids = chordShapeFeatureIds();
    expect(ids.length).toBeGreaterThanOrEqual(20);
    const byId = new Map(HAND_SIDE_FEATURES.map((f) => [f.id, f]));
    for (const id of ids) {
      const f = byId.get(id)!;
      expect(f.group).not.toBe('hand.position.raw');
      expect(f.group).not.toBe('hand.palm.orientation');
      expect(f.invariantTo).toEqual(expect.arrayContaining(['scale', 'position', 'yaw', 'pitch', 'roll']));
    }
    expect(ids).toContain('index.curl');
    expect(ids).toContain('spread.indexMiddle');
  });

  it('adds exactly the palm-orientation group when asked', () => {
    const base = new Set(chordShapeFeatureIds());
    const added = chordShapeFeatureIds({ withOrientation: true }).filter((id) => !base.has(id));
    expect(added.length).toBeGreaterThan(0);
    const byId = new Map(HAND_SIDE_FEATURES.map((f) => [f.id, f]));
    for (const id of added) expect(byId.get(id)!.group).toBe('hand.palm.orientation');
    expect(added).not.toContain('tilt');
    expect(added).not.toContain('wristFlexionProxy');
  });
});

describe('chordShapeVector', () => {
  it('is fixed-dimensional and finite on a synthetic hand', () => {
    const hand = syntheticHand(SHAPES.E, pose);
    const v = chordShapeVector(hand, frameOf([hand]));
    const ids = chordShapeFeatureIds();
    expect(Object.keys(v).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(Number.isFinite(v[id]), id).toBe(true);
  });

  it('distinguishes the synthetic chord shapes', () => {
    const vE = chordShapeVector(syntheticHand(SHAPES.E, pose), frameOf([]));
    const vG = chordShapeVector(syntheticHand(SHAPES.G, pose), frameOf([]));
    expect(vE['ring.curl']).toBeGreaterThan(vG['ring.curl']);
    expect(vE['spread.indexMiddle']).not.toBeCloseTo(vG['spread.indexMiddle'], 3);
  });

  it('is invariant to translation, scale and in-plane rotation (image landmarks only)', () => {
    const ref = chordShapeVector(syntheticHand(SHAPES.C, pose), frameOf([]));
    const moved = chordShapeVector(syntheticHand(SHAPES.C, { cx: 100, cy: 400, scale: 120 }), frameOf([]));
    const scaled = chordShapeVector(syntheticHand(SHAPES.C, { cx: 320, cy: 240, scale: 40 }), frameOf([]));
    const turned = chordShapeVector(syntheticHand(SHAPES.C, { ...pose, rotation: 0.7 }), frameOf([]));
    for (const id of Object.keys(ref)) {
      expect(moved[id], `${id} translation`).toBeCloseTo(ref[id], 6);
      expect(scaled[id], `${id} scale`).toBeCloseTo(ref[id], 6);
      expect(turned[id], `${id} rotation`).toBeCloseTo(ref[id], 6);
    }
  });

  it('is invariant to yaw and pitch WITH world landmarks, and is not without them', () => {
    const flat = syntheticHand(SHAPES.D, { ...pose, world: true });
    const yawed = syntheticHand(SHAPES.D, { ...pose, yaw: 0.8, pitch: -0.5, rotation: 0.3, world: true });
    expect(flat.worldKeypoints).toHaveLength(21);
    const ref = chordShapeVector(flat, frameOf([]));
    const got = chordShapeVector(yawed, frameOf([]));
    for (const id of Object.keys(ref)) expect(got[id], id).toBeCloseTo(ref[id], 6);
    // Same hand as a flat 2-D projection (no world set, no depth): foreshortening moves
    // the in-plane approximation, which is what the declared invariance caveat says.
    const noWorld = { ...yawed, worldKeypoints: undefined, keypoints: yawed.keypoints.map((k) => ({ ...k, z: 0 })) };
    const approx = chordShapeVector(noWorld, frameOf([]));
    const moved = Object.keys(ref).filter((id) => Math.abs(approx[id] - ref[id]) > 1e-3);
    expect(moved.length).toBeGreaterThan(0);
  });

  it('gives a mirrored hand the same shape vector', () => {
    const hand = syntheticHand(SHAPES.A, { ...pose, world: true }, 'Right');
    const mirrored = {
      ...hand,
      handedness: 'Left' as const,
      keypoints: hand.keypoints.map((k) => ({ ...k, x: 640 - k.x })),
      worldKeypoints: hand.worldKeypoints!.map((k) => ({ ...k, x: -k.x })),
    };
    const a = chordShapeVector(hand, frameOf([]));
    const b = chordShapeVector(mirrored, frameOf([]));
    for (const id of Object.keys(a)) expect(b[id], id).toBeCloseTo(a[id], 6);
  });

  it('marks an uncomputable feature NaN instead of dropping it', () => {
    const hand = syntheticHand(SHAPES.A, pose);
    // Collapse the hand to a point: every angle degenerates.
    const flat = { ...hand, keypoints: hand.keypoints.map(() => ({ x: 1, y: 1, z: 0 })) };
    const v = chordShapeVector(flat, frameOf([]));
    expect(Object.keys(v).length).toBe(chordShapeFeatureIds().length);
    expect(Object.values(v).some((x) => Number.isNaN(x))).toBe(true);
  });
});

describe('frettingHand', () => {
  // A right-handed player facing an unmirrored camera: the physical LEFT (fretting) hand
  // is on the viewer's right and MediaPipe labels it "Right" (it assumes a selfie image).
  const strumming = syntheticHand(SHAPES.E, { cx: 150, cy: 240, scale: 100 }, 'Left');
  const fretting = syntheticHand(SHAPES.G, { cx: 500, cy: 240, scale: 100 }, 'Right');
  const frame = frameOf([strumming, fretting]);

  it('picks by horizontal position', () => {
    expect(frettingHand(frame, { by: 'x', side: 'max' })).toBe(fretting);
    expect(frettingHand(frame, { by: 'x', side: 'min' })).toBe(strumming);
  });

  it('picks by the MediaPipe label as emitted', () => {
    expect(frettingHand(frame, { by: 'handedness', label: 'Right' })).toBe(fretting);
    expect(frettingHand(frameOf([strumming]), { by: 'handedness', label: 'Right' })).toBeUndefined();
  });

  it('accepts a lone hand only on the expected half of the frame', () => {
    expect(frettingHand(frameOf([fretting]), { by: 'x', side: 'max' })).toBe(fretting);
    expect(frettingHand(frameOf([strumming]), { by: 'x', side: 'max' })).toBeUndefined();
    expect(frettingHand(frameOf([strumming]), { by: 'x', side: 'min' })).toBe(strumming);
    expect(frettingHand(frameOf([]), { by: 'x', side: 'max' })).toBeUndefined();
  });

  it('ignores a hand with too few keypoints', () => {
    const stub = { ...fretting, keypoints: fretting.keypoints.slice(0, 5) };
    expect(frettingHand(frameOf([stub]), { by: 'x', side: 'max' })).toBeUndefined();
  });
});

describe('chordShapeFeaturizer', () => {
  it('is the featurize seam: a frame in, the fretting hand vector or undefined out', () => {
    const f = chordShapeFeaturizer({ by: 'x', side: 'max' });
    const fretting = syntheticHand(SHAPES.G, { cx: 500, cy: 240, scale: 100 });
    expect(f(frameOf([fretting]))).toEqual(chordShapeVector(fretting, frameOf([fretting])));
    expect(f(frameOf([]))).toBeUndefined();
  });
});
