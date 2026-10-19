/**
 * The conductor's view of the loaded piece (split from `conductor.ts`, #557): the score
 * document's fermatas, meter, marked tempo, bar lines, first tempo, last onset and length,
 * re-read when the document object changes. Pure derivations of a {@link ScoreDoc}; the
 * node keeps one per instance.
 */
import { barStartAt, beatsPerBarAt, firstTempo, timeSignatureAt, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { readScoreDoc } from '@thoremin/sdk/score/prepare';

/** The score's first marked tempo: a score query, in the SDK beside the others (#600 S7). */
export { firstTempo };

/** The score's marked tempo (bpm) at a beat: the last mark at or before it, else the
 *  first. Null when it marks none. */
function tempoAt(doc: ScoreDoc, beat: number): number | null {
  let at: { beat: number; bpm: number } | null = null;
  let first: { beat: number; bpm: number } | null = null;
  for (const m of doc.tempoMap) {
    if (!first || m.beat < first.beat) first = m;
    if (m.beat <= beat && (!at || m.beat >= at.beat)) at = m;
  }
  return (at ?? first)?.bpm ?? null;
}

/** What the node reads of the loaded piece. Every field is empty (null, no fermatas) until a
 *  document arrives, and again when it goes. */
export interface DocContext {
  /** The fermatas, sorted beats. */
  readonly fermatas: readonly number[];
  /** Beats per bar in force at a beat. */
  readonly meter: ((beat: number) => number) | null;
  /** The marked tempo (bpm) at a beat. */
  readonly tempo: ((beat: number) => number | null) | null;
  /** Where the time signature in force at a beat starts (the reference a bar or half-bar
   *  mark is counted from). */
  readonly sigStart: ((beat: number) => number) | null;
  /** Where the bar line in force at a beat sits (the signature's start, or the pickup's
   *  virtual bar start, #438): what `beatInBar` and the bar-level strokes count from. */
  readonly barStart: ((beat: number) => number) | null;
  /** The first tempo mark (bpm), seeding the body detector's period. */
  readonly bpm: number | null;
  /** The last note onset (null without a piece): a cut-off at or past it ends the piece, and
   *  the next start is from the top. */
  readonly lastOnset: number | null;
  /** The length in beats (the last note-off): where a dancer's piece loops (#463). */
  readonly length: number | null;
  /** Read `raw` (the `doc` input) when it is not the object read last. True when it changed:
   *  the caller lets go of what it held against the old piece (a fermata hold). */
  resolve(raw: unknown): boolean;
}

export function createDocContext(): DocContext {
  let ref: unknown = null;
  let fermatas: number[] = [];
  let meter: DocContext['meter'] = null;
  let tempo: DocContext['tempo'] = null;
  let sigStart: DocContext['sigStart'] = null;
  let barStart: DocContext['barStart'] = null;
  let bpm: number | null = null;
  let lastOnset: number | null = null;
  let length: number | null = null;
  return {
    get fermatas() { return fermatas; },
    get meter() { return meter; },
    get tempo() { return tempo; },
    get sigStart() { return sigStart; },
    get barStart() { return barStart; },
    get bpm() { return bpm; },
    get lastOnset() { return lastOnset; },
    get length() { return length; },
    resolve(raw) {
      if (raw === ref) return false;
      ref = raw;
      fermatas = [];
      meter = null;
      tempo = null;
      sigStart = null;
      barStart = null;
      bpm = null;
      lastOnset = null;
      length = null;
      const doc = readScoreDoc(raw);
      if (!doc) return true;
      fermatas = [...doc.fermatas].sort((a, b) => a - b);
      meter = (beat) => beatsPerBarAt(doc, beat);
      tempo = (beat) => tempoAt(doc, beat);
      sigStart = (beat) => timeSignatureAt(doc, beat).beat;
      barStart = (beat) => barStartAt(doc, beat);
      bpm = firstTempo(doc);
      let last = -Infinity;
      for (const part of doc.parts) for (const n of part.notes) last = Math.max(last, n.start);
      lastOnset = Number.isFinite(last) ? last : null;
      length = doc.lengthBeats > 0 ? doc.lengthBeats : null;
      return true;
    },
  };
}
