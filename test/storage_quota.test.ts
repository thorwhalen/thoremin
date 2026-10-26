// @vitest-environment jsdom
/**
 * A full localStorage must not break the hot store (#738): zustand's persist middleware writes
 * synchronously inside every `set(...)`, after the in-memory state changed, so a throwing
 * `setItem` used to come out of each action (and stop the engine starting).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestEffortWrites, memoryValues } from '@thoremin/sdk-ui/storage';
import { useControls } from '@/app/store';

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
