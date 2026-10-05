/**
 * Instrument categories (#249): derived from the parametrization, never stored. Every
 * shipped instrument lands in exactly one group; the Air Drum seed is an air instrument
 * whose theremin voices are silent (so its tooltip and tags describe the drum, not a
 * scale nobody hears); and any theremin becomes an air instrument the moment its air
 * drum is on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import {
  AIR_INSTRUMENTS,
  INSTRUMENT_CLASSES,
  airInstrumentsOf,
  categoryOf,
  groupByCategory,
  normaliseClassId,
} from '@/app/library/category';
import { summarizeInstrument, summaryLines } from '@/app/library/summarize';
import { deriveSystemTags } from '@/app/library/systemTags';
import { AIR } from './helpers/extensions';

const settingsOf = (name: string) => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`no seed ${name}`);
  return settingsFromLayer(seed.layer);
};

describe('instrument categories', () => {
  it.runIf(AIR)('ships one instrument per air instrument, each playing only its own; every other seed is a theremin', () => {
    const air = SEED_INSTRUMENTS.filter((s) => categoryOf(settingsFromLayer(s.layer)) === 'air').map((s) => s.name);
    expect(air).toEqual(['Air Drum', 'Air Bass', 'Air Guitar', 'Air Flute']);
    expect(airInstrumentsOf(settingsOf('Air Drum'))).toEqual(['drum']);
    expect(airInstrumentsOf(settingsOf('Air Bass'))).toEqual(['bass']);
  });

  it('is derived: a theremin with its air drum on is an air instrument', () => {
    const s = settingsOf('Pentatonic');
    expect(categoryOf(s)).toBe('field');
    expect(categoryOf({ ...s, airDrum: { ...s.airDrum, enabled: true } })).toBe('air');
  });

  it('groups in category order, keeping the incoming order inside a group, unknown as theremin', () => {
    const cats: Record<string, 'air' | 'field' | undefined> = { b: 'air', a: 'field', c: undefined, d: 'air' };
    const groups = groupByCategory(['d', 'a', 'b', 'c'], (n) => cats[n]);
    expect(groups.map((g) => g.id)).toEqual(INSTRUMENT_CLASSES.map((c) => c.id));
    expect(groups.find((g) => g.id === 'field')?.items).toEqual(['a', 'c']);
    expect(groups.find((g) => g.id === 'air')?.items).toEqual(['d', 'b']);
  });

  it('every air instrument has a label and an emoji for its tag', () => {
    for (const a of AIR_INSTRUMENTS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe.runIf(AIR)('an air-only instrument describes the air instrument, not the silent voices', () => {
  // Built in beforeAll, not at collection: a skipped suite's body still runs, and a build
  // without the air extension has no 'Air Drum' seed.
  let sum: ReturnType<typeof summarizeInstrument>;
  beforeAll(() => {
    sum = summarizeInstrument(settingsOf('Air Drum'));
  });

  it('summarizes as air with the hand voices off', () => {
    expect(sum.air).toEqual(['drum']);
    expect(sum.handVoices).toBe(false);
    const labels = summaryLines(sum).map((l) => l.label);
    expect(labels[0]).toBe('Air');
    expect(labels).toContain('Hand voices');
    expect(labels).not.toContain('Scale');
    expect(labels).not.toContain('Voices');
  });

  it('tags as the air drum, with no scale or note-source tag', () => {
    const ids = deriveSystemTags(sum).map((t) => t.id);
    expect(ids).toContain('sys:air:drum');
    expect(ids.some((id) => id.startsWith('sys:scale:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('sys:note:'))).toBe(false);
  });

  it('a theremin with a drum added keeps its scale tags and gains the drum tag first', () => {
    const s = settingsOf('Pentatonic');
    const ids = deriveSystemTags(summarizeInstrument({ ...s, airDrum: { ...s.airDrum, enabled: true } })).map((t) => t.id);
    expect(ids[0]).toBe('sys:air:drum');
    expect(ids.some((id) => id.startsWith('sys:scale:'))).toBe(true);
  });
});

describe.runIf(AIR)('an air instrument that plays the scale keeps describing it', () => {
  // Built in beforeAll, not at collection: a skipped suite's body still runs, and a build
  // without the air extension has no 'Air Bass' seed.
  let sum: ReturnType<typeof summarizeInstrument>;
  beforeAll(() => {
    sum = summarizeInstrument(settingsOf('Air Bass'));
  });

  it('shows the scale and range, not the silent voices', () => {
    expect(sum.air).toEqual(['bass']);
    expect(sum.handVoices).toBe(false);
    expect(sum.scaleHeard).toBe(true);
    const labels = summaryLines(sum).map((l) => l.label);
    expect(labels.slice(0, 3)).toEqual(['Air', 'Scale', 'Range']);
    expect(labels).toContain('Hand voices');
    expect(labels).not.toContain('Voices');
  });

  it('tags the bass and its scale, with no note-source tag', () => {
    const ids = deriveSystemTags(sum).map((t) => t.id);
    expect(ids[0]).toBe('sys:air:bass');
    expect(ids).toContain('sys:scale:pentatonicMinor');
    expect(ids.some((id) => id.startsWith('sys:note:'))).toBe(false);
  });
});

describe('instrument classes (the ADR\'s PR 2)', () => {
  it('has unique ids, each with a label, an emoji and a colour', () => {
    const ids = INSTRUMENT_CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of INSTRUMENT_CLASSES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.colour).toMatch(/^hsl\(/);
    }
    expect(ids).toEqual(['field', 'air']);
  });

  it('normalises the former id `theremin` to `field` and rejects unknown ids', () => {
    expect(normaliseClassId('theremin')).toBe('field');
    expect(normaliseClassId('field')).toBe('field');
    expect(normaliseClassId('air')).toBe('air');
    expect(normaliseClassId('brass')).toBeUndefined();
  });
});
