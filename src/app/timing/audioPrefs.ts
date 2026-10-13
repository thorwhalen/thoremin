/**
 * The per-device audio preference (step 4 of the 2026-10-05 timing plan, #240): whether
 * the instrument's audio context asks for the smallest output buffer, `latencyHint: 0`.
 *
 * Why a per-device preference and not an instrument dial. The hint is a property of the
 * machine's audio device, not of a sound: a dial is saved with an instrument and swapped
 * when the player switches one, and the hint only takes effect when the context is
 * created (the first tap), so an instrument switch would flip a setting that does
 * nothing until the next reload. It persists with the other per-device tooling prefs
 * (face calibration, gesture bindings), off by default.
 *
 * What it buys and what guards it. Measured on an M1 Max in Chromium: about 9 ms (base
 * 2.9 + output 23 against 5.8 + 29 under `interactive`). Chromium honours the hint;
 * Firefox has no numeric hint and Safari parses it and ignores it (measured: `baseLatency`
 * 2.9 ms under both), so on those the box changes nothing, and the panel says so. A
 * smaller buffer is one the audio thread can miss, so the status line counts the output's
 * dropouts (`@thoremin/sdk/timing/glitches`) and, with this on, names it as the cause.
 * Turning it on by default is the maintainer's call (#168), not this module's.
 */
import { z } from 'zod';
import { create } from 'zustand';

export const AudioPrefsSchema = z.object({
  /** Ask for `latencyHint: 0` when the audio context is created. */
  lowLatency: z.boolean().default(false),
});
export type AudioPrefs = z.infer<typeof AudioPrefsSchema>;

export const DEFAULT_AUDIO_PREFS: AudioPrefs = Object.freeze(AudioPrefsSchema.parse({}));

/** The hint every context got before #240, and still gets with the box off. */
export const DEFAULT_LATENCY_HINT: AudioContextLatencyCategory = 'interactive';
/** The smallest buffer the platform allows (a number of seconds; 0 = as small as it goes). */
export const LOW_LATENCY_HINT = 0;

/** The `latencyHint` to create the instrument's audio context with. */
export function latencyHintFor(prefs: AudioPrefs): AudioContextLatencyCategory | number {
  return prefs.lowLatency ? LOW_LATENCY_HINT : DEFAULT_LATENCY_HINT;
}

/**
 * Whether this browser honours a numeric hint, from its user agent: Chromium does,
 * Firefox has none, Safari ignores it. A label for the panel, never a gate: the hint is
 * passed either way (an ignored hint is harmless).
 */
export function honoursNumericLatencyHint(userAgent: string): boolean {
  if (/Firefox\//.test(userAgent)) return false;
  return /Chrom(e|ium)\/|Edg\//.test(userAgent);
}

/** A latency hint as the context was given it; null before a context exists. */
export type LatencyHintInEffect = AudioContextLatencyCategory | number | null;

/** The hint the instrument's context was created with, as a store: the status line
 *  re-renders when a context is created (or re-created) with a different hint, which a
 *  module variable could not tell React. Transient, per page: never persisted. */
export const useLatencyHintInEffect = create<{ hint: LatencyHintInEffect }>()(() => ({ hint: null }));

/** The host records the hint the instrument's context was created with (once, when it
 *  creates it), so the status line blames the low-latency box only when it is in force. */
export function noteLatencyHintInEffect(hint: LatencyHintInEffect): void {
  useLatencyHintInEffect.setState({ hint });
}

const currentUserAgent = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

/** Whether `hint` puts the low-latency buffer in force on this browser: it is the low
 *  hint and the browser honours a numeric one. Pure, for a component's selector. */
export function latencyHintInForce(hint: LatencyHintInEffect, userAgent: string = currentUserAgent()): boolean {
  return hint === LOW_LATENCY_HINT && honoursNumericLatencyHint(userAgent);
}

/**
 * Whether the low-latency hint is actually in force: the context was created with it and
 * this browser honours it. Ticking the box without a reload, or on Firefox or Safari,
 * changes nothing, so a glitch there must not be blamed on it.
 */
export function lowLatencyHintInEffect(userAgent: string = currentUserAgent()): boolean {
  return latencyHintInForce(useLatencyHintInEffect.getState().hint, userAgent);
}
