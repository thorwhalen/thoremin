/**
 * A key added INSIDE a whole-object dial (#263: `airFlute.prior`) must heal in a saved
 * instrument's layer the way the hot store heals it, or every returning player's
 * instrument reads dirty on load, having changed nothing (the #188 PR 5 symptom, one
 * level down).
 */
import { describe, expect, it } from 'vitest';
import { normalizeLayer } from '@/app/dials/instruments';
import { DEFAULT_FINGERING_PRIOR } from '@/extensions/air/lib/fingering_prior';
import { DEFAULT_AIR_BASS, DEFAULT_AIR_DRUM, DEFAULT_AIR_FLUTE, DEFAULT_AIR_GUITAR } from '@/extensions/air/dials';
import { mergeControls, useControls } from '@/app/store';

describe('normalizeLayer and a nested additive key', () => {
  it('fills airFlute.prior into a layer saved before it existed, and matches the working layer', () => {
    const { prior: _dropped, ...oldFlute } = DEFAULT_AIR_FLUTE as Record<string, unknown> & { prior: unknown };
    void _dropped;
    // What real persistence does: a JSON round-trip of a layer whose airFlute predates the prior.
    const saved = JSON.parse(JSON.stringify({ airFlute: oldFlute }));
    expect((saved.airFlute as { prior?: unknown }).prior).toBeUndefined();
    const healed = normalizeLayer(saved);
    expect((healed.airFlute as { prior: unknown }).prior).toEqual(DEFAULT_FINGERING_PRIOR);
    // The same as a layer written by this build (the working half of the dirty compare).
    const working = normalizeLayer(JSON.parse(JSON.stringify({ airFlute: DEFAULT_AIR_FLUTE })));
    expect(healed.airFlute).toEqual(working.airFlute);
    // A layer that already has it is left with the same airFlute.
    expect(normalizeLayer(healed).airFlute).toEqual(healed.airFlute);
  });

  it('fills airDrum.pattern the same way (#269)', () => {
    const { pattern: _dropped, ...oldDrum } = DEFAULT_AIR_DRUM as Record<string, unknown> & { pattern: unknown };
    void _dropped;
    const saved = JSON.parse(JSON.stringify({ airDrum: oldDrum }));
    const healed = normalizeLayer(saved);
    expect((healed.airDrum as { pattern: unknown }).pattern).toBe('');
    expect(healed.airDrum).toEqual(normalizeLayer(JSON.parse(JSON.stringify({ airDrum: DEFAULT_AIR_DRUM }))).airDrum);
  });

  it('heals every extension dial generically (bass, guitar), and leaves a complete dial as saved', () => {
    const { volume: _v, ...oldBass } = DEFAULT_AIR_BASS as Record<string, unknown> & { volume: unknown };
    void _v;
    const healed = normalizeLayer(JSON.parse(JSON.stringify({ airBass: oldBass })));
    expect(healed.airBass).toEqual(DEFAULT_AIR_BASS);
    const complete = { airGuitar: { ...DEFAULT_AIR_GUITAR, enabled: true } };
    // Untouched: the same object, not a re-parse (other dial keys may be default-filled around it).
    expect(normalizeLayer(complete).airGuitar).toBe(complete.airGuitar);
  });
});

describe('mergeControls and the extension dials (folded over the manifests)', () => {
  const current = useControls.getState();

  it('fills a partial stored dial from the current one, through its schema', () => {
    const merged = mergeControls({ airBass: { enabled: true } }, current);
    expect(merged.airBass).toEqual({ ...current.airBass, enabled: true });
    expect(merged.airGuitar).toBe(current.airGuitar); // absent from the blob: kept as is
  });

  it('keeps the current dial when the stored one is invalid', () => {
    const merged = mergeControls({ airDrum: { enabled: 'yes' } }, current);
    expect(merged.airDrum).toBe(current.airDrum);
  });
});
