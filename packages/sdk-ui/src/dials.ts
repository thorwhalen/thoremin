/**
 * The dial write path and the dials form, for an extension's panels: the same three
 * dispatchers core's panels use (`src/app/dispatchDial.ts` implements them; the write-path
 * guard reads these names), reached through the host. See `./host.ts`.
 */
import { dials, dialsForm, type DialsSettings } from './host';

/** The live dials form a panel reads: declared beside the seam that provides it (`./host`). */
export type { DialsSettings } from './host';

/** Dispatch `dial.set` for a discrete panel write on a SCALAR dial. */
export const dispatchDialSet = (key: string, value: unknown): void => dials().set(key, value);
/** Dispatch `dial.setIn` for one scalar leaf of a structured dial, by dotted path. */
export const dispatchDialSetIn = (path: string, value: unknown): void => dials().setIn(path, value);
/** Dispatch several dial writes atomically. */
export const dispatchDialPatch = (writes: ReadonlyArray<readonly [string, unknown]>): void => dials().patch(writes);
/** Subscribe a React component to the live dials store. */
export const useDialsSettings = (): DialsSettings => dialsForm().useSettings();
