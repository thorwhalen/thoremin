/**
 * The dials settings layer for the DAG app — one reactive `createSettingsStore`
 * over {@link thoreminDials}, plus the one-way sync that keeps the synchronous hot
 * {@link useControls} mirror (the store the DAG reads every tick) in step with it.
 *
 * The settings PANEL writes here (`setDial`/`resetDial`), never to `useControls`
 * directly. On every change we re-derive the nested {@link Settings}
 * ({@link layerToSettings}) and push it into `useControls.applySettings`, so the
 * audio graph hears edits live (synchronously — the tick loop never awaits). The
 * store is seeded FROM the current (persisted) hot state, so a returning player's
 * choices are already in the panel. `recordingFormats` is a tooling pref outside the
 * dials schema and stays on `useControls`.
 *
 * Framework-agnostic on purpose: the React binding lives in {@link useDialsSettings},
 * so this module imports no React and stays unit-testable. Named "instruments"
 * (Phase 4) are sparse dials {@link Layer}s loaded via `dialsStore.setLayer`.
 */
import { createSettingsStore, toSettingsForm } from '@zodal/dials-ui';
import type { SettingFieldConfig, SettingsForm } from '@zodal/dials-ui';
import type { SettingKey } from '@zodal/dials-core';
import { thoreminDials, settingsToLayer, layerToSettings } from '@/settings/dials';
import { useControls, toSettings } from '../store';

/** The headless form (field configs + facet groups) — value-independent, built once. */
export const settingsForm: SettingsForm = toSettingsForm(thoreminDials);

/** Field config by key, for the renderer's by-key lookups (the layout is bespoke,
 *  so the panel pulls each field's label / bounds / enum values by key). */
export const fieldByKey: Record<string, SettingFieldConfig> = Object.fromEntries(
  settingsForm.fields.map((f) => [f.key, f]),
);

/** The live editing store, seeded from the current (persisted) hot control state. */
export const dialsStore = createSettingsStore(thoreminDials, {
  layer: settingsToLayer(toSettings(useControls.getState())),
});

/**
 * One-way sync dials → hot store. Every dials edit re-derives the nested Settings
 * and applies it to `useControls`. Guarded: a value the nested schema can't parse
 * (an invalid intermediate state, e.g. an out-of-range value) is skipped rather than
 * thrown inside a subscriber, so the hot mirror is never left half-applied and the
 * tick loop is never interrupted — the dials `validation` surface reports such states
 * to the UI instead.
 *
 * The sync-hands mirror (when synced, the left voice tracks the right except its own
 * sound) is applied at the panel's write site, so the dials layer's `left.*` already
 * equals `right.*`; `applySettings` then sets both hands directly, matching how
 * loading a preset works.
 */
dialsStore.subscribe(() => {
  try {
    const settings = layerToSettings(dialsStore.getState().effective);
    useControls.getState().applySettings(settings);
  } catch {
    // invalid intermediate state — keep the hot mirror on its last good value
  }
});

/** Set one dial in the editable layer. */
export const setDial = (key: SettingKey, value: unknown): void => dialsStore.set(key, value);
/** Reset one dial (a lower scope — the defaults — re-wins). */
export const resetDial = (key: SettingKey): void => dialsStore.reset(key);

/** The voice fields mirrored between hands when synced. `sound` is never mirrored —
 *  each hand keeps its own timbre. Includes the #63 octave-range fields, so the
 *  double-thumb slider mirrors across hands like octaves/baseOctave do. */
const MIRRORED_VOICE_FIELDS = ['root', 'type', 'octaves', 'baseOctave', 'rangeLow', 'rangeHigh'] as const;

/** A field of one voice (the addressable keys under `right.` / `left.`). */
export type VoiceField = 'root' | 'type' | 'octaves' | 'baseOctave' | 'sound' | 'rangeLow' | 'rangeHigh';

/**
 * The dials-layer writes for one voice edit, reproducing the hot store's `setVoice`
 * sync-hands rule exactly: the addressed field is written, and when the hands are
 * synced the addressed hand's FULL non-sound voice is mirrored onto the other hand
 * (which keeps its own sound). Mirroring the whole voice — not just the edited field
 * — means a single edit re-converges the hands even if a prior un-sync/edit had left
 * them diverged, matching `setVoice` (src/app/store.ts). Pure, so it is unit-tested
 * directly (the panel just applies the returned writes in order).
 */
export function voiceEditWrites(
  side: 'right' | 'left',
  key: VoiceField,
  value: unknown,
  synced: boolean,
  effective: Record<string, unknown>,
): Array<[string, unknown]> {
  const writes: Array<[string, unknown]> = [[side + '.' + key, value]];
  if (synced) {
    const other = side === 'right' ? 'left' : 'right';
    for (const f of MIRRORED_VOICE_FIELDS) {
      writes.push([other + '.' + f, f === key ? value : effective[side + '.' + f]]);
    }
  }
  return writes;
}
