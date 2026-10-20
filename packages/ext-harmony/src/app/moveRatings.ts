/**
 * The player's ratings of chord moves ("Rate this move", #715), kept and published.
 *
 * One record per move (its mode and degrees, the last ratings kept) in a named zodal collection
 * (the storage seam's target, localStorage by default). The table of mean ratings is published to
 * the hot store's transient `chordMapRatings`, which `store-controls` feeds to the chord map: its
 * `mine` caption set reads it. Published once at mount and again after every rating, so a word on
 * the map changes the moment the player rates the move.
 */
import { z } from 'zod';
import { createNamedCollectionStore, type DataProvider, type NamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { MoveRatingsSchema, moveRecordName, ratingsTable, withRating, type MoveRatings, type Rating, type RatingMode, type RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { HARMONY_STORES } from '../stores';
import { harmonyControls } from './controls';

export const MoveRatingsRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  move: MoveRatingsSchema,
});
export type MoveRatingsRecord = z.infer<typeof MoveRatingsRecordSchema>;

export const createMoveRatingsStore = createNamedCollectionStore<MoveRatingsRecord, 'move'>({
  schema: MoveRatingsRecordSchema,
  storageKey: HARMONY_STORES.moveRatings.legacyKey,
  payloadKey: 'move',
  idFallback: 'move',
});

export interface MoveRatingsDeps {
  provider?: DataProvider<MoveRatingsRecord>;
  /** Where the table goes (the hot store's transient by default). */
  publish?: (table: RatingsTable) => void;
}

/** The ratings kept, and what rating a move does to them. */
export interface MoveRatingsBook {
  /** Every move's ratings, read from the store. */
  all(): Promise<MoveRatings[]>;
  /** Add a rating to a move, store it, publish the new table; returns the table. */
  rate(mode: RatingMode, from: number, to: number, rating: Rating): Promise<RatingsTable>;
  /** Read the store and publish the table; returns it. */
  publish(): Promise<RatingsTable>;
}

export function createMoveRatingsBook({ provider, publish = (t) => harmonyControls.setTransient('chordMapRatings', t) }: MoveRatingsDeps = {}): MoveRatingsBook {
  const store: NamedCollectionStore<MoveRatingsRecord, MoveRatings> = createMoveRatingsStore(provider);
  const all = async (): Promise<MoveRatings[]> => {
    const out: MoveRatings[] = [];
    for (const s of await store.list()) {
      const r = await store.load(s.id);
      if (r) out.push(r.move);
    }
    return out;
  };
  const publishNow = async (): Promise<RatingsTable> => {
    const table = ratingsTable(await all());
    publish(table);
    return table;
  };
  return {
    all,
    publish: publishNow,
    async rate(mode, from, to, rating) {
      const name = moveRecordName(mode, from, to);
      const prev = (await all()).find((m) => m.mode === mode && m.from === from && m.to === to) ?? null;
      await store.save(name, withRating(prev, mode, from, to, rating));
      return publishNow();
    },
  };
}

let book: MoveRatingsBook | null = null;

/** The app's book (made on first use). */
export function moveRatingsBook(): MoveRatingsBook {
  return (book ??= createMoveRatingsBook());
}

/** The mount effect: publish what is stored, so a saved player's words are on the map at once. */
export function startMoveRatings(): () => void {
  void moveRatingsBook().publish();
  return () => {};
}
