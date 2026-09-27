/**
 * The Instruments view's query state over the instruments collection: the items the
 * current search and sort select, from `@zodal/ui`'s generated zustand slice over the
 * collection and its specs provider (`instrumentsCollection.ts`). A view sets the search
 * text and the sort, hands over the library's current specs, and reads `items`.
 */
import { create } from 'zustand';
import { createZustandStoreSlice, type ZustandCollectionState } from '@zodal/ui';
import {
  createSpecsSource,
  instrumentsCollection,
  INSTRUMENT_SORTS,
  type InstrumentListItem,
  type InstrumentSort,
} from './instrumentsCollection';

const source = createSpecsSource();

export const useInstrumentsCatalog = create<ZustandCollectionState<InstrumentListItem>>()(
  createZustandStoreSlice<InstrumentListItem>(instrumentsCollection, source.provider),
);

/** Re-run the view's query: these specs, this search text, this sort. Unpaginated (the
 *  collection declares no pagination: a list that silently dropped an instrument would
 *  be the #136 failure again). */
export async function queryInstruments(
  specs: readonly InstrumentListItem[],
  query: string,
  sort: InstrumentSort,
): Promise<void> {
  source.set(specs);
  const s = useInstrumentsCatalog.getState();
  s.setGlobalFilter(query.trim());
  s.setSorting([...INSTRUMENT_SORTS[sort]]);
  await useInstrumentsCatalog.getState().fetchData?.({ pagination: undefined });
}
