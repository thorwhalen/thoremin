/**
 * The fingering prior (#263) — what an air wind instrument expects each note's hands to
 * look like BEFORE its player has shown it, and how the player's own enrolment tunes it.
 *
 * ## The idea
 *
 * The enrolled vocabulary (`./vocabulary.ts`) learns a class per label from samples
 * alone: a note the player has not enrolled does not exist. A fingering chart
 * (`src/music/fingerings.ts`) says, for every note, which fingers are down, and on an
 * air flute a down finger is a curled one and an up finger a straight one (the
 * research's "large lifts": a real key press is under the tracker's noise, so the air
 * instrument reads the exaggerated shape, `docs/research/air-instruments.md` §7.2). So
 * the chart gives every note an expected value on one feature per finger, its curl, and
 * says nothing about the rest of the hand (spreads, pinches, the other joints).
 *
 * ## Bayes, concretely
 *
 * Each class's centroid is treated as a Gaussian mean with a prior: mean at the chart's
 * expectation, worth `strength` pseudo-samples. With `n` enrolled samples averaging `x`,
 * the posterior mean is `(strength * chart + n * x) / (strength + n)` per feature: the
 * conjugate normal update, and exactly what `trainModel` computes when the chart's
 * centroid is added to the class `strength` times. With no enrolment the chart alone
 * plays; after a two-second hold (about forty samples) the player's own shape has
 * outvoted it four to one at the default strength. Features the chart has no opinion
 * about are left BLANK on a chart-only class (a non-finite centroid entry, which the
 * distance skips): such a class neither gains nor loses on them and competes on the
 * curls alone, while an enrolled class is judged on everything it showed. (Filling the
 * blanks with a grand mean instead lets an enrolled note steal its neighbours: a hand
 * one finger away from an enrolled G matches G on seventy features and the chart's G#
 * on nine.)
 *
 * ## The anchors are the player's
 *
 * How far this player curls a "down" finger, and how straight an "up" one is, are two
 * numbers per finger family (the thumb curls differently), read from whatever IS
 * enrolled whose label the chart knows: every enrolled note says what several down and
 * several up fingers look like, so one enrolled note calibrates the chart for all the
 * others. That is the sense in which training only tunes to the player. Without any
 * enrolment the defaults below apply, chosen for a deliberate air-flute lift.
 *
 * ## What the hand cannot see
 *
 * Two notes whose fingerings use the same fingers on different keys (the flute's C4, C#4
 * and Eb4: the little finger on the C, C# or Eb key; Bb with the thumb key and B) are one
 * shape to a camera. The prior keeps them as ONE class, labelled by every note in it,
 * unless an alternate fingering separates them (the flute's "one and one" Bb does), and
 * tells the player so through the class's `notes`. Nor can it see the octave: E4 and E5
 * are one shape. `preferredOctave` picks which note names such a class.
 *
 * Pure: no React, no DAG, no catalog import beyond the feature-id convention passed in.
 */
import { trainModel, weightedDistance, type FeatureVector, type TrainedModel } from '@/enroll';
import type { TargetVerdict } from '@/enroll';
import { chartNotes, fingeringKey, type FingerId, type Fingering, type FingeringChart } from '@/music/fingerings';
import { parseNoteName } from '@/music/notes';
import { MIN_SAMPLES_PER_ENTRY, jitterWeights, type Vocabulary, type VocabularyEntry } from './vocabulary';

/** How curled a finger is when down and when up, in the catalog's curl units (radians
 *  summed over the three joints; 0 is straight, a fist is near 3π). */
export interface Anchors {
  up: number;
  down: number;
  thumbUp: number;
  thumbDown: number;
}

/** For a deliberate air-flute lift: an up finger nearly straight, a down finger bent
 *  well past a resting curve. The thumb bends less. Overridden by the player's own
 *  enrolment through {@link calibrateAnchors}. */
export const DEFAULT_ANCHORS: Anchors = { up: 0.5, down: 2.4, thumbUp: 0.4, thumbDown: 1.2 };

/** The feature ids a finger's curl lives under in the flute's vocabulary: both hands'
 *  chord-shape vectors, prefixed by the player's hand (`fingeringVector`). */
export const FLUTE_FINGER_FEATURE: Record<FingerId, string> = {
  LT: 'l.thumb.curl',
  L1: 'l.index.curl',
  L2: 'l.middle.curl',
  L3: 'l.ring.curl',
  L4: 'l.pinky.curl',
  R1: 'r.index.curl',
  R2: 'r.middle.curl',
  R3: 'r.ring.curl',
  R4: 'r.pinky.curl',
};

const isThumb = (finger: FingerId) => finger.endsWith('T');

