/**
 * The sound aspects a control can be routed to (moved from the hand map's contract, #600 S17b): the
 * hand map routes a finger to one, the body map a body feature. All are applied in the voice mapping
 * (no synth changes): additive to brightness, vibrato and pan, folded into the pitch for pitchBend and
 * octave, and a gain gate for `gate`. Pure data, shared by core and the body slice.
 */
import { z } from 'zod';

/** The sound aspects a finger can be routed to control. All are applied in the voice
 *  mapping (no synth changes): additive to brightness/vibrato/pan, folded into the
 *  pitch for pitchBend/octave, and a gain gate for `gate`. */
export const EFFECTS = ['brightness', 'vibrato', 'pan', 'pitchBend', 'octave', 'gate'] as const;
export type EffectId = (typeof EFFECTS)[number];

/** Very short effect names for on-canvas cue labels. */
export const EFFECT_SHORT: Record<EffectId, string> = {
  brightness: 'brt',
  vibrato: 'vib',
  pan: 'pan',
  pitchBend: 'bnd',
  octave: 'oct',
  gate: 'gate',
};

/** A route target: an effect, or `none` (nothing driven). */
export type EffectTarget = EffectId | 'none';

/** What a route can drive, for a person: each effect, and `none`. */
export const EFFECT_LABELS: Record<EffectTarget, string> = {
  none: 'Off',
  brightness: 'Brightness',
  vibrato: 'Vibrato',
  pan: 'Pan',
  pitchBend: 'Pitch bend',
  octave: 'Octave',
  gate: 'Gate',
};

/**
 * The modulations the voice mapping applies (its `mods` input; the body route emits them) on top of the finger effects: additive
 * for the finger effects (0 = no change), multiplicative for `gate` and `gain`
 * (1 = no change). The same shape `fingerEffects` produces, plus `gain`.
 */
export type VoiceMods = Record<EffectId, number> & { gain: number };

export const NEUTRAL_MODS: VoiceMods = {
  brightness: 0,
  vibrato: 0,
  pan: 0,
  pitchBend: 0,
  octave: 0,
  gate: 1,
  gain: 1,
};

/** Zod shape of a `mods` port value, so `runHeadless` refuses a partial record. */
export const VoiceModsSchema = z.object({
  brightness: z.number(),
  vibrato: z.number(),
  pan: z.number(),
  pitchBend: z.number(),
  octave: z.number(),
  gate: z.number(),
  gain: z.number(),
});
