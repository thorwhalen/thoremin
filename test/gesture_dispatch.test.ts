/**
 * Gesture dispatch (#129) — pins the adapter's firing semantics exactly as the
 * module docstring states them, tick-driven (time is an input, no fake timers):
 *
 * - EDGE trigger: a fire needs a fresh transition into the gesture; held state
 *   never re-fires, even long past the cooldown.
 * - Minimum hold: an entry shorter than `holdMs` never fires.
 * - Per-gesture cooldown, CONSUMED not deferred: an entry whose hold completes
 *   inside the cooldown never fires — not even if held past the cooldown's expiry
 *   — while a re-entry whose hold completes after expiry fires normally. Shared
 *   across hands (two hands cannot double-fire one binding).
 * - No binding ⇒ no dispatch; disabled ⇒ no dispatch (including an entry begun
 *   while disabled that is still held when enabling).
 * - Unknown / confirmation-gated command ids are refused with an error toast,
 *   never dispatched.
 * - Feedback: success toasts "<gesture> → <title>", a failed dispatch toasts the
 *   error (the palette-toast precedent).
 *
 * Also pins that the SHIPPED default bindings name real, gesture-bindable registry
 * commands with schema-valid args, and — the #137-style reachability guard — that
 * the mounted classifier's output is actually read by the app path (a node wired
 * into the graph but read by nobody is #120 all over again).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, err, type Result } from 'acture';
import { createGestureDispatcher, isGestureBindable, type GestureDispatcherDeps } from '@/app/gestureDispatch';
import {
  GESTURE_IDS,
  defaultGesturePrefs,
  isGestureId,
  type GestureBinding,
  type GesturePrefs,
} from '@/app/gesturePrefs';
import type { HandPoses } from '@/app/gestureStatus';
import { createThoreminRegistry } from '@/app/commands/registry';
import type { Pose } from '@/nodes';

/** A poses frame: right-hand pose (the usual test subject) + optional left. */
const P = (right: Pose, left: Pose = 'absent'): HandPoses => ({ left, right });

/** Flush the microtask/timeout queue so fire-and-forget toast chains settle. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const FIST: GestureBinding = { command: 'test.fist.go', args: { value: 0 } };

interface Notice {
  message: string;
  level: string;
}

/** A dispatcher with every dependency stubbed; `prefs` is LIVE (mutable per test). */
function makeHarness(
  opts: {
    prefs?: Partial<GesturePrefs>;
    result?: (command: string) => Result<unknown>;
    known?: (id: string) => boolean;
  } = {},
) {
  const prefs: GesturePrefs = {
    ...defaultGesturePrefs(),
    enabled: true,
    bindings: { fist: FIST },
    ...opts.prefs,
  };
  const fired: { command: string; args: unknown }[] = [];
  const notices: Notice[] = [];
  const deps: Partial<GestureDispatcherDeps> = {
    getPrefs: () => prefs,
    hasCommand: opts.known ?? (() => true),
    commandTitle: (id) => `Title(${id})`,
    isBindable: (id) => !id.startsWith('instrument.'),
    dispatch: async (command, args) => {
      fired.push({ command, args });
      return (opts.result ?? (() => ok({})))(command);
    },
    notify: (message, level = 'info') => notices.push({ message, level }),
  };
  return { prefs, fired, notices, dispatcher: createGestureDispatcher(deps) };
}

