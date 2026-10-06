/**
 * Saved sequences (#263) — the third trainer collection, next to cues and routines.
 *
 * A sequence is an ordered list of targets a player is walked through
 * (`packages/sdk/src/enroll/sequence.ts` is the schema and the runner). Like cues, the shipped
 * STARTERS are merged with what is stored, by id, so a starter a player edits is saved
 * under its name and shadows the shipped one, and a starter whose list improves in code
 * is not shadowed by a stale seed row. Default target is localStorage through the same
 * {@link createNamedCollectionStore} facade; tests pass an in-memory provider.
 *
 * Starters are per instrument and live with the instrument (the air flute's scales and the
 * air guitar's chords are in `packages/ext-air/src/app/starterSequences.ts`). A caller asks for the starters of its instrument and adds the
 * stored ones, which are not tagged by instrument: a saved list of labels is only
 * meaningful to the instrument whose labels they are, and the trainer shows every stored
 * sequence, so a player can reuse a scale on any instrument that names notes.
 */
import type { DataProvider } from '@zodal/store';
import { SequenceRecordSchema, sequenceOf, type SequenceRecord, type SequenceSpec } from '@thoremin/sdk/enroll';
import { createNamedCollectionStore, type NamedCollectionStore } from '../namedCollection';
import { slugId } from '@thoremin/sdk/util/ids';

export const SEQUENCES_STORAGE_KEY = 'thoremin-sequences';

export const createSequenceStore = createNamedCollectionStore<SequenceRecord, 'sequence'>({
  schema: SequenceRecordSchema,
  storageKey: SEQUENCES_STORAGE_KEY,
  payloadKey: 'sequence',
  idFallback: 'sequence',
});
export type SequenceStore = NamedCollectionStore<SequenceRecord, SequenceSpec>;

/** A sequence with its identity, as the picker lists it. */
export interface NamedSequence {
  id: string;
  name: string;
  spec: SequenceSpec;
  /** Shipped in code (a starter) rather than saved by the player. */
  starter: boolean;
}

/** A sequence shipped in code: its id is its name's slug. An instrument's own starters are its
 *  extension's (the air flute's scales, the air guitar's chords). */
export const starterSequence = (name: string, labels: readonly string[], overrides: Parameters<typeof sequenceOf>[1] = {}): NamedSequence => ({
  id: slugId(name, 'sequence'),
  name,
  spec: sequenceOf(labels, overrides),
  starter: true,
});

let store: SequenceStore | null = null;
const getStore = (): SequenceStore => (store ??= createSequenceStore());

/** Swap the persistence target (tests: an in-memory provider); null restores the default. */
export function useSequenceStore(provider: DataProvider<SequenceRecord> | null): void {
  store = provider ? createSequenceStore(provider) : null;
}

/** Starters then stored, a stored sequence of a starter's id replacing the starter. */
export function mergeSequences(starters: readonly NamedSequence[], stored: readonly NamedSequence[]): NamedSequence[] {
  const byId = new Map(starters.map((s) => [s.id, s]));
  for (const s of stored) byId.set(s.id, s);
  return [...byId.values()];
}

/** Every sequence: the given starters plus everything stored (newest first among the stored). */
export async function listSequences(starters: readonly NamedSequence[]): Promise<NamedSequence[]> {
  const st = getStore();
  const summaries = await st.list();
  const stored: NamedSequence[] = [];
  for (const s of summaries) {
    const rec = await st.load(s.id);
    if (rec) stored.push({ id: rec.id, name: rec.name, spec: rec.sequence, starter: false });
  }
  return mergeSequences(starters, stored);
}

/** Save a sequence under a name (a starter's name overrides the starter). */
export async function saveSequence(name: string, spec: SequenceSpec): Promise<NamedSequence> {
  const rec = await getStore().save(name, spec);
  return { id: rec.id, name: rec.name, spec: rec.sequence, starter: false };
}

export function removeSequence(id: string): Promise<void> {
  return getStore().remove(id);
}

/**
 * Parse what a player typed into a target list: labels separated by spaces, commas or
 * newlines; `x3` after a label repeats it. Empty when nothing is left.
 */
export function parseTargets(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = /^(.+?)x(\d{1,2})$/i.exec(tok);
    if (m && Number(m[2]) > 0) for (let i = 0; i < Number(m[2]); i++) out.push(m[1]);
    else out.push(tok);
  }
  return out;
}
