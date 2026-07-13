/**
 * The read side for the assistant (#87 Phase 3) — a compact catalog of every settable
 * dial with its type and CURRENT value, built fresh each turn from the dials SSOT. The
 * model needs this to make RELATIVE edits ("an octave lower", "warmer", "brighter"): it
 * reads the current value here, computes the new one, and dispatches `dial.set`. This
 * is a pure read of the dials settings layer (the same layer the commands write) — it
 * never touches the hot store, the DAG, the nodes, or the audio path.
 */
import { settingsForm, dialsStore } from '@/app/dials/settingsStore';
import { DIAL_LEAVES } from '@/app/commands/paths';

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
 * and then one line per addressable LEAF of the structured dials:
 *   `- <path> (leaf; use dial.setIn); current: <value>`
 *
 * The leaves matter (#126): the model is told to reach `overlay.*`, `handMap.*` and
 * `faceExpr.*` with `dial.setIn`, and it is told to compute relative edits from "the
 * CURRENT value below". Omitting the structured dials — as this catalog did while
 * `dial.setIn` shipped — leaves it write-only-blind: able to set a leaf, unable to read
 * one, so "make the overlay a bit more transparent" is a guess.
 *
 * Hidden and read-only dials stay omitted.
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
  for (const leaf of DIAL_LEAVES) {
    const value = leafValue(effective[leaf.key], leaf.rest);
    lines.push(`- ${leaf.path} (${leaf.kind}, leaf; use dial.setIn); current: ${JSON.stringify(value)}`);
  }
  return lines.join('\n');
}

/** Read a leaf out of a structured dial's current value. */
function leafValue(root: unknown, rest: readonly string[]): unknown {
  let cur: unknown = root;
  for (const seg of rest) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
