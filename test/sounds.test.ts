/**
 * Integrity tests for the sound preset registry (the SSOT for sounds).
 * These are pure/headless — they validate the preset *data* (every preset is
 * well-formed, the raw waveforms and defaults exist, ids resolve). The actual
 * Web Audio realization lives in the browser-only `webaudio-synth` node and is
 * verified in the browser.
 */
import { describe, it, expect } from 'vitest';
import {
  SOUNDS,
  SOUND_IDS,
  DEFAULT_SOUND_RIGHT,
  DEFAULT_SOUND_LEFT,
  getSound,
  SoundSchema,
} from '@/music/sounds';

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];

describe('sound registry', () => {
  it('lists every registered id, in registry order', () => {
    expect(SOUND_IDS).toEqual(Object.keys(SOUNDS));
    expect(SOUND_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the four raw oscillator waveforms as ids (backward compatible)', () => {
    for (const id of OSC_TYPES) expect(SOUND_IDS).toContain(id);
  });

  it('every preset is well-formed', () => {
    for (const id of SOUND_IDS) {
      const preset = getSound(id); // widened SoundPreset view (optionals visible)
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
    expect(SOUND_IDS).toContain(DEFAULT_SOUND_RIGHT);
    expect(SOUND_IDS).toContain(DEFAULT_SOUND_LEFT);
  });

  it('getSound resolves ids and falls back to sine for unknown', () => {
    expect(getSound('warmPad')).toBe(SOUNDS.warmPad);
    expect(getSound('does-not-exist')).toBe(SOUNDS.sine);
  });

  it('the zod schema accepts every id and rejects junk', () => {
    for (const id of SOUND_IDS) expect(SoundSchema.safeParse(id).success).toBe(true);
    expect(SoundSchema.safeParse('nope').success).toBe(false);
  });
});
