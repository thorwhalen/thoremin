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
import { dialsStore, settingsForm, setDial, resetDial } from './settingsStore';
import { provideDialsForm } from '@thoremin/sdk-ui/host';

export type { DialsSettings } from '@thoremin/sdk-ui/dials';
import type { DialsSettings } from '@thoremin/sdk-ui/dials';

/** Subscribe a React component to the live dials store. */
export function useDialsSettings(): DialsSettings {
  const state = useSyncExternalStore(dialsStore.subscribe, dialsStore.getState, dialsStore.getState);
  const states = useMemo(() => toFieldStates(settingsForm.fields, state, state.dirty), [state]);
  return { state, form: settingsForm, states, set: setDial, reset: resetDial };
}

// The extension SDK's dials-form seam (`@thoremin/sdk-ui/dials`' `useDialsSettings`).
provideDialsForm({ useSettings: useDialsSettings });

