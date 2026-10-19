/**
 * The React half of the extension manifests (PR 5a of the instruments-as-graphs ADR). A
 * `.test.tsx` because it imports components: the strict typecheck covers no React.
 *
 * The old `AIR_UI` table was pinned by `satisfies Record<AirInstrumentId, …>`; the manifest's
 * `instrumentId` is a string, so the same completeness is pinned here instead: a fifth air
 * instrument in the library's table with no editor section fails this test.
 */
import { describe, expect, it } from 'vitest';
import { EXTENSION_PANELS, EXTENSION_MOUNT_EFFECTS, EXTENSION_UI_IDS, extensionStatusHooks, loadExtensionUi } from '@/app/extensions';
import { EXTENSIONS } from '@/extensions';
import { INSTRUMENT_CATALOG } from '@/app/library/category';
import { AIR } from '../helpers/extensions';

describe('the React halves of the extensions', () => {
  it('one ui manifest (or lazy stub) per extension, in the same order', () => {
    expect(EXTENSION_UI_IDS).toEqual(EXTENSIONS.map((e) => e.id));
  });

  it.runIf(AIR)('the editor sections cover exactly the air instruments the library lists, plus the add-on sections', () => {
    // An add-on section belongs to no instrument of its own: the faces extension's "Face
    // categorizer" is a section of the face chords (#330 P4); the MIDI slice's section (#600 S13) is
    // an output, not an instrument.
    const ADD_ON_SECTIONS = new Set(['faces', 'midi']);
    expect(EXTENSION_PANELS.map((p) => p.instrumentId).filter((id) => !ADD_ON_SECTIONS.has(id)).sort()).toEqual(INSTRUMENT_CATALOG.map((a) => a.id).sort());
    for (const p of EXTENSION_PANELS) {
      expect(p.section.length).toBeGreaterThan(0);
      expect(typeof p.Controls).toBe('function');
      expect(typeof p.Readout).toBe('function');
    }
  });

  it('every status hook names a node an extension branch declares, and can be built against an empty engine', async () => {
    // A lazy extension's hooks arrive with its React half: load every one first.
    await Promise.all(EXTENSION_UI_IDS.map((id) => loadExtensionUi(id)));
    const nodeIds = new Set(EXTENSIONS.flatMap((e) => e.branches.flatMap((b) => b.nodes.map((n) => n.id))));
    for (const hook of extensionStatusHooks()) {
      expect(nodeIds.has(hook.nodeId), hook.nodeId).toBe(true);
      const sink = hook.make({ getOutput: () => undefined });
      expect(() => sink()).not.toThrow();
      expect(() => hook.onRemoved()).not.toThrow();
      expect(() => hook.reset()).not.toThrow();
    }
  });

  it('mount effects are functions', () => {
    for (const effect of EXTENSION_MOUNT_EFFECTS) expect(typeof effect).toBe('function');
  });
});
