/**
 * The general readout store (#969): one factory gives any node readout its store (the status under
 * `status` or a named field), its reporter gated by the readout's own key (with an optional
 * throttle for a counter that moves at frame rate, MIDI's) and its status hook, whose sink reports a
 * node that returns after a reset with the status it left with.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeStatusGate } from '@thoremin/lazy/status';
import { createStatusStore } from '@thoremin/sdk-ui/statusStore';

interface Reading {
  on: boolean;
  level: number;
  count: number;
}

const IDLE: Reading = { on: false, level: 0, count: 0 };
const keyOf = (r: Reading) => `${r.on ? 1 : 0}|${Math.round(r.level * 10)}`;

const engineSaying = (nodeId: string, port: string, value: () => unknown) => ({
  getOutput: vi.fn((node: string, p: string) => (node === nodeId && p === port ? value() : undefined)),
});

describe('makeStatusGate', () => {
  it('passes a status whose key changed and holds one whose key did not', () => {
    const pass = makeStatusGate({ keyOf });
    expect(pass({ on: true, level: 0.5, count: 0 }, 0)).toBe(true);
    expect(pass({ on: true, level: 0.52, count: 9 }, 1)).toBe(false);
    expect(pass({ on: true, level: 0.7, count: 9 }, 2)).toBe(true);
  });

  it('paces a change in the throttled key alone, never a change in the main key', () => {
    const pass = makeStatusGate({ keyOf, throttle: { ms: 250, keyOf: (r: Reading) => String(r.count) } });
    expect(pass({ on: true, level: 0, count: 0 }, 0)).toBe(true);
    expect(pass({ on: true, level: 0, count: 1 }, 100)).toBe(false);
    expect(pass({ on: true, level: 0, count: 1 }, 250)).toBe(true);
    expect(pass({ on: true, level: 0, count: 2 }, 260)).toBe(false);
    expect(pass({ on: false, level: 0, count: 2 }, 270)).toBe(true);
    expect(pass({ on: false, level: 0, count: 2 }, 900)).toBe(false);
  });
});

describe('createStatusStore', () => {
  it('holds the status under the named field: absent, reported, reset', () => {
    const { useStatus } = createStatusStore('n', { absent: IDLE, keyOf, field: 'live' });
    expect(useStatus.getState().live).toBe(IDLE);
    const on = { on: true, level: 1, count: 0 };
    useStatus.getState().report(on);
    expect(useStatus.getState().live).toBe(on);
    useStatus.getState().reset();
    expect(useStatus.getState().live).toBe(IDLE);
  });

  it('keeps it under `status` by default', () => {
    const { useStatus } = createStatusStore('n', { absent: IDLE, keyOf });
    expect(useStatus.getState().status).toBe(IDLE);
  });

  it('the reporter reads the node on its port and writes only what the readout would change', () => {
    let current: Reading | undefined;
    const store = createStatusStore('reader', { absent: IDLE, keyOf, port: 'readout' });
    const engine = engineSaying('reader', 'readout', () => current);
    const writes: Reading[] = [];
    const report = store.makeReporter(engine, { report: (r) => writes.push(r) });
    report();
    current = { on: true, level: 0.5, count: 0 };
    report();
    current = { ...current, count: 3 };
    report();
    expect(writes).toEqual([{ on: true, level: 0.5, count: 0 }]);
    expect(engine.getOutput).toHaveBeenCalledWith('reader', 'readout');
  });

  it('the hook shows the node absent when it leaves, and reports it again when it returns unchanged', () => {
    const on: Reading = { on: true, level: 0.5, count: 0 };
    let current: Reading | undefined = on;
    const store = createStatusStore('n', { absent: IDLE, keyOf, field: 'live' });
    const sink = store.statusHook.make(engineSaying('n', 'status', () => current), () => ({}));
    expect(store.statusHook.nodeId).toBe('n');
    sink(0);
    expect(store.useStatus.getState().live).toBe(on);
    store.statusHook.onRemoved();
    current = undefined;
    sink(1);
    expect(store.useStatus.getState().live).toBe(IDLE);
    current = on;
    sink(2);
    expect(store.useStatus.getState().live).toBe(on);
    store.statusHook.reset();
    sink(3);
    expect(store.useStatus.getState().live).toBe(on);
  });

  it('the hook passes the tick time to a throttled reporter', () => {
    let current: Reading = { on: true, level: 0, count: 0 };
    const store = createStatusStore('n', { absent: IDLE, keyOf, throttle: { ms: 250, keyOf: (r) => String(r.count) } });
    const sink = store.statusHook.make(engineSaying('n', 'status', () => current), () => ({}));
    sink(0);
    current = { ...current, count: 4 };
    sink(100);
    expect(store.useStatus.getState().status.count).toBe(0);
    sink(300);
    expect(store.useStatus.getState().status.count).toBe(4);
  });
});
