/**
 * The dispatch middleware seam and its three consumers (#127) — undo/redo, the
 * telemetry journal, and command export/replay.
 *
 * The load-bearing assertions here are the ones that would go quietly wrong:
 *
 *  - **Order.** The confirmation gate must be OUTERMOST, so a command that was blocked
 *    (and therefore never ran) leaves no journal entry and no undo step. Get that
 *    backwards and undo starts "reverting" writes that never happened.
 *  - **`UNSET` is a symbol.** A `Layer` value can be the dials-core UNSET sentinel.
 *    `structuredClone` throws on symbols and `JSON.stringify` silently DROPS them — so
 *    the naive implementations of both clone and compare fail on exactly the case
 *    (an explicitly-unset dial) that is hardest to notice.
 *  - **The round trip.** The proof #127 asks for: dispatch a scripted sequence,
 *    serialize it, replay against a reset layer, assert the resulting `Layer` is
 *    deep-equal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UNSET } from '@zodal/dials-core';
import type { Layer } from '@zodal/dials-core';
import { dialsStore } from '@/app/dials/settingsStore';
import {
  composeMiddleware,
  installMiddleware,
  createJournal,
  replayJournal,
  createDialsHistory,
  layersEqual,
  createThoreminRegistry,
  confirmationGate,
  createApprovalStore,
  defaultGetRisk,
  type Dispatch,
  type Middleware,
} from '@/app/commands';

/** A registry wired exactly like the app singleton: gate → history → journal. */
function wiredRegistry() {
  const registry = createThoreminRegistry();
  const approvals = createApprovalStore();
  const history = createDialsHistory(dialsStore);
  const journal = createJournal({ now: () => 0 });
  const dispose = installMiddleware(
    registry,
    confirmationGate(defaultGetRisk, approvals),
    history.middleware,
    journal.middleware,
  );
  return { registry, approvals, history, journal, dispose };
}

beforeEach(() => {
  dialsStore.setLayer({});
});

describe('composeMiddleware / installMiddleware', () => {
  it('runs the FIRST middleware outermost', async () => {
    const order: string[] = [];
    const tag = (name: string): Middleware => (next) => async (c, p, ctx, ...rest) => {
      order.push(`${name}:in`);
      const r = await next(c, p, ctx, ...rest);
      order.push(`${name}:out`);
      return r;
    };
    const base: Dispatch = async () => ({ ok: true, value: null }) as never;
    await composeMiddleware(tag('a'), tag('b'), tag('c'))(base)('x');
    expect(order).toEqual(['a:in', 'b:in', 'c:in', 'c:out', 'b:out', 'a:out']);
  });

  it('dispose restores the original dispatch', async () => {
    const registry = createThoreminRegistry();
    const before = registry.dispatch;
    const seen: string[] = [];
    const dispose = installMiddleware(registry, (next) => async (c, p, ctx, ...rest) => {
      seen.push(c);
      return next(c, p, ctx, ...rest);
    });
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    expect(seen).toEqual(['dial.set']);
    dispose();
    expect(registry.dispatch).toBe(before);
    await registry.dispatch('dial.set', { key: 'right.root', value: 7 });
    expect(seen).toEqual(['dial.set']); // not recorded again
  });
});

describe('the journal (#127 telemetry + export)', () => {
  it('records successful and failed dispatches, with the error code and the channel', async () => {
    const { registry, journal } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    await registry.dispatch('dial.set', { key: 'nope.nope', value: 1 });
    await registry.dispatch('dial.set', { key: 'right.root', value: 3 }, { channel: 'assistant' });

    const entries = journal.entries();
    expect(entries.map((e) => e.command)).toEqual(['dial.set', 'dial.set', 'dial.set']);
    expect(entries.map((e) => e.ok)).toEqual([true, false, true]);
    expect(entries[1].code).toBe('unknown_dial');
    expect(entries[2].channel).toBe('assistant');
    // The failures are the interesting half for a bug report, but not for a replay.
    expect(journal.replayable().map((e) => e.ok)).toEqual([true, true]);
  });

  it('is a bounded ring buffer — the oldest entries fall off', async () => {
    const journal = createJournal({ limit: 3, now: () => 0 });
    const base: Dispatch = async () => ({ ok: true, value: null }) as never;
    const d = journal.middleware(base);
    for (const v of [1, 2, 3, 4, 5]) await d('dial.set', { value: v });
    expect(journal.entries()).toHaveLength(3);
    expect(journal.entries().map((e) => (e.params as { value: number }).value)).toEqual([3, 4, 5]);
  });

  it('exports a versioned envelope and clears', async () => {
    const { registry, journal } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    expect(journal.toJSON().version).toBe(1);
    expect(journal.toJSON().entries).toHaveLength(1);
    journal.clear();
    expect(journal.entries()).toEqual([]);
  });
});

