/**
 * Recording sink-selection (#88): the pure capability→backend decision and the
 * Node-safe capability probe. The actual sink I/O is browser-only (build-checked).
 */
import { describe, it, expect } from 'vitest';
import { chooseSinkKind, detectCaps, type RecordingCaps } from '@/app/recording/caps';

const caps = (over: Partial<RecordingCaps> = {}): RecordingCaps => ({
  directoryPicker: false,
  filePicker: false,
  ...over,
});

describe('chooseSinkKind', () => {
  it('uses a real folder when the directory picker exists', () => {
    expect(chooseSinkKind('directory', caps({ directoryPicker: true }))).toBe('directory');
  });
  it('degrades a directory request to a zip when unsupported', () => {
    expect(chooseSinkKind('directory', caps())).toBe('zip');
  });
  it('always zips for the downloads preference', () => {
    expect(chooseSinkKind('downloads', caps({ directoryPicker: true }))).toBe('zip');
    expect(chooseSinkKind('downloads', caps())).toBe('zip');
  });
});

describe('detectCaps', () => {
  it('reports no pickers under the Node test runtime (no globals)', () => {
    const c = detectCaps();
    expect(c.directoryPicker).toBe(false);
    expect(c.filePicker).toBe(false);
  });
});
