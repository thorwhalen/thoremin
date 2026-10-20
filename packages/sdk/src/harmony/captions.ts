/**
 * Computed move captions (#714; choice 2 of #614): a move's caption made from what can be
 * measured about it instead of a hand-typed table, as a third caption set beside the interval
 * captions (the default, the relations' own labels) and a player's own words. "smooth, darker"
 * for C to Em: two common tones, and major to minor.
 *
 * Each part of a caption is a fact with a source, and a part that comes from a model carries the
 * model's name (the #613 rule for tension applies to every number a display shows):
 *
 * - `tones`: the common tones (`distance.commonTones`): two or more is "smooth", one "one held",
 *   none "open". No model: a count.
 * - `quality`: the change of colour by the third (major to minor "darker", minor to major
 *   "brighter", into a diminished or an augmented chord "to diminished" / "to augmented", into a
 *   suspended one "suspended"). No model: the quality table.
 * - `expectedness`: how usual the progression is by a transition prior (`prior`, Piston's table
 *   by default): "expected" for his USUALLY, "surprising" for LESS OFTEN or a progression he does
 *   not name, nothing for SOMETIMES. Diatonic moves only.
 * - `direction`: whether tension falls ("resolving") or rises ("opening") by a tension model
 *   (the functional ladder by default). Off by default.
 * - `distance`: Lerdahl's chord distance δ between the two chords in the key's region (`tps`).
 *   Off by default (a number on the grid is for players who asked for it).
 *
 * The set is a function of (from, to, key), so `annotated(space, computedCaptions().caption)`
 * captions any space, and the chord map's degree pairs can be captioned without one. Pure.
 */
import { functionOf, parentKey, type Chord, type Key } from './chord';
import { commonTones } from './distance';
import { TRANSITION_PRIORS, type PriorId } from './prior';
import { QUALITIES, type QualityId } from './qualities';
import { TENSION_MODELS, tpsDistance, type TensionModelId } from './tension';
import { SCALE_TYPES } from '../music/theory';
import type { Edge, Relation } from './space';

export const CAPTION_PARTS = ['tones', 'quality', 'expectedness', 'direction', 'distance'] as const;
export type CaptionPart = (typeof CAPTION_PARTS)[number];

/** The parts a computed caption shows unless told otherwise, in the order it shows them. */
export const DEFAULT_CAPTION_PARTS: readonly CaptionPart[] = ['tones', 'quality', 'expectedness'];

// ---- The facts ------------------------------------------------------------------------------

/** A chord's colour, by its third and fifth. */
export type Colour = 'major' | 'minor' | 'diminished' | 'augmented' | 'suspended' | 'open5';

/** The colour a quality has: a diminished fifth is diminished, an augmented one augmented, else
 *  by the third (no third: suspended, or a bare fifth). */
export function colourOf(quality: QualityId): Colour {
  const iv: readonly number[] = QUALITIES[quality].intervals;
  if (iv.includes(3) && iv.includes(6)) return 'diminished';
  if (iv.includes(4) && iv.includes(8)) return 'augmented';
  if (iv.includes(4)) return 'major';
  if (iv.includes(3)) return 'minor';
  return iv.length > 2 ? 'suspended' : 'open5';
}

/** The ladder `darker` / `brighter` reads (diminished below minor below major). */
const BRIGHTNESS: Partial<Record<Colour, number>> = { diminished: 0, minor: 1, major: 2 };

export type QualityChange = 'darker' | 'brighter' | 'to diminished' | 'to augmented' | 'suspended' | null;

/** The change of colour from one chord to the next, or null where it keeps its colour. */
export function qualityChange(from: Chord, to: Chord): QualityChange {
  const a = colourOf(from.quality);
  const b = colourOf(to.quality);
  if (a === b) return null;
  if (b === 'diminished') return 'to diminished';
  if (b === 'augmented') return 'to augmented';
  if (b === 'suspended') return 'suspended';
  const ba = BRIGHTNESS[a];
  const bb = BRIGHTNESS[b];
  if (ba === undefined || bb === undefined) return null;
  return bb > ba ? 'brighter' : 'darker';
}

export type ToneMotion = 'smooth' | 'one held' | 'open';

/** How the move holds its tones: two or more common tones smooth, one held, none open. */
export function toneMotion(from: Chord, to: Chord): ToneMotion {
  const n = commonTones(from, to).length;
  return n >= 2 ? 'smooth' : n === 1 ? 'one held' : 'open';
}

export type Expectedness = 'expected' | 'plausible' | 'surprising';

/** The degree a chord stands on when it is the key's own chord there, else null. */
function ownDegree(c: Chord, key: Key): number | null {
  const fn = functionOf(c, key);
  return fn && fn.alter === undefined && fn.of === undefined ? fn.degree : null;
}

/** How usual a move is by a prior (Piston's usually / sometimes / less often or unnamed), or
 *  null when either chord is not the key's own (the prior is a table of diatonic degrees). */
export function expectedness(from: Chord, to: Chord, key: Key, prior: PriorId = 'piston'): Expectedness | null {
  const a = ownDegree(from, key);
  const b = ownDegree(to, key);
  if (a === null || b === null || a === b) return null;
  const w = TRANSITION_PRIORS[prior].weight(a, b);
  return w >= 3 ? 'expected' : w === 2 ? 'plausible' : 'surprising';
}

