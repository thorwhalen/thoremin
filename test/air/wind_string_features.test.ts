/**
 * The flute and bass featurizers, the multi-stream bundle and the pitch-class labels,
 * on self-made frames.
 */
import { describe, expect, it } from 'vitest';
import type { StreamRecord } from '@/dag';
import type { FaceFrame } from '@/nodes/domain';
import { bundleStreams, joinLabelledFrames, pitchClassLabeller, pitchClassOf, type FrameBundle } from '../../scripts/air/lib_chord_shape_dataset';
import { chordShapeFeatureIds } from '../../scripts/air/lib_chord_shape_features';
import {
  EMBOUCHURE_BLENDSHAPES,
  bassFeatureIds,
  bassHandsFeaturizer,
  embouchureVector,
  fluteFeatureIds,
  fluteFeaturizer,
  fluteFingeringClass,
  fluteFingeringLabeller,
} from '../../scripts/air/lib_wind_string_features';
import { SHAPES, frameOf, syntheticHand } from './synthetic_hand';

const SHAPE_IDS = chordShapeFeatureIds();

describe('pitchClassOf', () => {
  it('drops the octave and spells flats as sharps', () => {
    expect(pitchClassOf('C4')).toBe('C');
    expect(pitchClassOf('C#4')).toBe('C#');
    expect(pitchClassOf('Bb2')).toBe('A#');
    expect(pitchClassOf('E1')).toBe('E');
    expect(pitchClassOf('N')).toBe('N');
    expect(() => pitchClassOf('H3')).toThrow();
  });

  it('is the labelOf seam over note segments', () => {
    const l = pitchClassLabeller([{ start: 0, end: 1, label: 'G4' }, { start: 1, end: 2, label: 'N' }], 0.1);
    expect(l(0.5)).toBe('G');
    expect(l(0.95)).toBeNull();
    expect(l(1.5)).toBeNull();
  });
});

describe('bundleStreams', () => {
  it('zips streams by tick and leaves missing streams absent', () => {
    const hands: StreamRecord[] = [0, 1, 2].map((tick) => ({ tick, t: tick / 30, value: frameOf([]) }));
    const face: StreamRecord[] = [1, 2, 3].map((tick) => ({ tick, t: tick / 30, value: { present: true, blendshapes: { jawOpen: 0.5 } } }));
    const b = bundleStreams({ hands, face });
    expect(b.map((r) => r.tick)).toEqual([0, 1, 2, 3]);
    const v1 = b[1].value as FrameBundle;
    expect(v1.hands).toBeDefined();
    expect(v1.face?.blendshapes.jawOpen).toBe(0.5);
    expect((b[0].value as FrameBundle).face).toBeUndefined();
    expect((b[3].value as FrameBundle).hands).toBeUndefined();
  });
});

describe('fluteFeaturizer', () => {
  const left = syntheticHand(SHAPES.C, { cx: 480, cy: 200, scale: 90 }, 'Right');
  const right = syntheticHand(SHAPES.G, { cx: 200, cy: 260, scale: 90 }, 'Left');
  const face: FaceFrame = { present: true, blendshapes: { jawOpen: 0.1, mouthPucker: 0.7, mouthFunnel: 0.4 } };

  it('emits both hands prefixed by side and the embouchure blendshapes', () => {
    const f = fluteFeaturizer({ leftHand: 'max' });
    const v = f({ t: 0, hands: frameOf([left, right]), face })!;
    expect(Object.keys(v).sort()).toEqual(fluteFeatureIds(SHAPE_IDS).sort());
    expect(v['L.ring.curl']).toBeGreaterThan(v['R.ring.curl']); // C curls the ring more than G
    expect(v['face.mouthPucker']).toBe(0.7);
    expect(Number.isNaN(v['face.cheekPuff'])).toBe(true); // absent blendshape → NaN, not dropped
  });

  it('swaps the sides when the left hand is the min-x one', () => {
    const v = fluteFeaturizer({ leftHand: 'min' })({ t: 0, hands: frameOf([left, right]), face })!;
    expect(v['R.ring.curl']).toBeGreaterThan(v['L.ring.curl']);
  });

  it('needs two hands, and tolerates a missing face', () => {
    expect(fluteFeaturizer({ leftHand: 'max' })({ t: 0, hands: frameOf([left]) })).toBeUndefined();
    expect(fluteFeaturizer({ leftHand: 'max' })({ t: 0 })).toBeUndefined();
    const v = fluteFeaturizer({ leftHand: 'max' })({ t: 0, hands: frameOf([left, right]) })!;
    expect(Number.isNaN(v['face.jawOpen'])).toBe(true);
    const noFace = fluteFeaturizer({ leftHand: 'max', withFace: false })({ t: 0, hands: frameOf([left, right]) })!;
    expect(Object.keys(noFace).some((k) => k.startsWith('face.'))).toBe(false);
  });

  it('joins through the generic join on a bundle stream', () => {
    const recs = bundleStreams({
      hands: [0, 1, 2, 3].map((tick) => ({ tick, t: tick / 30, value: frameOf([left, right]) })),
      face: [0, 1].map((tick) => ({ tick, t: tick / 30, value: face })),
    });
    const { samples, stats } = joinLabelledFrames<FrameBundle>(recs, { group: 'p', featurize: fluteFeaturizer({ leftHand: 'max' }), labelOf: () => 'G' });
    expect(stats.samples).toBe(4);
    expect(samples[0].vector['face.mouthPucker']).toBe(0.7);
    expect(Number.isNaN(samples[3].vector['face.mouthPucker'])).toBe(true);
  });
});

