/**
 * Instrument categories (#249): derived from the parametrization, never stored. Every
 * shipped instrument lands in exactly one group; the Air Drum seed is an air instrument
 * whose theremin voices are silent (so its tooltip and tags describe the drum, not a
 * scale nobody hears); and any theremin becomes an air instrument the moment its air
 * drum is on.
 */
import { describe, it, expect } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { AIR_INSTRUMENTS, INSTRUMENT_CATEGORIES, airInstrumentsOf, categoryOf, groupByCategory } from '@/app/library/category';
import { summarizeInstrument, summaryLines } from '@/app/library/summarize';
import { deriveSystemTags } from '@/app/library/systemTags';

const settingsOf = (name: string) => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`no seed ${name}`);
  return settingsFromLayer(seed.layer);
};

describe('instrument categories', () => {
  it('ships the Air Drum as the one air instrument; every other seed is a theremin', () => {
    const air = SEED_INSTRUMENTS.filter((s) => categoryOf(settingsFromLayer(s.layer)) === 'air').map((s) => s.name);
    expect(air).toEqual(['Air Drum']);
    expect(airInstrumentsOf(settingsOf('Air Drum'))).toEqual(['drum']);
  });

  it('is derived: a theremin with its air drum on is an air instrument', () => {
    const s = settingsOf('Pentatonic');
    expect(categoryOf(s)).toBe('theremin');
    expect(categoryOf({ ...s, airDrum: { ...s.airDrum, enabled: true } })).toBe('air');
  });

  it('groups in category order, keeping the incoming order inside a group, unknown as theremin', () => {
    const cats: Record<string, 'air' | 'theremin' | undefined> = { b: 'air', a: 'theremin', c: undefined, d: 'air' };
    const groups = groupByCategory(['d', 'a', 'b', 'c'], (n) => cats[n]);
    expect(groups.map((g) => g.id)).toEqual(INSTRUMENT_CATEGORIES.map((c) => c.id));
    expect(groups.find((g) => g.id === 'theremin')?.items).toEqual(['a', 'c']);
    expect(groups.find((g) => g.id === 'air')?.items).toEqual(['d', 'b']);
  });

  it('every air instrument has a label and an emoji for its tag', () => {
    for (const a of AIR_INSTRUMENTS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('an air-only instrument describes the air instrument, not the silent voices', () => {
  const sum = summarizeInstrument(settingsOf('Air Drum'));

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