export interface FingeringPriorOptions {
  chart: FingeringChart;
  /** Only chart notes in this range (inclusive) take part. Default: the whole chart. */
  range?: [string | number, string | number];
  /** When one shape serves several octaves, the note in this octave names the class.
   *  Default 5 (a flute's most-played octave). */
  preferredOctave?: number;
  /** Pseudo-samples the chart is worth against the player's own. */
  strength?: number;
  /** The per-finger feature ids. Default: the flute vocabulary's. */
  feature?: Record<FingerId, string>;
  /** The curl anchors when nothing enrolled can calibrate them. */
  anchors?: Anchors;
}

const PRIOR_DEFAULTS = { preferredOctave: 5, strength: 10 };

/** One class of the prior: a distinct finger shape and the notes it plays. */
export interface PriorClass {
  /** The class's name: the note in the preferred octave, else the lowest. */
  label: string;
  /** Every chart note this shape plays, ascending. */
  notes: string[];
  down: readonly FingerId[];
  /** Which fingering was used when an alternate separated a collision. */
  fingering: 'standard' | string;
}

/**
 * The distinct finger shapes of a chart's notes, as classes. Notes sharing a shape are one
 * class; when the shared notes are different PITCH CLASSES (not octaves of each other),
 * the first alternate fingering that gives a shape of its own separates them.
 */
export function priorClasses(chart: FingeringChart, options: Pick<FingeringPriorOptions, 'range' | 'preferredOctave'> = {}): PriorClass[] {
  const preferred = options.preferredOctave ?? PRIOR_DEFAULTS.preferredOctave;
  const notes = chartNotes(chart, options.range);
  type Group = { down: readonly FingerId[]; notes: Fingering[]; fingering: string };
  const byKey = new Map<string, Group>();
  const place = (xs: readonly Fingering[], down: readonly FingerId[], fingering: string) => {
    const key = fingeringKey({ down });
    const g = byKey.get(key);
    if (g) g.notes.push(...xs);
    else byKey.set(key, { down, notes: [...xs], fingering });
  };
  // 1. Every note on its standard fingering.
  for (const x of notes) place([x], x.down, 'standard');
  // 2. A shape shared by different PITCH CLASSES (not octaves of one note): the pitch
  //    class without an alternate keeps the standard shape; each other one moves to the
  //    first of its alternates whose shape is free, all its octaves together.
  const pc = (x: Fingering) => ((x.midi % 12) + 12) % 12;
  for (const g of [...byKey.values()]) {
    const classes = [...new Set(g.notes.map(pc))];
    if (classes.length < 2) continue;
    const keep = classes.find((c) => g.notes.filter((x) => pc(x) === c).every((x) => x.alternates.length === 0)) ?? classes[0];
    for (const c of classes) {
      if (c === keep) continue;
      const movers = g.notes.filter((x) => pc(x) === c);
      const names = movers[0].alternates.map((a) => a.name);
      const name = names.find(
        (n) => movers.every((x) => x.alternates.some((a) => a.name === n)) && !byKey.has(fingeringKey(movers[0].alternates.find((a) => a.name === n)!)),
      );
      if (!name) continue;
      g.notes = g.notes.filter((x) => pc(x) !== c);
      place(movers, movers[0].alternates.find((a) => a.name === name)!.down, name);
    }
  }
  return [...byKey.values()].map((g) => {
    const sorted = [...g.notes].sort((a, b) => a.midi - b.midi);
    const named = sorted.find((n) => Math.floor(n.midi / 12) - 1 === preferred) ?? sorted[0];
    return { label: named.note, notes: sorted.map((n) => n.note), down: g.down, fingering: g.fingering };
  });
}

/**
 * The fingering the prior EXPECTS for a note: its class's shape, which is the standard
 * fingering unless an alternate was needed to tell it from another note (the flute's Bb
 * is shown "one and one"). This is what a guide must draw, so that what the player is
 * shown and what the prior listens for are the same shape. Null for a note outside the
 * chart or the range.
 */
export function expectedFingering(
  chart: FingeringChart,
  note: string,
  options: Pick<FingeringPriorOptions, 'range' | 'preferredOctave'> = {},
): { down: readonly FingerId[]; keys: readonly string[]; fingering: string; notes: string[] } | null {
  const midi = parseNoteName(note)?.midi;
  if (midi === undefined) return null;
  const row = chart.fingerings.find((x) => x.midi === midi);
  if (!row) return null;
  const cls = priorClasses(chart, options).find((c) => c.notes.includes(row.note));
  if (!cls) return null;
  const keys = cls.fingering === 'standard' ? row.keys : (row.alternates.find((a) => a.name === cls.fingering)?.keys ?? []);
  return { down: cls.down, keys, fingering: cls.fingering, notes: cls.notes };
}

