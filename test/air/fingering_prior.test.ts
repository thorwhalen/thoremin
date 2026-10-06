/**
 * The fingering prior (#263) on a synthetic flautist: the chart alone names the notes of
 * a player who lifts and curls as the defaults expect; one or two enrolled notes
 * calibrate the anchors to a player who curls less; the enrolment outvotes the chart in
 * the conjugate proportion; an ENROLLED note keeps winning against its chart-only
 * neighbours when the hand is noisier or drifts (the failure the first design had); a
 * wrong note in a take is caught; a label the chart does not know is still its own
 * class; an enharmonic spelling joins its class. Self-made data (`synthetic_hand.ts`),
 * safe to commit.
 */
import { describe, expect, it } from 'vitest';
import { classify, type FeatureVector, type TrainedModel } from '@thoremin/sdk/enroll';
import { fingeringVector } from '@thoremin/ext-air/nodes/air_flute';
import { FLUTE_CHART, chartNotes, fingeringFor, type FingerId } from '@thoremin/ext-air/lib/fingerings';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { emptyVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import {
  DEFAULT_ANCHORS,
  DEFAULT_FINGERING_PRIOR,
  FLUTE_FINGER_PREFIX,
  calibrateAnchors,
  checkTake,
  expectedFingering,
  fuseWithPrior,
  priorCentroid,
  priorClasses,
  priorOptionsFrom,
} from '@thoremin/ext-air/lib/fingering_prior';
import { noise, perturb, rng, syntheticHand, type HandShape } from './synthetic_hand';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';

/** A player: how much each joint bends when a finger is down / up (thumb apart), the
 *  per-frame jitter, and a per-finger drift (a systematic offset from the shape shown). */
interface Player {
  down: number;
  up: number;
  thumbDown: number;
  thumbUp: number;
  jitter: number;
  drift?: number;
}
/** Curls as the DEFAULT anchors expect. The catalog's curl is the sum over the three
 *  joints of the synthetic chain, about 2.2 x the per-joint bend after foreshortening. */
const TEXTBOOK: Player = { down: 1.1, up: 0.22, thumbDown: 0.55, thumbUp: 0.18, jitter: 0.03 };
/** A lazier player: smaller lifts and shallower curls than the defaults. */
const LAZY: Player = { down: 0.7, up: 0.35, thumbDown: 0.3, thumbUp: 0.12, jitter: 0.03 };

const FEATURES = ['l.', 'r.'].flatMap((p) => chordShapeFeatureIds().map((id) => p + id));

function handShape(down: ReadonlySet<FingerId>, hand: 'L' | 'R', p: Player): HandShape {
  const c = (finger: string, thumb = false) => {
    const id = `${hand}${finger}` as FingerId;
    const d = down.has(id);
    return thumb ? (d ? p.thumbDown : p.thumbUp) : d ? p.down : p.up;
  };
  return {
    curl: { thumb: c('T', true), index: c('1'), middle: c('2'), ring: c('3'), pinky: c('4') },
    spread: { index: -0.15, middle: 0, ring: 0.1, pinky: 0.3 },
  };
}

/** Both hands of a player holding a fingering, jittered per frame (and drifted per take). */
function frameFor(down: readonly FingerId[], p: Player, r: () => number, offset: (k: string) => number = () => 0, t = 0): HandsFrame {
  const set = new Set(down);
  const hand = (side: 'L' | 'R', label: 'Left' | 'Right', cx: number) =>
    syntheticHand(perturb(handShape(set, side, p), offset, () => noise(r, p.jitter)), { cx, cy: 220, scale: 80, world: true }, label);
  return { t, width: 640, height: 480, hands: [hand('L', 'Left', 200), hand('R', 'Right', 440)] };
}

/** The notes of the air flute's playing range: the first two octaves, one per shape. */
const RANGE: [string, string] = ['C4', 'C#6'];

/** A hold of `note` as the GUIDE shows it (the prior's expected fingering: the "one and
 *  one" Bb, not the thumb Bb the camera cannot tell from B). */
function take(note: string, p: Player, n: number, seed: number): FeatureVector[] {
  const down = expectedFingering(FLUTE_CHART, note, { range: RANGE })?.down ?? fingeringFor(FLUTE_CHART, note)!.down;
  const r = rng(seed);
  // A drift: every curl of this take offset by a fixed amount (the same sign per finger).
  const drift = p.drift ?? 0;
  const offset = (k: string) => (k.startsWith('c.') ? drift * (r() < 0.5 ? -1 : 1) : 0);
  const fixed = new Map<string, number>();
  const stable = (k: string) => {
    if (!fixed.has(k)) fixed.set(k, offset(k));
    return fixed.get(k)!;
  };
  return Array.from({ length: n }, () => fingeringVector(frameFor(down, p, r, stable), false)!);
}

const PLAYABLE = priorClasses(FLUTE_CHART, { range: RANGE }).map((c) => c.label);

const labelOf = (model: TrainedModel, v: FeatureVector) => model.categories.find((c) => c.id === classify(model, v).categoryId)!.label;

/** Fraction of frames of `notes` (held by `p`) read as their own label. */
function score(model: TrainedModel, notes: readonly string[], p: Player, seed = 23, n = 6): number {
  let right = 0;
  let total = 0;
  for (const label of notes) {
    for (const v of take(label, p, n, seed)) {
      if (labelOf(model, v) === label) right += 1;
      total += 1;
    }
  }
  return right / total;
}

describe('the flute chart as prior classes', () => {
  it('collapses notes that share a shape, naming the class in the preferred octave', () => {
    const classes = priorClasses(FLUTE_CHART, { range: RANGE });
    const e = classes.find((c) => c.notes.includes('E4'))!;
    expect(e.notes).toEqual(['E4', 'E5']);
    expect(e.label).toBe('E5');
    // D5 lifts the left index: its own shape, not D4's.
    expect(classes.find((c) => c.notes.includes('D4'))!.notes).toEqual(['D4']);
    expect(classes.find((c) => c.notes.includes('D5'))!.notes).toEqual(['D5']);
    // Low C, C# and Eb are one shape (the little finger on a different key).
    expect(classes.find((c) => c.notes.includes('C4'))!.notes).toEqual(['C4', 'C#4', 'D#4']);
  });

  it('separates Bb from B with the "one and one" alternate, since the thumb key is invisible', () => {
    const classes = priorClasses(FLUTE_CHART, { range: RANGE });
    const bb = classes.find((c) => c.notes.includes('A#4'))!;
    expect(bb.notes).toEqual(['A#4', 'A#5']);
    expect(bb.fingering).toBe('one and one');
    expect(bb.down).toContain('R1');
    expect(classes.find((c) => c.notes.includes('B4'))!.notes).toEqual(['B4', 'B5']);
    // The guide draws what the prior listens for.
    const shown = expectedFingering(FLUTE_CHART, 'Bb5', { range: RANGE })!;
    expect(shown.fingering).toBe('one and one');
    expect(shown.down).toEqual(bb.down);
    expect(shown.keys).toEqual(['Eb key']);
    expect(expectedFingering(FLUTE_CHART, 'G4', { range: RANGE })).toMatchObject({ fingering: 'standard', notes: ['G4', 'G5'] });
    expect(expectedFingering(FLUTE_CHART, 'D6', { range: RANGE })).toBeNull();
    expect(expectedFingering(FLUTE_CHART, 'nope')).toBeNull();
  });

  it('puts the expected value on each finger of each anchored family and nothing else', () => {
    const v = priorCentroid(['LT', 'L1', 'R4'], DEFAULT_ANCHORS, FLUTE_FINGER_PREFIX);
    const curl = DEFAULT_ANCHORS.curl!;
    expect(v['l.thumb.curl']).toBe(curl.thumbDown);
    expect(v['l.index.curl']).toBe(curl.down);
    expect(v['l.middle.curl']).toBe(curl.up);
    expect(v['r.pinky.curl']).toBe(curl.down);
    expect(Object.keys(v)).toHaveLength(9);
    expect(v['r.thumb.curl']).toBeUndefined();
    expect(v['l.index.pipAngle']).toBeUndefined();
  });

  it('is a dial with defaults, resolving to fuse options or to nothing when off or unusable', () => {
    expect(DEFAULT_FINGERING_PRIOR).toEqual({ enabled: true, chart: 'flute', strength: 10, low: 'C4', high: 'C#6' });
    const o = priorOptionsFrom(undefined)!;
    expect(o.chart.id).toBe('flute');
    expect(o.range).toEqual([60, 85]);
    expect(o.strength).toBe(10);
    expect(priorOptionsFrom({ enabled: false })).toBeNull();
    expect(priorOptionsFrom({ low: 'G9', high: 'A9' })).toBeNull();
    expect(priorOptionsFrom({ low: 'E5', high: 'C4' })).toBeNull();
    expect(priorOptionsFrom({ low: 'nope' })).toBeNull();
    expect(priorOptionsFrom({ chart: 'whistle-d', low: 'D5', high: 'D6' })!.chart.id).toBe('whistle-d');
  });
});

describe('the fused model', () => {
  it('names every playable note of a textbook player from the chart alone, on the curls', () => {
    const model = fuseWithPrior(emptyVocabulary(FEATURES), { chart: FLUTE_CHART, range: RANGE })!;
    expect(model.categories.map((c) => c.label).sort()).toEqual([...PLAYABLE].sort());
    expect(model.features).toHaveLength(9);
    expect(model.features.every((f) => f.endsWith('.curl'))).toBe(true);
    expect(score(model, PLAYABLE, TEXTBOOK, 11, 8)).toBeGreaterThan(0.95);
  });

  it("calibrates the anchors from enrolled notes on the guide's fingering, then names a lazy player's unseen notes", () => {
    let vocab = emptyVocabulary(FEATURES);
    const before = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE })!;
    // Two notes enrolled: G5 (four fingers down on the left, one on the right) and Bb5,
    // held "one and one" as the guide shows it (its right index DOWN, which the standard
    // row would call up).
    vocab = withEntry(vocab, 'G5', take('G5', LAZY, 40, 1));
    vocab = withEntry(vocab, 'Bb5', take('Bb5', LAZY, 40, 2));
    const { anchors, evidence } = calibrateAnchors(vocab, FLUTE_CHART, { range: RANGE });
    expect(evidence.curl!.down).toBeGreaterThan(0);
    expect(evidence.curl!.up).toBeGreaterThan(0);
    // The player's down curl is about 2.2 x 0.7 and up about 2.2 x 0.35, not the defaults.
    const curl = anchors.curl!;
    expect(curl.down).toBeLessThan(DEFAULT_ANCHORS.curl!.down);
    expect(curl.down).toBeGreaterThan(1.2);
    expect(curl.up).toBeGreaterThan(DEFAULT_ANCHORS.curl!.up);
    expect(curl.up).toBeLessThan(1.1);
    // The joint angles now have anchors too, so the metric grew past the curls.
    expect(anchors.pipAngle).toBeDefined();
    const after = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE })!;
    expect(after.anchors).toEqual(anchors);
    expect(after.features.length).toBeGreaterThan(9);
    // The enharmonic entry joined its class (A#5's), which is now named the player's way.
    const bb = after.categories.find((c) => c.label === 'Bb5')!;
    expect(after.provenance[bb.id]).toMatchObject({ enrolled: 40, prior: true, notes: ['A#4', 'A#5'] });
    expect(after.categories.some((c) => c.label === 'A#5')).toBe(false);
    // The notes NOT enrolled, read through the calibrated chart, at least as well as before.
    const unseen = PLAYABLE.filter((n) => n !== 'G5' && n !== 'A#5');
    expect(score(after, unseen, LAZY)).toBeGreaterThanOrEqual(score(before, unseen, LAZY));
    expect(score(after, unseen, LAZY)).toBeGreaterThan(0.9);
    expect(after.provenance[after.categories.find((c) => c.label === 'G5')!.id]).toMatchObject({ enrolled: 40, prior: true, notes: ['G4', 'G5'] });
  });

  it('an enrolled note keeps winning against its chart-only neighbours when the hand is noisier or drifts', () => {
    // The first design scored an enrolled class on every feature and a chart-only class
    // on the curls, so an enrolled G paid its jitter on seventy features its neighbours
    // never paid, and lost to them at twice the jitter (A5, F5, G#5 in 29 frames of 30).
    for (const p of [
      { ...TEXTBOOK, jitter: 0.06 },
      { ...TEXTBOOK, jitter: 0.03, drift: 0.08 },
      { ...LAZY, jitter: 0.06, drift: 0.05 },
    ]) {
      const vocab = withEntry(emptyVocabulary(FEATURES), 'G5', take('G5', p, 40, 3));
      const model = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE })!;
      const fresh = take('G5', p, 30, 44);
      const reads = fresh.map((v) => labelOf(model, v));
      expect(reads.filter((l) => l === 'G5').length).toBeGreaterThanOrEqual(28);
      expect(checkTake(model, 'G5', fresh)).toEqual({ kind: 'ok' });
      // And the neighbours still read as themselves.
      expect(score(model, ['A5', 'F5', 'G#5'], p, 45, 10)).toBeGreaterThan(0.9);
    }
  });

  it('updates a class centroid as a conjugate mean: chart worth `strength` samples; at 0 the chart only names', () => {
    const strength = 10;
    const samples = take('G5', LAZY, 30, 5);
    const vocab = withEntry(emptyVocabulary(FEATURES), 'G5', samples);
    const model = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE, strength })!;
    const g = model.categories.find((c) => c.label === 'G5')!;
    const id = 'l.index.curl';
    const stored = vocab.entries[0].samples; // the entry as stored (rounded)
    const x = stored.reduce((s, v) => s + v[id], 0) / stored.length;
    const prior = model.anchors.curl!.down; // L1 is down on G
    expect(g.centroid[id]).toBeCloseTo((strength * prior + stored.length * x) / (strength + stored.length), 6);
    const zero = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE, strength: 0 })!;
    expect(zero.categories.length).toBe(model.categories.length);
    expect(zero.categories.find((c) => c.label === 'G5')!.centroid[id]).toBeCloseTo(x, 6);
    expect(zero.categories.find((c) => c.label === 'A5')!.centroid[id]).toBe(prior);
  });

  it('catches a wrong note in a take, passes a right one, and shrugs at an unknown label', () => {
    const model = fuseWithPrior(emptyVocabulary(FEATURES), { chart: FLUTE_CHART, range: RANGE })!;
    expect(checkTake(model, 'A5', take('A5', TEXTBOOK, 20, 7))).toEqual({ kind: 'ok' });
    const wrong = checkTake(model, 'A5', take('G5', TEXTBOOK, 20, 8));
    expect(wrong.kind).toBe('mismatch');
    if (wrong.kind === 'mismatch') {
      expect(wrong.read).toBe('G5');
      expect(wrong.margin).toBeGreaterThan(0.5);
    }
    // Any spelling, any octave of a class's notes is that class.
    expect(checkTake(model, 'Bb5', take('A#5', TEXTBOOK, 20, 9))).toEqual({ kind: 'ok' });
    expect(checkTake(model, 'Eb4', take('C4', TEXTBOOK, 20, 9))).toEqual({ kind: 'ok' });
    expect(checkTake(model, 'Zz', take('A5', TEXTBOOK, 20, 7))).toEqual({ kind: 'unknown' });
    expect(checkTake(model, 'A5', [])).toEqual({ kind: 'unknown' });
    expect(checkTake(null, 'A5', take('A5', TEXTBOOK, 5, 7))).toEqual({ kind: 'unknown' });
  });

  it('keeps an enrolled label the chart does not know as its own class', () => {
    // "Fist": every finger down on both hands, a shape no flute note has.
    const all = ['LT', 'L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'] as FingerId[];
    const r = rng(3);
    const fist = Array.from({ length: 30 }, () => fingeringVector(frameFor(all, TEXTBOOK, r), false)!);
    const vocab = withEntry(emptyVocabulary(FEATURES), 'fist', fist);
    const model = fuseWithPrior(vocab, { chart: FLUTE_CHART, range: RANGE })!;
    const cat = model.categories.find((c) => c.label === 'fist')!;
    expect(model.provenance[cat.id]).toEqual({ notes: [], enrolled: 30, prior: false });
    const r2 = rng(4);
    const fresh = fingeringVector(frameFor(all, TEXTBOOK, r2), false)!;
    expect(classify(model, fresh).categoryId).toBe(cat.id);
    // And the chart's notes still read as themselves next to it.
    expect(labelOf(model, take('G5', TEXTBOOK, 1, 12)[0])).toBe('G5');
  });

  it('is null with nothing to learn from, and chart-only outside the enrolment', () => {
    expect(fuseWithPrior(emptyVocabulary(FEATURES), { chart: FLUTE_CHART, range: ['C9', 'C9'] })).toBeNull();
    expect(chartNotes(FLUTE_CHART, RANGE)).toHaveLength(26);
  });
});