describe('command export → replay round trip (the #127 proof)', () => {
  it('replaying a serialized session reproduces the exact same Layer', async () => {
    const { registry, journal } = wiredRegistry();

    // A scripted session touching all four write verbs.
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    await registry.dispatch('dial.setIn', { path: 'overlay.landmarks.show', value: false });
    await registry.dispatch('dial.patch', {
      writes: [
        { key: 'left.root', value: 7 },
        { key: 'left.octaves', value: 3 },
      ],
    });
    await registry.dispatch('dial.set', { key: 'master.volume', value: 0.42 });
    await registry.dispatch('dial.reset', { key: 'right.root' });

    const expected: Layer = JSON.parse(JSON.stringify(dialsStore.getState().layer));
    const wire = JSON.parse(JSON.stringify(journal.toJSON())) as ReturnType<typeof journal.toJSON>;

    // Replay against a FRESH layer, through a separate registry.
    dialsStore.setLayer({});
    expect(dialsStore.getState().layer).not.toEqual(expected);

    const { registry: replayRegistry } = wiredRegistry();
    const report = await replayJournal(wire.entries, replayRegistry);

    expect(report.failed).toEqual([]);
    expect(report.applied).toBe(wire.entries.length);
    expect(dialsStore.getState().layer).toEqual(expected);
  });
});

