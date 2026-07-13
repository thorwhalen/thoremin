/**
 * Path-addressed leaves of the STRUCTURED dials (#126) — the derivation that makes a
 * whole-object dial (`overlay`, `handMap`, `faceExpr.degrees`, `faceExpr.sensitivity`)
 * writable through the command registry WITHOUT ever putting an object into a command's
 * params.
 *
 * Why this exists. The per-dial command generator (`perDial.ts`) skips structured dials —
 * they aren't a single settable scalar — and the generic verbs carry a scalar-only
 * `DIAL_VALUE` union, deliberately: an object-shaped param emits a JSON Schema that
 * Gemini's function-calling validator rejects. So before this module there was NO
 * dispatchable write path for the overlay / hand-map / expression-map dials, and every
 * panel control that edits them had to bypass the registry. Addressing a single scalar
 * LEAF by a dotted path (`overlay.video.alpha`) keeps the command's value scalar while
 * making the whole structured keyspace reachable.
 *
 * The leaf set is DERIVED from the dials SSOT (schema + declared defaults), never
 * hand-listed: walk each structured dial's Zod schema, recursing into objects; for a
 * `ZodRecord` (which declares no key set) the dial's DEFAULT VALUE is the SSOT for which
 * members exist — the shipped expression map is what says `happy` is an expression. Add a
 * field to the overlay schema and its path appears here, in `dial.setIn`'s param enum, and
 * in the palette, with zero hand-maintenance.
 */
import { z } from 'zod';
import { getObjectShape, extractDefaults } from '@zodal/dials-core';
import { thoreminDials } from '@/settings/dials';

/** The scalar kinds a dial leaf can be — the same four the dial-value coercion understands. */
export type LeafKind = 'string' | 'number' | 'boolean' | 'enum';

/** One addressable scalar leaf inside a structured dial. */
export interface DialLeaf {
  /** The full dotted path, e.g. `overlay.video.alpha` or `faceExpr.degrees.happy`. */
  path: string;
  /** The dial key that owns it — itself possibly dotted (`faceExpr.degrees`). */
  key: string;
  /** The path of the leaf INSIDE the dial's value, e.g. `['video', 'alpha']`. */
  rest: string[];
  /** The leaf's scalar kind, read from the schema (drives coercion of a string-typed arg). */
  kind: LeafKind;
}

/** Zod's value WRAPPERS — they decorate a value without changing its shape, so the walk
 *  must see through them to reach the object/record/scalar underneath. */
const VALUE_WRAPPERS = new Set(['default', 'prefault', 'optional', 'nullable', 'nonoptional', 'catch', 'readonly']);

/** Strip the value wrappers (default/prefault/optional/…) to reach the shape schema. */
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema as unknown as { _zod?: { def?: { type?: string; innerType?: z.ZodType } } };
  while (s?._zod?.def && VALUE_WRAPPERS.has(s._zod.def.type ?? '') && s._zod.def.innerType) {
    s = s._zod.def.innerType as unknown as typeof s;
  }
  return s as unknown as z.ZodType;
}

/** The scalar kind of a (already-unwrapped) schema, or null when it isn't a settable scalar. */
function leafKind(schema: z.ZodType): LeafKind | null {
  if (schema instanceof z.ZodEnum) return 'enum';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodString) return 'string';
  return null;
}

/** The value schema of a `ZodRecord` (its members' type). */
function recordValueType(schema: z.ZodType): z.ZodType | undefined {
  return (schema as unknown as { _zod?: { def?: { valueType?: z.ZodType } } })._zod?.def?.valueType;
}

/**
 * Recurse a dial's schema, appending every SCALAR leaf reachable from it. `def` is the
 * corresponding slice of the dial's default value — the key set for a record (a record
 * declares none) and nothing more.
 */
