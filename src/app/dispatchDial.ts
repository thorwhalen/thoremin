/**
 * dispatchDialSet — route a settings panel's DISCRETE dial write (a mode/sync
 * toggle, a select) through the command registry (#87 Phase 1), the single write
 * path shared with the palette / hotkeys / AI. A failure surfaces as a toast.
 *
 * This is fire-and-forget: a discrete toggle does not need to await, and the
 * controlled input re-derives from the store once the dial lands. Panel
 * **live-drag** (sliders, continuous inputs) deliberately stays a direct
 * `setDial` for latency (Decision B) and does NOT use this.
 *
 * It lives outside `src/app/commands/` on purpose: it imports the toast store,
 * which the command import-firewall forbids inside a command. Commands stay pure
 * (they only write a dial); this is a UI-layer dispatcher.
 *
 * Phase-1 scope: only the two named mode/sync controls (`face.mapping`,
 * `master.syncHands`) are rerouted through here. The other one-shot `<select>`s
 * (voice sound/root/scale, chord sound/voicing/rendering, overlay position, …)
 * are discrete by the same logic but are DEFERRED — they stay a direct `set()`
 * for now, to be swept in a follow-up once this pattern is proven.
 */
import { registry } from './commands/registry';
import { useToasts } from './toasts';

/** Dispatch `dial.set` for a discrete panel write, toasting a validation error. */
export function dispatchDialSet(key: string, value: unknown): void {
  void registry.dispatch('dial.set', { key, value }).then((result) => {
    if (!result.ok) useToasts.getState().push(result.error.message, 5000, 'error');
  });
}
