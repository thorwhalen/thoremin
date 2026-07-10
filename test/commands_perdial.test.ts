/**
 * Per-dial command generation (#87 Phase 2) — one typed `dial.<key>.set` command is
 * generated per scalar dial from the dials SSOT, so the palette (and hotkeys/AI) get
 * a first-class, schema-typed entry for every parameter with zero hand-maintenance.
 * Structured dials (overlay/handMap) are skipped. Pure + headless.
 */
import { describe, it, expect } from 'vitest';
import { isErr } from 'acture';
import { deriveKind } from 'acture-palette-react';
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

  it('does NOT generate a Set Octaves command; the octave span is set via the range dials (#63)', () => {
    // #63 replaced the octaves control with the double-thumb range slider. `octaves` stays
    // in the keyspace as the integer shadow (+ legacy generateScale fallback) but is hidden,
    // so no "Set Octaves" command is generated — a direct write would be a silent no-op
    // whenever the range fields are present (generateScale ignores octaves then). The span
    // is instead settable (palette + AI) via the range dials.
    expect(registry.has('dial.right.octaves.set')).toBe(false);
    expect(registry.has('dial.left.octaves.set')).toBe(false);
    expect(registry.has('dial.right.rangeLow.set')).toBe(true);
    expect(registry.has('dial.right.rangeHigh.set')).toBe(true);
  });

  it('a range dial command actually writes the voice span (not a no-op like octaves) (#63)', async () => {
    // Guards the SSOT the #63 fix rests on: the range dial IS the live span control and its
    // write lands in the hot store (which generateScale reads), unlike the hidden octaves dial.
    await registry.dispatch('dial.right.rangeHigh.set', { value: 0 }); // middle octave only
    expect(useControls.getState().right.rangeHigh).toBe(0);
    await registry.dispatch('dial.right.rangeHigh.set', { value: 1 }); // + a full octave up
    expect(useControls.getState().right.rangeHigh).toBe(1);
  });

  it('skips ALL structured dials (objects/records are not a single settable scalar)', () => {
    // All four structured dials in thoreminDials — incl. the dotted faceExpr.* ones
    // most likely to be mis-classified as scalars by a regression.
    expect(registry.has('dial.overlay.set')).toBe(false);
    expect(registry.has('dial.handMap.set')).toBe(false);
    expect(registry.has('dial.faceExpr.sensitivity.set')).toBe(false);
    expect(registry.has('dial.faceExpr.degrees.set')).toBe(false);
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
    // right.root is bounded 0..11, so the generated schema is z.number().int().min(0).max(11).
    const r = await registry.dispatch('dial.right.root.set', { value: 99 });
    expect(r.ok).toBe(false);
    if (isErr(r)) expect(r.error.code).toBe('invalid_params');
  });

  it('a fractional value for an integer dial is still safely refused (downstream, invalid_value)', async () => {
    // The generated schema keeps bounds but not `.int()`, so 5.5 passes the param
    // layer and is caught by the full settings schema in applyDialSet — never lands.
    const before = useControls.getState().right.root;
    const r = await registry.dispatch('dial.right.root.set', { value: 5.5 });
    expect(r.ok).toBe(false);
    if (isErr(r)) expect(r.error.code).toBe('invalid_value');
    expect(useControls.getState().right.root).toBe(before); // dial unchanged
  });

  it('an enum command accepts a valid member and rejects a bad one', async () => {
    const good = await registry.dispatch('dial.right.sound.set', { value: 'square' });
    expect(good.ok).toBe(true);
    expect(useControls.getState().right.sound).toBe('square');
    const bad = await registry.dispatch('dial.right.sound.set', { value: 'not-a-sound' });
    expect(bad.ok).toBe(false);
    if (isErr(bad)) expect(bad.error.code).toBe('invalid_params');
  });

  it('the palette routes each command by type: enum → inline picker, bounded number → form', () => {
    // The component docstring / CSS assume this routing; deriveKind is the pure
    // predicate acture uses, so lock it to the actual generated schemas.
    expect(deriveKind(registry.get('dial.right.sound.set')!)).toBe('atomic'); // enum → dropdown picker
    expect(deriveKind(registry.get('dial.master.syncHands.set')!)).toBe('atomic'); // boolean → true/false picker
    expect(deriveKind(registry.get('dial.right.root.set')!)).toBe('handoff'); // bounded number → AutoForm
  });

  it('the generated command set EXACTLY equals the eligible scalar dials (no drop, no extra)', () => {
    // Both directions: nothing eligible is dropped AND nothing ineligible (a
    // structured/hidden/readOnly dial) is added. Mirrors valueSchemaFor's filter.
    const expected = new Set(
      settingsForm.fields
        .filter((f) => !f.isStructured && !f.hidden && !f.readOnly)
        .filter((f) => f.enumValues?.length || ['number', 'boolean', 'string'].includes(f.zodType))
        .map((f) => setCommandIdFor(f.key)),
    );
    const generated = new Set(DIAL_FIELD_COMMANDS.map((c) => c.id));
    expect(generated).toEqual(expected);
    expect(generated.size).toBeGreaterThanOrEqual(8); // sanity: the voice+master+face dials
  });
});
