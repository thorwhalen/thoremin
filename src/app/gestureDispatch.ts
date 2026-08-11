/**
 * Gesture dispatch (#129) — the FOURTH command dispatcher, alongside the keyboard,
 * the palette and the AI assistant. An app-level subscriber (like
 * `keyboardShortcuts.ts`, not a DAG node) that reads the gesture-classifier's
 * per-hand pose stream each frame and turns held-pose TRANSITIONS into
 * `registry.dispatch(commandId, args)` calls, per the user's binding map
 * (`gesturePrefs.ts`, a per-device tooling pref).
 *
 * ## Firing semantics (pinned by `test/gesture_dispatch.test.ts`)
 *
 * A fire requires ALL of:
 *
 * 1. **Edge, never state** — a fresh TRANSITION into the gesture. A held pose fires
 *    at most once per entry, no matter how long it is held (even far past the
 *    cooldown). Re-firing requires releasing and re-entering.
 * 2. **Minimum hold** — the pose must persist `holdMs` continuously from its entry
 *    before the entry may fire (classifier flicker shorter than the hold never
 *    fires at all).
 * 3. **Per-gesture cooldown, consumed not deferred** — after a fire, the gesture is
 *    refractory for `cooldownMs` (shared across hands, so two hands cannot
 *    double-fire one binding). An entry whose hold completes while the cooldown is
 *    still running is CONSUMED silently: it will not fire later even if held past
 *    the cooldown's expiry. Deferral would turn threshold chatter into a delayed
 *    surprise dispatch; suppression keeps "one deliberate gesture = at most one
 *    fire". A re-entry whose hold completes AFTER the cooldown expired fires
 *    normally. The cooldown starts at the fire ATTEMPT (including a refused
 *    unknown/gated command), so a broken binding cannot machine-gun error toasts.
 *
 * Further rules:
 * - **No binding, no dispatch** — a gesture with no binding-map entry never
 *   dispatches (and never burns the cooldown). Same when `enabled` is off; an entry
 *   begun while disabled stays inert even if gestures are enabled mid-hold
 *   (enabling arms FUTURE transitions).
 * - **Unknown command ids are surfaced, not dispatched** — a stale persisted
 *   binding naming a command the registry doesn't have gets an error toast.
 * - **Confirmation-gated (destructive) commands never fire from a gesture** — a
 *   hands-free flow cannot answer a confirmation dialog, so `instrument.*` (per
 *   {@link isGestureBindable}) is refused here AND filtered from the panel picker.
 * - **Feedback** — a successful fire toasts "<gesture> → <command title>"; a failed
 *   or refused dispatch toasts the error (the palette-toast precedent).
 *
 * Time is an INPUT (`tick(poses, nowMs)`), driven by the rAF loop in `useEngine`,
 * so the semantics are tick-testable without fake timers. All dependencies are
 * injectable for tests; the defaults bind the app singletons (registry, hot-store
 * prefs, toasts) — the same import surface `keyboardShortcuts.ts` /
 * `dispatchDial.ts` use, and none of what the command firewall forbids commands.
 */
import { isErr, type Result } from 'acture';
import type { Pose } from '@/nodes';
import { registry } from './commands/registry';
import { defaultGetRisk } from './commands/confirmation';
import { useControls } from './store';
import { useToasts } from './toasts';
import { GESTURE_LABELS, isGestureId, type GestureBinding, type GestureId, type GesturePrefs } from './gesturePrefs';
import type { HandPoses } from './gestureStatus';

/** Toast lifetimes: fires are frequent and small, errors need reading time. */
const FIRE_TOAST_MS = 2500;
const ERROR_TOAST_MS = 5000;

/**
 * True if a command may be bound to a gesture: everything except commands the
 * confirmation gate classifies destructive (or explicitly confirmation-requiring).
 * Shared by the dispatcher's refusal guard and the panel's picker filter (SSOT).
 */
export function isGestureBindable(id: string): boolean {
  const risk = defaultGetRisk(id);
  return !(risk.requiresConfirmation ?? risk.sideEffect === 'destructive');
}

