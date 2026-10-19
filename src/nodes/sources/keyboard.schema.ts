/**
 * The `keyboard` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


/** True if a key event targets a text-editing surface (an input / textarea / select
 *  or a contenteditable element), where global instrument shortcuts must NOT fire —
 *  e.g. typing a dial name into the command palette. Exported so the palette and the
 *  future hotkey layer share one definition. Tolerant of a non-DOM target (tests). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
