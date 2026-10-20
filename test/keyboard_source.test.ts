/**
 * The `keyboard-source` node: global key events become `held` plus the `pressed` and
 * `released` edges since the previous tick. Driven through a fake event target, so the
 * node's own buffering is what is tested: no edge lost between ticks, auto-repeat not a
 * new press, typing in a text field not played, the scrolling keys kept from the page.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { keyboardSourceNode } from '@/nodes/sources/keyboard';

type Listener = (e: unknown) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

function setup(params: Record<string, unknown> = {}) {
  const target = fakeTarget();
  const node = keyboardSourceNode.make(keyboardSourceNode.params.parse(params));
  const ctx = { tick: 0, time: 0, dt: 0, resources: { window: target } } as unknown as NodeContext;
  node.init!(ctx);
  const send = (type: 'keydown' | 'keyup', key: string, eventTarget: unknown = null) => {
    const e = { key, target: eventTarget, prevented: false, preventDefault() { e.prevented = true; } };
    for (const fn of target.listeners.get(type) ?? []) fn(e);
    return e;
  };
  const tick = () => node.process!({}, ctx) as { held: string[]; pressed: string[]; released: string[] };
  return { node, target, send, tick };
}

describe('the keyboard-source node', () => {
  it('emits held keys and the edges since the last tick, then clears the edges', () => {
    const { send, tick } = setup();
    send('keydown', 'a');
    send('keydown', 'b');
    expect(tick()).toEqual({ held: ['a', 'b'], pressed: ['a', 'b'], released: [] });
    expect(tick()).toEqual({ held: ['a', 'b'], pressed: [], released: [] });
    send('keyup', 'a');
    expect(tick()).toEqual({ held: ['b'], pressed: [], released: ['a'] });
  });

  it('keeps a press and release that both happen between two ticks', () => {
    const { send, tick } = setup();
    send('keydown', 'x');
    send('keyup', 'x');
    expect(tick()).toEqual({ held: [], pressed: ['x'], released: ['x'] });
  });

  it('an auto-repeated keydown is not a new press', () => {
    const { send, tick } = setup();
    send('keydown', 'm');
    send('keydown', 'm');
    send('keydown', 'm');
    expect(tick().pressed).toEqual(['m']);
    send('keydown', 'm');
    expect(tick().pressed).toEqual([]);
  });

  it('prevents the default of the scrolling keys only', () => {
    const { send } = setup();
    expect(send('keydown', 'ArrowUp').prevented).toBe(true);
    expect(send('keydown', ' ').prevented).toBe(true);
    expect(send('keydown', 'a').prevented).toBe(false);
  });

  it('prevents the keys a caller names instead of the defaults', () => {
    const { send } = setup({ preventDefaultKeys: ['q'] });
    expect(send('keydown', 'q').prevented).toBe(true);
    expect(send('keydown', 'ArrowUp').prevented).toBe(false);
  });

  it('ignores typing in a text field, but a release there still clears the key', () => {
    const { send, tick } = setup();
    const input = { tagName: 'INPUT' };
    const ev = send('keydown', 'ArrowUp', input);
    expect(ev.prevented).toBe(false);
    expect(tick()).toEqual({ held: [], pressed: [], released: [] });
    send('keydown', 'k');
    send('keyup', 'k', { tagName: 'TEXTAREA' });
    expect(tick().held).toEqual([]);
    expect(send('keydown', 'z', { tagName: 'DIV', isContentEditable: true }).prevented).toBe(false);
    expect(tick().pressed).toEqual([]);
  });

  it('listens on the window it is handed', () => {
    const { target } = setup();
    expect(target.count('keydown')).toBe(1);
    expect(target.count('keyup')).toBe(1);
  });

  it('falls back to no window at all without throwing (a headless run)', () => {
    const node = keyboardSourceNode.make(keyboardSourceNode.params.parse({}));
    const ctx = { tick: 0, time: 0, dt: 0, resources: {} } as unknown as NodeContext;
    expect(() => node.init!(ctx)).not.toThrow();
    expect(node.process!({}, ctx)).toEqual({ held: [], pressed: [], released: [] });
    expect(() => node.dispose!()).not.toThrow();
  });

  // dispose() removes its listeners from `globalThis.window`, while init() added them to
  // `ctx.resources.window` when one is handed. The app hands the real window, so the two
  // agree there; a host (or a test) that hands another target keeps the listeners alive
  // after dispose (#748). Flip to `it` when dispose uses the target init used.
  it.fails('dispose removes its listeners from the window it was handed', () => {
    const { node, target } = setup();
    node.dispose!();
    expect(target.count('keydown')).toBe(0);
    expect(target.count('keyup')).toBe(0);
  });
});
