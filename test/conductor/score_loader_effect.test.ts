/**
 * The conductor slice's score loader as a mount effect (`startScoreLoader`, #187 PR 3, #600
 * S18b): it follows the conductor dial through the SDK's controls host and hands the resolved
 * document to the graph. `score_loader.test.ts` pins the resolution itself (`resolvePiece`);
 * this file pins the effect around it, with the resolution stubbed: nothing loads while
 * conducting is off, a piece loads once per change, a change abandons the load in flight (its
 * late status and document are dropped), and the stop unsubscribes and abandons too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadStatus } from '@thoremin/lazy';
import { provideControls, type ControlsHost } from '@thoremin/sdk-ui/host';
import { CONDUCTOR } from '../helpers/extensions';

interface Pending {
  piece: string;
  status: (s: LoadStatus) => void;
  resolve: (doc: unknown) => void;
}
const pending: Pending[] = [];

vi.mock('@/slices/conductor/app/resolvePiece', () => ({
  fetchBytesFromUrl: vi.fn(),
  resolvePiece: vi.fn(
    (piece: string, _deps: unknown, status: (s: LoadStatus) => void) =>
      new Promise((resolve) => pending.push({ piece, status, resolve })),
  ),
}));

/** A controls host over a plain object, recording the transients written. */
function fakeControls(initial: Record<string, unknown>) {
  let state = { ...initial };
  const listeners = new Set<() => void>();
  const transients: [string, unknown][] = [];
  const host: ControlsHost = {
    get: () => state,
    setTransient: (field, value) => void transients.push([field, value]),
    setHush: () => {},
    setPref: () => {},
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
  provideControls(host);
  return {
    transients,
    listeners,
    set(patch: Record<string, unknown>) {
      state = { ...state, ...patch };
      for (const l of [...listeners]) l();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe.runIf(CONDUCTOR)('the score loader effect', () => {
  beforeEach(() => {
    pending.length = 0;
  });

  const load = async () => {
    const { startScoreLoader } = await import('@/slices/conductor/app/scoreLoader');
    const { getScoreStatus } = await import('@/slices/conductor/app/scoreStatus');
    return { startScoreLoader, getScoreStatus };
  };

  it('loads nothing while conducting is off, or with no conductor dial at all', async () => {
    const { startScoreLoader } = await load();
    const c = fakeControls({});
    const stop = startScoreLoader();
    c.set({ conductor: { enabled: false, piece: 'x' } });
    expect(pending).toEqual([]);
    stop();
  });

  it('resolves the piece when conducting turns on, and hands the document to the graph', async () => {
    const { startScoreLoader, getScoreStatus } = await load();
    const c = fakeControls({ conductor: { enabled: true, piece: 'demo-1' } });
    const stop = startScoreLoader();
    expect(pending.map((p) => p.piece)).toEqual(['demo-1']);
    pending[0].status({ phase: 'loading', message: 'Loading...' });
    expect(getScoreStatus()).toEqual({ phase: 'loading', message: 'Loading...' });
    const doc = { title: 'one' };
    pending[0].resolve(doc);
    await flush();
    expect(c.transients).toEqual([['scoreDoc', doc]]);
    stop();
  });

  it('an unrelated change does not reload; the same piece after a toggle does', async () => {
    const { startScoreLoader } = await load();
    const c = fakeControls({ conductor: { enabled: true } });
    const stop = startScoreLoader();
    expect(pending.map((p) => p.piece)).toEqual(['']); // no piece: the built-in one
    c.set({ other: 1 });
    c.set({ conductor: { enabled: true, piece: '' } });
    expect(pending).toHaveLength(1);
    c.set({ conductor: { enabled: false, piece: '' } });
    c.set({ conductor: { enabled: true, piece: '' } });
    expect(pending).toHaveLength(2);
    stop();
  });

  it('a new piece abandons the load in flight: its late status and document are dropped', async () => {
    const { startScoreLoader, getScoreStatus } = await load();
    const c = fakeControls({ conductor: { enabled: true, piece: 'a' } });
    const stop = startScoreLoader();
    c.set({ conductor: { enabled: true, piece: 'b' } });
    expect(pending.map((p) => p.piece)).toEqual(['a', 'b']);
    pending[1].status({ phase: 'ready', message: 'b' });
    pending[0].status({ phase: 'error', message: 'a failed late' });
    expect(getScoreStatus()).toEqual({ phase: 'ready', message: 'b' });
    pending[0].resolve({ title: 'a' });
    pending[1].resolve({ title: 'b' });
    await flush();
    expect(c.transients).toEqual([['scoreDoc', { title: 'b' }]]);
    stop();
  });

  it('turning conducting off abandons the load in flight', async () => {
    const { startScoreLoader } = await load();
    const c = fakeControls({ conductor: { enabled: true, piece: 'a' } });
    const stop = startScoreLoader();
    c.set({ conductor: { enabled: false, piece: 'a' } });
    pending[0].resolve({ title: 'a' });
    await flush();
    expect(c.transients).toEqual([]);
    stop();
  });

  it('the stop unsubscribes and abandons the load in flight', async () => {
    const { startScoreLoader } = await load();
    const c = fakeControls({ conductor: { enabled: true, piece: 'a' } });
    const stop = startScoreLoader();
    expect(c.listeners.size).toBe(1);
    stop();
    expect(c.listeners.size).toBe(0);
    pending[0].resolve({ title: 'a' });
    await flush();
    expect(c.transients).toEqual([]);
    c.set({ conductor: { enabled: true, piece: 'b' } });
    expect(pending).toHaveLength(1);
  });
});