/** The injectable seams (tests swap all of them; the app uses the defaults). */
export interface GestureDispatcherDeps {
  getPrefs(): GesturePrefs;
  hasCommand(id: string): boolean;
  commandTitle(id: string): string;
  isBindable(id: string): boolean;
  dispatch(command: string, args?: unknown): Promise<Result<unknown>>;
  notify(message: string, level?: 'info' | 'error'): void;
}

function defaultDeps(): GestureDispatcherDeps {
  return {
    getPrefs: () => useControls.getState().gestures,
    hasCommand: (id) => registry.has(id),
    commandTitle: (id) => registry.get(id)?.title ?? id,
    isBindable: isGestureBindable,
    dispatch: (command, args) => registry.dispatch(command, args),
    notify: (message, level = 'info') =>
      useToasts.getState().push(message, level === 'error' ? ERROR_TOAST_MS : FIRE_TOAST_MS, level),
  };
}

export interface GestureDispatcher {
  /** Feed one frame's per-hand poses; `nowMs` is the frame timestamp. */
  tick(poses: HandPoses, nowMs: number): void;
}

const HANDS = ['left', 'right'] as const;

/** Per-hand entry tracking: which pose is held, since when, and whether this
 *  entry has already been evaluated to completion (fired or consumed). */
interface EntryTrack {
  pose: Pose;
  enteredAt: number;
  consumed: boolean;
}

/** Build a gesture dispatcher (fresh timing state; one per engine run). */
export function createGestureDispatcher(overrides: Partial<GestureDispatcherDeps> = {}): GestureDispatcher {
  const deps: GestureDispatcherDeps = { ...defaultDeps(), ...overrides };
  const tracks: Record<(typeof HANDS)[number], EntryTrack> = {
    left: { pose: 'absent', enteredAt: 0, consumed: true },
    right: { pose: 'absent', enteredAt: 0, consumed: true },
  };
  /** Last fire ATTEMPT per gesture — shared across hands (the cooldown clock). */
  const lastFire = new Map<GestureId, number>();

  function fire(gesture: GestureId, binding: GestureBinding): void {
    const label = GESTURE_LABELS[gesture];
    if (!deps.hasCommand(binding.command)) {
      deps.notify(`${label}: unknown command "${binding.command}" — rebind it in the Gestures panel`, 'error');
      return;
    }
    if (!deps.isBindable(binding.command)) {
      deps.notify(`${label}: "${binding.command}" needs confirmation and cannot be fired by a gesture`, 'error');
      return;
    }
    const title = deps.commandTitle(binding.command);
    void deps.dispatch(binding.command, binding.args).then(
      (result) => {
        if (isErr(result)) deps.notify(`${label}: ${result.error.message}`, 'error');
        else deps.notify(`${label} → ${title}`);
      },
      (e: unknown) => deps.notify(`${label}: ${e instanceof Error ? e.message : String(e)}`, 'error'),
    );
  }

  return {
    tick(poses, nowMs) {
      const prefs = deps.getPrefs();
      for (const hand of HANDS) {
        const pose = poses[hand];
        const t = tracks[hand];
        if (pose !== t.pose) {
          // The EDGE: a fresh entry arms exactly one future evaluation — unless
          // dispatch is disabled right now, in which case the entry is born
          // consumed (enabling mid-hold must not fire a pre-enable gesture).
          t.pose = pose;
          t.enteredAt = nowMs;
          t.consumed = !prefs.enabled;
        }
        if (!prefs.enabled || t.consumed || !isGestureId(pose)) continue;
        const binding = prefs.bindings[pose];
        if (!binding) continue; // unbound: never dispatch, never consume, never cool down
        if (nowMs - t.enteredAt < prefs.holdMs) continue; // hold not yet met
        t.consumed = true; // this entry is now spent, fire or not
        const last = lastFire.get(pose);
        if (last !== undefined && nowMs - last < prefs.cooldownMs) continue; // consumed silently
        lastFire.set(pose, nowMs);
        fire(pose, binding);
      }
    },
  };
}
