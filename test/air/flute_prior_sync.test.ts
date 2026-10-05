/**
 * The prior as a dial (#263): the settings schema and its defaults, the fuse options it
 * resolves to, the flute's finger model derived from the enrolment AND the dial, the sync
 * that re-derives it when the dial changes, and the saved-sequence helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FINGERING_PRIOR, FingeringPriorSettingsSchema, priorOptionsFrom } from '@/extensions/air/lib/fingering_prior';
import { emptyVocabulary } from '@/extensions/air/lib/vocabulary';
import { FLUTE_FINGER_FEATURES, deriveFluteFingerModel, startFlutePriorSync } from '@/extensions/air/app/vocabularyStore';
import { mergeSequences, parseTargets } from '@thoremin/sdk-ui/enroll/sequenceStore';
import { FLUTE_STARTER_SEQUENCES, GUITAR_STARTER_SEQUENCES } from '@/extensions/air/app/starterSequences';
import { AirFluteSettingsSchema } from '@/extensions/air/dials';
import { structuredDialLeaves } from '@/app/commands/paths';
import { FLUTE_CHART } from '@/extensions/air/lib/fingerings';
import { priorClasses } from '@/extensions/air/lib/fingering_prior';
import { AIR } from '../helpers/extensions';

describe('the prior dial', () => {
  it('defaults to the flute chart over its first two octaves, worth ten samples', () => {
    expect(DEFAULT_FINGERING_PRIOR).toEqual({ enabled: true, chart: 'flute', strength: 10, low: 'C4', high: 'C#6' });
    expect(FingeringPriorSettingsSchema.parse({ chart: 'oboe' }).chart).toBe('oboe');
    expect(() => FingeringPriorSettingsSchema.parse({ chart: 'kazoo' })).toThrow();
    // It rides inside the air flute's settings, and an old blob without it heals.
    expect(AirFluteSettingsSchema.parse({ enabled: true }).prior).toEqual(DEFAULT_FINGERING_PRIOR);
  });

  it.runIf(AIR)('is reachable leaf by leaf through the command paths', () => {
    const paths = structuredDialLeaves().map((l) => l.path);
    for (const leaf of ['enabled', 'chart', 'strength', 'low', 'high']) expect(paths).toContain(`airFlute.prior.${leaf}`);
  });

  it('resolves to fuse options, or to nothing when off or unusable', () => {
    const o = priorOptionsFrom(undefined)!;
    expect(o.chart.id).toBe('flute');
    expect(o.range).toEqual([60, 85]);
    expect(o.strength).toBe(10);
    expect(priorOptionsFrom({ enabled: false })).toBeNull();
    expect(priorOptionsFrom({ low: 'G9', high: 'A9' })).toBeNull();
    expect(priorOptionsFrom({ low: 'E5', high: 'C4' })).toBeNull();
    expect(priorOptionsFrom({ low: 'nope' })).toBeNull();
    expect(priorOptionsFrom({ chart: 'whistle-d', low: 'D5', high: 'D6' })!.chart.id).toBe('whistle-d');
  });
});

describe("the flute's finger model", () => {
  it('is the chart alone with nothing enrolled, and nothing at all with the prior off', () => {
    const vocab = emptyVocabulary(FLUTE_FINGER_FEATURES);
    const model = deriveFluteFingerModel(vocab, undefined)!;
    // One class per distinct shape of the default range (the first two octaves).
    expect(model.categories.length).toBe(priorClasses(FLUTE_CHART, { range: ['C4', 'C#6'] }).length);
    expect(model.categories.length).toBeGreaterThan(10);
    expect(model.categories.some((c) => c.label === 'G5')).toBe(true);
    expect(deriveFluteFingerModel(vocab, { enabled: false })).toBeNull();
    expect(deriveFluteFingerModel(vocab, { ...DEFAULT_FINGERING_PRIOR, low: 'D5', high: 'D5' })!.categories.map((c) => c.label)).toEqual(['D5']);
  });

  it('is derived again when the dial changes, and only then', () => {
    let state = { airFlute: { prior: { ...DEFAULT_FINGERING_PRIOR } } };
    const listeners = new Set<(s: typeof state) => void>();
    const store = {
      getState: () => state,
      subscribe: (l: (s: typeof state) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const republish = vi.fn();
    const unsubscribe = startFlutePriorSync(store, { getState: () => ({ republish }) });
    const emit = () => listeners.forEach((l) => l(state));
    state = { airFlute: { prior: { ...DEFAULT_FINGERING_PRIOR } } };
    emit();
    expect(republish).not.toHaveBeenCalled();
    state = { airFlute: { prior: { ...DEFAULT_FINGERING_PRIOR, strength: 20 } } };
    emit();
    expect(republish).toHaveBeenCalledTimes(1);
    emit();
    expect(republish).toHaveBeenCalledTimes(1);
    unsubscribe();
    state = { airFlute: { prior: { ...DEFAULT_FINGERING_PRIOR, strength: 30 } } };
    emit();
    expect(republish).toHaveBeenCalledTimes(1);
  });
});

describe('saved sequences', () => {
  it('ships starters a method book would, and parses a typed list', () => {
    const g = FLUTE_STARTER_SEQUENCES.find((s) => s.name.startsWith('Flute: G major, one'))!;
    expect(g.spec.targets.map((t) => t.label)).toEqual(['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5']);
    expect(FLUTE_STARTER_SEQUENCES.find((s) => s.name.includes('two loops'))!.spec.loops).toBe(2);
    expect(GUITAR_STARTER_SEQUENCES[0].spec.targets.map((t) => t.label)).toEqual(['G', 'C', 'D']);
    expect(new Set(FLUTE_STARTER_SEQUENCES.map((s) => s.id)).size).toBe(FLUTE_STARTER_SEQUENCES.length);
    expect(parseTargets('G, C x2 D\nEm')).toEqual(['G', 'C', 'x2', 'D', 'Em']);
    expect(parseTargets('G Cx2 D')).toEqual(['G', 'C', 'C', 'D']);
    expect(parseTargets('  ')).toEqual([]);
  });

  it('a stored sequence of a starter id replaces the starter', () => {
    const [first, ...rest] = GUITAR_STARTER_SEQUENCES;
    const mine = { ...first, spec: { ...first.spec, loops: 3 }, starter: false };
    const merged = mergeSequences(GUITAR_STARTER_SEQUENCES, [mine]);
    expect(merged.length).toBe(GUITAR_STARTER_SEQUENCES.length);
    expect(merged.find((s) => s.id === first.id)!.spec.loops).toBe(3);
    expect(merged.slice(1).map((s) => s.id)).toEqual(rest.map((s) => s.id));
  });
});
