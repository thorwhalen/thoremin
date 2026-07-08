/**
 * Instrument commands (#87 Phase 1): loading / saving / creating a named
 * instrument via `registry.dispatch` mutates the dials store exactly as the
 * direct orchestration did, and reports success/failure as data. The profile
 * store falls back to in-memory storage in Node, so this runs headlessly. The
 * import firewall over these command files is covered by commands_firewall.test.
 */
import { describe, it, expect } from 'vitest';
import { createThoreminRegistry } from '@/app/commands/registry';
import { ensureSeeded, instruments, LAST_MODIFIED } from '@/app/dials/instruments';
import { dialsStore } from '@/app/dials/settingsStore';

const reg = createThoreminRegistry();
const namedInstruments = async () =>
  (await instruments.list()).filter((p) => p.name !== LAST_MODIFIED).map((p) => p.name);

describe('instrument commands (#87 Phase 1)', () => {
  it('instrument.load loads the layer as a clean baseline and returns ok', async () => {
    await ensureSeeded();
    const r = await reg.dispatch('instrument.load', { name: 'Split Voices' });
    expect(r.ok).toBe(true);
    const s = dialsStore.getState();
    expect(s.effective['right.type']).toBe('major');
    expect(s.effective['right.sound']).toBe('organ');
    expect(s.dirty.length).toBe(0);
  });

  it('instrument.load errors for a missing instrument, leaving the store unchanged', async () => {
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Pentatonic' });
    const before = dialsStore.getState().effective['right.type'];
    const r = await reg.dispatch('instrument.load', { name: 'Does Not Exist' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('instrument_not_found');
    expect(dialsStore.getState().effective['right.type']).toBe(before);
  });

  it('instrument.save overwrites the named instrument and clears dirty', async () => {
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Split Voices' });
    dialsStore.set('master.volume', 0.9);
    expect(dialsStore.getState().dirty.length).toBeGreaterThan(0);
    const r = await reg.dispatch('instrument.save', { name: 'Split Voices' });
    expect(r.ok).toBe(true);
    expect(dialsStore.getState().dirty.length).toBe(0);
    const reloaded = await instruments.load('Split Voices');
    expect(reloaded?.['master.volume']).toBe(0.9);
  });

  it('instrument.create saves the working layer as a new (trimmed) named instrument', async () => {
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Pentatonic' });
    dialsStore.set('master.volume', 0.42);
    const r = await reg.dispatch<{ name: string }>('instrument.create', { name: '  My New Inst  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('My New Inst'); // trimmed
    expect(await namedInstruments()).toContain('My New Inst');
    const saved = await instruments.load('My New Inst');
    expect(saved?.['master.volume']).toBe(0.42);
  });

  it('instrument.create rejects a whitespace-only name', async () => {
    const r = await reg.dispatch('instrument.create', { name: '   ' });
    expect(r.ok).toBe(false);
  });

  it('instrument.create on an existing name overwrites it (documents current behavior)', async () => {
    // Save-as does not guard duplicates today — creating with an existing name
    // clobbers it (same as the pre-Phase-1 hook). Pinned here; whether the UI
    // should warn on a duplicate is a deferred product decision, not Phase 1.
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Split Voices' });
    dialsStore.set('master.volume', 0.271);
    const r = await reg.dispatch('instrument.create', { name: 'Split Voices' });
    expect(r.ok).toBe(true);
    const reloaded = await instruments.load('Split Voices');
    expect(reloaded?.['master.volume']).toBe(0.271);
  });
});
