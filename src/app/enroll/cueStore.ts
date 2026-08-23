/**
 * Cue and routine stores (#163) — the trainer's two zodal collections.
 *
 * Two instances of the {@link createNamedCollectionStore} facade (see
 * `@/settings/namedCollection` for the CRUD contract, the swappable `DataProvider`
 * target and the sync/async hot-path split). This file supplies only what makes a cue
 * a cue and a routine a routine: the schema, the storage key, the payload field, and
 * the id fallback — the same shape as saved lab views and named instruments.
 *
 * **Default target is localStorage**; pass any `DataProvider` (in-memory in tests,
 * files/cloud later) without touching a caller. Adding or removing a cue is a dev and
 * agent action for now (no user accounts), but the facade is the one that would later
 * serve users, so nothing has to be rebuilt.
 *
 * ## Starters plus stored, merged by id
 *
 * {@link listCues} returns the shipped {@link STARTER_CUES} with any stored cue of the
 * same id REPLACING the starter — so "customise a starter" is "save a cue under its
 * name", and a starter whose wording improves in code is not shadowed by a stale seed
 * row (there are no seed rows). Custom cues with new ids simply append.
 */
import type { DataProvider } from '@zodal/store';
import { FEATURE_GROUP_IDS } from '@/features/catalog';
import { createNamedCollectionStore, type NamedCollectionStore } from '@/settings/namedCollection';
import {
  CueRecordSchema,
  RoutineRecordSchema,
  cueFromRecord,
  resolveRoutine,
  type Cue,
  type CueRecord,
  type CueSpec,
  type RoutineRecord,
  type RoutineSpec,
} from '@/enroll';
import { DEFAULT_ROUTINE_CUE_IDS, STARTER_CUES } from './starterCues';

/** localStorage keys (the browser default target). */
export const CUES_STORAGE_KEY = 'thoremin-cues';
export const ROUTINES_STORAGE_KEY = 'thoremin-routines';

export type CueStore = NamedCollectionStore<CueRecord, CueSpec>;
export type RoutineStore = NamedCollectionStore<RoutineRecord, RoutineSpec>;

export const createCueStore = createNamedCollectionStore<CueRecord, 'cue'>({
  schema: CueRecordSchema,
  storageKey: CUES_STORAGE_KEY,
  payloadKey: 'cue',
  idFallback: 'cue',
});

export const createRoutineStore = createNamedCollectionStore<RoutineRecord, 'routine'>({
  schema: RoutineRecordSchema,
  storageKey: ROUTINES_STORAGE_KEY,
  payloadKey: 'routine',
  idFallback: 'routine',
});

/** Every stored cue, flattened to the runner's shape (invalid records are skipped). */
export async function loadStoredCues(store: CueStore): Promise<Cue[]> {
  const summaries = await store.list();
  const out: Cue[] = [];
  for (const s of summaries) {
    const rec = await store.load(s.id);
    if (rec) out.push(cueFromRecord(rec));
  }
  return out;
}

/** Starters, overridden by stored cues of the same id, then custom cues — in that order. */
export function mergeCues(starters: readonly Cue[], stored: readonly Cue[]): Cue[] {
  const byId = new Map(stored.map((c) => [c.id, c]));
  const out: Cue[] = starters.map((c) => byId.get(c.id) ?? c);
  const starterIds = new Set(starters.map((c) => c.id));
  for (const c of stored) if (!starterIds.has(c.id)) out.push(c);
  return out;
}

/**
 * The full cue list a picker shows: {@link mergeCues} over the store — minus any stored
 * cue whose groups the catalog cannot resolve at all. The schema is modality-neutral on
 * purpose and cannot know the catalog; this is the app-side place that does. Such a cue
 * would resolve to zero attention features, never count a frame, and end after its
 * patience with a misleading "I could not see you". Dropped cues are reported by id.
 */
export async function listCues(
  store: CueStore,
  knownGroups: readonly string[] = FEATURE_GROUP_IDS,
): Promise<{ cues: Cue[]; unusable: string[] }> {
  const known = new Set(knownGroups);
  const stored = await loadStoredCues(store);
  const usable = stored.filter((c) => c.collects.groups.some((g) => known.has(g)));
  const unusable = stored.filter((c) => !usable.includes(c)).map((c) => c.id);
  return { cues: mergeCues(STARTER_CUES, usable), unusable };
}

/** The routine to run: the named one if it exists, else the default, resolved. */
export async function loadRoutine(
  routineId: string | null,
  cues: readonly Cue[],
  routines: RoutineStore,
): Promise<{ cues: Cue[]; missing: string[]; name: string }> {
  if (routineId) {
    const rec = await routines.load(routineId);
    if (rec) return { ...resolveRoutine(rec.routine.cueIds, cues), name: rec.name };
  }
  return { ...resolveRoutine(DEFAULT_ROUTINE_CUE_IDS, cues), name: 'Default' };
}

/** Distinct tags across a cue list, for the picker's filter chips (stable order). */
export function cueTags(cues: readonly Cue[]): string[] {
  const out: string[] = [];
  for (const c of cues) for (const t of c.tags) if (!out.includes(t)) out.push(t);
  return out;
}

/** A picker filter: free text over name + instruction, and an all-of tag set. */
export function filterCues(cues: readonly Cue[], query: string, tags: readonly string[] = []): Cue[] {
  const q = query.trim().toLowerCase();
  return cues.filter(
    (c) =>
      (q === '' || c.name.toLowerCase().includes(q) || c.instruction.toLowerCase().includes(q)) &&
      tags.every((t) => c.tags.includes(t)),
  );
}

export type { DataProvider };
