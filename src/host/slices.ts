/**
 * Per-slice versioned migrations (#600 S9; `docs/design/vertical-slices.md` §5): each extension's
 * dial and pref slices carry their own schema version and migration chain, so an extension that
 * renames a field migrates its own stored value, with no edit to core's `CONTROLS_MIGRATIONS`.
 *
 * The persisted hot-store blob gains `sliceVersions` (`{ airDrum: 1, ... }`) beside zustand's
 * global `version`, which stays the core fields' chain. On rehydrate the host runs, for each
 * slice, its chain from the stored version (absent: 1) to the slice's own, BEFORE healing:
 *
 *  - a slice whose key is absent adopts its first present `legacyKeys` path (version 1);
 *  - a value an older blob lacks is not migrated (the heal fills it from the schema);
 *  - a slice the build no longer lists (its extension removed) is FOREIGN: its stored value and
 *    version are carried through every later write untouched, so removing an extension and
 *    adding it back loses nothing. A slice is recognised as foreign by its `sliceVersions` entry,
 *    which only blobs written since this step have.
 *
 * A stored version ABOVE the slice's (a rollback to an older build) is left unmigrated, healed
 * through the older schema and rewritten at the older version, as the core fields' global version
 * is; rolling forward then runs the step again on that value.
 *
 * Pure: a blob in, a new blob out (the caller's is never edited), like `migrateControls`. A step
 * that throws drops its slice's value (the heal then fills the default) instead of failing.
 */
import type { DialSlice, PrefSlice, SliceMigration } from '@thoremin/sdk/instruments/extension';

/** One slice's chain, as the host runs it. */
export interface SliceChain {
  key: string;
  version: number;
  migrations: Readonly<Record<number, SliceMigration>>;
  legacyKeys: readonly string[];
}

/** The chains of a list of dial and pref slices. */
export function sliceChains(slices: readonly (DialSlice | PrefSlice)[]): SliceChain[] {
  return slices.map((s) => ({
    key: s.key,
    version: s.version ?? 1,
    migrations: s.migrations ?? {},
    legacyKeys: 'legacyKeys' in s ? (s.legacyKeys ?? []) : [],
  }));
}

/** The field the per-slice versions are stored under in the persisted blob. */
export const SLICE_VERSIONS_KEY = 'sliceVersions';

const readPath = (blob: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), blob);

/** The stored per-slice versions of a blob (`{}` when it has none). */
export function storedSliceVersions(blob: unknown): Record<string, number> {
  const raw = blob && typeof blob === 'object' ? (blob as Record<string, unknown>)[SLICE_VERSIONS_KEY] : undefined;
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= 1)) as Record<string, number>;
}

/**
 * Run every slice's chain over a persisted blob. Returns the migrated blob (its `sliceVersions`
 * dropped: the next write records the current ones) and the FOREIGN slices it carried: keys with a
 * stored version that no chain claims, with that version.
 */
export function migrateSlices(persisted: unknown, chains: readonly SliceChain[]): { blob: Record<string, unknown>; foreign: Record<string, number> } {
  const src = persisted && typeof persisted === 'object' ? (persisted as Record<string, unknown>) : {};
  const stored = storedSliceVersions(src);
  const { [SLICE_VERSIONS_KEY]: _dropped, ...rest } = src;
  void _dropped;
  const blob: Record<string, unknown> = { ...rest };
  for (const c of chains) {
    let value = blob[c.key];
    let from = stored[c.key] ?? 1;
    if (value === undefined) {
      const legacy = c.legacyKeys.map((k) => readPath(src, k)).find((v) => v !== undefined);
      if (legacy === undefined) continue;
      value = structuredClone(legacy);
      from = 1;
    }
    // A copy, so a step that edits its argument cannot reach the caller's blob.
    if (from < c.version) value = structuredClone(value);
    try {
      for (let v = from; v < c.version; v++) {
        const step = c.migrations[v];
        if (step) value = step(value, src);
      }
    } catch (err) {
      // A step that throws (a corrupt stored value its author did not expect) costs THIS slice
      // only: its value is dropped and the heal fills its default. It must never fail the
      // rehydrate, which would leave the store at its defaults and the next write would put them
      // over every one of the player's settings.
      console.warn(`[thoremin] the stored "${c.key}" could not be migrated to version ${c.version}; it starts from its default`, err);
      delete blob[c.key];
      continue;
    }
    blob[c.key] = value;
  }
  const claimed = new Set(chains.map((c) => c.key));
  const foreign = Object.fromEntries(Object.entries(stored).filter(([k]) => !claimed.has(k) && k in src));
  return { blob, foreign };
}

/** The `sliceVersions` a write records: each listed slice's current version, then the foreign
 *  slices' stored ones, untouched. */
export function sliceVersionsToWrite(chains: readonly SliceChain[], foreign: Readonly<Record<string, number>>): Record<string, number> {
  return { ...foreign, ...Object.fromEntries(chains.map((c) => [c.key, c.version])) };
}

/**
 * A saved instrument's layer through the slices' chains (#600 S10): a layer records no slice
 * version, so a dial slice's chain runs from version 1 on a layer whose dial lacks a field its
 * current default has (it was saved before that field); steps are idempotent by contract, so a
 * dial saved at a later version but missing some other field is unharmed. `stored` for the steps is
 * the layer itself (a whole-object dial keeps the same key there as in the hot store). A step that
 * throws leaves that dial as saved. Returns the same layer when nothing ran, else a new one.
 */