describe('gesture dispatch adapter (#129) — edge + hold + cooldown semantics', () => {
  it('fires once per transition after the minimum hold; held state NEVER re-fires', () => {
    const { fired, dispatcher } = makeHarness({ prefs: { holdMs: 400, cooldownMs: 1000 } });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('fist'), 399);
    expect(fired).toHaveLength(0); // hold not yet met
    dispatcher.tick(P('fist'), 400);
    expect(fired).toHaveLength(1); // the edge fires exactly once
    expect(fired[0]).toEqual({ command: 'test.fist.go', args: { value: 0 } });
    // Held far past the hold AND past the cooldown: an edge trigger must not
    // re-fire on state. (Mutation target: fire-on-state makes this re-fire.)
    dispatcher.tick(P('fist'), 5000);
    dispatcher.tick(P('fist'), 60000);
    expect(fired).toHaveLength(1);
  });

  it('an entry released before the minimum hold never fires (classifier flicker is inert)', () => {
    const { fired, notices, dispatcher } = makeHarness({ prefs: { holdMs: 400 } });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('neutral'), 300); // released at 300 < 400
    dispatcher.tick(P('fist'), 350);
    dispatcher.tick(P('neutral'), 700); // released again at 350ms held
    expect(fired).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it('cooldown: a re-entry whose hold completes inside the cooldown is CONSUMED — not deferred, not fired', () => {
    const { fired, dispatcher } = makeHarness({ prefs: { holdMs: 400, cooldownMs: 1200 } });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('fist'), 400); // fire #1 at 400; cooldown until 1600
    expect(fired).toHaveLength(1);
    dispatcher.tick(P('neutral'), 500); // release
    dispatcher.tick(P('fist'), 600); // re-enter during cooldown
    dispatcher.tick(P('fist'), 1000); // hold completes at 1000 < 1600 → consumed
    expect(fired).toHaveLength(1);
    // Still held long past the cooldown's expiry: the consumed entry stays spent.
    dispatcher.tick(P('fist'), 2000);
    dispatcher.tick(P('fist'), 10000);
    expect(fired).toHaveLength(1);
    // A FRESH entry after the cooldown expired fires normally.
    dispatcher.tick(P('neutral'), 10100);
    dispatcher.tick(P('fist'), 10200);
    dispatcher.tick(P('fist'), 10600);
    expect(fired).toHaveLength(2);
  });

  it('cooldown: a re-entry whose hold completes AFTER the cooldown expired fires', () => {
    const { fired, dispatcher } = makeHarness({ prefs: { holdMs: 400, cooldownMs: 1200 } });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('fist'), 400); // fire #1; cooldown until 1600
    dispatcher.tick(P('neutral'), 500);
    dispatcher.tick(P('fist'), 1300); // re-enter INSIDE the cooldown...
    dispatcher.tick(P('fist'), 1650); // ...but hold not met yet (350 < 400): not evaluated
    expect(fired).toHaveLength(1);
    dispatcher.tick(P('fist'), 1700); // hold completes at 1700 ≥ 1600 → fires
    expect(fired).toHaveLength(2);
  });

  it('never dispatches a gesture with no binding-map entry (and burns no cooldown)', () => {
    const { fired, notices, dispatcher } = makeHarness({ prefs: { holdMs: 100, bindings: {} } });
    dispatcher.tick(P('open'), 0);
    dispatcher.tick(P('open'), 5000); // held way past any hold
    dispatcher.tick(P('fist'), 6000);
    dispatcher.tick(P('fist'), 7000); // fist unbound too in this harness
    expect(fired).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it('disabled: no fires — and an entry begun while disabled stays inert after enabling mid-hold', () => {
    const h = makeHarness({ prefs: { holdMs: 400, enabled: false } });
    h.dispatcher.tick(P('fist'), 0);
    h.dispatcher.tick(P('fist'), 400);
    expect(h.fired).toHaveLength(0);
    h.prefs.enabled = true; // enabled mid-hold: arms FUTURE transitions only
    h.dispatcher.tick(P('fist'), 800);
    h.dispatcher.tick(P('fist'), 5000);
    expect(h.fired).toHaveLength(0);
    h.dispatcher.tick(P('neutral'), 5100); // release...
    h.dispatcher.tick(P('fist'), 5200); // ...and a fresh transition
    h.dispatcher.tick(P('fist'), 5600);
    expect(h.fired).toHaveLength(1);
  });

  it('hold is per hand, cooldown is per gesture: two hands cannot double-fire one binding', () => {
    const { fired, dispatcher } = makeHarness({ prefs: { holdMs: 400, cooldownMs: 1200 } });
    dispatcher.tick({ left: 'fist', right: 'absent' }, 0);
    dispatcher.tick({ left: 'fist', right: 'fist' }, 100); // right enters 100ms later
    dispatcher.tick({ left: 'fist', right: 'fist' }, 400); // left's hold completes → fire
    expect(fired).toHaveLength(1);
    dispatcher.tick({ left: 'fist', right: 'fist' }, 500); // right's hold completes → cooldown → consumed
    dispatcher.tick({ left: 'fist', right: 'fist' }, 5000);
    expect(fired).toHaveLength(1);
  });

  it('an unknown command id is surfaced as an error toast and never dispatched', async () => {
    const { fired, notices, dispatcher } = makeHarness({
      known: () => false,
      prefs: { holdMs: 100, bindings: { fist: { command: 'nope.missing.cmd' } } },
    });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('fist'), 100);
    await flush();
    expect(fired).toHaveLength(0);
    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe('error');
    expect(notices[0].message).toContain('nope.missing.cmd');
  });

  it('a confirmation-gated (destructive) command is refused, never dispatched', async () => {
    const { fired, notices, dispatcher } = makeHarness({
      prefs: { holdMs: 100, bindings: { fist: { command: 'instrument.load', args: { name: 'x' } } } },
    });
    dispatcher.tick(P('fist'), 0);
    dispatcher.tick(P('fist'), 100);
    await flush();
    expect(fired).toHaveLength(0); // a hands-free flow cannot answer a confirmation dialog
    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe('error');
    expect(notices[0].message).toMatch(/confirmation/i);
  });

  it('a successful fire toasts gesture + command title; a failed dispatch toasts the error', async () => {
    const good = makeHarness({ prefs: { holdMs: 100 } });
    good.dispatcher.tick(P('fist'), 0);
    good.dispatcher.tick(P('fist'), 100);
    await flush();
    expect(good.notices).toEqual([{ message: 'Fist → Title(test.fist.go)', level: 'info' }]);

    const bad = makeHarness({
      prefs: { holdMs: 100 },
      result: () => err('invalid_value', 'Nope, out of range.'),
    });
    bad.dispatcher.tick(P('fist'), 0);
    bad.dispatcher.tick(P('fist'), 100);
    await flush();
    expect(bad.fired).toHaveLength(1); // it DID dispatch; the registry refused it
    expect(bad.notices).toEqual([{ message: 'Fist: Nope, out of range.', level: 'error' }]);
  });
});

