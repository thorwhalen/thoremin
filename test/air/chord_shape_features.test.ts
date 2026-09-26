/**
 * The chord-shape featurizer: which catalog features it selects, that a vector is
 * fixed-dimensional, that it is invariant to where and how big the hand is in the
 * frame, and that the fretting-hand pick does what the sources say.
 */
import { describe, expect, it } from 'vitest';
import { HAND_SIDE_FEATURES } from '@/features/catalog';
import { chordShapeFeatureIds, chordShapeVector, frettingHand } from '../../scripts/air/lib_chord_shape_features';
import { SHAPES, frameOf, syntheticHand } from './synthetic_hand';

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

  it('adds palm orientation only when asked', () => {
    const base = chordShapeFeatureIds();
    const withO = chordShapeFeatureIds({ withOrientation: true });
    expect(withO.length).toBeGreaterThan(base.length);
    expect(withO).toContain('palm.yaw');
    expect(base).not.toContain('palm.yaw');
  });
});

describe('chordShapeVector', () => {
  const pose = { cx: 320, cy: 240, scale: 120 };

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

  it('is invariant to translation, scale and in-plane rotation', () => {
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
  const left = syntheticHand(SHAPES.E, { cx: 150, cy: 240, scale: 100 }, 'Right');
  const right = syntheticHand(SHAPES.G, { cx: 500, cy: 240, scale: 100 }, 'Left');
  const frame = frameOf([left, right]);

  it('picks by horizontal position', () => {
    expect(frettingHand(frame, { by: 'x', side: 'max' })).toBe(right);
    expect(frettingHand(frame, { by: 'x', side: 'min' })).toBe(left);
  });

  it('picks by the MediaPipe label', () => {
    expect(frettingHand(frame, { by: 'handedness', label: 'Left' })).toBe(right);
    expect(frettingHand(frameOf([left]), { by: 'handedness', label: 'Left' })).toBeUndefined();
  });

  it('returns the only hand for a positional pick, and nothing for an empty frame', () => {
    expect(frettingHand(frameOf([left]), { by: 'x', side: 'max' })).toBe(left);
    expect(frettingHand(frameOf([]), { by: 'x', side: 'max' })).toBeUndefined();
  });
});
