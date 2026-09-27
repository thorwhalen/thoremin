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
 * the chart gives every note an expected value on each finger's FLEXION features (its
 * curl, and the three joint angles the curl is the sum of) and says nothing about the
 * rest of the hand (spreads, pinches, reach).
 *
 * ## Bayes, concretely
 *
 * Each class's centroid is treated as a Gaussian mean with a prior: mean at the chart's
 * expectation, worth `strength` pseudo-samples. With `n` enrolled samples averaging `x`,
 * the posterior mean is `(strength * chart + n * x) / (strength + n)` per feature: the
 * conjugate normal update, and exactly what `trainModel` computes when the chart's
 * centroid is added to the class `strength` times. With no enrolment the chart alone
 * plays; after a two-second hold (about forty samples) the player's own shape has
 * outvoted it four to one at the default strength.
 *
 * ## One metric for every class
 *
 * The fused model compares every class on the SAME features: the flexion features the
 * chart can speak on. An enrolled class is not scored on the seventy other features of
 * the hand vector, because a chart-only class has nothing there and a distance over
 * different feature sets is not one distance: scored on everything, an enrolled note
 * pays its own jitter on seventy features that its chart-only neighbours never pay, and
 * loses to them as soon as the hand is a little noisy (measured: at twice the test
 * jitter an enrolled G read as A, F or G# in 29 frames of 30). For the air flute this
 * costs nothing a note is made of: a note is which fingers are lifted, and the spreads
 * and pinches are the nuisance the flexion features are invariant to.
 *
 * ## The anchors are the player's
 *
 * What a "down" finger's curl (or joint angle) is, and an "up" one's, are two numbers per
 * feature family, thumbs apart (a thumb bends differently), read from whatever IS
 * enrolled whose label the chart knows, on the fingering the guide showed for it. Every
 * enrolled note says what several down and several up fingers look like, so one enrolled
 * note calibrates the chart for all the others. That is the sense in which training only
 * tunes to the player. The curl has defaults (below, a deliberate air-flute lift) and is
 * always in play; a joint angle joins the metric only once the enrolment has calibrated
 * it, because a guessed per-joint prior would add noise to what the curl already says.
 *
 * ## What the hand cannot see
 *
 * Two notes whose fingerings use the same fingers on different keys (the flute's C4, C#4
 * and Eb4: the little finger on the C, C# or Eb key; Bb with the thumb key and B) are one
 * shape to a camera. The prior keeps them as ONE class unless an alternate fingering
 * separates them (the flute's "one and one" Bb does), labelled by one of its notes and
 * carrying all of them in `notes`, which is what a guide should tell the player. Nor can
 * it see the octave: E4 and E5 are one shape. `preferredOctave` picks which note names
 * such a class. `expectedFingering` is the shape the prior listens for, and the guide
 * must draw that, not the chart's standard row.
 *
 * Pure: no React, no DAG, no catalog import beyond the feature-id convention passed in.
 */
import { z } from 'zod';
import { trainModel, weightedDistance, type FeatureVector, type TrainedModel } from '@/enroll';
import type { TargetVerdict } from '@/enroll';
import { FINGERING_CHARTS, chartById, chartNotes, fingeringKey, type FingerId, type Fingering, type FingeringChart } from '@/music/fingerings';
import { parseNoteName } from '@/music/notes';
import { MIN_SAMPLES_PER_ENTRY, jitterWeights, type Vocabulary, type VocabularyEntry } from './vocabulary';

/** The per-finger flexion features a chart can have an opinion on, by their id suffix in
 *  the hand catalog. The curl is the sum of the three joint angles. */
export const FLEXION_FEATURES = ['curl', 'mcpAngle', 'pipAngle', 'dipAngle'] as const;
export type FlexionFeature = (typeof FLEXION_FEATURES)[number];

/** A feature family's value when a finger is down and when it is up, thumbs apart. */
export interface AnchorPair {
  up: number;
  down: number;
  thumbUp: number;
  thumbDown: number;
}
/** Anchors per flexion feature. A family without an entry is not in the metric. */
export type Anchors = Partial<Record<FlexionFeature, AnchorPair>>;

/** For a deliberate air-flute lift, in the catalog's curl units (radians summed over the
 *  three joints; 0 is straight, a fist is near 3π): an up finger nearly straight, a down
 *  finger bent well past a resting curve. The thumb bends less. Only the curl has
 *  defaults; the joint angles are calibrated or absent. Overridden by the player's own
 *  enrolment through {@link calibrateAnchors}. */
export const DEFAULT_ANCHORS: Anchors = { curl: { up: 0.5, down: 2.4, thumbUp: 0.4, thumbDown: 1.2 } };

/** Where each finger's features live in the flute's vocabulary: both hands' chord-shape
 *  vectors, prefixed by the player's hand (`fingeringVector`), so `l.index` + `.curl`. */
export const FLUTE_FINGER_PREFIX: Record<FingerId, string> = {
  LT: 'l.thumb',
  L1: 'l.index',
  L2: 'l.middle',
  L3: 'l.ring',
  L4: 'l.pinky',
  R1: 'r.index',
  R2: 'r.middle',
  R3: 'r.ring',
  R4: 'r.pinky',
};

const isThumb = (finger: FingerId) => finger.endsWith('T');
const featureId = (prefix: Record<FingerId, string>, finger: FingerId, family: FlexionFeature) => `${prefix[finger]}.${family}`;

export interface FingeringPriorOptions {
  chart: FingeringChart;
  /** Only chart notes in this range (inclusive) take part. Default: the whole chart. */
  range?: [string | number, string | number];
  /** When one shape serves several octaves, the note in this octave names the class.
   *  Default 5 (a flute's most-played octave). */
  preferredOctave?: number;
  /** Pseudo-samples the chart is worth against the player's own. 0: the chart only names
   *  the classes nothing is enrolled for; an enrolled class is the enrolment alone. */
  strength?: number;
  /** The per-finger feature prefixes. Default: the flute vocabulary's. */
  prefix?: Record<FingerId, string>;
  /** The anchors when nothing enrolled can calibrate them. */
  anchors?: Anchors;
}

const PRIOR_DEFAULTS = { preferredOctave: 5, strength: 10 };

/**
 * The prior as a DIAL (the air flute's `prior` field): which chart, how many
 * pseudo-samples it is worth, and the note range it covers. Scalar leaves only, so every
 * field is a command path (`airFlute.prior.strength`). Off means the enrolment alone
 * plays, as before the prior existed.
 */
export const FingeringPriorSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  chart: z.enum(Object.keys(FINGERING_CHARTS) as [string, ...string[]]).default('flute'),
  /** Pseudo-samples the chart is worth against the player's own (the vocabulary keeps 40
   *  per entry, so 10 is one part in five). */
  strength: z.number().min(0).max(100).default(PRIOR_DEFAULTS.strength),
  /** The chart notes in play, inclusive. The flute's default stops below the third
   *  octave, whose fingerings charts disagree on. */
  low: z.string().default('C4'),
  high: z.string().default('C#6'),
});
export type FingeringPriorSettings = z.infer<typeof FingeringPriorSettingsSchema>;
export const DEFAULT_FINGERING_PRIOR: FingeringPriorSettings = FingeringPriorSettingsSchema.parse({});

/** The fuse options for a settings value, or null when the prior is off or its chart or
 *  range is not usable (an unknown chart id, a range with no notes). */
export function priorOptionsFrom(settings: Partial<FingeringPriorSettings> | undefined): FingeringPriorOptions | null {
  const s = { ...DEFAULT_FINGERING_PRIOR, ...settings };
  if (!s.enabled) return null;
  const chart = chartById(s.chart);
  if (!chart) return null;
  const lo = parseNoteName(s.low)?.midi;
  const hi = parseNoteName(s.high)?.midi;
  if (lo === undefined || hi === undefined || lo > hi || chartNotes(chart, [lo, hi]).length === 0) return null;
  return { chart, range: [lo, hi], strength: s.strength };
}

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
 * the pitch class without an alternate keeps the standard shape and each other one moves
 * to the first of its alternates whose shape is free, all its octaves together.
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
  for (const x of notes) place([x], x.down, 'standard');
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

/** The class a note (by name, any spelling) belongs to, or null. */
function classOf(classes: readonly PriorClass[], note: string): PriorClass | null {
  const midi = parseNoteName(note)?.midi;
  if (midi === undefined) return null;
  return classes.find((c) => c.notes.some((n) => parseNoteName(n)!.midi === midi)) ?? null;
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
  const cls = classOf(priorClasses(chart, options), row.note);
  if (!cls) return null;
  const keys = cls.fingering === 'standard' ? row.keys : (row.alternates.find((a) => a.name === cls.fingering)?.keys ?? []);
  return { down: cls.down, keys, fingering: cls.fingering, notes: cls.notes };
}

/** The chart's expectation for a shape on every feature family the anchors cover. */
export function priorCentroid(down: readonly FingerId[], anchors: Anchors, prefix: Record<FingerId, string>): FeatureVector {
  const isDown = new Set(down);
  const out: FeatureVector = {};
  for (const family of FLEXION_FEATURES) {
    const a = anchors[family];
    if (!a) continue;
    for (const finger of Object.keys(prefix) as FingerId[]) {
      const d = isDown.has(finger);
      out[featureId(prefix, finger, family)] = isThumb(finger) ? (d ? a.thumbDown : a.thumbUp) : d ? a.down : a.up;
    }
  }
  return out;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Evidence behind each anchor: how many samples set it (0: the default, or absent). */
export type AnchorEvidence = Partial<Record<FlexionFeature, Record<keyof AnchorPair, number>>>;

/**
 * The player's own anchors, from every enrolled entry whose label the chart knows, on the
 * fingering the prior expects for it (the shape the guide showed): per feature family,
 * the mean value of the fingers that shape has down and of those it has up, thumbs
 * apart. A family joins the anchors once BOTH its finger states have evidence (and both
 * thumb states, or the family's thumb features are left out); the curl keeps its default
 * for any state without evidence.
 */
export function calibrateAnchors(
  vocab: Vocabulary,
  chart: FingeringChart,
  options: Pick<FingeringPriorOptions, 'prefix' | 'anchors' | 'range' | 'preferredOctave'> = {},
): { anchors: Anchors; evidence: AnchorEvidence } {
  const prefix = options.prefix ?? FLUTE_FINGER_PREFIX;
  const base = options.anchors ?? DEFAULT_ANCHORS;
  const classes = priorClasses(chart, options);
  const pool = (): Record<keyof AnchorPair, number[]> => ({ up: [], down: [], thumbUp: [], thumbDown: [] });
  const pools: Record<FlexionFeature, Record<keyof AnchorPair, number[]>> = { curl: pool(), mcpAngle: pool(), pipAngle: pool(), dipAngle: pool() };
  for (const entry of vocab.entries) {
    const cls = classOf(classes, entry.label);
    if (!cls) continue;
    const isDown = new Set(cls.down);
    for (const finger of Object.keys(prefix) as FingerId[]) {
      const key: keyof AnchorPair = isThumb(finger) ? (isDown.has(finger) ? 'thumbDown' : 'thumbUp') : isDown.has(finger) ? 'down' : 'up';
      for (const family of FLEXION_FEATURES) {
        const id = featureId(prefix, finger, family);
        for (const s of entry.samples) {
          const x = s[id];
          if (finite(x)) pools[family][key].push(x);
        }
      }
    }
  }
  const anchors: Anchors = {};
  const evidence: AnchorEvidence = {};
  for (const family of FLEXION_FEATURES) {
    const p = pools[family];
    const counts = { up: p.up.length, down: p.down.length, thumbUp: p.thumbUp.length, thumbDown: p.thumbDown.length };
    evidence[family] = counts;
    const enough = (k: keyof AnchorPair) => counts[k] >= MIN_SAMPLES_PER_ENTRY;
    const fallback = base[family];
    const pick = (k: keyof AnchorPair): number | undefined => (enough(k) ? mean(p[k]) : fallback?.[k]);
    const up = pick('up');
    const down = pick('down');
    if (up === undefined || down === undefined) continue;
    const thumbUp = pick('thumbUp');
    const thumbDown = pick('thumbDown');
    // Without both thumb states the family's thumb features are silenced by NaN anchors
    // (the distance skips them) rather than guessed.
    anchors[family] = { up, down, thumbUp: thumbUp ?? NaN, thumbDown: thumbDown ?? NaN };
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
 * enrolled label, the two joined where the label is one of the shape's notes (by pitch,
 * so a "Bb5" entry is the class spelled A#5). Null when there is nothing at all (an
 * empty chart range and no enrolment). Every class is scored on the same features (see
 * the module note): the flexion features the anchors cover.
 *
 * Distances are in the player's own hold jitter where the enrolment gives one
 * (`jitterWeights`), and in units of the anchors' gap on the rest until it does: a
 * quarter of the up-to-down gap is one unit, so a finger halfway between the two states
 * is two units from either.
 */
export function fuseWithPrior(vocab: Vocabulary, options: FingeringPriorOptions): FusedModel | null {
  const o = { ...PRIOR_DEFAULTS, ...options };
  const prefix = o.prefix ?? FLUTE_FINGER_PREFIX;
  const { anchors } = calibrateAnchors(vocab, o.chart, { prefix, anchors: o.anchors, range: o.range, preferredOctave: o.preferredOctave });
  const classes = priorClasses(o.chart, o);
  const usable = vocab.entries.filter((e) => e.samples.length >= MIN_SAMPLES_PER_ENTRY);
  if (classes.length === 0 && usable.length === 0) return null;

  // The metric: every finger feature of every family the anchors cover, thumb features
  // only where the thumb anchors are known.
  const features: string[] = [];
  const gapUnit: Record<string, number> = {};
  for (const family of FLEXION_FEATURES) {
    const a = anchors[family];
    if (!a) continue;
    for (const finger of Object.keys(prefix) as FingerId[]) {
      const thumb = isThumb(finger);
      if (thumb && !(finite(a.thumbUp) && finite(a.thumbDown))) continue;
      const id = featureId(prefix, finger, family);
      features.push(id);
      gapUnit[id] = Math.max(1e-3, Math.abs((thumb ? a.thumbDown - a.thumbUp : a.down - a.up) / 4));
    }
  }
  if (features.length === 0) return null;
  const weights = usable.length > 0 ? jitterWeights(usable, features) : {};
  for (const id of features) {
    const seen = usable.some((e) => e.samples.some((s) => finite(s[id])));
    if (!seen || !finite(weights[id])) weights[id] = 1 / gapUnit[id];
  }

  // Join: an enrolled entry whose label is one of a class's notes IS that class.
  const enrolledOf = new Map<PriorClass, VocabularyEntry[]>();
  const loose: VocabularyEntry[] = [];
  for (const e of usable) {
    const c = classOf(classes, e.label);
    if (c) enrolledOf.set(c, [...(enrolledOf.get(c) ?? []), e]);
    else loose.push(e);
  }

  const vectors: FeatureVector[] = [];
  const clusters: number[][] = [];
  const labels: string[] = [];
  const provenance: FusedModel['provenance'] = {};
  const addClass = (label: string, prior: FeatureVector | null, entries: readonly VocabularyEntry[], notes: string[]) => {
    const idx: number[] = [];
    // A chart-only class keeps at least one copy even at strength 0: the chart then only
    // names the class, and an enrolled class is its enrolment alone.
    const copies = prior ? (entries.length > 0 ? o.strength : Math.max(1, o.strength)) : 0;
    for (let i = 0; i < copies; i++) {
      idx.push(vectors.length);
      vectors.push(prior!);
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
    addClass(label, priorCentroid(c.down, anchors, prefix), entries, c.notes);
  }
  for (const e of loose) addClass(e.label, null, [e], []);

  // Closed-set, as the vocabulary is (the prior classes cover the space).
  const model = trainModel(vectors, clusters, features, weights, { defaultRejectRadius: Infinity }) as FusedModel;
  model.categories.forEach((c, i) => (c.label = labels[i]));
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

/** The model's class for a label: by exact text, else by pitch against the label of each
 *  class and, for a fused model, against every note its shape plays. */
function targetOf(model: TrainedModel, label: string) {
  const exact = model.categories.find((c) => c.label === label);
  if (exact) return exact;
  const midi = parseNoteName(label)?.midi;
  if (midi === undefined) return undefined;
  const provenance = (model as Partial<FusedModel>).provenance;
  return model.categories.find(
    (c) => parseNoteName(c.label)?.midi === midi || (provenance?.[c.id]?.notes ?? []).some((n) => parseNoteName(n)?.midi === midi),
  );
}

/**
 * Did a take look like its label? For every sample, the weighted distance to the target's
 * class and to the nearest OTHER class, their difference over the two centroids' own
 * distance; a mismatch when that fraction is at least `margin` on the median sample (a
 * hold is judged as a whole, not on its worst frame). `unknown` when the model has no
 * class for the label or the take is empty. A `TargetCheck` for the sequence runner is
 * `(label, samples) => checkTake(model, label, samples)`.
 */
export function checkTake(model: TrainedModel | null, label: string, samples: readonly FeatureVector[], options: CheckOptions = {}): TargetVerdict {
  const o = { ...CHECK_DEFAULTS, ...options };
  if (!model || samples.length === 0) return { kind: 'unknown' };
  const target = targetOf(model, label);
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
