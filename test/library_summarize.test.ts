/**
 * summarizeInstrument + summaryLines (issue #115), exercised against the REAL shipped
 * instruments (the seed fixtures) so the projection stays true to actual configs, not a
 * hand-built stub. Confirms the scale/voice/control facts each seed encodes and that the
 * tooltip lines show only non-default master tweaks.
 */
import { describe, it, expect } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { layerToSettings } from '@/settings/dials';
import {
  summarizeInstrument,
  summaryLines,
  fingerTargetLabel,
  scaleQualityOf,
  faceModeOf,
} from '@/app/library/summarize';
import type { InstrumentSummary } from '@/app/library/summarize';

const sumOf = (name: string): InstrumentSummary => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`seed not found: ${name}`);
  return summarizeInstrument(layerToSettings(seed.layer));
};

describe('scaleQualityOf / faceModeOf', () => {
  it('maps scale ids to coarse qualities', () => {
    expect(scaleQualityOf('major')).toBe('major');
    expect(scaleQualityOf('minorHarmonic')).toBe('minor');
    expect(scaleQualityOf('pentatonic')).toBe('pentatonicMajor');
    expect(scaleQualityOf('minorPentatonic')).toBe('pentatonicMinor');
  });
  it('collapses face mappings to modes', () => {
    expect(faceModeOf('none')).toBe('none');
    expect(faceModeOf('timbre')).toBe('expression');
    expect(faceModeOf('chord')).toBe('chord');
    expect(faceModeOf('controls')).toBe('pose');
  });
});

describe('summarizeInstrument (seed fixtures)', () => {
  it('the gentle default: index-controlled pentatonic, no face, synced', () => {
    const s = sumOf('Pentatonic');
    expect(s.scaleQuality).toBe('pentatonicMajor');
    expect(s.noteSource).toBe('index');
    expect(s.faceMode).toBe('none');
    expect(s.syncHands).toBe(true);
    expect(s.fingerFx).toEqual([]);
  });

  it('Split Voices: unsynced, major right hand', () => {
    const s = sumOf('Split Voices');
    expect(s.syncHands).toBe(false);
    expect(s.scaleQuality).toBe('major');
  });

  it('Finger FX: wrist-controlled with active finger routing', () => {
    const s = sumOf('Finger FX');
    expect(s.noteSource).toBe('wrist');
    expect(s.fingerFx.length).toBeGreaterThan(0);
  });

  it('Glass Bells maps the face to a chord; Everything to expression/timbre', () => {
    expect(sumOf('Glass Bells').faceMode).toBe('chord');
    expect(sumOf('Everything').faceMode).toBe('expression');
    expect(sumOf('Everything').fingerFx.length).toBeGreaterThan(0);
  });

  it('scaleLabel combines root name + scale name', () => {
    const s = sumOf('Pentatonic');
    expect(s.scaleLabel).toBe(`${s.rootName} ${s.scaleName}`);
  });
});

describe('summaryLines', () => {
  it('omits master rows at their defaults', () => {
    const lines = summaryLines(sumOf('Pentatonic'));
    const labels = lines.map((l) => l.label);
    expect(labels).toContain('Scale');
    expect(labels).toContain('Voices');
    expect(labels).toContain('Notes');
    expect(labels).not.toContain('Volume'); // default master volume
    expect(labels).not.toContain('Octave shift');
  });

  it('shows a non-default master volume (Glass Bells lowers it)', () => {
    const labels = summaryLines(sumOf('Glass Bells')).map((l) => l.label);
    expect(labels).toContain('Volume');
    expect(labels).toContain('Face'); // chord face mode surfaces a Face row
  });

  const voicesOf = (name: string): string =>
    summaryLines(sumOf(name)).find((l) => l.label === 'Voices')?.value ?? '';

  it('shows BOTH sounds when the hands differ, even while synced (no hidden left voice)', () => {
    // Pentatonic: syncHands=true but right=Warm Pad, left=Glass — both must appear.
    const voices = voicesOf('Pentatonic');
    expect(voices).toContain('Warm Pad');
    expect(voices).toContain('Glass');
  });

  it('collapses to one voice when both sounds match', () => {
    // Wrist Theremin: right=left=Warm Pad, synced.
    expect(voicesOf('Wrist Theremin')).toBe('Warm Pad (synced range)');
  });
});

describe('fingerTargetLabel', () => {
  it('humanizes camelCase targets', () => {
    expect(fingerTargetLabel('pitchBend')).toBe('pitch bend');
    expect(fingerTargetLabel('brightness')).toBe('brightness');
  });
});
