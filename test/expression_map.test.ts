/**
 * Tests the pure expression layer (issue #64): the diatonic-triad builder
 * (theory.ts), the blendshape→expression classifier, and the confusion-aware
 * expression→scale-degree assignment + its brute-force optimizer.
 */
import { describe, it, expect } from 'vitest';
import { diatonicTriad, isSevenNoteScale, type ScaleSpec } from '@/music/theory';
import {
  EMOTIONS,
  CONFUSION_EXPRESSIONS,
  DEFAULT_EXPRESSION_TO_DEGREE,
  expressionActivations,
  decideExpression,
  sensitivityToThreshold,
  expressionThresholds,
  calibrateSensitivity,
  EXPRESSION_PROTOTYPES,
  EXPRESSION_THRESHOLD_BOUNDS,
  DEFAULT_EXPRESSION_SENSITIVITY,
  triadDegreeSet,
  sharedTriadNotes,
  assignmentObjective,
  optimalExpressionToDegree,
  RECOMMENDED_EXPRESSION_TO_DEGREE,
  CONFUSION_FER2013,
  type Emotion,
} from '@/music/expression';
import { EXPRESSION_HELP } from '@/app/expressionHelp';

const zeroActs = (): Record<Emotion, number> =>
  Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;

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

describe('expressionActivations (magnitude-aware, [0,1])', () => {
  it('a full smile activates happy strongly and the rest near zero', () => {
    const a = expressionActivations({ mouthSmileLeft: 1, mouthSmileRight: 1 });
    expect(a.happy).toBeGreaterThan(0.6);
    expect(a.angry).toBeLessThan(0.1);
    expect(a.sad).toBeLessThan(0.1);
  });

  it('a FAINT brow furrow barely activates angry (the fix for cosine scale-invariance)', () => {
    // The old cosine classifier read this tiny resting furrow as a confident
    // angry; the magnitude-aware score keeps it near zero so it cannot fire.
    const a = expressionActivations({ browDownLeft: 0.08, browDownRight: 0.08 });
    expect(a.angry).toBeLessThan(0.1);
  });

  it('every emotion scores within [0,1]', () => {
    const a = expressionActivations({ jawOpen: 1, eyeWideLeft: 1, eyeWideRight: 1, browInnerUp: 1 });
    for (const e of EMOTIONS) {
      expect(a[e]).toBeGreaterThanOrEqual(0);
      expect(a[e]).toBeLessThanOrEqual(1);
    }
  });
});

