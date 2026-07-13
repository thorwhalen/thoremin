/**
 * The generic dial-mutation commands (#87) — the param-mutation surface of thoremin
 * as `acture` commands. Each is a named, Zod-typed operation whose handler writes
 * through the dials settings store (`setDial`/`resetDial`), which then syncs into the
 * hot `useControls` mirror the DAG reads each tick. This is the SINGLE write path a
 * keyboard binding, the command palette, or the AI assistant use to parametrize the
 * instrument — none of them re-describe a dial; they all dispatch these commands.
 *
 * The hard boundary (enforced by the import-firewall test): a command NEVER touches
 * the hot store, the DAG, the nodes, or the audio layer directly. It changes sound
 * only by writing a dial — human-frequency edits go through dispatch; the per-tick /
 * audio path stays un-registered and real-time. `sound`/`sync`/`mode`/`volume` are
 * all dials (`master.*`, `face.mapping`), so they are just `dial.set` with the right
 * key; only the non-dial `muted` flag (#91) is deliberately NOT a command yet.
 *
 * Four verbs, one contract: `dial.set` (one scalar dial), `dial.setIn` (one scalar LEAF of
 * a structured dial, addressed by a dotted path — see `paths.ts`), `dial.patch` (several
 * dials, atomically) and `dial.reset`. Every one of them writes through
 * {@link applyDialSet} / {@link applyDialSetIn}, so a typed palette input, a free-text AI
 * arg and a panel click pass the exact same unknown-key + value-validity guards.
 */
import { z } from 'zod';
import { defineCommand, ok, err, type Result } from 'acture';
import type { SettingKey } from '@zodal/dials-core';
import { dialsStore, setDial, resetDial, fieldByKey } from '@/app/dials/settingsStore';
import { thoreminDials, layerToSettings } from '@/settings/dials';
import { leafByPath, resolveDialPath, setIn, structuredLeafPaths, type LeafKind } from './paths';

/** A dial value on the generic verbs — a JSON-Schema-representable union (string, number,
 *  or boolean), NOT `z.unknown()`. The `z.unknown()`/`z.tuple()` shapes emit an untyped
 *  (`{}`) or tuple-`items` JSON Schema that Gemini's function-calling validator rejects
 *  ("items.items: missing field"); a plain union of scalars is accepted by every provider.
 *  A structured dial is never set as a whole object through these verbs either — its scalar
 *  LEAVES are addressed by path via `dial.setIn` (see `paths.ts`), which is exactly what
 *  lets the value stay scalar while the whole keyspace stays reachable. So scalars cover
 *  the entire command surface. */
const DIAL_VALUE = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Coerce a STRING value to a declared scalar type. The palette's typed inputs and the
 * app's programmatic callers already pass a number/boolean, so those pass through
 * untouched; but an AI model often sends a numeric/boolean dial as a STRING ("0.3",
 * "true"), so we convert it against the SSOT type before validation. An unparseable
 * string is left as-is, so the downstream settings-schema check reports it as
 * `invalid_value` rather than a silently-wrong write.
 *
 * Kind-addressed (not key-addressed) so the same coercion serves a whole dial (whose kind
 * comes from the dials form) and a nested LEAF of a structured dial (whose kind comes from
 * the schema walk in `paths.ts`) — one rule, two addressing schemes.
 */
function coerceScalar(value: unknown, kind: LeafKind | undefined): unknown {
  if (typeof value !== 'string') return value;
  if (kind === 'enum') return value; // enum members are strings
  if (kind === 'number') {
    const n = Number(value);
    return value.trim() !== '' && !Number.isNaN(n) ? n : value;
  }
  if (kind === 'boolean') {
    const t = value.trim().toLowerCase();
    if (t === 'true' || t === '1') return true;
    if (t === 'false' || t === '0') return false;
    return value;
  }
  return value; // a string leaf (or an unknown kind — leave it to the schema check)
}

/** Coerce a value against a DIAL's declared scalar type (from the dials form, the SSOT). */
function coerceDialValue(key: string, value: unknown): unknown {
  const field = fieldByKey[key];
  if (!field) return value;
  return coerceScalar(value, field.enumValues?.length ? 'enum' : (field.zodType as LeafKind));
}

/** The DECLARED dial keyspace — the SSOT for "is this a real dial". Keyed off the
 *  dials definition, NOT the resolved `effective` map (which omits any future
 *  UNSET/defaultless dial, so it would wrongly reject a legitimately-declared one). */
