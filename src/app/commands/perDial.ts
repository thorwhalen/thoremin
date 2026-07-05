/**
 * Per-dial commands (#87 Phase 2) — one `dial.<key>.set` command per scalar dial,
 * GENERATED from the dials SSOT (`settingsForm.fields`), each carrying the dial's
 * exact typed value schema. So the command palette renders a dropdown for an enum
 * dial and a bounded number input for a numeric one, every dial is searchable by its
 * human label, and there is zero hand-maintenance: add a dial to `thoreminDials` and
 * its command appears automatically (the SSOT imperative satisfied structurally).
 * Structured dials (overlay / handMap) are skipped — they aren't a single settable
 * scalar. Every generated command routes through {@link applyDialSet}, so a typed
 * palette input and a free-text AI arg pass the exact same validation guards.
 */
import { z } from 'zod';
import { defineCommand, type AnyCommandRecord } from 'acture';
import type { SettingFieldConfig } from '@zodal/dials-ui';
import { settingsForm } from '@/app/dials/settingsStore';
import { applyDialSet } from './dials';

/** The Zod value-schema for a dial field, or null for a dial that isn't a single
 *  settable scalar (structured objects, or an unrecognized base type). It reflects
 *  the dial's enum members and numeric bounds. It does NOT re-derive `.int()` (the
 *  flat SettingFieldConfig doesn't expose integer-ness), so a fractional value for an
 *  integer dial passes this schema but is still safely refused by {@link applyDialSet}
 *  — downstream, via the full SettingsSchema — as `invalid_value` rather than at the
 *  param layer. The write never lands either way. */
function valueSchemaFor(field: SettingFieldConfig): z.ZodTypeAny | null {
  if (field.isStructured) return null;
  if (field.enumValues?.length) return z.enum(field.enumValues as [string, ...string[]]);
  switch (field.zodType) {
    case 'boolean':
      return z.boolean();
    case 'number': {
      let s = z.number();
      if (typeof field.bounds?.min === 'number') s = s.min(field.bounds.min);
      if (typeof field.bounds?.max === 'number') s = s.max(field.bounds.max);
      return s;
    }
    case 'string':
      return z.string();
    default:
      return null;
  }
}

/** The acture command id that sets a dial: `dial.<key>.set`. Dial keys are already
 *  dot-namespaced lowercase-alphanumeric segments (`right.baseOctave`,
 *  `faceChord.bpm`), which is exactly acture's id grammar — no sanitizing needed. */
export const setCommandIdFor = (key: string): string => `dial.${key}.set`;

/** Generate the per-dial `set` commands from the dials form (the SSOT). */
export function generateDialCommands(): AnyCommandRecord[] {
  const cmds: AnyCommandRecord[] = [];
  for (const field of settingsForm.fields) {
    if (field.hidden || field.readOnly) continue;
    const value = valueSchemaFor(field);
    if (!value) continue;
    cmds.push(
      defineCommand({
        id: setCommandIdFor(field.key),
        title: `Set ${field.label}`,
        description: field.description ?? `Set the "${field.label}" instrument dial.`,
        category: 'Dials',
        params: z.object({ value }),
        execute: ({ value }) => applyDialSet(field.key, value),
      }),
    );
  }
  return cmds;
}

/** The generated per-dial commands (built once from the dials SSOT). */
export const DIAL_FIELD_COMMANDS: AnyCommandRecord[] = generateDialCommands();