describe('decideExpression (per-class thresholds + neutral abstention)', () => {
  const decide = (bs: Record<string, number>) => decideExpression(expressionActivations(bs)).label;

  it('reads a clear smile as happy', () => {
    expect(decide({ mouthSmileLeft: 1, mouthSmileRight: 1 })).toBe('happy');
  });
  it('reads furrowed brows as angry (not disgust)', () => {
    expect(decide({ browDownLeft: 1, browDownRight: 1 })).toBe('angry');
  });
  it('reads a sneer + raised upper lip as disgusted', () => {
    expect(decide({ noseSneerLeft: 1, noseSneerRight: 1, mouthUpperUpLeft: 0.8, mouthUpperUpRight: 0.8 })).toBe('disgusted');
  });
  it('reads a wide-eyed open jaw with outer-brow raise as surprised', () => {
    expect(decide({ jawOpen: 1, eyeWideLeft: 0.8, eyeWideRight: 0.8, browOuterUpLeft: 0.7, browOuterUpRight: 0.7, browInnerUp: 0.4 })).toBe('surprised');
  });
  it('distinguishes fear from surprise by the inner-brow raise', () => {
    expect(decide({ jawOpen: 0.7, eyeWideLeft: 0.9, eyeWideRight: 0.9, browInnerUp: 0.9, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 })).toBe('fearful');
  });
  it('reads a frown + inner-brow raise as sad', () => {
    expect(decide({ mouthFrownLeft: 1, mouthFrownRight: 1, browInnerUp: 0.7 })).toBe('sad');
  });

  it('falls back to neutral on a resting OR faintly-active face (the angry-bug fix)', () => {
    expect(decide({})).toBe('neutral');
    expect(decide({ _neutral: 0.95 })).toBe('neutral'); // a stray model key, no FACS units
    expect(decide({ browDownLeft: 0.1, browDownRight: 0.1 })).toBe('neutral'); // faint furrow
  });

  it('a higher sensitivity makes an otherwise-neutral faint expression fire', () => {
    const faint = expressionActivations({ mouthSmileLeft: 0.25, mouthSmileRight: 0.25 });
    expect(decideExpression(faint, DEFAULT_EXPRESSION_SENSITIVITY).label).toBe('neutral');
    expect(decideExpression(faint, { ...DEFAULT_EXPRESSION_SENSITIVITY, happy: 1 }).label).toBe('happy');
  });

  it('breaks ties by margin over each class’s own threshold', () => {
    // happy at 0.5, sad at 0.5 — both clear; the more-sensitive one (lower bar →
    // bigger margin) wins, exercising the operating-point tie-break.
    const acts = { ...zeroActs(), happy: 0.5, sad: 0.5 };
    expect(decideExpression(acts, { ...DEFAULT_EXPRESSION_SENSITIVITY, happy: 0.9, sad: 0.5 }).label).toBe('happy');
    expect(decideExpression(acts, { ...DEFAULT_EXPRESSION_SENSITIVITY, happy: 0.5, sad: 0.9 }).label).toBe('sad');
  });

  it('marks fired flags for the emotions that cleared their bar', () => {
    const d = decideExpression(expressionActivations({ mouthSmileLeft: 1, mouthSmileRight: 1 }));
    expect(d.fired.happy).toBe(true);
    expect(d.fired.angry).toBe(false);
  });
});

describe('reachability: sad / disgusted / fearful fire after the prototype/threshold tuning', () => {
  // The MediaPipe model under-reports mouthFrown / noseSneer / browInnerUp / eyeWide;
  // the prototypes were rebalanced onto the reliable neighbour channels so a real
  // (partial on the weak channels) expression clears the bar. These pin that.
  it('sad fires on a strong frown even with the weak channels only partial', () => {
    const a = expressionActivations({
      mouthFrownLeft: 0.25, mouthFrownRight: 0.25, browInnerUp: 0.2,
      mouthLowerDownLeft: 0.8, mouthLowerDownRight: 0.8,
    });
    expect(a.sad).toBeGreaterThan(expressionThresholds().sad); // clears its own firing bar
    expect(decideExpression(a).label).toBe('sad');
  });

  it('disgusted fires on a strong upper-lip raise even with noseSneer near zero', () => {
    const a = expressionActivations({
      noseSneerLeft: 0.1, noseSneerRight: 0.1, mouthUpperUpLeft: 0.8, mouthUpperUpRight: 0.8,
    });
    expect(a.disgusted).toBeGreaterThan(expressionThresholds().disgusted);
    expect(decideExpression(a).label).toBe('disgusted');
    expect(a.angry).toBeLessThan(expressionThresholds().angry); // the browDown component stays under angry
  });

  it('fearful wins at the relaxed 0.40 bar on a wide-eyed, open-jaw, lip-stretched face', () => {
    const a = expressionActivations({
      jawOpen: 0.5, eyeWideLeft: 0.7, eyeWideRight: 0.7, browInnerUp: 0.3,
      mouthStretchLeft: 0.5, mouthStretchRight: 0.5,
    });
    expect(decideExpression(a).label).toBe('fearful');
  });

  it('kiss: funneled-lips "ooo" fires kiss, and kiss does not cross-trip happy/surprise', () => {
    const a = expressionActivations({ mouthFunnel: 0.8, mouthPucker: 0.5 }); // kiss = 0.71
    expect(a.kiss).toBeGreaterThan(expressionThresholds().kiss);
    expect(decideExpression(a).label).toBe('kiss');
    // A smile or an open-mouth surprise (no mouthFunnel) must not read as kiss.
    expect(decideExpression(expressionActivations({ mouthSmileLeft: 1, mouthSmileRight: 1 })).label).not.toBe('kiss');
    expect(decideExpression(expressionActivations({ jawOpen: 1, eyeWideLeft: 0.8, eyeWideRight: 0.8 })).label).not.toBe('kiss');
    // When kiss CO-FIRES with a weakly-firing emotion, the bigger margin wins —
    // kiss (0.71, margin 0.335) beats a just-firing happy (0.40, margin 0.025).
    expect(decideExpression({ ...a, happy: 0.4 }).label).toBe('kiss');
  });

  it('does NOT false-fire on non-emotional faces (open mouth → neutral, smile → not disgusted)', () => {
    // An open mouth drives mouthLowerDown high via jawOpen, but with no frown it
    // must stay neutral (the lower-lip weight is capped below the bar).
    expect(decideExpression(expressionActivations({ jawOpen: 1, mouthLowerDownLeft: 1, mouthLowerDownRight: 1 })).label).toBe('neutral');
    // A broad smile must not leak into disgusted via any upper-lip movement.
    expect(decideExpression(expressionActivations({ mouthSmileLeft: 1, mouthSmileRight: 1 })).label).not.toBe('disgusted');
  });
});

