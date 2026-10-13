/**
 * The conductor dial's `prior` (#232) defaults to `blend` for an instrument made from
 * now on, but an instrument or a returning player's hot store saved with a conductor
 * and no `prior` was played by the oscillator and must keep it: a default that
 * changes what a saved instrument does is a migration, not a default. Both halves of
 * the dirty compare (the saved layer and the hot store) heal to the same value.
 */
import { describe, expect, it } from 'vitest';
import { normalizeLayer } from '@/app/dials/instruments';
import { migrateControls } from '@/app/store';
import { DEFAULT_CONDUCTOR, LEGACY_CONDUCTOR_PRIOR, ConductorSettingsSchema } from '@/settings/schema';
import { DEFAULT_RHYTHM_PRIOR } from '@thoremin/ictus';

const withoutPrior = () => {
  const { prior: _dropped, ...old } = DEFAULT_CONDUCTOR as Record<string, unknown> & { prior: unknown };
  void _dropped;
  return JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
};

describe('conductor.prior for instruments saved before the field existed', () => {
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

  it('the hot store migration (v21) does the same for a returning player, once', () => {
    const migrated = migrateControls({ conductor: withoutPrior() }, 20);
    expect((migrated.conductor as { prior: unknown }).prior).toBe(LEGACY_CONDUCTOR_PRIOR);
    const kept = migrateControls({ conductor: { ...withoutPrior(), prior: 'trend' } }, 20);
    expect((kept.conductor as { prior: unknown }).prior).toBe('trend');
    const current = migrateControls({ conductor: withoutPrior() }, 21);
    expect((current.conductor as { prior?: unknown }).prior).toBeUndefined();
  });
});
