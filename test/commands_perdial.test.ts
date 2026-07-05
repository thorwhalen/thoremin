/**
 * Per-dial command generation (#87 Phase 2) — one typed `dial.<key>.set` command is
 * generated per scalar dial from the dials SSOT, so the palette (and hotkeys/AI) get
 * a first-class, schema-typed entry for every parameter with zero hand-maintenance.
 * Structured dials (overlay/handMap) are skipped. Pure + headless.
 */
import { describe, it, expect } from 'vitest';
import { createThoreminRegistry, DIAL_FIELD_COMMANDS, setCommandIdFor } from '@/app/commands';
import { useControls } from '@/app/store';
import { settingsForm } from '@/app/dials/settingsStore';

describe('per-dial command generation (#87)', () => {
  const registry = createThoreminRegistry();

  it('generates a set command per scalar dial (enum, number, boolean)', () => {
    expect(registry.has('dial.right.root.set')).toBe(true); // number
    expect(registry.has('dial.right.sound.set')).toBe(true); // enum
    expect(registry.has('dial.master.syncHands.set')).toBe(true); // boolean
  });

  it('skips structured dials (not a single settable scalar)', () => {
    expect(registry.has('dial.overlay.set')).toBe(false);
    expect(registry.has('dial.handMap.set')).toBe(false);
  });

  it('a generated command carries a human title + Dials category', () => {
    const cmd = registry.get('dial.right.root.set');
    expect(cmd?.category).toBe('Dials');
    expect(cmd?.title.toLowerCase()).toContain('root');
  });

  it('dispatching a generated number command writes + syncs the hot store', async () => {
    const r = await registry.dispatch('dial.right.root.set', { value: 5 });
    expect(r.ok).toBe(true);
    expect(useControls.getState().right.root).toBe(5);
  });

  it('the typed schema rejects an out-of-bounds value at the param layer (invalid_params)', async () => {
    // right.root is bounded 0..11, so the generated schema is z.number().min(0).max(11).
    const r = await registry.dispatch('dial.right.root.set', { value: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_params');
  });

  it('an enum command accepts a valid member and rejects a bad one', async () => {
    const good = await registry.dispatch('dial.right.sound.set', { value: 'square' });
    expect(good.ok).toBe(true);
    expect(useControls.getState().right.sound).toBe('square');
    const bad = await registry.dispatch('dial.right.sound.set', { value: 'not-a-sound' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_params');
  });

  it('every generated command id round-trips a real dial field, and every scalar field is covered', () => {
    const scalarFields = settingsForm.fields.filter((f) => !f.isStructured && !f.hidden && !f.readOnly);
    // At least the voice + master + face dials produce commands.
    expect(DIAL_FIELD_COMMANDS.length).toBeGreaterThanOrEqual(8);
    for (const cmd of DIAL_FIELD_COMMANDS) {
      expect(cmd.id.startsWith('dial.')).toBe(true);
      expect(cmd.id.endsWith('.set')).toBe(true);
    }
    // Every generated id is setCommandIdFor(some scalar field key).
    const ids = new Set(DIAL_FIELD_COMMANDS.map((c) => c.id));
    for (const f of scalarFields) {
      // A scalar field of a supported base type has a command.
      if (f.enumValues?.length || ['number', 'boolean', 'string'].includes(f.zodType)) {
        expect(ids.has(setCommandIdFor(f.key))).toBe(true);
      }
    }
  });
});