describe('undo/redo over the dials layer (#127)', () => {
  it('undoes and redoes a single dial write', async () => {
    const { registry, history } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    expect(dialsStore.getState().effective['right.root']).toBe(5);

    expect(history.canUndo()).toBe(true);
    expect(history.undoLabel()).toBe('dial.set');
    expect(history.undo()).toBe(true);
    expect(dialsStore.getState().layer['right.root']).toBeUndefined();

    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(dialsStore.getState().effective['right.root']).toBe(5);
  });

  it('treats an atomic dial.patch as ONE undo entry', async () => {
    const { registry, history } = wiredRegistry();
    await registry.dispatch('dial.patch', {
      writes: [
        { key: 'left.root', value: 7 },
        { key: 'left.octaves', value: 3 },
      ],
    });
    expect(history.size()).toBe(1);
    history.undo();
    // Both halves of the mirrored write come back, not one.
    expect(dialsStore.getState().layer['left.root']).toBeUndefined();
    expect(dialsStore.getState().layer['left.octaves']).toBeUndefined();
  });

  it('undoes a structured-dial leaf write (dial.setIn)', async () => {
    const { registry, history } = wiredRegistry();
    const before = dialsStore.getState().effective['overlay'];
    await registry.dispatch('dial.setIn', { path: 'overlay.landmarks.show', value: false });
    expect((dialsStore.getState().effective['overlay'] as { landmarks: { show: boolean } }).landmarks.show).toBe(false);
    history.undo();
    expect(dialsStore.getState().effective['overlay']).toEqual(before);
  });

  it('opens no entry for a FAILED command', async () => {
    const { registry, history } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    await registry.dispatch('dial.set', { key: 'right.octaves', value: 999 }); // out of range
    expect(history.size()).toBe(1);
    expect(history.undoLabel()).toBe('dial.set');
    history.undo();
    expect(dialsStore.getState().layer['right.root']).toBeUndefined();
  });

  it('opens no entry for a write that changed nothing', async () => {
    const { registry, history } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    expect(history.size()).toBe(1);
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 }); // same value
    expect(history.size()).toBe(1);
  });

  it('a new change discards the redo future', async () => {
    const { registry, history } = wiredRegistry();
    await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    history.undo();
    expect(history.canRedo()).toBe(true);
    await registry.dispatch('dial.set', { key: 'left.root', value: 2 });
    expect(history.canRedo()).toBe(false);
  });

  it('is bounded by its limit', async () => {
    const { registry } = wiredRegistry();
    const history = createDialsHistory(dialsStore, { limit: 2 });
    const dispose = installMiddleware(registry, history.middleware);
    for (const v of [1, 2, 3, 4]) {
      await registry.dispatch('dial.set', { key: 'right.root', value: v });
    }
    expect(history.size()).toBe(2);
    dispose();
  });

  it('undo/redo are no-ops (not throws) on empty stacks', () => {
    const history = createDialsHistory(dialsStore);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

describe('order: the confirmation gate is outermost', () => {
  it('a BLOCKED assistant command is neither journaled nor undoable', async () => {
    const { registry, journal, history } = wiredRegistry();
    const blocked = await registry.dispatch(
      'instrument.save',
      { name: 'X' },
      { channel: 'assistant' },
    );
    expect(blocked.ok).toBe(false);
    // It never ran, so neither observer saw it.
    expect(journal.entries()).toEqual([]);
    expect(history.size()).toBe(0);
  });
});

describe('layersEqual is symbol-safe (guard the guard)', () => {
  it('does NOT treat an explicitly-UNSET dial as equal to an absent one', () => {
    // JSON.stringify drops a symbol value, so a stringify-based compare would call these
    // equal and undo would silently skip the write that unset the dial.
    expect(layersEqual({ 'right.root': UNSET } as Layer, {} as Layer)).toBe(false);
    expect(layersEqual({ 'right.root': UNSET } as Layer, { 'right.root': UNSET } as Layer)).toBe(true);
  });

  it('ignores key ORDER but not key SET', () => {
    expect(layersEqual({ a: 1, b: 2 } as unknown as Layer, { b: 2, a: 1 } as unknown as Layer)).toBe(true);
    expect(layersEqual({ a: 1 } as unknown as Layer, { a: 1, b: 2 } as unknown as Layer)).toBe(false);
  });

  it('compares nested structured values deeply', () => {
    const a = { overlay: { landmarks: { show: true }, video: { alpha: 0.5 } } } as unknown as Layer;
    const b = { overlay: { video: { alpha: 0.5 }, landmarks: { show: true } } } as unknown as Layer;
    const c = { overlay: { landmarks: { show: false }, video: { alpha: 0.5 } } } as unknown as Layer;
    expect(layersEqual(a, b)).toBe(true);
    expect(layersEqual(a, c)).toBe(false);
  });

  it('survives an UNSET dial through a full snapshot/undo cycle', async () => {
    const { registry, history } = wiredRegistry();
    dialsStore.setLayer({ 'right.root': UNSET } as Layer);
    // A clone that used structuredClone would THROW here rather than fail an assertion.
    await expect(registry.dispatch('dial.set', { key: 'left.root', value: 4 })).resolves.toMatchObject({ ok: true });
    expect(history.undo()).toBe(true);
    expect(dialsStore.getState().layer['right.root']).toBe(UNSET);
  });
});

describe('the keyboard entry point', () => {
  it('binds undo and redo in the default keymap', async () => {
    const { DEFAULT_KEYMAP } = await import('@/app/keyboardShortcuts');
    expect(Object.keys(DEFAULT_KEYMAP)).toEqual(
      expect.arrayContaining(['$mod+z', '$mod+Shift+z', '$mod+y']),
    );
    const undoSpy = vi.spyOn((await import('@/app/commands/registry')).history, 'undo');
    DEFAULT_KEYMAP['$mod+z']();
    expect(undoSpy).toHaveBeenCalled();
    undoSpy.mockRestore();
  });
});
