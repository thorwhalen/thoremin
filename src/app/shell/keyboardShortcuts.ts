/**
 * Keyboard shortcuts (#90) — an app-level keymap that binds keys to command
 * dispatches via raw `tinykeys`, replacing the retired in-DAG `keyboard-control`
 * switch. Octave-shift and magnetism go through the **dial command path** (the
 * single write path: `dial.set` → the dials store → the hot mirror the DAG reads
 * via `store-controls`); mute is a non-dial store flag (#91), toggled directly.
 *
 * Every binding is guarded by the shared {@link isEditableTarget} so typing a
 * dial name into the command palette (or any input) never fires the instrument.
 * The keymap is plain data (key-binding string → action), so a persisted,
 * user-rebindable keymap UI is a clean follow-up; this ships the default.
 *
 * `tinykeys` is used directly (not `acture-hotkeys`) because a binding must carry
 * FIXED params (a specific octave delta), which the hotkeys adapter can't express.
 *
 * An action may return `false` to say "not mine now": the key is then left to the browser
 * (no `preventDefault`). Space is such a binding (#385 E2): it toggles a carve tool's capture
 * only while one is live, and otherwise still presses a focused button or scrolls.
 *
 * Extensions add bindings as data (#600 S11): a `KeybindingDecl` names a key and the command it
 * dispatches, and its `when` may pass the key to the browser or swallow it. They are folded in
 * after core's; a key core binds, or one two extensions bind, is refused at load, naming both.
 */
import { tinykeys } from 'tinykeys';
import { isEditableTarget } from '@/nodes/sources/keyboard.schema';
import { history, registry } from '../commands/registry';
import { useControls } from '../store';
import { useTools } from '../tools/toolsStore';
import { toggleCarveCapture } from '../enroll/carveCapture';
import type { KeybindingDecl } from '@thoremin/sdk-ui/types';
// The extensions' keybindings; loading it registers the commands they dispatch.
import { UI_CONTRIBUTIONS } from '../host/contributions';

