// @vitest-environment jsdom
/**
 * Per-slice versioned migrations through the real hot store (#600 S9): with the probe extension
 * listed (its dial at version 2, which renamed `hz` to `freq`; its device pref), a returning
 * player's blob goes through the persist rehydrate, the probe's own chain runs once, and the
 * written blob records every slice's version; a slice whose extension is no longer listed is
 * written back untouched; the pref is a device pref (persisted, validated, healed), never part of
 * an instrument. Core's global chain is unchanged (`persisted_golden.test.ts` pins it).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { PROBE_EXTENSION, probeMigrations } from './fixtures/ext-probe/index';
import { PROBE_UI } from './fixtures/ext-probe/ui';

const PURE: readonly Extension[] = [PROBE_EXTENSION as unknown as Extension];
const UIS: readonly ExtensionUi[] = [PROBE_UI];
let store: typeof import('@/app/store');

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('virtual:thoremin/extensions', () => ({ default: PURE }));
  vi.doMock('virtual:thoremin/extensions-ui', () => ({ default: UIS }));
  store = await import('@/app/store');
});

const KEY = 'thoremin-controls';
/** Rehydrate a fresh store from `state` (zustand's persist envelope at the current version). */
async function rehydrate(state: Record<string, unknown>): Promise<void> {
  const { useControls } = store;
  useControls.setState(useControls.getInitialState(), true);
  localStorage.setItem(KEY, JSON.stringify({ state, version: useControls.persist.getOptions().version }));
  await useControls.persist.rehydrate();
}
const written = (): Record<string, unknown> => (JSON.parse(localStorage.getItem(KEY)!) as { state: Record<string, unknown> }).state;
const state = (): Record<string, unknown> => store.useControls.getState() as unknown as Record<string, unknown>;

describe('a slice\'s own migration chain', () => {
  beforeEach(() => localStorage.clear());

  it('migrates a version-1 probe dial once, and the written blob records version 2', async () => {
    probeMigrations.runs = 0;
    await rehydrate({ probe: { enabled: true, hz: 330 } });
    expect(state().probe).toEqual({ enabled: true, freq: 330 });
    expect(probeMigrations.runs).toBe(1);
    store.useControls.getState().setMasterVolume(0.3); // any write persists
    expect(written().probe).toEqual({ enabled: true, freq: 330 });
    expect((written().sliceVersions as Record<string, number>).probe).toBe(2);
    // Reload what was written: the chain does not run again.
    await rehydrate(written());
    expect(state().probe).toEqual({ enabled: true, freq: 330 });
    expect(probeMigrations.runs).toBe(1);
  });

  it('a slice whose extension is no longer listed is written back untouched, with its version', async () => {
    await rehydrate({ removedDial: { kept: true }, sliceVersions: { removedDial: 3, probe: 2 } });
    expect(state().removedDial).toEqual({ kept: true });
    store.useControls.getState().setMasterVolume(0.31);
    expect(written().removedDial).toEqual({ kept: true });
    expect(written().sliceVersions).toEqual({ removedDial: 3, probe: 2, probePref: 1 });
  });

  it('the global version and the core chain are untouched by the slices', () => {
    expect(store.useControls.persist.getOptions().version).toBe(26);
  });
});

describe('the store refuses a pref named like a core field (#600 S9 review)', () => {
  it('a pref that would replace a core field\'s default and heal is refused when the store is built', () => {
    const state = store.useControls.getInitialState() as unknown as Record<string, unknown>;
    // `conductorPrefs`: a core device pref (`songPrefs`, the example before, is the song slice's since #600 S15).
    const clash = [{ key: 'conductorPrefs', schema: { parse: () => ({}) } as never }];
    expect(() => store.withExtensionPrefs(state, clash)).toThrow(/"conductorPrefs", which core already uses/);
    expect(store.withExtensionPrefs({ a: 1 }, [{ key: 'fresh', schema: { parse: () => 2 } as never }])).toEqual({ a: 1, fresh: 2 });
  });
});

describe('a slice that adopts a legacy path (#600 S9)', () => {
  beforeEach(() => localStorage.clear());

  it('reads its value from the old path when its own key is absent, and writes its own key after', async () => {
    probeMigrations.runs = 0;
    await rehydrate({ probeOld: { enabled: true, hz: 200 } });
    expect(state().probe).toEqual({ enabled: true, freq: 200 });
    store.useControls.getState().setMasterVolume(0.32);
    expect(written().probe).toEqual({ enabled: true, freq: 200 });
  });
});

describe('an extension\'s device pref', () => {
  beforeEach(() => localStorage.clear());

  it('starts at its default, is validated on write, persisted, and healed when corrupt', async () => {
    await rehydrate({});
    expect(state().probePref).toEqual({ volume: 0.5 });
    store.useControls.getState().setPref('probePref', { volume: 0.9 });
    expect(state().probePref).toEqual({ volume: 0.9 });
    store.useControls.getState().setPref('probePref', { volume: 7 });
    expect(state().probePref).toEqual({ volume: 0.9 });
    expect(written().probePref).toEqual({ volume: 0.9 });
    expect(() => store.useControls.getState().setPref('nobody', 1)).toThrow(/not a pref any listed extension declares/);
    await rehydrate({ probePref: { volume: 'loud' } });
    expect(state().probePref).toEqual({ volume: 0.5 });
  });

  it('is never part of an instrument (not a settings key)', () => {
    expect(Object.keys(store.toSettings(store.useControls.getState()))).not.toContain('probePref');
    expect(Object.keys(store.toSettings(store.useControls.getState()))).toContain('probe');
  });
});
