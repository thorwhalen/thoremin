/**
 * The conductor slice's reach into the hot store (#600 S18b), through the SDK host: a React hook over
 * one reading of it (`useControlsField(() => scoreDoc())`), and the loaded score, a transient field
 * the slice declares (`scoreDoc`), read and written by name.
 */
import { useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';

/** A React hook over one reading of the store: re-renders when the reading changes. The reading
 *  must return a stable value (a field, a primitive). */
export function useControlsField<T>(read: () => T): T {
  return useSyncExternalStore((listener) => controls().subscribe(listener), read, read);
}

/** The loaded score the `score` node and the orchestra play (null: none). */
export const scoreDoc = (): ScoreDoc | null => (controls().get().scoreDoc as ScoreDoc | null | undefined) ?? null;

/** Hand the graph a loaded score (null clears it). */
export const setScoreDoc = (doc: ScoreDoc | null): void => controls().setTransient('scoreDoc', doc);
