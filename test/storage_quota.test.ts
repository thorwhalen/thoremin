// @vitest-environment jsdom
/**
 * A full localStorage must not break the hot store (#738): zustand's persist middleware writes
 * synchronously inside every `set(...)`, after the in-memory state changed, so a throwing
 * `setItem` used to come out of each action (and stop the engine starting).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestEffortWrites, memoryValues } from '@thoremin/sdk-ui/storage';
import { useControls } from '@/app/store';
import { useVoice } from '@thoremin/sdk-ui/enroll/voiceRuntime';
import { useTrainerPrefs } from '@/slices/trainer/app/prefs';
import { useCategoryBinding } from '@/app/enroll/categoryBinding';
import { trySetStoredKey, getStoredKey } from '@/keys/providerKeys';

afterEach(() => vi.restoreAllMocks());

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
    localStorage.clear();
  });
});
