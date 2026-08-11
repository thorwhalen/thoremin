/**
 * Gesture-dispatch preferences (#129) — the user-visible gesture → command binding
 * map plus the dispatch timing knobs, as a Zod-validated PER-DEVICE tooling pref.
 *
 * Like `featureLab` / `faceCalibration`, this is persisted on the hot store via
 * `partialize` but is NOT a preset field and NOT a dial: gestures bind to commands
 * the way the keyboard does, and keybindings are not instrument state (loading an
 * instrument must never rebind your hands). The schema is the SSOT the store's
 * `mergeControls` heals a returning blob through, and the adapter
 * (`gestureDispatch.ts`) + the Gestures panel both read.
 *
 * A binding names a command ID from the app registry plus the fixed args to
 * dispatch it with (the same "binding carries fixed params" shape as the keyboard
 * keymap). Whether the id actually exists is validated where it matters: the panel
 * only offers registered, gesture-bindable commands and surfaces an unknown id on a
 * stale binding; the dispatcher refuses an unknown id with an error toast instead
 * of dispatching.
 */
import { z } from 'zod';

/** The bindable gesture ids — exactly the meaningful poses the classifier emits
 *  (`fist` / `open` / `pinch`; `neutral` and `absent` are non-poses and can never
 *  fire). One id per pose, hand-agnostic: either hand can trigger a binding, the
 *  hold is tracked per hand, and the cooldown is shared per gesture. */
export const GESTURE_IDS = ['fist', 'open', 'pinch'] as const;
export type GestureId = (typeof GESTURE_IDS)[number];

/** True if `v` names a bindable gesture (narrows a classifier `Pose` string). */
export const isGestureId = (v: string): v is GestureId =>
  (GESTURE_IDS as readonly string[]).includes(v);

/** Human labels, shared by the panel rows and the fire toasts. */
export const GESTURE_LABELS: Record<GestureId, string> = {
  fist: 'Fist',
  open: 'Open palm',
  pinch: 'Pinch',
};

/** How long a pose must persist before its entry can fire (anti-flicker). */
export const DEFAULT_GESTURE_HOLD_MS = 400;
/** Per-gesture refractory window after a fire (anti-repeat). */
export const DEFAULT_GESTURE_COOLDOWN_MS = 1500;
/** Slider bounds for the panel (the schema clamps to the same range). */
export const MAX_GESTURE_HOLD_MS = 2000;
export const MAX_GESTURE_COOLDOWN_MS = 10000;

/** One gesture binding: a registry command id + the fixed args it dispatches with. */
export const GestureBindingSchema = z.object({
  command: z.string().min(1),
  /** Fixed dispatch args (e.g. `{ value: 0 }` for a per-dial set command). Persisted
   *  client data — the command's own param schema is what validates it at dispatch. */
  args: z.record(z.string(), z.unknown()).optional(),
});
export type GestureBinding = z.infer<typeof GestureBindingSchema>;

/** The whole gestures tooling pref. Every field carries a default so an older
 *  (pre-#129) or partial blob heals cleanly in `mergeControls`. */
export const GesturePrefsSchema = z.object({
  /** Off by default: a camera gesture silently firing commands is the wrong surprise
   *  for a first-time player. The Gestures shell tool is the (2-clicks-from-cold-load)
   *  entry point that turns it on. */
  enabled: z.boolean().default(false),
  holdMs: z.number().min(0).max(MAX_GESTURE_HOLD_MS).default(DEFAULT_GESTURE_HOLD_MS),
  cooldownMs: z.number().min(0).max(MAX_GESTURE_COOLDOWN_MS).default(DEFAULT_GESTURE_COOLDOWN_MS),
  /** gesture id → binding. A missing key means UNBOUND (the dispatcher never fires
   *  an unbound gesture), and unbinding a default is a user choice that persists. */
  bindings: z.record(z.string(), GestureBindingSchema).default({}),
});
export type GesturePrefs = z.infer<typeof GesturePrefsSchema>;

/**
 * The shipped default bindings — 2 of the 3 reliable poses, both on real registry
 * command ids (pinned by test to exist and be gesture-bindable):
 *
 * - `fist` → `dial.master.volume.set { value: 0 }` — hands-free SILENCE. The issue's
 *   example ("fist → mute") cannot be honored literally: mute is deliberately a
 *   non-dial store flag with no command (#91), and this adapter only ever dispatches
 *   into the registry. Zeroing the master-volume dial is the closest real command.
 * - `pinch` → `dial.reset { key: 'master.volume' }` — RESTORE the default volume,
 *   the deliberate counterpart gesture.
 * - `open` ships UNBOUND on purpose: an open palm is the natural playing posture, so
 *   a default binding on it would fire constantly during normal play (a toast every
 *   cooldown window). It stays bindable from the panel for players who want it.
 */
export function defaultGestureBindings(): Record<string, GestureBinding> {
  return {
    fist: { command: 'dial.master.volume.set', args: { value: 0 } },
    pinch: { command: 'dial.reset', args: { key: 'master.volume' } },
  };
}

/** A fresh, fully-populated default prefs object (the store initializer). */
export function defaultGesturePrefs(): GesturePrefs {
  return {
    enabled: false,
    holdMs: DEFAULT_GESTURE_HOLD_MS,
    cooldownMs: DEFAULT_GESTURE_COOLDOWN_MS,
    bindings: defaultGestureBindings(),
  };
}