function collectLeaves(key: string, rest: string[], schema: z.ZodType, def: unknown, out: DialLeaf[]): void {
  const s = unwrap(schema);

  if (s instanceof z.ZodObject) {
    const shape = getObjectShape(s as z.ZodObject<z.ZodRawShape>);
    const d = (def ?? {}) as Record<string, unknown>;
    for (const [name, child] of Object.entries(shape)) collectLeaves(key, [...rest, name], child, d[name], out);
    return;
  }

  if (s instanceof z.ZodRecord) {
    const valueType = recordValueType(s);
    if (!valueType) return;
    const d = (def ?? {}) as Record<string, unknown>;
    for (const name of Object.keys(d)) collectLeaves(key, [...rest, name], valueType, d[name], out);
    return;
  }

  const kind = leafKind(s);
  // rest === [] means the DIAL ITSELF is a scalar — that is `dial.set`'s job, not a path's.
  // Anything else non-scalar (array, union, …) is simply not path-addressable as a scalar.
  if (!kind || rest.length === 0) return;
  out.push({ path: `${key}.${rest.join('.')}`, key, rest, kind });
}

/**
 * Every scalar leaf of every STRUCTURED dial, derived from the dials schema + defaults.
 * Sorted by path, so the generated command's param enum (and anything rendered from it)
 * has a stable, reviewable order.
 */
export function structuredDialLeaves(): DialLeaf[] {
  const shape = getObjectShape(thoreminDials.schema as z.ZodObject<z.ZodRawShape>);
  const defaults = extractDefaults(thoreminDials.schema as z.ZodObject<z.ZodRawShape>);
  const out: DialLeaf[] = [];
  for (const key of thoreminDials.keys) {
    const schema = shape[key];
    if (!schema) continue;
    const s = unwrap(schema);
    if (!(s instanceof z.ZodObject || s instanceof z.ZodRecord)) continue; // a scalar dial → `dial.set`
    collectLeaves(key, [], schema, defaults[key], out);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The leaves, built once from the SSOT. */
export const DIAL_LEAVES: readonly DialLeaf[] = structuredDialLeaves();

/** The sorted leaf PATHS — the param enum of `dial.setIn`, and the discoverable keyspace. */
export function structuredLeafPaths(): string[] {
  return DIAL_LEAVES.map((l) => l.path);
}

/** The leaves keyed by path — the SSOT check for "is this a real, settable leaf". */
export const leafByPath: Record<string, DialLeaf> = Object.fromEntries(DIAL_LEAVES.map((l) => [l.path, l]));

/** The declared dial keys, for the longest-prefix resolution below. */
const DIAL_KEYS = new Set<string>(thoreminDials.keys);

/**
 * Split a dotted path into the DIAL it addresses and the path inside that dial's value.
 *
 * Resolved by LONGEST-PREFIX match against the declared keyspace, not by splitting on the
 * first dot: dial keys are themselves dotted (`faceExpr.degrees`, `master.volume`), so
 * `faceExpr.degrees.happy` must resolve to the dial `faceExpr.degrees` + `['happy']`, and
 * a naive first-dot split would hand back a non-existent `faceExpr` dial. Longest-first
 * also means a scalar dial addressed by its own key resolves with an empty `rest`.
 */
export function resolveDialPath(path: string): { key: string; rest: string[] } | null {
  const segs = path.split('.');
  for (let n = segs.length; n >= 1; n--) {
    const key = segs.slice(0, n).join('.');
    if (DIAL_KEYS.has(key)) return { key, rest: segs.slice(n) };
  }
  return null;
}

/**
 * Return a COPY of `obj` with the leaf at `rest` replaced by `value`. Immutable (the input
 * is never mutated — the dials store's subscribers compare by reference, and the panel
 * renders from the store's value), with structural sharing of the untouched branches.
 */
export function setIn<T>(obj: T, rest: readonly string[], value: unknown): T {
  if (rest.length === 0) return value as T;
  const [head, ...tail] = rest;
  const src = (obj ?? {}) as Record<string, unknown>;
  return { ...src, [head]: setIn(src[head], tail, value) } as T;
}
