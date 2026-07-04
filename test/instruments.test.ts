/**
 * The seeded instruments (Phase 4): each shipped instrument is a full settings layer
 * that maps back to a valid Settings, face-chord seeds respect the current 7-note-scale
 * requirement, and ensureSeeded seeds the named set once (idempotently). The profile
 * store falls back to in-memory storage in the Node runtime, so this exercises the real
 * seeding path without a browser.
 */
import { describe, it, expect } from 'vitest';
import {
  SEED_INSTRUMENTS,
  instruments,
  ensureSeeded,
  LAST_MODIFIED,
  selectInstrument,
  commitToInstrument,
  restoreSession,
  setSelectedName,
} from '@/app/dials/instruments';
import { dialsStore } from '@/app/dials/settingsStore';
import { layerToSettings } from '@/settings/dials';

const SEVEN_NOTE = new Set(['major', 'minor', 'minorHarmonic']);

describe('seed instruments', () => {
  it('every seed layer maps back to a valid Settings', () => {
    for (const s of SEED_INSTRUMENTS) {
      const settings = layerToSettings(s.layer);
      expect(settings.masterVolume).toBeGreaterThanOrEqual(0);
      expect(settings.masterVolume).toBeLessThanOrEqual(1);
      expect(settings.right.type).toBeTruthy();
      expect(settings.left.type).toBeTruthy();
    }
  });

  it('face-chord seeds use a 7-note right-hand scale (the current chord requirement)', () => {
    for (const s of SEED_INSTRUMENTS) {
      const settings = layerToSettings(s.layer);
      if (settings.faceMapping === 'chord') expect(SEVEN_NOTE.has(settings.right.type)).toBe(true);
    }
  });

  it('seeds the named instruments once, idempotently', async () => {
    await ensureSeeded();
    const named = async () => (await instruments.list()).filter((p) => p.name !== LAST_MODIFIED);
    const after1 = await named();
    expect(after1.map((p) => p.name)).toEqual(SEED_INSTRUMENTS.map((s) => s.name));
    await ensureSeeded(); // no-op when named instruments already exist
    const after2 = await named();
    expect(after2.length).toBe(SEED_INSTRUMENTS.length);
  });
});

describe('instruments orchestration over the dials store', () => {
  it('selectInstrument loads the layer as a clean baseline (dirty empty)', async () => {
    await ensureSeeded();
    const layer = await selectInstrument('Split Voices');
    expect(layer).not.toBeNull();
    const s = dialsStore.getState();
    expect(s.effective['right.type']).toBe('major');
    expect(s.effective['right.sound']).toBe('organ');
    expect(s.dirty.length).toBe(0);
  });

  it('editing after select dirties the store; commit clears it and persists', async () => {
    await ensureSeeded();
    await selectInstrument('Split Voices');
    dialsStore.set('master.volume', 0.9);
    expect(dialsStore.getState().dirty.length).toBeGreaterThan(0);
    await commitToInstrument('Split Voices');
    expect(dialsStore.getState().dirty.length).toBe(0);
    const reloaded = await instruments.load('Split Voices');
    expect(reloaded?.['master.volume']).toBe(0.9);
  });

  it('selectInstrument returns null for a missing instrument, leaving the store unchanged', async () => {
    await ensureSeeded();
    await selectInstrument('Pentatonic');
    const before = dialsStore.getState().effective['right.type'];
    const layer = await selectInstrument('Does Not Exist');
    expect(layer).toBeNull();
    expect(dialsStore.getState().effective['right.type']).toBe(before);
  });

  it('restoreSession baselines the selected instrument and keeps the working layer (dirty)', async () => {
    // getSelectedName/setSelectedName use localStorage, absent in the Node runtime —
    // stub it for this test (restored after) so the selected-name round-trip works.
    const orig = (globalThis as { localStorage?: unknown }).localStorage;
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
    try {
      await ensureSeeded();
      await selectInstrument('Pentatonic'); // working layer = Pentatonic, clean
      setSelectedName('Split Voices'); // pretend Split Voices is the selected instrument
      dialsStore.set('master.volume', 0.123); // an unsaved working tweak
      const sel = await restoreSession();
      expect(sel).toBe('Split Voices');
      expect(dialsStore.getState().effective['master.volume']).toBeCloseTo(0.123); // working preserved
      expect(dialsStore.getState().dirty.length).toBeGreaterThan(0); // dirty vs Split Voices baseline
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = orig;
    }
  });
});
