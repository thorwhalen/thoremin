/**
 * The dial write path and the dials form, for an extension's panels: the same three
 * dispatchers core's panels use (`src/app/dispatchDial.ts` implements them; the write-path
 * guard reads these names), reached through the host. See `./host.ts`.
 */
import type { SettingKey } from '@zodal/dials-core';
import type { SettingFieldState, SettingsForm, SettingsState } from '@zodal/dials-ui';
import { dials, dialsForm } from './host';

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

/** Dispatch `dial.set` for a discrete panel write on a SCALAR dial. */
export const dispatchDialSet = (key: string, value: unknown): void => dials().set(key, value);
/** Dispatch `dial.setIn` for one scalar leaf of a structured dial, by dotted path. */
export const dispatchDialSetIn = (path: string, value: unknown): void => dials().setIn(path, value);
/** Dispatch several dial writes atomically. */
export const dispatchDialPatch = (writes: ReadonlyArray<readonly [string, unknown]>): void => dials().patch(writes);
/** Subscribe a React component to the live dials store. */
export const useDialsSettings = (): DialsSettings => dialsForm().useSettings();