describe('calibrateSensitivity (per-user solve from rest + peak)', () => {
  const rest = Object.fromEntries(EMOTIONS.map((e) => [e, 0.05])) as Record<Emotion, number>;

  it('a reachable peak puts the firing bar between rest and peak, and it fires there', () => {
    const peak = { ...rest, surprised: 0.5 };
    const cal = calibrateSensitivity(rest, peak);
    expect(cal.surprised.reachable).toBe(true);
    // Bar strictly between the user's rest and peak → their production clears it.
    expect(cal.surprised.threshold).toBeGreaterThan(rest.surprised);
    expect(cal.surprised.threshold).toBeLessThan(peak.surprised);
    // The solved sensitivity, fed back through the classifier, reproduces the bar.
    expect(sensitivityToThreshold(cal.surprised.sensitivity, EXPRESSION_THRESHOLD_BOUNDS.surprised)).toBeCloseTo(
      cal.surprised.threshold,
    );
  });

  it('an UNreachable emotion (peak ≈ rest) keeps the default and is flagged', () => {
    const peak = { ...rest }; // never activated above rest
    const cal = calibrateSensitivity(rest, peak);
    expect(cal.disgusted.reachable).toBe(false);
    expect(cal.disgusted.sensitivity).toBe(DEFAULT_EXPRESSION_SENSITIVITY.disgusted);
  });

  it('a strong producer gets a stricter (lower-sensitivity) bar than a weak producer', () => {
    const strong = calibrateSensitivity(rest, { ...rest, fearful: 0.8 }).fearful;
    const weak = calibrateSensitivity(rest, { ...rest, fearful: 0.3 }).fearful;
    expect(strong.threshold).toBeGreaterThan(weak.threshold); // strong face → higher bar
    expect(strong.sensitivity).toBeLessThan(weak.sensitivity);
  });

  it('clamps the bar into the emotion bounds (a very weak peak can floor at min)', () => {
    const cal = calibrateSensitivity(rest, { ...rest, angry: 0.22 }).angry;
    expect(cal.threshold).toBeGreaterThanOrEqual(EXPRESSION_THRESHOLD_BOUNDS.angry.min - 1e-9);
    expect(cal.sensitivity).toBeLessThanOrEqual(1);
  });

  it('flags a peak BELOW the emotion floor as UNreachable (the floored bar exceeds the peak)', () => {
    // angry.min = 0.2; a peak of 0.15 floors the bar at 0.2 > 0.15 → could never fire,
    // so it must NOT be reported reachable (that would be a false green in the wizard).
    const cal = calibrateSensitivity(rest, { ...rest, angry: 0.15 }).angry;
    expect(cal.reachable).toBe(false);
    expect(cal.threshold).toBeGreaterThan(0.15); // the bar the peak can't clear
    expect(cal.sensitivity).toBe(DEFAULT_EXPRESSION_SENSITIVITY.angry); // fell back to default
  });
});

