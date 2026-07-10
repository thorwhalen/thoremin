/**
 * Modal tag-toggle keymap (#92, design §8) — digits 1..9 toggle the positional tag,
 * `0` closes all open tags (panic / clean-stop). It is deliberately **modal**: the
 * handler no-ops unless tagging mode is on, so it never shadows any other digit
 * binding (e.g. a future instrument-load keymap) and the keys are inert until the
 * performer opts into tagging.
 *
 * Guarded by the shared {@link isEditableTarget} (typing a tag label must never fire
 * a tag) and by the modifier check (Cmd/Ctrl/Alt combos pass through to the palette
 * etc.). Auto-repeat is ignored so a held key is one toggle, not a stream. The
 * handler only pushes a `TagAction` into the store — the same path a button click
 * takes — so keyboard and mouse are indistinguishable downstream (`src` records which).
 */
import { isEditableTarget } from '@/nodes/sources/keyboard';
import { useTagging } from './store';

/** Install the modal keymap on `target` (default window); returns the unsubscribe. */
export function installTaggingKeymap(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    const st = useTagging.getState();
    if (!st.mode) return; // modal: only while tagging mode is on
    if (isEditableTarget(e.target)) return; // don't steal keys from a focused input
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave modifier combos alone
    if (e.repeat) return; // one toggle per physical press, not per auto-repeat
    const k = e.key;
    if (k === '0') {
      e.preventDefault();
      st.closeAllTags('key');
    } else if (k >= '1' && k <= '9') {
      e.preventDefault();
      st.toggleByNumber(Number(k), 'key');
    }
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
