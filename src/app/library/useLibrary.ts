/**
 * useLibrary — the React binding for the instrument-library metadata (issues #112-#115).
 * The pure model, persistence, emoji, derivation and system-tag logic live in the
 * framework-agnostic library modules (all unit-tested); this hook owns only the React
 * state and wires them to the panel:
 *  - loads the custom tags + the per-instrument metadata blob once on mount;
 *  - re-derives each instrument's summary + system tags whenever the instrument `list`
 *    it is given changes (a save/create/delete refreshes that list upstream);
 *  - exposes favorite (star) toggling, custom-tag association (comma input + chip
 *    removal), and the tag-manager mutations (rename / re-emoji / delete).
 *
 * Mutation reads go through a ref so the memoized callbacks stay stable while always
 * seeing the latest map (the pattern `useInstruments` uses for its optimistic selection);
 * read predicates the UI SORTS/RENDERS on (`starred`, `customTagsOf`) depend on the map
 * state so a change re-renders and re-orders the list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileMeta } from '@zodal/dials-ui';
import { parseTagLabels, type Tag, type InstrumentMetaMap } from './model';
import type { InstrumentSummary } from './summarize';
import type { SystemTag } from './systemTags';
import {
  listTags,
  resolveOrCreateTag,
  renameTag as renameTagRecord,
  setTagEmoji as setTagEmojiRecord,
  deleteTag as deleteTagRecord,
  readInstrumentMeta,
  writeInstrumentMeta,
  withStarred,
  withTagIds,
  instrumentsUsingTag,
} from './store';
import { deriveForNames, type InstrumentDerived } from './derive';
import { useToasts } from '@/app/toasts';

export interface LibraryApi {
  /** False until tags + metadata have loaded. */
  ready: boolean;
  /** All custom tags. */
  tags: Tag[];
  /** Whether an instrument is a favorite. */
  starred: (name: string) => boolean;
  /** Toggle an instrument's favorite flag (several may be starred). */
  toggleStar: (name: string) => void;
  /** The resolved custom tags applied to an instrument (existing tags only). */
  customTagsOf: (name: string) => Tag[];
  /** Add tags from a comma-separated input (existing tags reused, new ones created). */
  addTags: (name: string, csv: string) => Promise<void>;
  /** Remove one custom-tag association from an instrument. */
  removeTag: (name: string, tagId: string) => void;
  /** The derived, read-only system tags for an instrument. */
  systemTagsOf: (name: string) => SystemTag[];
  /** The derived compact summary for an instrument (undefined until derived). */
  summaryOf: (name: string) => InstrumentSummary | undefined;
  /** Rename a tag's label (id + associations preserved). */
  renameTag: (id: string, label: string) => Promise<void>;
  /** Change a tag's emoji. */
  setTagEmoji: (id: string, emoji: string) => Promise<void>;
  /** Delete a tag (also stripped from every instrument). */
  deleteTag: (id: string) => Promise<void>;
  /** How many instruments currently use a tag (for the delete-in-use guard). */
  usageCount: (id: string) => number;
}

export function useLibrary(list: ProfileMeta[]): LibraryApi {
  const [tags, setTags] = useState<Tag[]>([]);
  const [metaMap, setMetaMap] = useState<InstrumentMetaMap>({});
  const [derived, setDerived] = useState<Record<string, InstrumentDerived>>({});
  const [ready, setReady] = useState(false);

  const metaRef = useRef<InstrumentMetaMap>(metaMap);
  metaRef.current = metaMap;

  // Load tags + metadata once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedTags, loadedMeta] = await Promise.all([listTags(), readInstrumentMeta()]);
      if (cancelled) return;
      setTags(loadedTags);
      setMetaMap(loadedMeta);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-derive each instrument's summary + system tags whenever the instrument list
  // changes — including a save that keeps the same names but changes a layer, since the
  // upstream refresh hands us a fresh `list` reference on every save/create/delete.
  useEffect(() => {
    let cancelled = false;
    void deriveForNames(list.map((p) => p.name)).then((d) => {
      if (!cancelled) setDerived(d);
    });
    return () => {
      cancelled = true;
    };
  }, [list]);

  const tagByIdMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const persistMeta = useCallback((next: InstrumentMetaMap) => {
    metaRef.current = next;
    setMetaMap(next);
    void writeInstrumentMeta(next);
  }, []);

  const reloadTags = useCallback(async () => {
    setTags(await listTags());
  }, []);

  // Depends on the map state (not the ref) so a star toggle re-renders and re-sorts.
  const starred = useCallback((name: string) => metaMap[name]?.starred ?? false, [metaMap]);

  const toggleStar = useCallback(
    (name: string) => persistMeta(withStarred(metaRef.current, name, !(metaRef.current[name]?.starred ?? false))),
    [persistMeta],
  );

  const customTagsOf = useCallback(
    (name: string): Tag[] => {
      const ids = metaMap[name]?.tagIds ?? [];
      return ids.map((id) => tagByIdMap.get(id)).filter((t): t is Tag => Boolean(t));
    },
    [metaMap, tagByIdMap],
  );

  const addTags = useCallback(
    async (name: string, csv: string) => {
      const labels = parseTagLabels(csv);
      if (labels.length === 0) return;
      const resolved: Tag[] = [];
      for (const label of labels) resolved.push(await resolveOrCreateTag(label));
      await reloadTags();
      const current = metaRef.current[name]?.tagIds ?? [];
      persistMeta(withTagIds(metaRef.current, name, [...current, ...resolved.map((t) => t.id)]));
    },
    [persistMeta, reloadTags],
  );

  const removeTag = useCallback(
    (name: string, tagId: string) => {
      const current = metaRef.current[name]?.tagIds ?? [];
      persistMeta(withTagIds(metaRef.current, name, current.filter((id) => id !== tagId)));
    },
    [persistMeta],
  );

  const systemTagsOf = useCallback((name: string) => derived[name]?.systemTags ?? [], [derived]);
  const summaryOf = useCallback((name: string) => derived[name]?.summary, [derived]);

  const renameTag = useCallback(
    async (id: string, label: string) => {
      try {
        await renameTagRecord(id, label);
      } catch (e) {
        // A label collision (or empty label) is rejected by the store; surface it and
        // reload so the manager's input reverts to the tag's unchanged label.
        useToasts.getState().push(e instanceof Error ? e.message : 'Rename failed', 4000, 'error');
      }
      await reloadTags();
    },
    [reloadTags],
  );

  const setTagEmoji = useCallback(
    async (id: string, emoji: string) => {
      await setTagEmojiRecord(id, emoji);
      await reloadTags();
    },
    [reloadTags],
  );

  const deleteTag = useCallback(
    async (id: string) => {
      const nextMeta = await deleteTagRecord(id);
      metaRef.current = nextMeta;
      setMetaMap(nextMeta);
      await reloadTags();
    },
    [reloadTags],
  );

  const usageCount = useCallback((id: string) => instrumentsUsingTag(metaMap, id).length, [metaMap]);

  return {
    ready,
    tags,
    starred,
    toggleStar,
    customTagsOf,
    addTags,
    removeTag,
    systemTagsOf,
    summaryOf,
    renameTag,
    setTagEmoji,
    deleteTag,
    usageCount,
  };
}
