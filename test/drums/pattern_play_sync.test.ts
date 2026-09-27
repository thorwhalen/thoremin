/**
 * The pattern-in-play sync (#269): the `airDrum.pattern` dial names a pattern; the sync
 * loads its trained model and publishes {pattern, model} for the node, null for no
 * pattern or one without a model, drops a stale load when the dial moved on, and
 * publishes null on stop.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolvePatternPlay, startPatternPlaySync } from '@/extensions/air/app/patternPlaySync';
import type { PatternModel } from '@/drums/pattern_fit';
import type { PatternPlay } from '@/drums/pattern_play';

const model = (id: string): PatternModel => ({ v: 1, patternId: id, bpm: 96, statedBpm: 96, passes: 4, feel: {}, positions: {}, recall: 1, precision: 1, takenAt: 0 });

function fakeStore(initial: string) {
  let state = { airDrum: { pattern: initial } };
  const listeners = new Set<(s: typeof state) => void>();
  return {
    getState: () => state,
    subscribe: (l: (s: typeof state) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set: (pattern: string) => {
      state = { airDrum: { pattern } };
      listeners.forEach((l) => l(state));
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the pattern-in-play sync', () => {
  it('resolves a dial value to the pattern and its model, or null', async () => {
    const load = async (id: string) => (id === 'rock' ? model('rock') : null);
    expect((await resolvePatternPlay('rock', load))?.pattern.id).toBe('rock');
    expect(await resolvePatternPlay('half-time', load)).toBeNull();
    expect(await resolvePatternPlay('', load)).toBeNull();
    expect(await resolvePatternPlay('no-such', load)).toBeNull();
  });

  it('publishes on start and on every change of the dial, and null on stop', async () => {
    const store = fakeStore('rock');
    const published: (PatternPlay | null)[] = [];
    const load = vi.fn(async (id: string) => (id === 'rock' || id === 'fill' ? model(id) : null));
    const stop = startPatternPlaySync({ store, publish: (p) => published.push(p), load });
    await tick();
    expect(published.map((p) => p?.pattern.id ?? null)).toEqual(['rock']);
    store.set('rock'); // unchanged: nothing
    store.set('fill');
    await tick();
    expect(published.map((p) => p?.pattern.id ?? null)).toEqual(['rock', 'fill']);
    store.set('half-time'); // no model
    await tick();
    expect(published.at(-1)).toBeNull();
    expect(load).toHaveBeenCalledTimes(3);
    stop();
    expect(published.at(-1)).toBeNull();
    store.set('rock');
    await tick();
    expect(published).toHaveLength(4);
  });

  it('drops a load the dial has moved past', async () => {
    const store = fakeStore('');
    const published: (PatternPlay | null)[] = [];
    let release: (() => void) | null = null;
    const load = (id: string) =>
      id === 'rock'
        ? new Promise<PatternModel | null>((r) => {
            release = () => r(model('rock'));
          })
        : Promise.resolve(model(id));
    startPatternPlaySync({ store, publish: (p) => published.push(p), load });
    await tick();
    store.set('rock'); // slow load, pending
    store.set('fill'); // moves on
    await tick();
    release!();
    await tick();
    expect(published.map((p) => p?.pattern.id ?? null)).toEqual([null, 'fill']);
  });
});
