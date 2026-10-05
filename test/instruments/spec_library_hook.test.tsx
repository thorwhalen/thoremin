// @vitest-environment jsdom
/**
 * `useLibrary`'s spec surface (the instruments-as-graphs ADR, PR 4), through the real hook:
 * `specOf` once derived, `setBranches` writing only known ids, a star toggle keeping the
 * spec fields, and the class cache back-filled once both the record and the derivation are
 * loaded and read by `categoryOf` before the derivation on the next mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useLibrary } from '@/app/library/useLibrary';
import { __resetMemoryMeta, readInstrumentMeta } from '@/app/library/store';
import { SEED_INSTRUMENTS, instruments } from '@/app/dials/instruments';
import { AIR } from '../helpers/extensions';

const seedNames = ['Pentatonic', 'Air Drum'];
const list = seedNames.map((name) => ({ name }));

async function saveSeeds(): Promise<void> {
  for (const name of seedNames) {
    const seed = SEED_INSTRUMENTS.find((s) => s.name === name)!;
    await instruments.save(seed.name, seed.layer);
  }
}

describe.runIf(AIR)('useLibrary: the spec surface', () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetMemoryMeta();
    await saveSeeds();
  });
  afterEach(() => cleanup());

  it('specOf joins the Layer, the record and the derivation; the class cache is back-filled once', async () => {
    const { result } = renderHook(() => useLibrary(list));
    await waitFor(() => expect(result.current.derivedReady).toBe(true));
    await waitFor(() => expect(result.current.specOf('Air Drum')).toBeDefined());
    const drum = result.current.specOf('Air Drum')!;
    expect(drum).toMatchObject({ id: 'Air Drum', class: 'air', branches: ['air-drum'], features: ['air-drum'], starred: false, tags: [] });
    expect(drum.settings).toBeDefined();
    expect(result.current.specOf('Pentatonic')!.class).toBe('field');
    // The back-fill wrote a class cache for both, and nothing else.
    await waitFor(async () => {
      const meta = await readInstrumentMeta();
      expect(meta['Air Drum']?.class).toBe('air');
      expect(meta.Pentatonic?.class).toBe('field');
    });
  });

  it('a star toggle keeps the spec fields; setBranches writes only known ids; the explicit set shows in the spec', async () => {
    const { result } = renderHook(() => useLibrary(list));
    await waitFor(() => expect(result.current.specOf('Pentatonic')).toBeDefined());
    act(() => result.current.setBranches('Pentatonic', ['field-voices', 'conductor', 'not-a-branch']));
    await waitFor(() => expect(result.current.branchesOf('Pentatonic')).toEqual(['field-voices', 'conductor']));
    act(() => result.current.setTraining('Pentatonic', { route: 'trainer/sequence' }));
    act(() => result.current.setImage('Pentatonic', 'gallery/pentatonic.png'));
    act(() => result.current.toggleStar('Air Drum'));
    await waitFor(() => expect(result.current.starred('Air Drum')).toBe(true));
    const spec = result.current.specOf('Pentatonic')!;
    expect(spec.branches).toEqual(['field-voices', 'conductor']);
    expect(spec.features).toEqual(['field-voices', 'conductor']);
    expect(spec.training).toEqual({ route: 'trainer/sequence' });
    expect(spec.image).toBe('gallery/pentatonic.png');
    const meta = await readInstrumentMeta();
    expect(meta.Pentatonic).toMatchObject({ branches: ['field-voices', 'conductor'], training: { route: 'trainer/sequence' }, image: 'gallery/pentatonic.png' });
    // An EXTENSION's branch id is a known id too (the set is the build's, not the core's).
    act(() => result.current.setBranches('Air Drum', ['air-drum', 'not-a-branch']));
    await waitFor(() => expect(result.current.branchesOf('Air Drum')).toEqual(['air-drum']));
    // Clearing goes back to "derive".
    act(() => result.current.setBranches('Pentatonic', null));
    await waitFor(() => expect(result.current.branchesOf('Pentatonic')).toBeUndefined());
    expect(result.current.specOf('Pentatonic')!.branches).toEqual(['field-voices']);
  });

  it('on a later mount, categoryOf answers from the cache before the derivation has run', async () => {
    const first = renderHook(() => useLibrary(list));
    await waitFor(async () => expect((await readInstrumentMeta())['Air Drum']?.class).toBe('air'));
    cleanup();
    void first;
    const second = renderHook(() => useLibrary(list));
    // The record loads (fast) before the derivation (loads every Layer): at least one render
    // where the cache answers and the derivation has not.
    await waitFor(() => expect(second.result.current.categoryOf('Air Drum')).toBe('air'));
    await waitFor(() => expect(second.result.current.derivedReady).toBe(true));
    expect(second.result.current.categoryOf('Air Drum')).toBe('air');
  });
});