const DIAL_KEYS = new Set<string>(thoreminDials.keys);
/** True if `key` names a real dial (guards a bad key from the AI / palette / hotkey). */
const isDial = (key: string): boolean => DIAL_KEYS.has(key);

/**
 * Validate a set of prospective writes against the SAME `layerToSettings` →
 * `SettingsSchema.parse` the dials→hot sync runs — so a write's success is HONEST.
 * The dials layer accepts any value (out-of-range values are only flagged on a
 * separate `validation` surface, never rejected), and the hot-store sync then
 * SILENTLY skips an unparseable state — which would leave a command reporting `ok`
 * while the audio never changed (a panel/profile-vs-audio divergence). Refusing the
 * write up front (errors-as-data) keeps the dials layer and the audio in agreement.
 * Returns an error message, or null if every write is acceptable.
 */
function invalidWritesReason(writes: ReadonlyArray<readonly [string, unknown]>): string | null {
  const prospective = { ...dialsStore.getState().effective };
  for (const [k, v] of writes) prospective[k] = v;
  try {
    layerToSettings(prospective);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Set one dial with the full write contract (unknown-key guard + value validated
 * against the settings schema before writing), returning a Result. Shared by the
 * generic `dial.set` command and the generated per-dial commands, so both the
 * palette's typed inputs and a free-text AI arg go through the exact same guards.
 */
export function applyDialSet(key: string, value: unknown): Result<{ key: string; value: unknown }> {
  if (!isDial(key)) return err('unknown_dial', `No dial named "${key}".`, { key });
  const coerced = coerceDialValue(key, value);
  const reason = invalidWritesReason([[key, coerced]]);
  if (reason) return err('invalid_value', `Invalid value for "${key}": ${reason}`, { key, value: coerced });
  setDial(key as SettingKey, coerced);
  return ok({ key, value: coerced });
}

/** Set one dial to a value. The value is validated against the settings schema before
 *  it is written, so an out-of-range value is refused (errors-as-data) rather than
 *  silently landing in the dials layer while the audio keeps the old value. */
export const setDialCmd = defineCommand({
  id: 'dial.set',
  title: 'Set dial',
  description: 'Set a single instrument parameter (dial) to a value.',
  category: 'Dials',
  params: z.object({
    key: z.string().describe('The dial key, e.g. "right.baseOctave" or "face.mapping".'),
    value: DIAL_VALUE.describe('The new value: a number, a boolean, or a string (an enum member / note name, or a stringified number that is coerced to the dial\'s type).'),
  }),
  execute: ({ key, value }) => applyDialSet(key, value),
});

/**
 * Set ONE SCALAR LEAF inside a structured dial, addressed by a dotted path
 * (`overlay.video.alpha`, `handMap.fingers.index.target`, `faceExpr.degrees.happy`).
 *
 * The dial's current value is deep-SET immutably and the resulting whole object goes
 * through the exact same `invalidWritesReason` → `setDial` contract as {@link applyDialSet}
 * — so an out-of-range leaf or a bad enum member is refused (errors-as-data) instead of
 * landing in the dials layer while the audio keeps the old value.
 *
 * A path that resolves to a dial but names no DECLARED leaf (`overlay.bogus.show`) is
 * refused as `unknown_path`. That check is load-bearing, not defensive noise: Zod strips
 * unknown object keys, so a junk path would deep-set a junk key, still PARSE, and land in
 * the dials layer as silent garbage.
 */
export function applyDialSetIn(path: string, value: unknown): Result<{ path: string; key: string; value: unknown }> {
  const target = resolveDialPath(path);
  if (!target) return err('unknown_path', `No dial for path "${path}".`, { path });
  const leaf = leafByPath[path];
  if (!leaf || target.rest.length === 0) {
    return err('unknown_path', `"${path}" is not a settable leaf of dial "${target.key}".`, { path, key: target.key });
  }
  const current = dialsStore.getState().effective[target.key];
  if (current === null || typeof current !== 'object') {
    return err('unknown_path', `Dial "${target.key}" has no structured value to write into.`, { path, key: target.key });
  }
  const coerced = coerceScalar(value, leaf.kind);
  const next = setIn(current as Record<string, unknown>, target.rest, coerced);
  const reason = invalidWritesReason([[target.key, next]]);
  if (reason) return err('invalid_value', `Invalid value for "${path}": ${reason}`, { path, value: coerced });
  setDial(target.key as SettingKey, next);
  return ok({ path, key: target.key, value: coerced });
}

/** The settable leaf paths, as a non-empty tuple for `z.enum`. Derived from the dials SSOT. */
const LEAF_PATHS = structuredLeafPaths() as [string, ...string[]];

/**
 * Set one scalar leaf of a STRUCTURED dial by path — the write path for the overlay, the
 * hand map and the expression maps, which have no single settable scalar value and so get
 * no per-dial command.
 *
 * `path` is an ENUM of the derived leaf paths rather than a free string: it keeps the
 * emitted JSON Schema a plain string-enum (Gemini-safe, unlike an object param), it makes
 * every valid path DISCOVERABLE to the palette and the model, and it means a typo is
 * refused at the param layer instead of reaching the store.
 */
export const setDialInCmd = defineCommand({
  id: 'dial.setIn',
  title: 'Set nested dial',
  description:
    'Set one value inside a structured instrument parameter (the overlay, the hand mapping, the expression map) by its dotted path.',
  category: 'Dials',
  params: z.object({
    path: z
      .enum(LEAF_PATHS)
      .describe('The leaf path, e.g. "overlay.landmarks.show", "handMap.fingers.index.target", "faceExpr.degrees.happy".'),
    value: DIAL_VALUE.describe('The new value: a number, a boolean, or a string (an enum member, or a stringified number coerced to the leaf\'s type).'),
  }),
  execute: ({ path, value }) => applyDialSetIn(path, value),
});

/** Reset one dial to its default (the lower default scope re-wins). */
export const resetDialCmd = defineCommand({
  id: 'dial.reset',
  title: 'Reset dial',
  description: 'Reset a dial to its default value.',
  category: 'Dials',
  params: z.object({ key: z.string().describe('The dial key to reset.') }),
  execute: ({ key }) => {
    if (!isDial(key)) return err('unknown_dial', `No dial named "${key}".`, { key });
    resetDial(key as SettingKey);
    return ok({ key });
  },
});

/** Set several dials in one command — the atomic unit a synced-hands voice edit (a
 *  primary write + its mirrored writes) or an instrument tweak dispatches. Truly
 *  all-or-nothing: the whole batch is rejected up front if any key is unknown OR the
 *  resulting state wouldn't parse, so a partial or invalid write never reaches the
 *  dials layer. */
export const patchDialsCmd = defineCommand({
  id: 'dial.patch',
  title: 'Patch dials',
  description: 'Set several dials at once (an ordered list of [key, value] writes).',
  category: 'Dials',
  params: z.object({
    writes: z
      .array(
        z.object({
          key: z.string().describe('The dial key.'),
          // OPTIONAL — an omitted value clears the dial. Not a convenience: the sync-hands
          // voice mirror (the panel's main patch caller) copies the source hand's fields
          // onto the other hand, and the #63 octave-range dials are legitimately ABSENT on
          // a pre-#63 instrument. The mirror must be able to propagate that absence, and
          // OMITTING the key is the JSON-Schema-safe way to say "no value" (a `null` member
          // in the value union is what a provider's validator would choke on). A dial that
          // REQUIRES a value still refuses the clear downstream, as `invalid_value`.
          value: DIAL_VALUE.optional().describe('The new value (number/boolean/string, coerced to the dial\'s type). Omit to clear an optional dial.'),
        }),
      )
      .describe('An ordered list of { key, value } dial writes, applied in sequence.'),
  }),
  execute: ({ writes }) => {
    const bad = writes.find((w) => !isDial(w.key));
    if (bad) return err('unknown_dial', `No dial named "${bad.key}".`, { key: bad.key });
    const pairs = writes.map((w) => [w.key, coerceDialValue(w.key, w.value)] as [string, unknown]);
    const reason = invalidWritesReason(pairs);
    if (reason) return err('invalid_value', `Invalid dial values: ${reason}`, { writes });
    for (const [k, v] of pairs) setDial(k as SettingKey, v);
    return ok({ count: writes.length });
  },
});

/** All generic dial-mutation commands, registered together. */
export const DIAL_COMMANDS = [setDialCmd, setDialInCmd, resetDialCmd, patchDialsCmd] as const;
