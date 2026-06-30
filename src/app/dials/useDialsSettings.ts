/**
 * React binding for the dials settings store: subscribes a component to the live
 * store and derives the per-field state. Kept apart from {@link settingsStore} so
 * that module stays framework-agnostic (and unit-testable without React).
 *
 * `form` is value-independent (built once in {@link settingsStore}); `states` is the
 * value-dependent projection (value / dirty / provenance per field), recomputed when
 * the store state changes — the input to Phase-4 dirty indicators.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { toFieldStates } from '@zodal/dials-ui';
import type { SettingFieldState, SettingsForm, SettingsState } from '@zodal/dials-ui';
import type { SettingKey } from '@zodal/dials-core';
import { dialsStore, settingsForm, setDial, resetDial } from './settingsStore';

export interface DialsSettings {
  /** Live store state ({@link SettingsState}): `effective` values, `dirty`, `validation`, … */
  state: SettingsState;
  /** The headless form (field configs + facet groups). */
  form: SettingsForm;
  /** Per-field value-dependent state (value / dirty / provenance). */
  states: Record<SettingKey, SettingFieldState>;
  /** Set one dial in the editable layer. */
  set: (key: SettingKey, value: unknown) => void;
  /** Reset one dial (the defaults re-win). */
  reset: (key: SettingKey) => void;
}

/** Subscribe a React component to the live dials store. */
export function useDialsSettings(): DialsSettings {
  const state = useSyncExternalStore(dialsStore.subscribe, dialsStore.getState, dialsStore.getState);
  const states = useMemo(() => toFieldStates(settingsForm.fields, state, state.dirty), [state]);
  return { state, form: settingsForm, states, set: setDial, reset: resetDial };
}
