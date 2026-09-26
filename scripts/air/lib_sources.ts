/**
 * The curated source list for one air instrument: the ONLY footage-related thing this
 * public repository commits. A source is a YouTube URL plus why it was chosen, its
 * licence as yt-dlp reports it, who is playing (the held-out unit), and, per instrument,
 * what the audio labeller may emit and how to find the tracked hand. The list is a Zod
 * schema (the zodal rule: affordances first) so a typo in a chord name or a video id
 * fails in the test suite rather than as a silently empty dataset.
 *
 * Two invariants the schema enforces because the repo is public: a source may carry
 * no local path, and the licence note is mandatory (standard YouTube licence footage
 * is kept locally for private derivation only and never redistributed).
 *
 * The document is a discriminated union on `instrument`: guitar sources carry a chord
 * vocabulary and a fretting-hand pick; the other instruments carry only the common
 * fields until their label sources exist (flute: pitch; bass: pitch; drums: onsets), so
 * a `flute.json` parses today and its instrument-specific fields are added at this one
 * seam when its pipeline lands.
 */
import { z } from 'zod';

/** The open-chord vocabulary the guitar model learns first; barre shapes come later. */
export const GUITAR_CHORD_SHAPES = ['C', 'G', 'D', 'E', 'A', 'Em', 'Am', 'Dm', 'F', 'B7', 'Cadd9', 'G7', 'D7', 'E7', 'A7'] as const;
export type GuitarChordShape = (typeof GUITAR_CHORD_SHAPES)[number];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Anything that looks like a path on someone's machine. */
const LOCAL_PATH = /(\/(Users|home|root|tmp|private|Volumes)\/|(^|[\s"'(])~\/|[A-Za-z]:\\)/;

/**
 * How to pick the fretting hand in a frame with up to two hands.
 *
 * `x` picks by horizontal position and is the robust default: it survives the label
 * flicker of #144 and needs only the camera framing. A right-handed player facing the
 * camera frets with the physical left hand, which is on the viewer's RIGHT (`max`); a
 * left-handed player's fretting hand is on the viewer's left (`min`). A lone detected
 * hand is accepted only when it sits on that half of the frame, so a strumming hand
 * alone in frame is not mistaken for a fretting one.
 *
 * `handedness` uses MediaPipe's label AS EMITTED ON THIS VIDEO. MediaPipe assumes a
 * mirrored (selfie) image, so on unmirrored footage its "Left" is the physical RIGHT
 * hand (that is why `graph.ts` sets `mirrorHandedness: true` for the webcam; see
 * `resolveSide` in `src/features/catalog.ts`). For a right-handed player facing the
 * camera the fretting hand therefore arrives labelled "Right".
 */
export const FrettingHandPick = z.discriminatedUnion('by', [
  z.object({ by: z.literal('handedness'), label: z.enum(['Left', 'Right']) }),
  z.object({ by: z.literal('x'), side: z.enum(['min', 'max']) }),
]);
export type FrettingHandPick = z.infer<typeof FrettingHandPick>;

const SourceBase = z.object({
  /** The YouTube video id (11 chars); the URL is derived from it. */
  id: z.string().regex(YOUTUBE_ID, 'a YouTube id is 11 URL-safe characters'),
  title: z.string().min(1),
  channel: z.string().min(1),
  /**
   * Who is playing: the unit of the held-out evaluation. Two videos of one player are
   * one group, so "leave one group out" means what it says. Usually the channel.
   */
  player: z.string().min(1),
  /** Why this clip is in the set: the view, what is played, what it adds. */
  why: z.string().min(20),
  /** Licence as yt-dlp's `license` field reports it (null = standard YouTube licence). */
  license: z.string().nullable(),
  /** Windows (seconds) worth keeping; absent = the whole video. */
  windows: z.array(z.tuple([z.number().nonnegative(), z.number().positive()])).optional(),
  notes: z.string().optional(),
  /**
   * A domain-shift probe (e.g. an air-guitar clip): never in a training fold and never
   * labelled from its audio (a mimed performance's backing track is not what the hand
   * plays). Scored by what the model predicts on it, not by an accuracy.
   */
  holdout: z.boolean().optional(),
});

export const GuitarSource = SourceBase.extend({
  /** Chords the audio labeller may emit on this video (a per-video prior). */
  chords: z.array(z.enum(GUITAR_CHORD_SHAPES)).min(1),
  frettingHand: FrettingHandPick,
}).strict();
export type GuitarSource = z.infer<typeof GuitarSource>;

export const GenericSource = SourceBase.strict();
export type GenericSource = z.infer<typeof GenericSource>;

const noLocalPaths = (doc: unknown): boolean => !LOCAL_PATH.test(JSON.stringify(doc));
const uniqueIds = (d: { sources: { id: string }[] }): boolean => new Set(d.sources.map((s) => s.id)).size === d.sources.length;

const docOf = <I extends string, S extends z.ZodTypeAny>(instrument: I, source: S) =>
  z
    .object({
      instrument: z.literal(instrument),
      /** Where the raw videos go, relative to the app-data root; documentation only. */
      dataDir: z.literal(`videos/air/${instrument}`),
      sources: z.array(source).min(1),
    })
    .strict();

export const AirSources = z
  .discriminatedUnion('instrument', [
    docOf('guitar', GuitarSource),
    docOf('flute', GenericSource),
    docOf('bass', GenericSource),
    docOf('drums', GenericSource),
  ])
  .refine(uniqueIds, { message: 'duplicate source id' })
  .refine(noLocalPaths, { message: 'no local paths in a committed source list' });
export type AirSources = z.infer<typeof AirSources>;
export type GuitarSources = Extract<AirSources, { instrument: 'guitar' }>;

export const youtubeUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Parse and validate a sources document (a JSON string, as committed). */
export function parseSources(json: string): AirSources {
  return AirSources.parse(JSON.parse(json));
}

/** Parse a guitar source list, refusing any other instrument. */
export function parseGuitarSources(json: string): GuitarSources {
  const doc = parseSources(json);
  if (doc.instrument !== 'guitar') throw new Error(`expected a guitar source list, got ${doc.instrument}`);
  return doc;
}
