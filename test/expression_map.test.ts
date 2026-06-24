/**
 * Tests the pure expression layer (issue #64): the diatonic-triad builder
 * (theory.ts), the blendshape→expression classifier, and the confusion-aware
 * expression→scale-degree assignment + its brute-force optimizer.
 */
import { describe, it, expect } from 'vitest';
import { diatonicTriad, isSevenNoteScale, type ScaleSpec } from '@/music/theory';
import {
  EXPRESSIONS,
  blendshapesToExpression,
  triadDegreeSet,
  sharedTriadNotes,
  assignmentObjective,
  optimalExpressionToDegree,
  RECOMMENDED_EXPRESSION_TO_DEGREE,
  CONFUSION_FER2013,
  type ExpressionLabel,
} from '@/music/expression';

const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

describe('diatonicTriad', () => {
  it('builds the tonic triad (I) as stacked thirds', () => {
    // C major, baseOctave 3 → C3=48, E3=52, G3=55.
    expect(diatonicTriad(cMajor, 0)).toEqual([48, 52, 55]);
  });

  it('builds the dominant (V) wrapping the octave to stay ascending', () => {
    // G3=55, B3=59, D4=62.
    expect(diatonicTriad(cMajor, 4)).toEqual([55, 59, 62]);
  });

  it('builds the diminished leading-tone triad (vii°)', () => {
    // B3=59, D4=62, F4=65.
    expect(diatonicTriad(cMajor, 6)).toEqual([59, 62, 65]);
  });

  it('respects harmonic minor (irregular qualities) via scale-thirds', () => {
    // A harmonic minor degrees: A B C D E F G#. iii (C) is augmented: C E G#.
    const aHarm: ScaleSpec = { root: 9, type: 'minorHarmonic', octaves: 2, baseOctave: 3 };
    const triad = diatonicTriad(aHarm, 2);
    // pitch classes C(0), E(4), G#(8) — an augmented triad.
    expect(triad.map((m) => ((m % 12) + 12) % 12).sort((a, b) => a - b)).toEqual([0, 4, 8]);
  });

  it('returns [] for non-seven-note scales', () => {
    expect(isSevenNoteScale('pentatonic')).toBe(false);
    expect(diatonicTriad({ ...cMajor, type: 'pentatonic' }, 0)).toEqual([]);
    expect(diatonicTriad({ ...cMajor, type: 'blues' }, 0)).toEqual([]);
  });
});

describe('blendshapesToExpression', () => {
  const classify = (bs: Record<string, number>) => blendshapesToExpression(bs);

  it('reads a smile as happy', () => {
    expect(classify({ mouthSmileLeft: 1, mouthSmileRight: 1 }).label).toBe('happy');
  });

  it('reads furrowed brows as angry (not disgust)', () => {
    expect(classify({ browDownLeft: 1, browDownRight: 1 }).label).toBe('angry');
  });

  it('reads a sneer + raised upper lip as disgusted', () => {
    expect(
      classify({ noseSneerLeft: 1, noseSneerRight: 1, mouthUpperUpLeft: 0.8, mouthUpperUpRight: 0.8 })
        .label,
    ).toBe('disgusted');
  });

  it('reads a wide-eyed open jaw with outer-brow raise as surprised', () => {
    expect(
      classify({
        jawOpen: 1,
        eyeWideLeft: 0.8,
        eyeWideRight: 0.8,
        browOuterUpLeft: 0.7,
        browOuterUpRight: 0.7,
      }).label,
    ).toBe('surprised');
  });

  it('distinguishes fear from surprise by the inner-brow raise', () => {
    expect(
      classify({ jawOpen: 0.7, eyeWideLeft: 0.9, eyeWideRight: 0.9, browInnerUp: 0.9 }).label,
    ).toBe('fearful');
  });

  it('reads a frown + inner-brow raise as sad', () => {
    expect(classify({ mouthFrownLeft: 1, mouthFrownRight: 1, browInnerUp: 0.7 }).label).toBe('sad');
  });

  it('falls back to neutral on a resting face', () => {
    expect(classify({}).label).toBe('neutral');
    expect(classify({ _neutral: 0.95 }).label).toBe('neutral');
  });

  it('returns a valid softmax distribution', () => {
    const r = classify({ mouthSmileLeft: 1, mouthSmileRight: 1 });
    expect(r.probs).toHaveLength(EXPRESSIONS.length);
    expect(r.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    for (const p of r.probs) expect(p).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeCloseTo(Math.max(...r.probs), 10);
  });
});

describe('triad note-sharing graph', () => {
  it('a triad is its root plus two stacked scale-thirds', () => {
    expect(triadDegreeSet(0)).toEqual([0, 2, 4]);
    expect(triadDegreeSet(6)).toEqual([6, 1, 3]);
  });

  it('thirds-apart triads share 2 notes, fifths 1, steps 0', () => {
    expect(sharedTriadNotes(0, 0)).toBe(3);
    expect(sharedTriadNotes(0, 2)).toBe(2); // I ↔ iii (mediant)
    expect(sharedTriadNotes(0, 4)).toBe(1); // I ↔ V (dominant)
    expect(sharedTriadNotes(0, 1)).toBe(0); // I ↔ ii (step)
  });
});

describe('confusion-aware assignment', () => {
  const distinct = (a: Record<ExpressionLabel, number>) =>
    new Set(Object.values(a)).size === EXPRESSIONS.length;

  it('the recommended seed is a valid bijection over degrees 0..6', () => {
    expect(distinct(RECOMMENDED_EXPRESSION_TO_DEGREE)).toBe(true);
    expect(new Set(Object.values(RECOMMENDED_EXPRESSION_TO_DEGREE))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6]),
    );
  });

  it('places all five non-trivial confusion pairs on 2-note-sharing triads, happy on the tonic', () => {
    const a = RECOMMENDED_EXPRESSION_TO_DEGREE;
    expect(sharedTriadNotes(a.disgusted, a.angry)).toBe(2);
    expect(sharedTriadNotes(a.angry, a.fearful)).toBe(2);
    expect(sharedTriadNotes(a.fearful, a.sad)).toBe(2);
    expect(sharedTriadNotes(a.sad, a.neutral)).toBe(2);
    expect(sharedTriadNotes(a.happy, a.neutral)).toBe(2);
    expect(a.happy).toBe(0); // happy → tonic (the resting "home" chord)
  });

  it('the shipped assignment IS the objective maximum of the shipped matrix', () => {
    // Non-tautological: pins that RECOMMENDED equals the brute-force optimum
    // (a regression in the matrix or shared-note math moves one of these).
    const optimal = optimalExpressionToDegree(CONFUSION_FER2013);
    expect(distinct(optimal)).toBe(true);
    expect(optimal).toEqual(RECOMMENDED_EXPRESSION_TO_DEGREE);
    expect(assignmentObjective(optimal)).toBeCloseTo(2.11, 5);
  });

  it('recomputes from a custom (measured) matrix without throwing', () => {
    // A trivial matrix: only happy↔neutral confused → they should land on a
    // 2-note-sharing pair in the optimum.
    const idx = Object.fromEntries(EXPRESSIONS.map((e, i) => [e, i]));
    const m = Array.from({ length: 7 }, () => new Array(7).fill(0));
    m[idx.happy][idx.neutral] = 1;
    m[idx.neutral][idx.happy] = 1;
    const opt = optimalExpressionToDegree(m);
    expect(sharedTriadNotes(opt.happy, opt.neutral)).toBe(2);
  });
});
