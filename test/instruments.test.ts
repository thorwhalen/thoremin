/**
 * Integrity tests for the instrument preset registry (the SSOT for sounds).
 * These are pure/headless — they validate the preset *data* (every preset is
 * well-formed, the raw waveforms and defaults exist, ids resolve). The actual
 * Web Audio realization lives in the browser-only `webaudio-synth` node and is
 * verified in the browser.
 */
import { describe, it, expect } from 'vitest';
import {
  INSTRUMENTS,
  INSTRUMENT_IDS,
  DEFAULT_INSTRUMENT_RIGHT,
  DEFAULT_INSTRUMENT_LEFT,
  getInstrument,
  InstrumentSchema,
} from '@/music/instruments';

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];

describe('instrument registry', () => {
  it('lists every registered id, in registry order', () => {
    expect(INSTRUMENT_IDS).toEqual(Object.keys(INSTRUMENTS));
    expect(INSTRUMENT_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the four raw oscillator waveforms as ids (backward compatible)', () => {
    for (const id of OSC_TYPES) expect(INSTRUMENT_IDS).toContain(id);
  });

  it('every preset is well-formed', () => {
    for (const id of INSTRUMENT_IDS) {
      const preset = getInstrument(id); // widened InstrumentPreset view (optionals visible)
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.partials.length).toBeGreaterThanOrEqual(1);
      for (const part of preset.partials) {
        expect(OSC_TYPES).toContain(part.type);
        if (part.ratio !== undefined) expect(part.ratio).toBeGreaterThan(0);
        if (part.gain !== undefined) expect(part.gain).toBeGreaterThanOrEqual(0);
      }
      if (preset.reverbSend !== undefined) {
        expect(preset.reverbSend).toBeGreaterThanOrEqual(0);
        expect(preset.reverbSend).toBeLessThanOrEqual(1);
      }
    }
  });

  it('defaults are registered ids', () => {
    expect(INSTRUMENT_IDS).toContain(DEFAULT_INSTRUMENT_RIGHT);
    expect(INSTRUMENT_IDS).toContain(DEFAULT_INSTRUMENT_LEFT);
  });

  it('getInstrument resolves ids and falls back to sine for unknown', () => {
    expect(getInstrument('warmPad')).toBe(INSTRUMENTS.warmPad);
    expect(getInstrument('does-not-exist')).toBe(INSTRUMENTS.sine);
  });

  it('the zod schema accepts every id and rejects junk', () => {
    for (const id of INSTRUMENT_IDS) expect(InstrumentSchema.safeParse(id).success).toBe(true);
    expect(InstrumentSchema.safeParse('nope').success).toBe(false);
  });
});
