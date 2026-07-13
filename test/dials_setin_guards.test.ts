/**
 * The guards on the structured write path (#126 review follow-ups).
 *
 * Each of these pins a defect found by adversarial review of the sweep — all three were
 * invisible to the 825 green tests the sweep shipped with.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from '@/app/commands';
import { dialsStore } from '@/app/dials/settingsStore';
import { CLEARABLE_DIALS, isClearableDial } from '@/app/commands/paths';
import { buildDialCatalog } from '@/plugins/assistant/dialsContext';
import { OVERLAY_CONTROLS, controlsForSurface } from '@/app/overlayControls';
import { structuredLeafPaths } from '@/app/commands/paths';

beforeEach(() => {
  for (const key of dialsStore.getState().dirty) dialsStore.reset(key);
});

describe('a dial with a default cannot be CLEARED', () => {
  // dial.patch's per-write `value` is optional so the sync-hands mirror can propagate the
  // ABSENCE of the #63 octave-range fields on a pre-#63 instrument. But `value` optional in
  // the emitted JSON Schema means the AI can omit it for ANY dial — and SettingsSchema gives
  // handMap / overlay / faceExpr.degrees a `.default()`, so the clear used to PARSE: the
  // command reported ok, the audio silently reset to the default, the dials layer kept the
  // `undefined`, and the Hand panel then crashed dereferencing it on its next render.
  it('only the genuinely optional (#63 range) dials are clearable', () => {
    expect([...CLEARABLE_DIALS].sort()).toEqual([
      'left.rangeHigh',
      'left.rangeLow',
      'right.rangeHigh',
      'right.rangeLow',
    ]);
    expect(isClearableDial('handMap')).toBe(false);
    expect(isClearableDial('overlay')).toBe(false);
  });

  it('clearing handMap is REFUSED, and the dial is untouched', async () => {
    const before = dialsStore.getState().effective['handMap'];
    const res = await registry.dispatch('dial.patch', { writes: [{ key: 'handMap' }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_value');
    expect(dialsStore.getState().effective['handMap']).toBe(before); // same reference: no write
  });

  it('clearing an octave-range dial still WORKS (the case the option exists for)', async () => {
    const res = await registry.dispatch('dial.patch', { writes: [{ key: 'right.rangeLow' }] });
    expect(res.ok).toBe(true);
    expect(dialsStore.getState().effective['right.rangeLow']).toBeUndefined();
  });
});

describe('the AI can READ the structured dials it is told to write', () => {
  // The assistant is instructed to reach overlay/handMap/faceExpr with dial.setIn AND to
  // compute relative edits "from the CURRENT value below" — while the catalog omitted every
  // structured dial. It was write-only-blind.
  it('the dial catalog lists the leaf paths with their current values', () => {
    const catalog = buildDialCatalog();
    expect(catalog).toContain('overlay.video.alpha');
    expect(catalog).toContain('handMap.positionSource');
    expect(catalog).toContain('dial.setIn');
    // and the leaf lines carry a real current value, not `undefined`
    const line = catalog.split('\n').find((l) => l.startsWith('- overlay.video.alpha'));
    expect(line).toMatch(/current: [\d.]+/);
  });
});

describe('every overlay control the panel renders is an addressable leaf', () => {
  // The derivation can only drift in one place — an overlay element whose descriptor names
  // a field the schema does not have (or vice versa) — and that was the one place nothing
  // asserted. A drifted descriptor means a control that dispatches to a path outside the
  // command's enum: it would refuse every write, silently, forever.
  it('each instrument-surface descriptor field resolves to a declared leaf path', () => {
    const paths = new Set(structuredLeafPaths());
    for (const d of controlsForSurface('instrument')) {
      expect(paths, `overlay.${d.name}.show`).toContain(`overlay.${d.name}.show`);
      for (const t of d.toggles ?? []) {
        expect(paths, `overlay.${d.name}.${t.key}`).toContain(`overlay.${d.name}.${t.key}`);
      }
      if (d.slider) expect(paths).toContain(`overlay.${d.name}.${d.slider.key}`);
      if (d.position) expect(paths).toContain(`overlay.${d.name}.position`);
    }
  });

  it('the LAB-surface descriptor is excluded (its element is not a dial since #136)', () => {
    const paths = new Set(structuredLeafPaths());
    expect(OVERLAY_CONTROLS.some((d) => d.surface === 'lab')).toBe(true);
    expect(paths).not.toContain('overlay.featureLab.show');
  });
});
