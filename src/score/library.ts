/**
 * The score library (#187 PR 3): the demo pieces the app ships, and the collection a
 * player's own scores are saved to.
 *
 * Two kinds of content, one contract. The DEMO pieces are static files under
 * `public/scores/` (public domain / CC0 — see `public/scores/LICENSES.md`), fetched and
 * parsed on first use and never persisted: they are a download away, and a parsed
 * symphony movement is a few hundred kilobytes of JSON that has no business in
 * localStorage. A player's OWN scores (a file they picked) go into the `scores` zodal
 * collection — the named-collection facade every other saved thing in the app uses,
 * localStorage by default, any `DataProvider` by injection — so the picker lists them
 * next to the demos.
 *
 * Nothing here parses: `loadScore` (`./load.ts`) does, lazily. Nothing here touches
 * the DOM: the fetch is injected so tests pass bytes from disk.
 */
import { createNamedCollectionStore, type NamedCollectionStore, type NamedRecord } from '@/settings/namedCollection';
import { z } from 'zod';
import { ScoreDocSchema, type ScoreDoc } from './schema';

/** A demo piece: served from `public/scores/`, licence stated, parsed on first use. */
export interface DemoScore {
  id: string;
  title: string;
  /** Path relative to the app's base URL. */
  file: string;
  /** For the picker's tooltip and the licence line. */
  licence: string;
  /** What to say about it in one line. */
  blurb: string;
}

/** The shipped demos, in picker order. The first is the natural first conduct: the
 *  opening every player knows, with fermatas that exercise the hold. */
export const DEMO_SCORES: readonly DemoScore[] = [
  {
    id: 'beethoven-symphony-5-1',
    title: 'Beethoven — Symphony No. 5, I',
    file: 'scores/beethoven-symphony-5-1.mid',
    licence: 'Public domain (Mutopia Project edition)',
    blurb: 'The opening every player knows; two fermatas in the first five bars.',
  },
  {
    id: 'haydn-op76-3',
    title: 'Haydn — String Quartet Op. 76 No. 3 "Emperor"',
    file: 'scores/haydn-op76-3.mxl',
    licence: 'CC0 (OpenScore String Quartets)',
    blurb: 'Four string parts from MusicXML, with written dynamics.',
  },
];

export const demoById = (id: string): DemoScore | undefined => DEMO_SCORES.find((d) => d.id === id);

/** A saved score: the collection record. */
export const ScoreRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  doc: ScoreDocSchema,
});
export type ScoreRecord = z.infer<typeof ScoreRecordSchema> & NamedRecord;

/** localStorage key holding the player's scores (the browser default target). */
export const SCORES_STORAGE_KEY = 'thoremin-scores';

export type ScoreStore = NamedCollectionStore<ScoreRecord, ScoreDoc>;

/** Build a {@link ScoreStore}: localStorage by default; pass any `DataProvider` to
 *  retarget (in-memory in tests, files/cloud later). */
export const createScoreStore = createNamedCollectionStore<ScoreRecord, 'doc'>({
  schema: ScoreRecordSchema,
  storageKey: SCORES_STORAGE_KEY,
  payloadKey: 'doc',
  idFallback: 'score',
});