describe('the shipped default bindings (#129)', () => {
  it('every default binding names a REAL, gesture-bindable registry command with schema-valid args', () => {
    const registry = createThoreminRegistry();
    const prefs = defaultGesturePrefs();
    const bound = Object.entries(prefs.bindings);
    expect(bound.length).toBeGreaterThanOrEqual(2); // fist + pinch ship bound
    for (const [gesture, binding] of bound) {
      expect(isGestureId(gesture), `"${gesture}" must be a bindable gesture id`).toBe(true);
      const cmd = registry.get(binding.command);
      expect(cmd, `${gesture} → "${binding.command}" must exist in the registry`).toBeTruthy();
      expect(
        isGestureBindable(binding.command),
        `${gesture} → "${binding.command}" must not be confirmation-gated`,
      ).toBe(true);
      // The fixed args must satisfy the command's own param schema — a default
      // binding that fires straight into a validation error is not a default.
      expect(
        () => (cmd!.params as { parse(v: unknown): unknown }).parse(binding.args ?? {}),
        `${gesture} → "${binding.command}" default args must parse`,
      ).not.toThrow();
    }
    // `open` ships deliberately UNBOUND: an open palm is the natural playing
    // posture, so a default binding on it would fire during normal play.
    expect(prefs.bindings.open).toBeUndefined();
    expect(GESTURE_IDS).toContain('open'); // ...but it stays a bindable gesture
  });

  it('gestures are disabled by default (a camera must not fire commands unasked)', () => {
    expect(defaultGesturePrefs().enabled).toBe(false);
  });
});

describe('the classifier output reaches the app dispatch path (the #137-style guard)', () => {
  it('useEngine reads the mounted gesture node and ticks the dispatcher', () => {
    // The graph half (node mounted + fed by `feat`) is asserted structurally in
    // app_graph.test.ts. This is the other half MIDI-out shipped without (#120/#137):
    // the app actually READING the output. A rewiring that drops either line makes
    // the gesture feature silently unreachable while every unit test stays green.
    const src = readFileSync(resolve(process.cwd(), 'src/app/useEngine.ts'), 'utf8');
    expect(src).toMatch(/getOutput\(\s*'gesture'\s*,\s*'poses'\s*\)/);
    expect(src).toMatch(/createGestureDispatcher\(/);
    expect(src).toMatch(/gestureDispatcher\.tick\(/);
    expect(src).toMatch(/reportGesture\(t\)/); // wired into the rAF loop, not just defined
  });
});
