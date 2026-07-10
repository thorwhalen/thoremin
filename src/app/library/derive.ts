/**
 * Instrument -> derived-view bridge: the glue that turns a *saved* instrument (a sparse
 * dials {@link Layer} in the profile store) into the {@link InstrumentSummary} and the
 * {@link SystemTag}s the list renders. Kept apart from the pure `summarize`/`systemTags`
 * modules (which speak only {@link Settings}) because it reaches the dials defaults and
 * the instruments profile store — the one place the library's read side touches them.
 *
 * A saved layer is sparse and may carry the dials UNSET sentinel (a symbol) for keys the
 * user reset; both are resolved by merging the layer over the flat dials defaults and
 * dropping any symbol value, so the projection sees the same EFFECTIVE settings the live
 * engine would — without mutating the live dials store.
 */
import type { Layer } from '@zodal/dials-core';
import { instruments } from '@/app/dials/instruments';
import { thoreminDials, layerToSettings } from '@/settings/dials';
import type { Settings } from '@/settings/schema';
import { summarizeInstrument, type InstrumentSummary } from './summarize';
import { deriveSystemTags, type SystemTag } from './systemTags';

/** The flat dials defaults (every key set), the base a sparse profile layer merges over. */
const DEFAULTS_LAYER = thoreminDials.defaults as Record<string, unknown>;

/**
 * Resolve a saved (sparse, possibly UNSET-bearing) layer to full effective {@link Settings}.
 * UNSET keys (symbols) abstain, so the default wins — matching the dials cascade.
 */
export function settingsFromLayer(layer: Layer): Settings {
  const merged: Record<string, unknown> = { ...DEFAULTS_LAYER };
  for (const [key, value] of Object.entries(layer)) {
    if (typeof value !== 'symbol') merged[key] = value; // skip the UNSET sentinel
  }
  return layerToSettings(merged);
}

/** The derived read-view of one instrument. */
export interface InstrumentDerived {
  summary: InstrumentSummary;
  systemTags: SystemTag[];
}

/** Derive the summary + system tags for one saved instrument, or null if it is gone or
 *  its layer cannot be projected (defensive — a bad instrument never breaks the list). */
export async function deriveForName(name: string): Promise<InstrumentDerived | null> {
  try {
    const layer = await instruments.load(name);
    if (!layer) return null;
    const summary = summarizeInstrument(settingsFromLayer(layer));
    return { summary, systemTags: deriveSystemTags(summary) };
  } catch {
    return null;
  }
}

/** Derive summary + system tags for every named instrument, in parallel. Instruments
 *  that fail to project are simply omitted from the map. */
export async function deriveForNames(names: readonly string[]): Promise<Record<string, InstrumentDerived>> {
  const entries = await Promise.all(
    names.map(async (name) => [name, await deriveForName(name)] as const),
  );
  const out: Record<string, InstrumentDerived> = {};
  for (const [name, derived] of entries) {
    if (derived) out[name] = derived;
  }
  return out;
}
