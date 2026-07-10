/**
 * The read side for the assistant (#87 Phase 3) — a compact catalog of every settable
 * dial with its type and CURRENT value, built fresh each turn from the dials SSOT. The
 * model needs this to make RELATIVE edits ("an octave lower", "warmer", "brighter"): it
 * reads the current value here, computes the new one, and dispatches `dial.set`. This
 * is a pure read of the dials settings layer (the same layer the commands write) — it
 * never touches the hot store, the DAG, the nodes, or the audio path.
 */
import { settingsForm, dialsStore } from '@/app/dials/settingsStore';

/** Describe a dial's accepted values: its enum members, numeric range, or base type. */
function describeType(field: {
  enumValues?: readonly string[];
  zodType?: string;
  bounds?: { min?: number; max?: number };
}): string {
  if (field.enumValues?.length) return `one of [${field.enumValues.join(', ')}]`;
  if (field.zodType === 'number') {
    const { min, max } = field.bounds ?? {};
    if (typeof min === 'number' && typeof max === 'number') return `number ${min}..${max}`;
    return 'number';
  }
  return field.zodType ?? 'value';
}

/**
 * A newline-delimited catalog — one line per settable dial:
 *   `- <key> — <label> (<type>); current: <value>`
 * Structured, hidden, and read-only dials are omitted (they aren't a single settable
 * scalar the model should target with `dial.set`).
 */
export function buildDialCatalog(): string {
  const effective = dialsStore.getState().effective;
  const lines: string[] = [];
  for (const field of settingsForm.fields) {
    if (field.hidden || field.readOnly || field.isStructured) continue;
    lines.push(
      `- ${field.key} — ${field.label} (${describeType(field)}); current: ${JSON.stringify(effective[field.key])}`,
    );
  }
  return lines.join('\n');
}
