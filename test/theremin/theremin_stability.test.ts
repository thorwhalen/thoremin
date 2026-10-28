/**
 * The physical theremin on real hands (`scripts/stability/lib_theremin.ts`; the table is in
 * `docs/research/theremin-physics.md`): the assistance makes a held hand steadier, the field still
 * plays a sweep in order, and the real signer's open palm sounds above their fist at the same place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecords, FIXTURES } from '../helpers/fixtures';
import { THEREMIN } from '../helpers/extensions';
import { measureTheremin } from '../../scripts/stability/lib_theremin';

describe.runIf(THEREMIN)('the physical theremin on real hands', () => {
  const meta = JSON.parse(readFileSync(join(FIXTURES, 'real_hands_signs', 'meta.json'), 'utf8'));

  it('assistance lowers the note changes of a held hand; the sweep stays in order; fingering plays', async () => {
    const pure = await measureTheremin(loadRecords, meta, 0);
    const gentle = await measureTheremin(loadRecords, meta, 0.25);
    const full = await measureTheremin(loadRecords, meta, 1);
    expect(pure.sweepOrder).toBeGreaterThan(0.9);
    expect(gentle.sweepOrder).toBeGreaterThan(0.9);
    expect(gentle.noteChangesPerHeldS).toBeLessThan(pure.noteChangesPerHeldS / 2);
    expect(full.noteChangesPerHeldS).toBeLessThan(pure.noteChangesPerHeldS / 10);
    expect(gentle.heldWarbleCents).toBeLessThan(pure.heldWarbleCents);
    for (const m of [pure, gentle, full]) expect(m.openOverFist).toBeGreaterThan(3);
  }, 60_000);
});
