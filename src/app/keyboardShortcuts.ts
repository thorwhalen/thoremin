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
 */
import { tinykeys } from 'tinykeys';
import { isEditableTarget } from '@/nodes/sources/keyboard';
import { registry } from './commands/registry';
import { useControls } from './store';

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

/** A keymap: a tinykeys key-binding string → a zero-arg action. */
export type Keymap = Record<string, () => void>;

/** The shipped default keymap (mirrors the retired keyboard-control node). */
export const DEFAULT_KEYMAP: Keymap = {
  ArrowUp: () => shiftOctave(1),
  ArrowDown: () => shiftOctave(-1),
  ArrowRight: () => adjustMagnetism(MAGNETISM_STEP),
  ArrowLeft: () => adjustMagnetism(-MAGNETISM_STEP),
  m: toggleMute,
};

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
      e.preventDefault();
      action();
    };
  }
  return tinykeys(target, bindings);
}
