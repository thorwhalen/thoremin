/**
 * The `music-context` node's status, mirrored for the panel: a store the status hook writes when
 * what it says changes (the key, the chord, whether it moves or owns the scale), never on every tick.
 * The store, its reporter and the status hook are the shared readout store's
 * (`@thoremin/sdk-ui/statusStore`, #969).
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_MUSIC_CONTEXT_STATUS, MUSIC_CONTEXT_NODE_ID, type MusicContextStatus } from '@thoremin/sdk/context/reading';

export type MusicContextStatusState = StatusState<MusicContextStatus>;

/** What a change worth re-rendering is (the position moves every tick; the panel does not show it). */
const signature = (s: MusicContextStatus) => [s.active, s.source, s.clock, s.moving, s.key, s.chord, s.ownsScale].join('|');

/** The musical context's readout store, reporter and status hook. */
export const MUSIC_CONTEXT_STATUS = createStatusStore(MUSIC_CONTEXT_NODE_ID, { absent: IDLE_MUSIC_CONTEXT_STATUS, keyOf: signature });

export const useMusicContextStatus = MUSIC_CONTEXT_STATUS.useStatus;

/** The per-tick sink: reads the node's status and reports it (to this store by default) when it changed. */
export const makeMusicContextReporter = MUSIC_CONTEXT_STATUS.makeReporter;
