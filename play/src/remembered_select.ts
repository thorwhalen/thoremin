/**
 * A select whose choice this browser remembers (`./stored`): filled from a label table, the last
 * choice restored on load and kept on every change. For a player's taste that outlives a game (how
 * the notes are shown), not for a game's settings, which a spec carries.
 */
import { stored } from './stored';

export function rememberedSelect<K extends string>(sel: HTMLSelectElement, labels: Record<K, string>, key: string): () => K {
  const keys = Object.keys(labels) as K[];
  const memory = stored<K>(key, (v): v is K => typeof v === 'string' && (keys as string[]).includes(v));
  for (const k of keys) sel.add(new Option(labels[k], k));
  sel.value = memory.read() ?? keys[0];
  sel.addEventListener('change', () => memory.write(sel.value as K));
  return () => sel.value as K;
}
