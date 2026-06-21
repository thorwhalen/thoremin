/**
 * Instrument presets — the single source of truth for the sounds Thoremin can
 * play. Each preset is a declarative recipe (additive oscillator partials +
 * optional filter, vibrato, amplitude envelope and reverb send) that the
 * browser `webaudio-synth` node realizes into a Web Audio voice graph, and that
 * the UI lists by `name`. The `instrument` field on a synth voice is one of
 * these ids ({@link InstrumentId}); adding a richer sound means adding an entry
 * here (open/closed) — no other module needs to change.
 *
 * The four raw oscillator waveforms (sine/triangle/square/sawtooth) are kept as
 * presets so existing graphs/tests that name them still resolve.
 */
import { z } from 'zod';

/** The Web Audio oscillator shapes a partial can use. */
export type OscType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** One additive oscillator within a preset, tuned relative to the fundamental. */
export interface Partial {
  readonly type: OscType;
  /** Frequency multiple of the fundamental (1 = unison, 2 = octave up). Default 1. */
  readonly ratio?: number;
  /** Detune in cents (for chorus/width). Default 0. */
  readonly detuneCents?: number;
  /** Relative level of this partial, 0..1. Default 1. */
  readonly gain?: number;
}

/** A complete, declarative instrument timbre. */
export interface InstrumentPreset {
  /** Human label for the UI. */
  readonly name: string;
  /** Additive oscillators summed to form the tone — non-empty by construction,
   * so `as const satisfies` rejects a partial-less preset at authoring time. */
  readonly partials: readonly [Partial, ...Partial[]];
  /** Optional tone-shaping filter applied to the summed partials. */
  readonly filter?: { readonly type: 'lowpass' | 'highpass' | 'bandpass'; readonly cutoff: number; readonly q?: number };
  /** Optional pitch vibrato (LFO on detune). */
  readonly vibrato?: { readonly rateHz: number; readonly depthCents: number };
  /** Amplitude glide-up time constant when a note starts (s). Default 0.02. */
  readonly attack?: number;
  /** Amplitude glide-down time constant when a note ends (s). Default 0.08. */
  readonly release?: number;
  /** Dry/wet send to the shared reverb, 0..1. Default 0 (dry). */
  readonly reverbSend?: number;
  /** Overall level trim for the preset, 0..1. Default 1. */
  readonly gain?: number;
}

/**
 * The preset registry. Keys are the stable instrument ids; values are the
 * recipes. Declared with `satisfies` (not an annotation) so {@link InstrumentId}
 * stays a literal union of the keys.
 */
export const INSTRUMENTS = {
  // --- Raw waveforms (classic, also the backward-compatible ids) -----------
  sine: { name: 'Sine', partials: [{ type: 'sine' }] },
  triangle: { name: 'Triangle', partials: [{ type: 'triangle' }] },
  square: {
    name: 'Square',
    partials: [{ type: 'square' }],
    filter: { type: 'lowpass', cutoff: 3500, q: 0.7 },
    gain: 0.85,
  },
  sawtooth: {
    name: 'Sawtooth',
    partials: [{ type: 'sawtooth' }],
    filter: { type: 'lowpass', cutoff: 4000, q: 0.7 },
    gain: 0.85,
  },

  // --- Richer, "nice" instruments ------------------------------------------
  warmPad: {
    name: 'Warm Pad',
    partials: [
      { type: 'sawtooth', detuneCents: -7 },
      { type: 'sawtooth', detuneCents: 7 },
      { type: 'sine', ratio: 0.5, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 0.6 },
    attack: 0.18,
    release: 0.28,
    reverbSend: 0.35,
    gain: 0.8,
  },
  glass: {
    name: 'Glass',
    partials: [
      { type: 'sine' },
      { type: 'sine', ratio: 2, gain: 0.35 },
      { type: 'sine', ratio: 3, gain: 0.12 },
    ],
    attack: 0.01,
    release: 0.4,
    reverbSend: 0.4,
    gain: 0.9,
  },
  bell: {
    name: 'Bell',
    partials: [
      { type: 'sine' },
      { type: 'sine', ratio: 2.0, gain: 0.5 },
      { type: 'sine', ratio: 3.01, gain: 0.28 },
      { type: 'sine', ratio: 4.2, gain: 0.12 },
    ],
    attack: 0.005,
    release: 0.5,
    reverbSend: 0.3,
    gain: 0.8,
  },
  organ: {
    name: 'Organ',
    partials: [
      { type: 'sine' },
      { type: 'sine', ratio: 2, gain: 0.5 },
      { type: 'sine', ratio: 3, gain: 0.33 },
      { type: 'sine', ratio: 4, gain: 0.2 },
    ],
    attack: 0.02,
    release: 0.06,
    reverbSend: 0.15,
    gain: 0.7,
  },
  voice: {
    name: 'Voice',
    partials: [{ type: 'sawtooth' }],
    filter: { type: 'lowpass', cutoff: 1300, q: 3 },
    vibrato: { rateHz: 5.5, depthCents: 14 },
    attack: 0.08,
    release: 0.15,
    reverbSend: 0.3,
    gain: 0.85,
  },
  softLead: {
    name: 'Soft Lead',
    partials: [
      { type: 'triangle' },
      { type: 'square', gain: 0.25, detuneCents: 5 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 0.8 },
    vibrato: { rateHz: 5, depthCents: 6 },
    attack: 0.03,
    release: 0.12,
    reverbSend: 0.18,
    gain: 0.8,
  },
} as const satisfies Record<string, InstrumentPreset>;

/** A valid instrument id (literal union of {@link INSTRUMENTS} keys). */
export type InstrumentId = keyof typeof INSTRUMENTS;

/** All instrument ids, registry order (UI lists them in this order). */
export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

/** Default timbres — pleasant, forgiving, and distinct per hand. */
export const DEFAULT_INSTRUMENT_RIGHT: InstrumentId = 'warmPad';
export const DEFAULT_INSTRUMENT_LEFT: InstrumentId = 'glass';

/** Resolve an id to its preset, falling back to a pure sine for unknown ids. */
export function getInstrument(id: string): InstrumentPreset {
  return (INSTRUMENTS as Record<string, InstrumentPreset>)[id] ?? INSTRUMENTS.sine;
}

/** Zod schema accepting any registered instrument id. */
export const InstrumentSchema = z.enum(INSTRUMENT_IDS as [InstrumentId, ...InstrumentId[]]);
