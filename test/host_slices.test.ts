/**
 * Per-slice versioned migrations, the pure half (#600 S9; `src/host/slices.ts`): each extension
 * dial or pref runs its own chain from the stored version (absent: 1) to its own; a slice whose
 * key is absent adopts a legacy path; a value an older blob lacks is not migrated; a stored slice
 * no chain claims is foreign and carried with its version; the caller's blob is never edited.
 */
import { describe, expect, it, vi } from 'vitest';
import { migrateSlices, sliceChains, sliceVersionsToWrite, storedSliceVersions, type SliceChain } from '@/host/slices';

const rename: SliceChain = { key: 'x', version: 3, migrations: { 1: (o) => ({ ...(o as object), b: (o as { a: number }).a }), 2: (o) => ({ ...(o as object), c: true }) }, legacyKeys: [] };

describe('migrateSlices', () => {
  it('runs each step from the stored version to the slice\'s own, oldest first', () => {
    expect(migrateSlices({ x: { a: 1 } }, [rename]).blob.x).toEqual({ a: 1, b: 1, c: true });
    expect(migrateSlices({ x: { a: 1 }, sliceVersions: { x: 2 } }, [rename]).blob.x).toEqual({ a: 1, c: true });
    expect(migrateSlices({ x: { a: 1 }, sliceVersions: { x: 3 } }, [rename]).blob.x).toEqual({ a: 1 });
  });

  it('leaves a slice the blob lacks for the heal, and drops the stored versions (the next write records them)', () => {
    const { blob } = migrateSlices({ y: 1, sliceVersions: { x: 1 } }, [rename]);
    expect(blob).toEqual({ y: 1 });
  });

  it('adopts the first present legacy path when the slice\'s own key is absent', () => {
    const chain: SliceChain = { key: 'airDrum', version: 1, migrations: {}, legacyKeys: ['overlay.drumPads', 'old'] };
    expect(migrateSlices({ overlay: { drumPads: { show: false } } }, [chain]).blob.airDrum).toEqual({ show: false });
    expect(migrateSlices({ airDrum: { show: true }, overlay: { drumPads: { show: false } } }, [chain]).blob.airDrum).toEqual({ show: true });
  });

  it('carries a stored slice no chain claims (its extension removed), with its version', () => {
    const { blob, foreign } = migrateSlices({ gone: { v: 1 }, x: { a: 1 }, sliceVersions: { gone: 4, x: 3 } }, [rename]);
    expect(blob.gone).toEqual({ v: 1 });
    expect(foreign).toEqual({ gone: 4 });
    expect(sliceVersionsToWrite([rename], foreign)).toEqual({ gone: 4, x: 3 });
  });

  it('never edits the caller\'s blob', () => {
    const src = { x: { a: 1 }, overlay: { drumPads: { show: false } } };
    const frozen = JSON.stringify(src);
    migrateSlices(src, [rename, { key: 'd', version: 1, migrations: {}, legacyKeys: ['overlay.drumPads'] }]);
    expect(JSON.stringify(src)).toBe(frozen);
  });

  it('reads only sane stored versions, and builds chains with defaults', () => {
    expect(storedSliceVersions({ sliceVersions: { a: 2, b: 0, c: 'x', d: 1.5 } })).toEqual({ a: 2 });
    expect(storedSliceVersions(null)).toEqual({});
    expect(sliceChains([{ key: 'p', schema: undefined as never }])).toEqual([{ key: 'p', version: 1, migrations: {}, legacyKeys: [] }]);
  });

  it('a step that throws costs its slice only: the value is dropped for the heal, the rest migrate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const bad: SliceChain = { key: 'bad', version: 2, migrations: { 1: () => { throw new Error('null'); } }, legacyKeys: [] };
      const { blob } = migrateSlices({ bad: null, x: { a: 1 }, core: 5 }, [bad, rename]);
      expect('bad' in blob).toBe(false);
      expect(blob.x).toEqual({ a: 1, b: 1, c: true });
      expect(blob.core).toBe(5);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a step that edits its argument cannot reach the caller\'s blob', () => {
    const mutating: SliceChain = { key: 'm', version: 2, migrations: { 1: (o) => { (o as { a: number }).a = 9; return o; } }, legacyKeys: [] };
    const src = { m: { a: 1 } };
    expect(migrateSlices(src, [mutating]).blob.m).toEqual({ a: 9 });
    expect(src.m.a).toBe(1);
  });
});
