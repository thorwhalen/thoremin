// @vitest-environment jsdom
/**
 * A full localStorage must not break the hot store (#738): zustand's persist middleware writes
 * synchronously inside every `set(...)`, after the in-memory state changed, so a throwing
 * `setItem` used to come out of each action (and stop the engine starting).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestEffortWrites, hostPersistValues, localStorageCollectionProvider, memoryValues, noopValues, provideStorage, skipUnchangedWrites } from '@thoremin/sdk-ui/storage';
import { useControls } from '@/app/store';
import { useVoice } from '@thoremin/sdk-ui/enroll/voiceRuntime';
import { useTrainerPrefs } from '@/slices/trainer/app/prefs';
import { useCategoryBinding } from '@/app/enroll/categoryBinding';
import { writeInstrumentMeta } from '@/app/library/store';
import { trySetStoredKey, getStoredKey } from '@/keys/providerKeys';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const quota = () => new DOMException('full', 'QuotaExceededError');

describe('bestEffortWrites', () => {
  it('swallows write failures, warns once, and still reads', () => {
    const inner = memoryValues();
    inner.setItem('a', '1');
    vi.spyOn(inner, 'setItem').mockImplementation(() => {
      throw quota();
    });
    const warn = vi.fn();
    const s = bestEffortWrites(inner, warn);
    expect(() => s.setItem('b', '2')).not.toThrow();
    expect(() => s.setItem('c', '3')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(s.getItem('a')).toBe('1');
  });
});

describe('the hot store with a full localStorage', () => {
  it('actions do not throw and the state still changes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota();
    });
    expect(() => useControls.getState().setGraphElements(['x'])).not.toThrow();
    expect(() => useControls.getState().setMuted(true)).not.toThrow();
    expect(useControls.getState().muted).toBe(true);
    useControls.getState().setMuted(false);
  });
});

describe('every persist store survives a full localStorage (#823)', () => {
  const full = () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota();
    });
  };

  it.each([
    ['trainer prefs', () => useTrainerPrefs.getState().setRecordTake(false), () => useTrainerPrefs.getState().recordTake, false],
    ['voice prefs', () => useVoice.getState().setEnabled(true), () => useVoice.getState().enabled, true],
    ['category binding', () => useCategoryBinding.getState().setHoldMs(321), () => useCategoryBinding.getState().holdMs, 321],
  ] as const)('%s: the action does not throw and the state changes', (_name, act, read, expected) => {
    full();
    expect(act).not.toThrow();
    expect(read()).toBe(expected);
  });
});

describe('an API key that could not be stored is reported, not swallowed (#823)', () => {
  it('returns the reason, and nothing was saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota();
    });
    expect(trySetStoredKey('openai', 'k')).toMatch(/not saved/);
    vi.restoreAllMocks();
    expect(getStoredKey('openai')).toBeNull();
  });

  it('returns null when it was saved', () => {
    expect(trySetStoredKey('openai', ' k ')).toBeNull();
    expect(getStoredKey('openai')).toBe('k');
  });
});

describe('the instrument metadata blob (#823)', () => {
  it('a full storage drops the write; it never rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota();
    });
    await expect(writeInstrumentMeta({})).resolves.toBeUndefined();
  });
});

describe('two tabs over one localStorage (#739)', () => {
  it("a tab's transient-only set does not write its stale blob over the other tab's saved pref", async () => {
    vi.resetModules();
    const A = await import('@/app/store');
    vi.resetModules();
    const B = await import('@/app/store');
    const stored = () => JSON.parse(localStorage.getItem('thoremin-controls') ?? '{}').state as Record<string, unknown>;

    // B's first write is its own (it may have healed or migrated the blob); then it is in sync with storage.
    B.useControls.getState().setMasterVolume(0.31);
    // Tab A learns a lead offset and saves it.
    A.useControls.getState().setPref('conductorPrefs', { leadOffsets: { wrist: 0.05 } });
    expect((stored().conductorPrefs as { leadOffsets: Record<string, number> }).leadOffsets.wrist).toBe(0.05);

    // Tab B only switches instrument (a transient): it must not touch the saved blob.
    B.useControls.getState().setGraphElements(['x']);
    expect((stored().conductorPrefs as { leadOffsets: Record<string, number> }).leadOffsets.wrist).toBe(0.05);
  });
});

describe('skipUnchangedWrites', () => {
  const counting = () => {
    const inner = memoryValues();
    const set = vi.spyOn(inner, 'setItem');
    return { inner, set };
  };

  it('skips a write of what it last wrote or read, and passes a change', () => {
    const { inner, set } = counting();
    inner.setItem('a', '1');
    set.mockClear();
    const s = skipUnchangedWrites(inner);
    s.getItem('a');
    s.setItem('a', '1');
    expect(set).not.toHaveBeenCalled();
    s.setItem('a', '2');
    s.setItem('a', '2');
    expect(set).toHaveBeenCalledTimes(1);
    s.setItem('a', '1'); // back to an older value is a change
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('a failed write is not remembered, so the next one is tried again', () => {
    const { inner, set } = counting();
    const s = skipUnchangedWrites(inner);
    set.mockImplementationOnce(() => {
      throw quota();
    });
    expect(() => s.setItem('a', '1')).toThrow();
    s.setItem('a', '1');
    expect(inner.getItem('a')).toBe('1');
  });

  it('a removed key is written again; a changed scope forgets what it knew', () => {
    const { inner, set } = counting();
    let scope = 'one';
    const s = skipUnchangedWrites(inner, () => scope);
    s.setItem('a', '1');
    s.removeItem('a');
    s.setItem('a', '1');
    expect(set).toHaveBeenCalledTimes(2);
    scope = 'two';
    s.setItem('a', '1');
    expect(set).toHaveBeenCalledTimes(3);
  });
});

describe('hostPersistValues follows a swapped host', () => {
  it('a value written before the swap is written again to the new target', () => {
    const first = memoryValues();
    const second = memoryValues();
    provideStorage({ collection: localStorageCollectionProvider, values: () => first });
    const s = hostPersistValues(noopValues);
    s.setItem('k', 'v');
    provideStorage({ collection: localStorageCollectionProvider, values: () => second });
    s.setItem('k', 'v');
    expect(second.getItem('k')).toBe('v');
    provideStorage(null);
  });
});
