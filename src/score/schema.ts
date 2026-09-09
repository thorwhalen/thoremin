/**
 * `ScoreDoc` — the one symbolic score model the app plays from (#187 PR 3).
 *
 * Affordances first (the zodal rule): this Zod schema is the SSOT of what a score IS
 * to thoremin, and every loader (MIDI, MusicXML, the built-in demo) produces exactly
 * this. It is deliberately small — the `score` node, the scheduler (PR 4) and the
 * orchestra (PR 5) need notes with onsets and durations **in beats**, per part, plus
 * the tempo map, the time signatures, dynamics marks and fermatas — and deliberately
 * parser-agnostic: the app never sees `@tonejs/midi`'s or `musicxml-io`'s own model,
 * so either parser is a swap behind `loadScore`, not a rewrite (research map §4.2).
 *
 * Units: a *beat* is a quarter note (MIDI's `ticks / ppq`; MusicXML's `divisions`
 * scaled to quarters), whatever the time signature — the conductor's beat and the
 * time-signature denominator are reconciled by the consumer, not here. Times are
 * absolute beats from the start of the piece, never seconds: the conductor supplies
 * the seconds.
 */
import { z } from 'zod';

export const ScoreNoteSchema = z.object({
  /** MIDI note number. */
  midi: z.number().int().min(0).max(127),
  /** Onset in beats (quarter notes) from the start of the piece. */
  start: z.number().min(0),
  /** Duration in beats. */
  duration: z.number().min(0),
  /** 0..1. */
  velocity: z.number().min(0).max(1).default(0.8),
});
export type ScoreNote = z.infer<typeof ScoreNoteSchema>;

export const ScorePartSchema = z.object({
  /** Stable id within the document (a slug of the name, made unique). */
  id: z.string().min(1),
  name: z.string(),
  /** General MIDI program, when the source says (0..127). The orchestra maps it to a
   *  section; absent → a default section. */
  program: z.number().int().min(0).max(127).optional(),
  /** True for a percussion part (MIDI channel 10, or a MusicXML unpitched part). */
  percussion: z.boolean().default(false),
  notes: z.array(ScoreNoteSchema),
});
export type ScorePart = z.infer<typeof ScorePartSchema>;

export const TempoMarkSchema = z.object({
  beat: z.number().min(0),
  bpm: z.number().positive(),
});
export type TempoMark = z.infer<typeof TempoMarkSchema>;

export const TimeSignatureSchema = z.object({
  beat: z.number().min(0),
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});
export type TimeSignature = z.infer<typeof TimeSignatureSchema>;

export const DynamicMarkSchema = z.object({
  beat: z.number().min(0),
  /** The part it applies to; absent = all parts. */
  part: z.string().optional(),
  /** 0..1 (pp → ff mapped onto the range; see `dynamicValue`). */
  value: z.number().min(0).max(1),
  /** The mark as written (`p`, `ff`, `crescendo`, …), for display. */
  text: z.string().optional(),
});
export type DynamicMark = z.infer<typeof DynamicMarkSchema>;

export const ScoreDocSchema = z.object({
  /** Schema version, for the persisted collection. */
  v: z.literal(1).default(1),
  title: z.string(),
  /** Where it came from (for display and for the licence line). */
  source: z.enum(['midi', 'musicxml', 'builtin']),
  parts: z.array(ScorePartSchema),
  /** Tempo marks in order; empty = the source stated none. The conductor overrides the
   *  tempo anyway, but the marks let the scheduler ratio a rubato prior. */
  tempoMap: z.array(TempoMarkSchema).default([]),
  /** Time signatures in order; empty = assume 4/4. */
  timeSignatures: z.array(TimeSignatureSchema).default([]),
  dynamics: z.array(DynamicMarkSchema).default([]),
  /** Beats at which a fermata is written (the scheduler's HOLD points, PR 4). */
  fermatas: z.array(z.number().min(0)).default([]),
  /** Total length in beats (the last note-off). */
  lengthBeats: z.number().min(0),
});
export type ScoreDoc = z.infer<typeof ScoreDocSchema>;

/** The dynamic marks MusicXML and MIDI-import conventions use, mapped onto 0..1. The
 *  velocity scale of `pp` is not zero (a pianissimo is still audible); `ff` is 1. */
export const DYNAMIC_VALUES: Record<string, number> = {
  pppp: 0.1,
  ppp: 0.18,
  pp: 0.28,
  p: 0.4,
  mp: 0.52,
  mf: 0.64,
  f: 0.76,
  ff: 0.88,
  fff: 0.96,
  ffff: 1,
  sfz: 0.9,
  sf: 0.85,
  fp: 0.7,
};

/** 0..1 for a written dynamic, or null when the text is not a level (`crescendo`). */
export function dynamicValue(text: string): number | null {
  const v = DYNAMIC_VALUES[text.trim().toLowerCase()];
  return typeof v === 'number' ? v : null;
}

/** The length of a document from its notes (the last note-off), in beats. */
export function notesLength(parts: readonly { notes: readonly ScoreNote[] }[]): number {
  let end = 0;
  for (const p of parts) for (const n of p.notes) end = Math.max(end, n.start + n.duration);
  return end;
}

/** The time signature in force at `beat` (4/4 when the document states none). */
export function timeSignatureAt(doc: ScoreDoc, beat: number): TimeSignature {
  let current: TimeSignature = { beat: 0, numerator: 4, denominator: 4 };
  for (const ts of doc.timeSignatures) {
    if (ts.beat <= beat) current = ts;
    else break;
  }
  return current;
}

/** Beats (quarter notes) per bar at `beat` — what the conductor's `beatsPerBar` should
 *  be, in the beat unit the score is counted in. 6/8 is three quarter-beats per bar in
 *  this unit; the consumer that wants the felt two-in-a-bar of a 6/8 decides that. */
export function beatsPerBarAt(doc: ScoreDoc, beat: number): number {
  const ts = timeSignatureAt(doc, beat);
  return (ts.numerator * 4) / ts.denominator;
}

/**
 * The notes of the selected parts (all when `partIds` is empty), flattened in onset
 * order, in the shape the `score` node's `notes` param takes. Per-part dynamics marks
 * are applied to note velocities so a written `p` is a quieter part.
 */
export function flattenNotes(doc: ScoreDoc, partIds: readonly string[] = []): ScoreNote[] {
  const want = partIds.length ? new Set(partIds) : null;
  const out: ScoreNote[] = [];
  for (const part of doc.parts) {
    if (want && !want.has(part.id)) continue;
    const marks = doc.dynamics.filter((d) => !d.part || d.part === part.id).sort((a, b) => a.beat - b.beat);
    for (const n of part.notes) {
      let scale = 1;
      if (marks.length) {
        let level: number | null = null;
        for (const m of marks) {
          if (m.beat <= n.start) level = m.value;
          else break;
        }
        // A written level replaces the source velocity's scale, gently: geometric mean
        // so a MIDI file with real velocities keeps its accents under a `p`.
        if (level !== null) scale = Math.sqrt(level / 0.76);
      }
      out.push({ ...n, velocity: Math.max(0, Math.min(1, n.velocity * scale)) });
    }
  }
  out.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return out;
}

/** A unique, stable part id from a name and its index (`violin-1`, `violin-1-2` on a clash). */
export function partId(name: string, index: number, taken: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `part-${index + 1}`;
  let id = base;
  let k = 2;
  while (taken.has(id)) id = `${base}-${k++}`;
  taken.add(id);
  return id;
}
