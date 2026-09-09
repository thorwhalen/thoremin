// @vitest-environment jsdom
/**
 * The shared BYO-key store (#188): the assistant and the lazily loaded Lyria engine
 * read the same key under the same historical storage key, so one pasted Google key
 * serves both and nothing a player saved before the move is orphaned.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getStoredKey, setStoredKey, removeStoredKey, keyStorageKey } from '@/keys/providerKeys';
import { getStoredKey as assistantGetStoredKey } from '@/plugins/assistant/providers';

afterEach(() => localStorage.clear());

describe('provider key store', () => {
  it('keeps the historical storage key, so keys saved by the assistant before the move still resolve', () => {
    expect(keyStorageKey('google')).toBe('thoremin:plugin:assistant:apiKey:google');
    localStorage.setItem('thoremin:plugin:assistant:apiKey:google', 'legacy-key');
    expect(getStoredKey('google')).toBe('legacy-key');
  });

  it('is the store the assistant reads (one key serves the assistant and Lyria)', () => {
    setStoredKey('google', '  abc  ');
    expect(assistantGetStoredKey('google')).toBe('abc');
    removeStoredKey('google');
    expect(getStoredKey('google')).toBeNull();
    expect(assistantGetStoredKey('google')).toBeNull();
  });
});