export type TensionDirection = 'resolving' | 'opening' | null;

/** Whether tension falls or rises by a model, or null where it stays or the model has no
 *  opinion on one of the chords. */
export function tensionDirection(from: Chord, to: Chord, key: Key, model: TensionModelId = 'function'): TensionDirection {
  const m = TENSION_MODELS[model];
  const a = m.tension(from, key);
  const b = m.tension(to, key);
  if (a === null || b === null || a === b) return null;
  return b < a ? 'resolving' : 'opening';
}

const pc = (n: number) => ((Math.round(n) % 12) + 12) % 12;
const isMinorKey = (key: Key): boolean => SCALE_TYPES[parentKey(key).scale].intervals[2] === 3;

/** Lerdahl's chord distance from one chord to the next, `from` heard in the key's own major
 *  region (a minor key's is its relative major's), as `tension`'s tps model places chords. */
export function lerdahlDistance(from: Chord, to: Chord, key: Key): number | null {
  const parent = parentKey(key);
  const region = isMinorKey(key) ? pc(parent.tonic + 3) : parent.tonic;
  const d = tpsDistance(from, region, to);
  return Number.isFinite(d) ? d : null;
}

/** Every fact a computed caption can show about one move. */
export interface MoveFacts {
  tones: ToneMotion;
  quality: QualityChange;
  expectedness: Expectedness | null;
  direction: TensionDirection;
  distance: number | null;
}

export interface CaptionOptions {
  /** The parts shown, in order. */
  parts?: readonly CaptionPart[];
  /** The prior `expectedness` reads. */
  prior?: PriorId;
  /** The tension model `direction` reads. */
  tension?: TensionModelId;
}

/** The facts of a move; only the `parts` asked for are measured (the others are null, and
 *  `tones` is always measured). */
export function moveFacts(from: Chord, to: Chord, key: Key, { parts = CAPTION_PARTS, prior = 'piston', tension = 'function' }: CaptionOptions = {}): MoveFacts {
  return {
    tones: toneMotion(from, to),
    quality: qualityChange(from, to),
    expectedness: parts.includes('expectedness') ? expectedness(from, to, key, prior) : null,
    direction: parts.includes('direction') ? tensionDirection(from, to, key, tension) : null,
    distance: parts.includes('distance') ? lerdahlDistance(from, to, key) : null,
  };
}

// ---- The words ------------------------------------------------------------------------------

/** One part's words, or '' where it has nothing to say (a `plausible` move says nothing). */
function partText(part: CaptionPart, f: MoveFacts): string {
  switch (part) {
    case 'tones':
      return f.tones;
    case 'quality':
      return f.quality ?? '';
    case 'expectedness':
      return f.expectedness === 'plausible' ? '' : (f.expectedness ?? '');
    case 'direction':
      return f.direction ?? '';
    case 'distance':
      return f.distance === null ? '' : `δ ${f.distance}`;
  }
}

/** The caption of a move from its facts: the non-empty parts, comma-separated. */
export function captionText(facts: MoveFacts, parts: readonly CaptionPart[] = DEFAULT_CAPTION_PARTS): string {
  return parts
    .map((p) => partText(p, facts))
    .filter((s) => s !== '')
    .join(', ');
}

/** A caption set: a function from a move to its words, and the models its words come from. */
export interface CaptionSet {
  id: string;
  name: string;
  /** The names of the models behind the words (shown beside the captions, the #613 rule). */
  models: readonly string[];
  /** A move's caption, or undefined to fall back to the relation's label. */
  caption(edge: Pick<Edge, 'from' | 'to'>, relation: Relation | undefined, key: Key): string | undefined;
}

/** The computed caption set over some parts (`DEFAULT_CAPTION_PARTS` by default). A move to the
 *  same chord has no caption. */
export function computedCaptions(options: CaptionOptions = {}): CaptionSet {
  const parts = options.parts ?? DEFAULT_CAPTION_PARTS;
  const prior = options.prior ?? 'piston';
  const tension = options.tension ?? 'function';
  const models: string[] = [];
  if (parts.includes('expectedness')) models.push(TRANSITION_PRIORS[prior].name);
  if (parts.includes('direction')) models.push(TENSION_MODELS[tension].name);
  if (parts.includes('distance')) models.push(TENSION_MODELS.tps.name.replace(/ \(.*\)$/, ''));
  return {
    id: 'computed',
    name: 'Computed (what the move does)',
    models,
    caption(edge, _relation, key) {
      const { from, to } = edge;
      if (from.root === to.root && from.quality === to.quality) return undefined;
      const text = captionText(moveFacts(from, to, key, { parts, prior, tension }), parts);
      return text || undefined;
    },
  };
}

/** The interval captions (the default): no words of their own, so every move shows its
 *  relation's label ("3rd up"). */
export const INTERVAL_CAPTIONS: CaptionSet = {
  id: 'interval',
  name: 'Intervals (the move in scale steps)',
  models: [],
  caption: () => undefined,
};

export const CAPTION_SET_IDS = ['interval', 'computed'] as const;
export type CaptionSetId = (typeof CAPTION_SET_IDS)[number];

/** The caption set an id names, the computed one over `options`. */
export function captionSet(id: CaptionSetId, options: CaptionOptions = {}): CaptionSet {
  return id === 'computed' ? computedCaptions(options) : INTERVAL_CAPTIONS;
}