/** The chart's expected curl per finger for a shape, on the given feature ids. */
export function priorCentroid(down: readonly FingerId[], anchors: Anchors, feature: Record<FingerId, string>): FeatureVector {
  const isDown = new Set(down);
  const out: FeatureVector = {};
  for (const finger of Object.keys(feature) as FingerId[]) {
    const d = isDown.has(finger);
    out[feature[finger]] = isThumb(finger) ? (d ? anchors.thumbDown : anchors.thumbUp) : d ? anchors.down : anchors.up;
  }
  return out;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The player's own anchors, from every enrolled entry whose label the chart knows: the
 * mean curl of the fingers the chart says are down, and of those it says are up, thumbs
 * apart. A state with no evidence keeps its default. Returns how many samples backed each.
 */
export function calibrateAnchors(
  vocab: Vocabulary,
  chart: FingeringChart,
  options: Pick<FingeringPriorOptions, 'feature' | 'anchors'> = {},
): { anchors: Anchors; evidence: Record<keyof Anchors, number> } {
  const feature = options.feature ?? FLUTE_FINGER_FEATURE;
  const base = options.anchors ?? DEFAULT_ANCHORS;
  const pools: Record<keyof Anchors, number[]> = { up: [], down: [], thumbUp: [], thumbDown: [] };
  for (const entry of vocab.entries) {
    const midi = parseNoteName(entry.label)?.midi;
    const row = midi === undefined ? null : chart.fingerings.find((x) => x.midi === midi) ?? null;
    if (!row) continue;
    const isDown = new Set(row.down);
    for (const finger of Object.keys(feature) as FingerId[]) {
      const key: keyof Anchors = isThumb(finger) ? (isDown.has(finger) ? 'thumbDown' : 'thumbUp') : isDown.has(finger) ? 'down' : 'up';
      for (const s of entry.samples) {
        const x = s[feature[finger]];
        if (finite(x)) pools[key].push(x);
      }
    }
  }
  const anchors: Anchors = { ...base };
  const evidence = { up: 0, down: 0, thumbUp: 0, thumbDown: 0 } as Record<keyof Anchors, number>;
  for (const key of Object.keys(pools) as (keyof Anchors)[]) {
    evidence[key] = pools[key].length;
    if (pools[key].length >= MIN_SAMPLES_PER_ENTRY) anchors[key] = mean(pools[key]);
  }
  return { anchors, evidence };
}

/** A fused model's category carries which chart notes it plays (empty: enrolled only). */
export interface FusedModel extends TrainedModel {
  /** Per category id: the chart notes of its shape, and whether the player enrolled it. */
  provenance: Record<string, { notes: string[]; enrolled: number; prior: boolean }>;
  anchors: Anchors;
}

/**
 * The classifier from the chart AND the enrolment: one category per chart shape and per
 * enrolled label, the two joined where the label is one of the shape's notes. Null when
 * there is nothing at all (an empty chart range and no enrolment).
 *
 * Distances are in the player's own hold jitter where the enrolment gives one
 * (`jitterWeights`), and in units of the anchors' gap on the curl features until it does:
 * a quarter of the up-to-down gap is one unit, so a finger halfway between the two states
 * is two units from either.
 */
export function fuseWithPrior(vocab: Vocabulary, options: FingeringPriorOptions): FusedModel | null {
  const o = { ...PRIOR_DEFAULTS, ...options };
  const feature = o.feature ?? FLUTE_FINGER_FEATURE;
  const { anchors } = calibrateAnchors(vocab, o.chart, { feature, anchors: o.anchors });
  const classes = priorClasses(o.chart, o);
  const usable = vocab.entries.filter((e) => e.samples.length >= MIN_SAMPLES_PER_ENTRY);
  if (classes.length === 0 && usable.length === 0) return null;

  // Join: an enrolled entry whose label is one of a class's notes IS that class.
  const byNote = new Map<string, PriorClass>();
  for (const c of classes) for (const n of c.notes) byNote.set(n, c);
  const enrolledOf = new Map<PriorClass, VocabularyEntry[]>();
  const loose: VocabularyEntry[] = [];
  for (const e of usable) {
    const canonical = parseNoteName(e.label)?.name ?? e.label;
    const c = byNote.get(canonical);
    if (c) enrolledOf.set(c, [...(enrolledOf.get(c) ?? []), e]);
    else loose.push(e);
  }

  // Features: the vocabulary's where something is enrolled, else only the curls.
  const curlIds = Object.values(feature);
  const enrolledFeatures = vocab.features.filter((f) => usable.some((e) => e.samples.some((s) => finite(s[f]))));
  const features = [...new Set([...curlIds, ...enrolledFeatures])];
  const weights = usable.length > 0 ? jitterWeights(usable, features) : {};
  const gapUnit = Math.max(1e-3, Math.abs(anchors.down - anchors.up) / 4);
  for (const id of curlIds) if (!finite(weights[id]) || usable.length === 0 || !enrolledFeatures.includes(id)) weights[id] = 1 / gapUnit;

  const vectors: FeatureVector[] = [];
  const clusters: number[][] = [];
  const labels: string[] = [];
  const provenance: FusedModel['provenance'] = {};
  const addClass = (label: string, prior: FeatureVector | null, entries: readonly VocabularyEntry[], notes: string[]) => {
    const idx: number[] = [];
    if (prior) {
      for (let i = 0; i < o.strength; i++) {
        idx.push(vectors.length);
        vectors.push(prior);
      }
    }
    let enrolled = 0;
    for (const e of entries) {
      for (const s of e.samples) {
        idx.push(vectors.length);
        vectors.push(s);
        enrolled += 1;
      }
    }
    if (idx.length === 0) return;
    clusters.push(idx);
    labels.push(label);
    provenance[`cat-${clusters.length}`] = { notes, enrolled, prior: prior !== null };
  };

  for (const c of classes) {
    const entries = enrolledOf.get(c) ?? [];
    // Enrolled under several of the class's notes (E4 and E5): keep the class ONE shape,
    // named by the first enrolled label so the player's own word wins.
    const label = entries[0]?.label ?? c.label;
    addClass(label, priorCentroid(c.down, anchors, feature), entries, c.notes);
  }
  for (const e of loose) addClass(e.label, null, [e], []);

  // Closed-set, as the vocabulary is (the prior classes cover the space).
  const model = trainModel(vectors, clusters, features, weights, { defaultRejectRadius: Infinity }) as FusedModel;
  model.categories.forEach((c, i) => {
    c.label = labels[i];
    // A chart-only class has no opinion beyond the curls: blank, not zero (trainModel's
    // mean of nothing), so the distance skips those features for it.
    if (provenance[c.id]?.enrolled === 0) for (const f of features) if (!curlIds.includes(f)) c.centroid[f] = NaN;
  });
  model.provenance = provenance;
  model.anchors = anchors;
  return model;
}

export interface CheckOptions {
  /**
   * How far toward another class the take must sit before it is called a mismatch: the
   * median sample's (distance to target - distance to nearest other) as a fraction of
   * the distance between those two centroids. 0 is halfway between them, 1 is exactly
   * on the other class; scale-free, so it means the same thing before and after
   * enrolment changes the metric.
   */
  margin?: number;
}

const CHECK_DEFAULTS = { margin: 0.5 };

/** The median of a list (its mean middle for an even count). */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Did a take look like its label? For every sample, the weighted distance to the target's
 * class and to the nearest OTHER class, their difference over the two centroids' own
 * distance; a mismatch when that fraction is at least `margin` on the median sample (a
 * hold is judged as a whole, not on its worst frame). `unknown` when the model has no class for the label or the take is empty. A
 * `TargetCheck` for the sequence runner is `(label, samples) => checkTake(model, label, samples)`.
 */
export function checkTake(model: TrainedModel | null, label: string, samples: readonly FeatureVector[], options: CheckOptions = {}): TargetVerdict {
  const o = { ...CHECK_DEFAULTS, ...options };
  if (!model || samples.length === 0) return { kind: 'unknown' };
  // A note label matches its class by pitch (Bb5 is the class spelled A#5); any other
  // label by its exact text.
  const midi = parseNoteName(label)?.midi;
  const target = model.categories.find((c) => c.label === label || (midi !== undefined && parseNoteName(c.label)?.midi === midi));
  if (!target || model.categories.length < 2) return { kind: 'unknown' };
  const others = model.categories.filter((c) => c !== target);
  const margins: number[] = [];
  const reads: Record<string, number> = {};
  for (const s of samples) {
    const dTarget = weightedDistance(s, target.centroid, model.features, model.weights);
    let best = others[0];
    let dBest = Infinity;
    for (const c of others) {
      const d = weightedDistance(s, c.centroid, model.features, model.weights);
      if (d < dBest) {
        dBest = d;
        best = c;
      }
    }
    const apart = weightedDistance(target.centroid, best.centroid, model.features, model.weights);
    margins.push(apart > 0 ? (dTarget - dBest) / apart : 0);
    if (dBest < dTarget) reads[best.label] = (reads[best.label] ?? 0) + 1;
  }
  const m = median(margins);
  if (m < o.margin) return { kind: 'ok' };
  const read = Object.entries(reads).sort((a, b) => b[1] - a[1])[0]?.[0];
  return read ? { kind: 'mismatch', read, margin: m } : { kind: 'ok' };
}
