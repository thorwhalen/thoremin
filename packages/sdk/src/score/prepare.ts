/**
 * A `ScoreDoc` made ready to play: the one derivation every player of a piece shares.
 *
 * Two players perform the conductor's piece: the `score` node (the theremin synth's
 * oscillators) and the `orchestra` node (a sampled orchestra, #187 PR 5). Each used to
 * derive the notes it plays on its own — the part filter, the velocities under the
 * written dynamics, the demo piece — so the two could disagree about the same document
 * (the orchestra once ignored the dynamics marks, #393). {@link preparePiece} is that
 * derivation, once, built on {@link flattenNotes}: the notes of the selected parts, per
 * part (an orchestra lays each part on a channel) and all together in onset order (an
 * oscillator player walks the sounding window), plus the longest note (the window's
 * look-back bound).
 *
 * {@link readScoreDoc} is the other half: the `score-doc` port carries whatever the host
 * hands it, so each consumer validates it against {@link ScoreDocSchema}. The result is
 * memoised per document object, so a document change is parsed once however many nodes
 * (conductor, score, orchestra) read the port, and every one of them sees the same
 * parsed document. Documents are immutable: a changed piece is a new object, which is
 * also what the nodes' own identity checks assume.
 */
import { flattenNotes, ScoreDocSchema, type ScoreDoc, type ScoreNote, type ScorePart } from './schema';

/**
 * Where a note's velocity comes from. `written`: scaled by the score's dynamics marks
 * through {@link flattenNotes} (how the `score` node voices a piece, so a written `p` is
 * a quieter part). `raw`: the source's own velocity, untouched.
 */
export const SCORE_DYNAMICS = ['raw', 'written'] as const;
export type ScoreDynamics = (typeof SCORE_DYNAMICS)[number];

export interface PreparePieceOptions {
  /** {@link ScoreDynamics}. Required, with no default: the two players default
   *  differently (the `score` node plays `written`, the orchestra `raw`), so a caller
   *  must say which, and none can change the other's velocities by omission. */
  dynamics: ScoreDynamics;
}

/** One selected part and its notes, velocities per the chosen dynamics, in the part's
 *  own order (onset order under `written`, the source's order under `raw`). */
export interface PreparedPart {
  part: ScorePart;
  notes: ScoreNote[];
}

/** A piece prepared for playback. */
export interface PreparedPiece {
  /** Every note, sorted by onset then pitch (ties keep part order). */
  notes: ScoreNote[];
  /** The selected parts in document order; empty for a piece made from bare notes. */
  parts: PreparedPart[];
  /** The longest duration, beats: the look-back bound of a sounding-window search. */
  maxDuration: number;
  /** Loop length in beats; 0 = play once (a loaded document never loops). */
  loopBeats: number;
}

/** Onset order, then pitch; `Array.prototype.sort` is stable, so ties keep their order. */
const byOnset = (a: ScoreNote, b: ScoreNote): number => a.start - b.start || a.midi - b.midi;

function longest(notes: readonly ScoreNote[]): number {
  let maxDuration = 0;
  for (const n of notes) maxDuration = Math.max(maxDuration, n.duration);
  return maxDuration;
}

/** A piece from bare notes (the built-in demo, a node's `notes` param), looped over
 *  `loopBeats` (0 = no loop). */
export function pieceFromNotes(notes: readonly ScoreNote[], loopBeats: number): PreparedPiece {
  const sorted = [...notes].sort(byOnset);
  return { notes: sorted, parts: [], maxDuration: longest(sorted), loopBeats };
}

/**
 * The selected parts of `doc` (all when `partIds` is empty), ready to play once through.
 * Under `written` dynamics the flattened `notes` are exactly `flattenNotes(doc, partIds)`:
 * each part is flattened on its own and the concatenation re-sorted stably, which keeps
 * the order a single flatten gives.
 */
export function preparePiece(doc: ScoreDoc, partIds: readonly string[], { dynamics }: PreparePieceOptions): PreparedPiece {
  // A selection naming no part of THIS document (a piece switched under a kept selection,
  // #471) plays every part rather than nothing: both players share this one rule.
  const known = partIds.filter((id) => doc.parts.some((p) => p.id === id));
  const want = known.length ? new Set(known) : null;
  const parts: PreparedPart[] = [];
  for (const part of doc.parts) {
    if (want && !want.has(part.id)) continue;
    parts.push({ part, notes: dynamics === 'written' ? flattenNotes(doc, [part.id]) : [...part.notes] });
  }
  const notes = parts.flatMap((p) => p.notes).sort(byOnset);
  return { notes, parts, maxDuration: longest(notes), loopBeats: 0 };
}

const parsedDocs = new WeakMap<object, ScoreDoc | null>();

/** The `score-doc` port's value as a valid {@link ScoreDoc}, or null when there is none or
 *  it does not parse. Memoised per document object (see the module note). */
export function readScoreDoc(raw: unknown): ScoreDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  let doc = parsedDocs.get(raw);
  if (doc === undefined) {
    const parsed = ScoreDocSchema.safeParse(raw);
    doc = parsed.success ? (parsed.data as ScoreDoc) : null;
    parsedDocs.set(raw, doc);
  }
  return doc;
}

/** The dial's part selection as ids: a comma-separated list (part ids are slugs, so no id
 *  holds a comma); empty = every part. One dial leaf stays a scalar string (#471). */
export function parsePartsSelection(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

/** The inverse of {@link parsePartsSelection}: the ids a player left on, as the dial's string. */
export function formatPartsSelection(ids: readonly string[]): string {
  return ids.join(',');
}

/** The part selection a node plays: the conductor dial's `parts` when the `config` input
 *  carries one (empty = every part), else the node's own build-time `fallback`. */
export function partsOfConfig(config: unknown, fallback: readonly string[]): readonly string[] {
  const raw = config && typeof config === 'object' ? (config as { parts?: unknown }).parts : undefined;
  return typeof raw === 'string' ? parsePartsSelection(raw) : fallback;
}
