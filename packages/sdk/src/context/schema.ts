/**
 * `MusicalContext`: what the music around the player is doing, as a timeline. The beats and the
 * bars, the meter and the tempo, the key regions with their scales, the chords, the melody and the
 * sections, each item with a confidence, plus where it came from (`source`) and what produced it
 * (`analyzers`, each with the licence of its weights).
 *
 * Times are SONG SECONDS: seconds into the piece as written or recorded, never engine time. A
 * score's song seconds are its notes at its marked tempi; a recording's are its own position. The
 * `beats` list is the timeline's ruler: beat `k` of the clock that plays it (the `beat` of the
 * `MusicalTime` a song player or a conductor publishes) sits at `beats[k].t`, so a reader maps a
 * clock's beat to song seconds through it (`./cursor`).
 *
 * Producers are a seam (`./producer`): a score read exactly (`./from_score`), the player's own
 * entries, and, later, an estimate from the audio, all produce this one shape. Versioned (`v`) for
 * the device cache (`./cache`), keyed by the content it was made from (`contentKey`).
 *
 * Pure: Zod and the chord model.
 */
import { z } from 'zod';
import { ChordSchema } from '../harmony/chord';
import { KEY_MODES } from '../score/schema';

/** Where a timeline came from: a score (exact), an estimate from a recording's audio, a score
 *  aligned to a recording, or the player's own entries. */
export const CONTEXT_SOURCES = ['score', 'audio-estimate', 'score-aligned', 'user'] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

const Confidence = z.number().min(0).max(1).default(1);
const Time = z.number().min(0);

/** What produced a layer: its name and version, and the licence of any model weights it ran
 *  (`none` for a rule with no weights). */
export const AnalyzerSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  weightsLicence: z.string().min(1),
});
export type Analyzer = z.infer<typeof AnalyzerSchema>;

export const BeatSchema = z.object({ t: Time, confidence: Confidence });
export type Beat = z.infer<typeof BeatSchema>;

export const MeterSchema = z.object({ t: Time, numerator: z.number().int().positive(), denominator: z.number().int().positive().default(4), confidence: Confidence });
export type Meter = z.infer<typeof MeterSchema>;

export const TempoSchema = z.object({ t: Time, bpm: z.number().positive(), confidence: Confidence });
export type Tempo = z.infer<typeof TempoSchema>;

/** A key region: a tonic, a mode and the scale's pitch classes (from the tonic), over a span. */
export const KeyRegionSchema = z.object({
  start: Time,
  end: Time,
  tonic: z.number().int().min(0).max(11),
  mode: z.enum(KEY_MODES),
  scalePcs: z.array(z.number().int().min(0).max(11)).min(1),
  confidence: Confidence,
});
export type KeyRegion = z.infer<typeof KeyRegionSchema>;

/** A chord over a span. `text` is the symbol as written, when a score wrote one. */
export const ChordSpanSchema = z.object({ start: Time, end: Time, chord: ChordSchema, text: z.string().optional(), confidence: Confidence });
export type ChordSpan = z.infer<typeof ChordSpanSchema>;

export const MelodyNoteSchema = z.object({ start: Time, end: Time, midi: z.number().int().min(0).max(127), confidence: Confidence });
export type MelodyNote = z.infer<typeof MelodyNoteSchema>;

export const SectionSchema = z.object({ start: Time, end: Time, label: z.string(), confidence: Confidence });
export type Section = z.infer<typeof SectionSchema>;

export const MUSICAL_CONTEXT_VERSION = 1;

export const MusicalContextSchema = z.object({
  v: z.literal(MUSICAL_CONTEXT_VERSION).default(MUSICAL_CONTEXT_VERSION),
  /** What it was made from (`./cache`'s `contentKey`), or '' when it was not made from content
   *  (the player's entries for a source with none). */
  contentKey: z.string().default(''),
  durationS: z.number().min(0),
  source: z.enum(CONTEXT_SOURCES),
  analyzers: z.array(AnalyzerSchema).default([]),
  /** The ruler: beat k at `beats[k].t`. */
  beats: z.array(BeatSchema).default([]),
  /** Song seconds of every bar line. */
  downbeats: z.array(Time).default([]),
  meter: z.array(MeterSchema).default([]),
  tempo: z.array(TempoSchema).default([]),
  keys: z.array(KeyRegionSchema).default([]),
  chords: z.array(ChordSpanSchema).default([]),
  melody: z.array(MelodyNoteSchema).default([]),
  sections: z.array(SectionSchema).default([]),
});
export type MusicalContext = z.infer<typeof MusicalContextSchema>;
/** What a producer writes: the defaults may be left out. */
export type MusicalContextInput = z.input<typeof MusicalContextSchema>;
