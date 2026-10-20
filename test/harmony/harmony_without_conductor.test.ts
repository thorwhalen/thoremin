/**
 * A build that ships the harmony slice and not the conductor slice (#697): the chord chart needs
 * the conductor's beat and piece, so its catalog row, its editor section and the seed "Conduct the
 * Chords" are withheld, the derivation leaves the `chord-chart` branch out when its dial is on, and
 * every instrument the air extension and the harmony slice still seed composes. The build is
 * folded from those two manifests alone, as `extensions.json` would list them (the harmony slice's
 * rows are listed under the air extension's class, #705).
 */
import { describe, expect, it } from 'vitest';
import AIR_EXTENSION from '@thoremin/ext-air';
import HARMONY_EXTENSION from '@thoremin/ext-harmony';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { foldContributions } from '@/host/contributions';
import { BRANCHES as CORE_BRANCHES } from '@/instruments/branches';
import { composeGraph } from '@/instruments';
import { deriveBranchIds, type DerivationSettings, type DerivationTable } from '@/instruments/derive';
import { CATEGORY_TARGET, CHORD_TARGET, MERGE_TARGET, resolveSlots } from '@/app/graph';
import { AIR, HARMONY } from '../helpers/extensions';

const fold = foldContributions([AIR_EXTENSION, HARMONY_EXTENSION] as unknown as Extension[]);
const library = [...CORE_BRANCHES, ...fold.branches];
const table: DerivationTable = { knownBranchIds: new Set(library.map((b) => b.id)), extensions: fold.extensions, implying: library };
const compose = (settings: DerivationSettings) =>
  composeGraph(['trunk', ...deriveBranchIds(settings, {}, table)], library, { slots: resolveSlots(), merge: MERGE_TARGET, chords: CHORD_TARGET, categories: CATEGORY_TARGET });

describe.runIf(AIR && HARMONY)('the chord instruments without the conductor slice (#697)', () => {
  it('withholds the chord chart: its catalog row, its seed', () => {
    expect(fold.withheld.catalog).toEqual(['chart']);
    expect(fold.withheld.instruments).toEqual(['Conduct the Chords', 'Sign Wheel', 'Sign Map']);
    expect(fold.catalog.map((r) => r.id)).not.toContain('chart');
    expect(fold.instruments.map((i) => i.name)).not.toContain('Conduct the Chords');
  });

  it('a chord chart switched on anyway (a saved instrument) is left out of the derivation, and the graph composes', () => {
    const settings = { chordChart: { enabled: true }, handMap: { maxGain: 0 } } as DerivationSettings;
    expect(deriveBranchIds(settings, {}, table)).not.toContain('chord-chart');
    expect(() => compose(settings)).not.toThrow();
    // An explicit branch set naming it (a saved spec) is treated the same way.
    expect(deriveBranchIds(settings, { explicit: ['field-voices', 'chord-chart'] }, table)).toEqual(['field-voices']);
  });

  it('every instrument they still seed composes', () => {
    expect(fold.instruments.length).toBeGreaterThan(0);
    for (const { name, patch } of fold.instruments) expect(() => compose(patch as DerivationSettings), name).not.toThrow();
  });

  it('the harmony slice needs the air extension for its catalog class (until #705): listed alone, the fold says so at load', () => {
    expect(() => foldContributions([HARMONY_EXTENSION] as unknown as Extension[])).toThrow(/listed under the class "air", which no extension and not core declares/);
  });
});
