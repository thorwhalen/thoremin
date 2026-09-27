/**
 * The launcher's view state over the tools collection: the items the current search
 * matches, from `@zodal/ui`'s generated zustand slice over the collection and its
 * provider. The launcher sets the search text and asks for a fetch; what matches is the
 * provider's answer, over the fields the collection declares searchable.
 */
import { create } from 'zustand';
import { createZustandStoreSlice, type ZustandCollectionState } from '@zodal/ui';
import { toolsCollection, createToolsProvider } from './toolsCollection';
import type { Tool } from './tools';

export const useToolsCatalog = create<ZustandCollectionState<Tool>>()(
  createZustandStoreSlice<Tool>(toolsCollection, createToolsProvider()),
);

/** Search the tools for `query` (empty = all of them), unpaginated. */
export async function searchTools(query: string): Promise<void> {
  const s = useToolsCatalog.getState();
  s.setGlobalFilter(query);
  // The collection declares no pagination: a launcher that silently dropped the 26th
  // tool would be the #136 failure again.
  await useToolsCatalog.getState().fetchData?.({ pagination: undefined });
}
