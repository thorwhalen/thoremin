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
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import type { SettingKey } from '@zodal/dials-core';
import { dialsStore, setDial, resetDial } from '@/app/dials/settingsStore';
import { thoreminDials, layerToSettings } from '@/settings/dials';

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
    value: z.unknown().describe('The new value for that dial.'),
  }),
  execute: ({ key, value }) => {
    if (!isDial(key)) return err('unknown_dial', `No dial named "${key}".`, { key });
    const reason = invalidWritesReason([[key, value]]);
    if (reason) return err('invalid_value', `Invalid value for "${key}": ${reason}`, { key, value });
    setDial(key as SettingKey, value);
    return ok({ key, value });
  },
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
      .array(z.tuple([z.string(), z.unknown()]))
      .describe('Ordered [key, value] writes, applied in sequence.'),
  }),
  execute: ({ writes }) => {
    const bad = writes.find(([k]) => !isDial(k));
    if (bad) return err('unknown_dial', `No dial named "${bad[0]}".`, { key: bad[0] });
    const reason = invalidWritesReason(writes);
    if (reason) return err('invalid_value', `Invalid dial values: ${reason}`, { writes });
    for (const [k, v] of writes) setDial(k as SettingKey, v);
    return ok({ count: writes.length });
  },
});

/** All generic dial-mutation commands, registered together. */
export const DIAL_COMMANDS = [setDialCmd, resetDialCmd, patchDialsCmd] as const;