describe('embouchureVector', () => {
  it('lists every embouchure blendshape', () => {
    const v = embouchureVector(undefined);
    expect(Object.keys(v).length).toBe(EMBOUCHURE_BLENDSHAPES.length);
    expect(Object.values(v).every(Number.isNaN)).toBe(true);
  });
});

describe('bassHandsFeaturizer', () => {
  const pluck = syntheticHand(SHAPES.E, { cx: 200, cy: 300, scale: 80 }, 'Left');
  const fretNear = syntheticHand(SHAPES.A, { cx: 400, cy: 260, scale: 80 }, 'Right');
  const fretFar = syntheticHand(SHAPES.A, { cx: 560, cy: 220, scale: 80 }, 'Right');

  it('adds the position along the neck in palm-span units', () => {
    const f = bassHandsFeaturizer({ by: 'x', side: 'max' });
    const near = f(frameOf([pluck, fretNear]))!;
    const far = f(frameOf([pluck, fretFar]))!;
    expect(Object.keys(near).sort()).toEqual(bassFeatureIds(SHAPE_IDS).sort());
    expect(far['neck.distance']).toBeGreaterThan(near['neck.distance']);
    expect(far['neck.dx']).toBeGreaterThan(0);
    expect(near['index.curl']).toBeCloseTo(far['index.curl'], 6); // same shape, different place
  });

  it('is scale-invariant in the neck position', () => {
    const f = bassHandsFeaturizer({ by: 'x', side: 'max' });
    const small = f(frameOf([syntheticHand(SHAPES.E, { cx: 100, cy: 150, scale: 40 }, 'Left'), syntheticHand(SHAPES.A, { cx: 200, cy: 130, scale: 40 }, 'Right')]))!;
    const big = f(frameOf([syntheticHand(SHAPES.E, { cx: 200, cy: 300, scale: 80 }, 'Left'), syntheticHand(SHAPES.A, { cx: 400, cy: 260, scale: 80 }, 'Right')]))!;
    expect(small['neck.distance']).toBeCloseTo(big['neck.distance'], 6);
  });

  it('gives NaN position with one hand, and nothing with none', () => {
    const f = bassHandsFeaturizer({ by: 'x', side: 'max' });
    const lone = f(frameOf([fretFar]))!;
    expect(Number.isNaN(lone['neck.distance'])).toBe(true);
    expect(Number.isFinite(lone['index.curl'])).toBe(true);
    expect(f(frameOf([]))).toBeUndefined();
  });
});

describe('fluteFingeringClass', () => {
  it('folds the first two octaves except D5/D#5, and drops the third octave', () => {
    expect(fluteFingeringClass('G4')).toBe('G');
    expect(fluteFingeringClass('G5')).toBe('G');
    expect(fluteFingeringClass('D4')).toBe('D');
    expect(fluteFingeringClass('D5')).toBe('D5');
    expect(fluteFingeringClass('Eb5')).toBe('D#5');
    expect(fluteFingeringClass('C6')).toBe('C');
    expect(fluteFingeringClass('C#6')).toBe('N');
    expect(fluteFingeringClass('B3')).toBe('N');
    expect(fluteFingeringClass('N')).toBe('N');
    const l = fluteFingeringLabeller([{ start: 0, end: 1, label: 'D5' }, { start: 1, end: 2, label: 'F#6' }], 0.1);
    expect(l(0.5)).toBe('D5');
    expect(l(1.5)).toBeNull();
  });
});
