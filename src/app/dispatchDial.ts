/**
 * The settings panels' write path (#87 Phase 1, completed by #126): route a panel's
 * DISCRETE dial write — a `<select>`, a toggle, a mode button — through the command
 * registry, the single write path shared with the palette / hotkeys / AI. A validation
 * failure surfaces as a toast.
 *
 * Three dispatchers, one per shape of write:
 *
 * - {@link dispatchDialSet}   — one scalar dial (`faceChord.voicing`).
 * - {@link dispatchDialSetIn} — one scalar LEAF of a structured dial, by path
 *   (`overlay.landmarks.show`, `handMap.fingers.index.target`, `faceExpr.degrees.happy`).
 *   Structured dials get no per-dial command and a command's value must stay SCALAR (an
 *   object param emits a JSON Schema Gemini rejects), so a path is what makes the overlay
 *   / hand-map / expression-map dispatchable at all. See `commands/paths.ts`.
 * - {@link dispatchDialPatch} — several dials ATOMICALLY, for the controls whose single
 *   gesture is genuinely several writes: the chord-source flip that seeds root+type, and a
 *   synced-hands voice edit that mirrors onto the other hand. All-or-nothing, so a
 *   half-applied voice can never exist.
 *
 * All are fire-and-forget: a discrete control does not need to await, and the controlled
 * input re-derives from the store once the dial lands.
 *
 * Panel **live-drag** (`type="range"` sliders, continuous inputs) deliberately stays a
 * direct `setDial` for latency (Decision B) and does NOT use these: routing a write per
 * pointer-move frame through Zod param validation, the confirmation-gate wrapper and a
 * promise buys nothing and costs latency on the one interaction where latency is audible.
 * That is the ONLY sanctioned bypass, and `test/dials_write_path.test.ts` holds the line —
 * any other panel control that writes the dials store directly fails the suite.
 *
 * This module lives outside `src/app/commands/` on purpose: it imports the toast store,
 * which the command import-firewall forbids inside a command. Commands stay pure (they
 * only write a dial); surfacing a failure to the user is a UI-layer concern.
 */
import { isErr, type Result } from 'acture';
import { registry } from './commands/registry';
import { useToasts } from './toasts';

/** Toast a rejected write — a refused value is the player's to see, not a silent no-op. */
function toastOnFailure(dispatched: Promise<Result<unknown>>): void {
  void dispatched.then((result) => {
    if (isErr(result)) useToasts.getState().push(result.error.message, 5000, 'error');
  });
}

/** Dispatch `dial.set` for a discrete panel write on a SCALAR dial. */
export function dispatchDialSet(key: string, value: unknown): void {
  toastOnFailure(registry.dispatch('dial.set', { key, value }));
}

/** Dispatch `dial.setIn` for a discrete panel write on one scalar LEAF of a STRUCTURED
 *  dial (`overlay.*`, `handMap.*`, `faceExpr.degrees.*`), addressed by its dotted path. */
export function dispatchDialSetIn(path: string, value: unknown): void {
  toastOnFailure(registry.dispatch('dial.setIn', { path, value }));
}

/** Dispatch `dial.patch` for a discrete panel write that is ATOMICALLY several dials — a
 *  sync-hands voice mirror (`voiceEditWrites`) or the chord-source flip that seeds the
 *  custom root/type. One command, so the whole batch is validated and applied as a unit. */
export function dispatchDialPatch(writes: ReadonlyArray<readonly [string, unknown]>): void {
  toastOnFailure(registry.dispatch('dial.patch', { writes: writes.map(([key, value]) => ({ key, value })) }));
}
