/**
 * The score producer as a mount effect (`startScoreContext`): it follows the loaded score
 * (`scoreDoc`) through the SDK's controls host, publishes its timeline as the timeline in force,
 * played by the conductor's clock, reads it from the device cache by content key the second time,
 * withdraws it when the score goes, and drops a load overtaken by a newer score.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provideControls, type ControlsHost } from '@thoremin/sdk-ui/host';
import { musicxmlToScoreDoc } from '@thoremin/music-formats/musicxml';
import { memoryContextCache, type ContextCache } from '@thoremin/sdk/context/cache';
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { startScoreContext } from '@/slices/music-context/app/scoreContext';
import { MUSIC } from '../helpers/extensions';

const study = () => musicxmlToScoreDoc(new Uint8Array(readFileSync(join(__dirname, '..', '..', 'public', 'scores', 'modulation-study.musicxml'))));

/** A controls host over a plain object, with transients written back into it. */
function fakeControls(initial: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { ...initial };
  const listeners = new Set<() => void>();
  const host: ControlsHost = {
    get: () => state,
    setTransient: (field, value) => {
      state = { ...state, [field]: value };
      for (const l of [...listeners]) l();
    },
    setHush: () => {},
    setPref: () => {},
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
  provideControls(host);
  return {
    active: () => (state.musicContextActive as ActiveContext | null | undefined) ?? null,
    set(patch: Record<string, unknown>) {
      state = { ...state, ...patch };
      for (const l of [...listeners]) l();
    },
  };
}

/** Wait until `done()` or give up after a few hundred event-loop turns. */
async function until(done: () => boolean) {
  for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 0));
}

/** A memory cache that counts its writes. */
function countingCache(): ContextCache & { writes: number } {
  const inner = memoryContextCache();
  const c = { writes: 0, get: inner.get, set: async (k: string, v: Parameters<ContextCache['set']>[1]) => (c.writes++, inner.set(k, v)) };
  return c;
}

describe.runIf(MUSIC)('the score producer effect', () => {
  it('publishes the loaded score as the timeline in force, on the conductor\'s clock, and withdraws it', async () => {
    const host = fakeControls();
    const cache = countingCache();
    const stop = startScoreContext({ cache });
    expect(host.active()).toBeNull();
    host.set({ scoreDoc: study() });
    await until(() => host.active() !== null);
    expect(host.active()).toMatchObject({ clock: 'conductor', context: { source: 'score' } });
    expect(host.active()!.context.keys.map((k) => k.tonic)).toEqual([0, 7, 5]);
    expect(host.active()!.context.contentKey).toMatch(/^sha256:/);
    expect(cache.writes).toBe(1);
    host.set({ scoreDoc: null });
    await until(() => host.active() === null);
    expect(host.active()).toBeNull();
    // The same score again: from the cache, not produced and stored twice.
    host.set({ scoreDoc: study() });
    await until(() => host.active() !== null);
    expect(cache.writes).toBe(1);
    stop();
    expect(host.active()).toBeNull();
  });

  it('drops a load overtaken by a newer score', async () => {
    const host = fakeControls();
    const stop = startScoreContext({ cache: memoryContextCache() });
    const first = study();
    const second = { ...study(), keys: [{ beat: 0, fifths: 2, mode: 'major' as const }] };
    host.set({ scoreDoc: first });
    host.set({ scoreDoc: second });
    await until(() => host.active() !== null);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.active()!.context.keys.map((k) => k.tonic)).toEqual([2]);
    stop();
  });
});