export function migrateLayerSlices<L extends Record<string, unknown>>(layer: L, slices: readonly { key: string; version?: number; migrations?: Readonly<Record<number, SliceMigration>>; schema: { parse(v: unknown): unknown } }[]): L {
  let out = layer;
  for (const slice of slices) {
    const version = slice.version ?? 1;
    const value = layer[slice.key];
    if (version <= 1 || !slice.migrations || !value || typeof value !== 'object') continue;
    const current = slice.schema.parse(undefined);
    const missing = current && typeof current === 'object' && Object.keys(current).some((k) => !(k in (value as object)));
    if (!missing) continue;
    let next: unknown = structuredClone(value);
    try {
      for (let v = 1; v < version; v++) {
        const step = slice.migrations[v];
        if (step) next = step(next, layer);
      }
    } catch {
      continue;
    }
    if (out === layer) out = { ...layer };
    (out as Record<string, unknown>)[slice.key] = next;
  }
  return out;
}
/** The built-in features whose dials stay FLAT as slices (#600 Phase E), by slice key, with the
 *  extension that owns each: their keys (`midi.enabled`) were flat before they became slices, and a
 *  saved instrument and a bound command name them. A new extension's dial is one object
 *  (`airDrum`); the registry refuses `layout: 'flat'` for a key not listed here, or declared by
 *  another extension than its owner. Each Phase E slice adds its key when it moves. */
export const FLAT_SLICES: Readonly<Record<string, string>> = { midi: 'midi-output' };

type FieldSchema = { safeParse(v: unknown): { success: boolean; data?: unknown }; parse(v: unknown): unknown };

/** The object schema inside a slice's schema (its `.default(...)` unwrapped). */
function innerObject(slice: DialSlice): { shape: Record<string, FieldSchema>; parse(v: unknown): unknown } {
  let s = slice.schema as unknown as { def?: { innerType?: unknown }; shape?: Record<string, unknown> };
  while (!s.shape && s.def?.innerType) s = s.def.innerType as typeof s;
  if (!s.shape) throw new Error(`the flat dial slice "${slice.key}" is not an object schema`);
  return s as unknown as { shape: Record<string, FieldSchema>; parse(v: unknown): unknown };
}

/** A flat slice's fields, each its own dial (`layout: 'flat'`), with its schema. */
export function flatFields(slice: DialSlice): [field: string, schema: FieldSchema][] {
  return Object.entries(innerObject(slice).shape);
}

/** The dial key a flat slice's field is kept under: `key.field`, or the slice's override
 *  (`flatKeys`, for a built-in feature whose field had another key: `steerConfig`). */
export const flatDialKey = (slice: DialSlice, field: string): string => slice.flatKeys?.[field] ?? `${slice.key}.${field}`;

/** The flat dial keys of a slice (`midi.enabled`...), or `[]` for an object slice. */
export const flatDialKeys = (slice: DialSlice): string[] => (slice.layout === 'flat' ? flatFields(slice).map(([f]) => flatDialKey(slice, f)) : []);

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Check a flat slice (#600 S13): it is a built-in feature's, declared by its owner
 * ({@link FLAT_SLICES}); every field has a real default (each is a dial of its own; an optional
 * field has none) and the object's default is the fields' defaults (the hot store's first load
 * reads the one, the dials and a saved instrument the others); and it carries no migration chain
 * or legacy keys (a saved instrument keeps its fields as separate keys that a whole-object step
 * could not reach). Throws, naming the extension.
 */
export function checkFlatSlice(extension: string, slice: DialSlice): void {
  if (slice.layout !== 'flat') {
    if (slice.flatKeys) throw new Error(`extension "${extension}": the dial "${slice.key}" names flat keys but is not flat`);
    return;
  }
  const owner = FLAT_SLICES[slice.key];
  if (owner === undefined) {
    throw new Error(`extension "${extension}" declares the dial "${slice.key}" flat; only a built-in feature that already had flat keys may (${Object.keys(FLAT_SLICES).join(', ')}): a new extension's dial is one object`);
  }
  if (owner !== extension) throw new Error(`extension "${extension}" declares the flat dial "${slice.key}", which belongs to "${owner}"`);
  const fields = flatFields(slice);
  for (const [field, schema] of fields) {
    const parsed = schema.safeParse(undefined);
    if (!parsed.success || parsed.data === undefined) throw new Error(`extension "${extension}": the flat dial "${flatDialKey(slice, field)}" has no default`);
  }
  for (const field of Object.keys(slice.flatKeys ?? {})) {
    if (!fields.some(([f]) => f === field)) throw new Error(`extension "${extension}": the flat dial slice "${slice.key}" renames "${field}", which is not one of its fields`);
  }
  if (!sameJson(slice.schema.parse(undefined), innerObject(slice).parse({}))) {
    throw new Error(`extension "${extension}": the flat dial slice "${slice.key}"'s default is not its fields' defaults`);
  }
  if ((slice.version ?? 1) > 1 || slice.migrations || slice.legacyKeys?.length) {
    throw new Error(`extension "${extension}": the flat dial slice "${slice.key}" cannot carry migrations or legacy keys (its fields are separate dials in a saved instrument)`);
  }
}
