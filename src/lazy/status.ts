/**
 * The shared status vocabulary every lazily-loaded heavy resource speaks (#188).
 *
 * Three nodes already report a lifecycle phase on a port so the UI can be honest
 * about *why* they are silent: `webcam-face` (`idle | loading | ready | error`),
 * `midi-out` (`off | unsupported | connecting | ready | no-ports | denied | error`)
 * and the recording formats (a null blob plus an error). Each invented its own
 * words. This module is the one vocabulary the next heavy node uses instead, and
 * what one shared readout component renders — see `docs/design/lazy-loading.md`.
 *
 * Node-specific detail lives in `reason`, never in a new phase: a blocked MIDI
 * permission and a missing API key are both `unavailable`, with reasons `denied`
 * and `no-key`, so a UI that has never heard of the node still knows to show the
 * reason instead of a dead toggle.
 */

/** Where a heavy resource is in its life. Ordered roughly as a player meets them. */
export type LoadPhase =
  /** Not requested: nothing loaded, nothing held. The enable control is off. */
  | 'off'
  /** Requested, but this host cannot provide it. `reason` says why, actionably. */
  | 'unavailable'
  /** The implementation (SDK, model, wasm, session) is being fetched or opened. */
  | 'loading'
  /** Loaded and usable; idle. */
  | 'ready'
  /** Loaded and doing its job right now (playing, sending, detecting). */
  | 'active'
  /** The load or the resource failed. A later disable + enable retries. */
  | 'error';

/** What a heavy node reports on its `status` port each tick. */
export interface LoadStatus {
  phase: LoadPhase;
  /** Short, human-readable explanation of the phase, always present. */
  message: string;
  /** Machine-readable cause for `unavailable` / `error` (`no-key`, `denied`, `unsupported`, …). */
  reason?: string;
  /** 0..1 while `loading`, when the loader can report it (a multi-megabyte download). */
  progress?: number;
}

/** A `ready` status becomes `active` while the node is doing its job; anything else is
 *  returned unchanged. Keeps "is it working" a one-line composition in `process()`. */
export function withActive(status: LoadStatus, active: boolean, activeMessage?: string): LoadStatus {
  if (status.phase !== 'ready' || !active) return status;
  return { ...status, phase: 'active', message: activeMessage ?? status.message };
}
