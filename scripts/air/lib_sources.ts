/**
 * The curated source list for one air instrument: the ONLY footage-related thing this
 * public repository commits. A source is a YouTube URL plus why it was chosen, its
 * licence as yt-dlp reports it, the chord vocabulary the audio labeller is allowed to
 * use on it, and how to pick the fretting hand out of the landmark stream. The list is a
 * Zod schema (the zodal rule: affordances first) so a typo in a chord name or a video
 * id fails in the test suite rather than as a silently empty dataset.
 *
 * Two invariants the schema enforces because the repo is public: a source may carry
 * no local path, and the licence note is mandatory (standard YouTube licence footage
 * is kept locally for private derivation only and never redistributed).
 */
import { z } from 'zod';
import { AIR_INSTRUMENTS } from './lib_air_paths';

/** The open-chord vocabulary the guitar model learns first; barre shapes come later. */
export const GUITAR_CHORD_SHAPES = ['C', 'G', 'D', 'E', 'A', 'Em', 'Am', 'Dm', 'F', 'B7', 'Cadd9', 'G7', 'D7', 'E7', 'A7'] as const;
export type GuitarChordShape = (typeof GUITAR_CHORD_SHAPES)[number];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * How to pick the fretting hand in a frame with up to two hands. `handedness` uses
 * the MediaPipe label as emitted on this (unmirrored) video; `x` picks by horizontal
 * position, which is robust when the label flickers (#144) and the camera framing is
 * known: a right-handed player facing the camera frets on the viewer's right (`max`).
 */
export const FrettingHandPick = z.discriminatedUnion('by', [
  z.object({ by: z.literal('handedness'), label: z.enum(['Left', 'Right']) }),
  z.object({ by: z.literal('x'), side: z.enum(['min', 'max']) }),
]);
export type FrettingHandPick = z.infer<typeof FrettingHandPick>;

export const AirSource = z
  .object({
    /** The YouTube video id (11 chars); the URL is derived from it. */
    id: z.string().regex(YOUTUBE_ID, 'a YouTube id is 11 URL-safe characters'),
    title: z.string().min(1),
    channel: z.string().min(1),
    /** Why this clip is in the set: the view, what is played, what it adds. */
    why: z.string().min(1),
    /** Licence as yt-dlp's `license` field reports it (null = standard YouTube licence). */
    license: z.string().nullable(),
    /** Chords the audio labeller may emit on this video (a per-video prior). */
    chords: z.array(z.enum(GUITAR_CHORD_SHAPES)).min(1),
    frettingHand: FrettingHandPick,
    /** Windows (seconds) worth keeping; absent = the whole video. */
    windows: z.array(z.tuple([z.number().nonnegative(), z.number().positive()])).optional(),
    /** Player faces the camera with a mirrored (selfie) image: flips the x heuristic. */
    notes: z.string().optional(),
    /** A held-out-by-design source (e.g. an air-guitar clip): never in a training fold. */
    holdout: z.boolean().optional(),
  })
  .strict()
  .refine((s) => !/\/(Users|home|root)\//.test(JSON.stringify(s)), { message: 'no local paths in a committed source' });
export type AirSource = z.infer<typeof AirSource>;

export const AirSources = z
  .object({
    instrument: z.enum(AIR_INSTRUMENTS),
    /** Where the raw videos go, relative to the app-data root; documentation only. */
    dataDir: z.string().regex(/^videos\/air\/[a-z]+$/),
    sources: z.array(AirSource).min(1),
  })
  .strict()
  .refine((d) => new Set(d.sources.map((s) => s.id)).size === d.sources.length, { message: 'duplicate source id' });
export type AirSources = z.infer<typeof AirSources>;

export const youtubeUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Parse and validate a sources document (a JSON string, as committed). */
export function parseSources(json: string): AirSources {
  return AirSources.parse(JSON.parse(json));
}
