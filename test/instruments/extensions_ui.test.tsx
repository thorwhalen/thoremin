/**
 * The React half of the extension manifests (PR 5a of the instruments-as-graphs ADR). A
 * `.test.tsx` because it imports components: the strict typecheck covers no React.
 *
 * The old `AIR_UI` table was pinned by `satisfies Record<AirInstrumentId, …>`; the manifest's
 * `instrumentId` is a string, so the same completeness is pinned here instead: a fifth air
 * instrument in the library's table with no editor section fails this test.
 */
import { describe, expect, it } from 'vitest';
import { EXTENSION_PANELS, EXTENSION_STATUS_HOOKS, EXTENSION_MOUNT_EFFECTS, EXTENSION_UIS } from '@/app/extensions';
import { EXTENSIONS } from '@/extensions';
import { AIR_INSTRUMENTS } from '@/app/library/category';
import { AIR } from '../helpers/extensions';

describe('the React halves of the extensions', () => {
  it('one ui manifest per extension, in the same order', () => {
    expect(EXTENSION_UIS.map((u) => u.id)).toEqual(EXTENSIONS.map((e) => e.id));
  });

  it.runIf(AIR)('the editor sections cover exactly the air instruments the library lists', () => {
    expect(EXTENSION_PANELS.map((p) => p.instrumentId).sort()).toEqual(AIR_INSTRUMENTS.map((a) => a.id).sort());
    for (const p of EXTENSION_PANELS) {
      expect(p.section.length).toBeGreaterThan(0);
      expect(typeof p.Controls).toBe('function');
      expect(typeof p.Readout).toBe('function');
    }
  });

  it('every status hook names a node an extension branch declares, and can be built against an empty engine', () => {
    const nodeIds = new Set(EXTENSIONS.flatMap((e) => e.branches.flatMap((b) => b.nodes.map((n) => n.id))));
    for (const hook of EXTENSION_STATUS_HOOKS) {
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
