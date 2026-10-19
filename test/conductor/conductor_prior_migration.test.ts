/**
 * The conductor dial's `prior` (#232) defaults to `blend` for an instrument made from
 * now on, but an instrument or a returning player's hot store saved with a conductor
 * and no `prior` was played by the oscillator and must keep it: a default that
 * changes what a saved instrument does is a migration, not a default. Both halves of
 * the dirty compare (the saved layer and the hot store) heal to the same value.
 */
import { describe, expect, it } from 'vitest';
import { normalizeLayer } from '@/app/dials/instruments';
import { mergeControls, migrateControls, useControls } from '@/app/store';
import { DEFAULT_CONDUCTOR, LEGACY_CONDUCTOR_PRIOR, ConductorSettingsSchema } from '@/slices/conductor/schema';
import { DEFAULT_RHYTHM_PRIOR } from '@thoremin/ictus';
import { CONDUCTOR } from '../helpers/extensions';

const withoutPrior = () => {
  const { prior: _dropped, ...old } = DEFAULT_CONDUCTOR as Record<string, unknown> & { prior: unknown };
  void _dropped;
  return JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
};

describe.runIf(CONDUCTOR)('conductor.prior for instruments saved before the field existed', () => {
  it('the schema fills the blend for a new instrument, and the legacy value is the oscillator', () => {
    expect(DEFAULT_CONDUCTOR.prior).toBe(DEFAULT_RHYTHM_PRIOR);
    expect(DEFAULT_RHYTHM_PRIOR).toBe('blend');
    expect(LEGACY_CONDUCTOR_PRIOR).toBe('oscillator');
    expect(ConductorSettingsSchema.parse(withoutPrior()).prior).toBe('blend');
  });

  it('normalizeLayer keeps a saved conductor without `prior` on the oscillator, and leaves one with it alone', () => {
    const saved = { conductor: withoutPrior() };
    const healed = normalizeLayer(saved);
    expect((healed.conductor as { prior: unknown }).prior).toBe(LEGACY_CONDUCTOR_PRIOR);
    expect(normalizeLayer(healed).conductor).toEqual(healed.conductor);
    const fresh = normalizeLayer({ conductor: { ...DEFAULT_CONDUCTOR } });
    expect((fresh.conductor as { prior: unknown }).prior).toBe('blend');
    // A layer with no conductor at all (saved before #187) takes the whole default: it never conducted.
    expect((normalizeLayer({}).conductor as { prior: unknown }).prior).toBe('blend');
  });

  it('the hot store migration (v21, the slice\'s v1 -> v2 since #600 S18b) does the same for a returning player, once', () => {
    const rehydrate = (blob: Record<string, unknown>) => mergeControls(migrateControls(blob, 20), useControls.getState()).conductor as { prior?: unknown };
    // A blob written before the slice (no `sliceVersions` entry) is the conductor's v1.
    expect(rehydrate({ conductor: withoutPrior() }).prior).toBe(LEGACY_CONDUCTOR_PRIOR);
    expect(rehydrate({ conductor: { ...withoutPrior(), prior: 'trend' } }).prior).toBe('trend');
    // One the slice wrote is v2: the step never runs again, and the heal fills the current value.
    expect(rehydrate({ conductor: withoutPrior(), sliceVersions: { conductor: 2 } }).prior).toBe(useControls.getState().conductor.prior);
    expect(useControls.getState().conductor.prior).toBe('blend');
  });
});