const OCTAVE_MIN = -2;
const OCTAVE_MAX = 2;
const MAGNETISM_STEP = 0.1;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Shift the global octave-transpose dial by `delta` (clamped ±2) via `dial.set`.
 *  Reading the current value then dispatching is race-free: `dial.set`'s handler
 *  runs synchronously (the store lands before dispatch's first await), so a burst
 *  of presses accumulates correctly. */
export function shiftOctave(delta: number): void {
  const next = clamp(useControls.getState().octaveShift + delta, OCTAVE_MIN, OCTAVE_MAX);
  void registry.dispatch('dial.set', { key: 'master.octaveShift', value: next });
}

/** Adjust the scale-magnetism dial by `delta` (clamped [0,1]) via `dial.set`. */
export function adjustMagnetism(delta: number): void {
  const next = clamp(useControls.getState().magnetism + delta, 0, 1);
  void registry.dispatch('dial.set', { key: 'master.magnetism', value: next });
}

/** Toggle the master mute — a non-dial store flag (#91), not a command. */
export function toggleMute(): void {
  useControls.getState().toggleMuted();
}

/**
 * Undo the last discrete param change (#127). A no-op when the history is empty, so the
 * binding is safe to fire unconditionally.
 *
 * This binding is the reason undo counts as SHIPPED rather than merely present: an undo
 * history reachable only from a module export is exactly the #137 trap this repo now has
 * a rule about. Note the guard in `installKeyboardShortcuts` — `isEditableTarget` means
 * Cmd-Z inside the palette's text input still does the browser's own text undo, which is
 * what a player expects there.
 */
export function undoLastChange(): void {
  history.undo();
}

/** Re-apply the most recently undone param change (#127). */
export function redoLastChange(): void {
  history.redo();
}

/** Open or close the Tools launcher — shell UI state, not a param, so not a command. */
export function toggleToolsLauncher(): void {
  useTools.getState().toggleLauncher();
}

/** A keymap: a tinykeys key-binding string → an action (given the event; most ignore it);
 *  `false` means "not handled". */
export type Keymap = Record<string, (e?: KeyboardEvent) => void | boolean>;

/** Core's own bindings (mirrors the retired keyboard-control node). */
const CORE_KEYMAP: Keymap = {
  ArrowUp: () => shiftOctave(1),
  ArrowDown: () => shiftOctave(-1),
  ArrowRight: () => adjustMagnetism(MAGNETISM_STEP),
  ArrowLeft: () => adjustMagnetism(-MAGNETISM_STEP),
  m: toggleMute,
  // The Tools launcher (Round 4, #271): every shell tool, one key from anywhere.
  t: toggleToolsLauncher,
  // A carve tool's capture (#385 E2): start, pause, resume. Only while a carve is live.
  Space: toggleCarveCapture,
  // `$mod` is Cmd on macOS, Ctrl elsewhere. Both redo spellings are bound: Shift-Cmd-Z is
  // the macOS convention, Ctrl-Y the Windows one, and a player should not have to know
  // which platform the binding table was written on.
  '$mod+z': undoLastChange,
  '$mod+Shift+z': redoLastChange,
  '$mod+y': redoLastChange,
};

/**
 * Fold extension keybindings onto `base` (#600 S11). Each binding names a registered command, or
 * runs an action (`run`, #600 S14: state deliberately not a command, like the master mute);
 * its `when` (default: dispatch) may say `pass` (the browser's key) or `swallow` (handled, nothing
 * dispatched). A key `base` binds, or one bound twice, is refused. Exported for direct testing.
 */
export function withKeybindings(base: Keymap, decls: readonly KeybindingDecl[], commands: { has(id: string): boolean } = registry): Keymap {
  const out: Keymap = { ...base };
  const owner = new Map<string, string>(Object.keys(base).map((k) => [k, 'core']));
  for (const decl of decls) {
    const label = decl.command ?? `${decl.key} action`;
    const taken = owner.get(decl.key);
    if (taken) throw new Error(`keybinding "${decl.key}" (to "${label}") is already bound by ${taken === 'core' ? 'core' : `the binding to "${taken}"`}`);
    if ((decl.command === undefined) === (decl.run === undefined)) throw new Error(`keybinding "${decl.key}" must name a command or a run action, not both or neither`);
    if (decl.command !== undefined && !commands.has(decl.command)) throw new Error(`keybinding "${decl.key}" names "${decl.command}", which no command registers`);
    owner.set(decl.key, label);
    const { command, run } = decl;
    out[decl.key] = (e) => {
      const verdict = decl.when ? decl.when(e) : 'dispatch';
      if (verdict === 'pass') return false;
      if (verdict === 'dispatch') {
        if (run) run();
        else if (command) void registry.dispatch(command, { ...(decl.params ?? {}) });
      }
      return true;
    };
  }
  return out;
}

/** The shipped default keymap: core's bindings, then every listed extension's. */
export const DEFAULT_KEYMAP: Keymap = withKeybindings(CORE_KEYMAP, UI_CONTRIBUTIONS.keybindings);

/**
 * Install `keymap` on `target` (default `window`) via tinykeys; returns the
 * unsubscribe. Each binding skips text-editing targets and calls `preventDefault`
 * (the arrows would otherwise scroll the page).
 */
export function installKeyboardShortcuts(
  target: Window = window,
  keymap: Keymap = DEFAULT_KEYMAP,
): () => void {
  const bindings: Record<string, (e: KeyboardEvent) => void> = {};
  for (const [keys, action] of Object.entries(keymap)) {
    bindings[keys] = (e) => {
      if (isEditableTarget(e.target)) return;
      if (action(e) === false) return;
      e.preventDefault();
    };
  }
  return tinykeys(target, bindings);
}