describe('sensitivity ↔ threshold', () => {
  it('sensitivityToThreshold is monotone DECREASING (more sensitive = lower bar)', () => {
    const b = EXPRESSION_THRESHOLD_BOUNDS.happy;
    expect(sensitivityToThreshold(0, b)).toBeCloseTo(b.max);
    expect(sensitivityToThreshold(1, b)).toBeCloseTo(b.min);
    expect(sensitivityToThreshold(0.3, b)).toBeGreaterThan(sensitivityToThreshold(0.7, b));
  });
  it('expressionThresholds returns one threshold per emotion', () => {
    const thr = expressionThresholds(DEFAULT_EXPRESSION_SENSITIVITY);
    for (const e of EMOTIONS) expect(typeof thr[e]).toBe('number');
  });
});

describe('decideExpression hysteresis', () => {
  it('judges the held label against an easier exit threshold (sticky, anti-chatter)', () => {
    const b = EXPRESSION_THRESHOLD_BOUNDS.happy;
    const enter = sensitivityToThreshold(0.5, b);
    const between = enter - b.delta * 0.5; // below enter, above the exit (enter − delta)
    const acts = { ...zeroActs(), happy: between };
    expect(decideExpression(acts, DEFAULT_EXPRESSION_SENSITIVITY).label).toBe('neutral'); // not held
    expect(decideExpression(acts, DEFAULT_EXPRESSION_SENSITIVITY, 'happy').label).toBe('happy'); // held → sticky
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

describe('shipped default expression→degree map (hand-picked)', () => {
  it('covers I..vii° once each, kiss on vii°, neutral silent', () => {
    const d = DEFAULT_EXPRESSION_TO_DEGREE;
    expect(d.happy).toBe(0); // I
    expect(d.fearful).toBe(1); // ii
    expect(d.disgusted).toBe(2); // iii
    expect(d.surprised).toBe(3); // IV
    expect(d.angry).toBe(4); // V
    expect(d.sad).toBe(5); // vi
    expect(d.kiss).toBe(6); // vii°
    expect(d.neutral).toBe(-1); // silence
    // The seven scored emotions cover degrees 0..6 exactly once (all 7 chords).
    expect(EMOTIONS.map((e) => d[e]).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('confusion-aware assignment', () => {
  // The confusion optimizer is a bijection over the ORIGINAL 7 labels (it predates
  // the later `kiss` emotion), so size against CONFUSION_EXPRESSIONS, not EXPRESSIONS.
  const distinct = (a: Record<string, number>) =>
    new Set(Object.values(a)).size === CONFUSION_EXPRESSIONS.length;

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
    const idx = Object.fromEntries(CONFUSION_EXPRESSIONS.map((e, i) => [e, i]));
    const m = Array.from({ length: 7 }, () => new Array(7).fill(0));
    m[idx.happy][idx.neutral] = 1;
    m[idx.neutral][idx.happy] = 1;
    const opt = optimalExpressionToDegree(m);
    expect(sharedTriadNotes(opt.happy, opt.neutral)).toBe(2);
  });
});

describe('expression help content', () => {
  it('covers every emotion with a key action + real blendshape channels; flags the hard ones', () => {
    const helpNames = new Set(EXPRESSION_HELP.map((h) => h.name));
    for (const e of EMOTIONS) expect(helpNames.has(e)).toBe(true); // one card per emotion
    for (const h of EXPRESSION_HELP) {
      expect(h.keyAction.length).toBeGreaterThan(0);
      expect(h.blendshapes.length).toBeGreaterThan(0);
      // The channels named in each help card are exactly the ones the classifier
      // scores for that emotion (catches a typo or drift after a prototype retune).
      const protoKeys = new Set(Object.keys(EXPRESSION_PROTOTYPES[h.name]));
      for (const b of h.blendshapes) expect(protoKeys.has(b)).toBe(true);
    }
    // The model's under-reported emotions are flagged as harder to detect.
    const hard = new Set(EXPRESSION_HELP.filter((h) => h.hardToDetect).map((h) => h.name));
    expect(hard).toEqual(new Set(['sad', 'fearful', 'disgusted']));
  });
});
