/**
 * The hand as a carve modality (#385 E8): one hand's shape, side-relative (#387 C4).
 *
 * - `project` picks one hand of the merged vector (`either`: the right when both are in view) and
 *   strips its side; it is idempotent, so a projected vector projects to itself.
 * - The space a session resolves the cues against yields exactly the air guitar's shape ids, and a
 *   carved hand sample is the air guitar's chord-shape vector for the same hand (one feature space).
 * - The general model names the recorded open hand, fist and pinch.
 * - The words' directions hold on the recorded open/close hand (the E6 lesson: three face words
 *   were backwards until a test like this caught them).
 */
import { describe, expect, it } from 'vitest';
import { cueFeatures } from '@thoremin/sdk/enroll/cue';
import { matchLabels } from '@thoremin/sdk/enroll/match';
import { handModality, handShapeFeatureIds, handsFrameVector, HAND_SPACE, generalHandLabeling } from '@thoremin/sdk/features/modalities/hand';
import { handWords } from '@thoremin/sdk/features/modalities/hand_words';
import { modalityById } from '@thoremin/sdk/features/modalities';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { foreignModality } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { chordShapeFeatureIds, chordShapeVector } from '@thoremin/ext-air/lib/hand_shape';
import { restCue } from '@thoremin/ext-faces/lib/take';
import { loadStream } from '../helpers/fixtures';

const frames = (scenario: string) => loadStream(scenario, 'src.hands') as HandsFrame[];
const SHAPE = handShapeFeatureIds();

describe('handModality: one hand, side-relative', () => {
  const v = { 'hand.right.index.curl': 1, 'hand.right.wrist.x': 0.4, 'hand.left.index.curl': 2, 'face.jaw.open': 0.3 };

  it('projects one hand, its side stripped, positions kept', () => {
    expect(handModality.project!(v)).toEqual({ 'index.curl': 1, 'wrist.x': 0.4 });
    expect(handModality.project!(v, { hand: 'left' })).toEqual({ 'index.curl': 2 });
    expect(handModality.project!({ 'hand.left.index.curl': 2 })).toEqual({ 'index.curl': 2 });
    expect(handModality.project!({ 'hand.left.index.curl': 2 }, { hand: 'right' })).toEqual({});
    // Idempotent: a projected vector is left as it is.
    const p = handModality.project!(v);
    expect(handModality.project!(p)).toBe(p);
  });

  it('reads only the shape keys, or null with no hand in view', () => {
    expect(handModality.read(v)).toEqual({ 'index.curl': 1 });
    expect(handModality.read({ 'face.jaw.open': 1 })).toBeNull();
    expect(handModality.read({ 'hand.right.index.curl': Number.NaN })).toBeNull();
    expect(handModality.keep('index.curl')).toBe(true);
    expect(handModality.keep('wrist.x')).toBe(false);
    expect(handModality.keep('hand.right.index.curl')).toBe(false);
  });

  it('resolves its cues to exactly the air guitar shape features', () => {
    const cue = restCue(handModality);
    expect(cueFeatures(cue, HAND_SPACE.ids, HAND_SPACE.groupOf)).toEqual(SHAPE);
    expect(chordShapeFeatureIds()).toEqual(SHAPE);
    expect(cue.instruction).toMatch(/hand/);
  });

  it('a carved hand sample is the air guitar chord-shape vector of the same hand', () => {
    for (const frame of frames('video_hand_open_close').filter((_, i) => i % 20 === 0)) {
      const read = handModality.read(handsFrameVector(frame))!;
      const guitar = chordShapeVector(frame.hands[0], frame);
      expect(Object.keys(read).sort()).toEqual(Object.keys(guitar).sort());
      for (const k of Object.keys(guitar)) {
        if (Number.isFinite(guitar[k])) expect(read[k]).toBeCloseTo(guitar[k], 9);
      }
    }
  });

  it('is found by its id, and a face file is foreign to it', () => {
    expect(modalityById('hand')).toBe(handModality);
    expect(modalityById('face')).toBe(faceModality);
    expect(modalityById('constructor')).toBeUndefined();
    expect(foreignModality(handModality, { modality: 'face', features: ['face.jaw.open'] })).toMatch(/face/);
    expect(foreignModality(handModality, { features: ['index.curl'] })).toBeNull();
    expect(foreignModality(faceModality, { features: ['index.curl'] })).not.toBeNull();
  });
});

describe('the hand general model', () => {
  it('names the recorded open hand, fist and pinch', () => {
    const shapes = [...frames('video_hand_open_close'), ...frames('video_hand_pinch')].map((f) => handModality.read(handsFrameVector(f))!);
    const open = shapes.filter((v) => v.openness > 2.5);
    const fist = shapes.filter((v) => v.openness < 1.1);
    const pinch = shapes.filter((v) => v['pinch.thumbIndex'] < 0.4 && v.openness > 1.6);
    for (const group of [open, fist, pinch]) expect(group.length).toBeGreaterThan(1);
    const mean = (vs: FeatureVector[]): FeatureVector => Object.fromEntries(SHAPE.map((k) => [k, vs.reduce((a, v) => a + v[k], 0) / vs.length]));
    const cats = [open, fist, pinch].map((vs, i) => ({ id: `c${i}`, label: '', centroid: mean(vs), members: [] as number[] }));
    const names = matchLabels(cats, { ...generalHandLabeling(), fallback: (i) => `shape ${i + 1}` });
    expect(names.map((m) => m.label)).toEqual(['open', 'fist', 'pinch']);
  });
});

describe('the hand words', () => {
  it('has words for every shape feature', () => {
    for (const id of SHAPE) expect(handWords(id), id).toBeDefined();
  });

  it('point the right way on the recorded open/close hand', () => {
    const shapes = frames('video_hand_open_close').map((f) => handModality.read(handsFrameVector(f))!);
    const open = shapes.filter((v) => v.openness > 2.5);
    const fist = shapes.filter((v) => v.openness < 1.1);
    const mean = (vs: FeatureVector[], k: string) => vs.reduce((a, v) => a + v[k], 0) / vs.length;
    /** Movements a fist makes MORE of than an open hand, and those it makes less of. */
    const fistMore = (m: string) => m.endsWith('-bend') || m === 'fingers-curl' || m === 'thumb-across' || m.startsWith('pinch-');
    const fistLess = (m: string) => m === 'hand-open' || m === 'fingers-spread' || m.startsWith('spread-');
    let checked = 0;
    for (const id of SHAPE) {
      const w = handWords(id)!;
      const movement = w.movement ?? w.name;
      if (!fistMore(movement) && !fistLess(movement)) continue;
      // Only what the clip clearly moves: seen from the front, a fist folds the base and tip joints
      // toward the camera, so their IMAGE angles change by a few hundredths either way.
      const delta = mean(fist, id) - mean(open, id);
      if (Math.abs(delta) < 0.1) continue;
      const moreInFist = (w.invert ? -delta : delta) > 0;
      expect(moreInFist, `${id} (${movement}${w.invert ? ', inverted' : ''}): fist ${mean(fist, id).toFixed(2)} vs open ${mean(open, id).toFixed(2)}`).toBe(fistMore(movement));
      checked++;
    }
    expect(checked).toBeGreaterThan(25);
  });
});
