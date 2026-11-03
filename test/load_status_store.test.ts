/**
 * The shared load-status store (#957): one factory gives a heavy node's status store, its
 * change-gated reporter and its status hook, absent as null or as the node's own `off` words.
 */
import { describe, expect, it } from 'vitest';
import type { LoadStatus } from '@thoremin/lazy';
import { createLoadStatusStore } from '@thoremin/sdk-ui/loadStatusStore';

const engineSaying = (nodeId: string, status: () => LoadStatus | undefined) => ({
  getOutput: (node: string, port: string) => (node === nodeId && port === 'status' ? status() : undefined),
});

describe('createLoadStatusStore', () => {
  it('starts absent (null by default), reports, and resets', () => {
    const { useStatus } = createLoadStatusStore('n');
    expect(useStatus.getState().status).toBeNull();
    useStatus.getState().report({ phase: 'loading', message: 'Loading' });
    expect(useStatus.getState().status?.phase).toBe('loading');
    useStatus.getState().reset();
    expect(useStatus.getState().status).toBeNull();
  });

  it('holds the given absent status before a report and after the hook clears it', () => {
    const absent: LoadStatus = { phase: 'off', message: 'Off' };
    const store = createLoadStatusStore('n', { absent });
    expect(store.useStatus.getState().status).toEqual(absent);
    store.useStatus.getState().report({ phase: 'ready', message: 'Ready' });
    store.statusHook.onRemoved();
    expect(store.useStatus.getState().status).toEqual(absent);
    store.useStatus.getState().report({ phase: 'ready', message: 'Ready' });
    store.statusHook.reset();
    expect(store.useStatus.getState().status).toEqual(absent);
  });

  it('the reporter and the hook read the node, writing only on a change', () => {
    let current: LoadStatus | undefined;
    const store = createLoadStatusStore('gen');
    expect(store.statusHook.nodeId).toBe('gen');
    const writes: LoadStatus[] = [];
    const report = store.makeReporter(engineSaying('gen', () => current), { report: (s) => writes.push(s) });
    report();
    current = { phase: 'loading', message: 'Loading', progress: 0.5 };
    report();
    report();
    expect(writes).toHaveLength(1);
    const sink = store.statusHook.make(engineSaying('gen', () => current), () => ({}));
    sink(0);
    expect(store.useStatus.getState().status).toEqual(current);
  });
});
