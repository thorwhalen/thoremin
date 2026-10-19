/**
 * The trunk's names: the id every spec implies, and the node ids branches wire to. Kept apart
 * from the branch table (`./branches.ts`), whose trunk branch carries node DEFAULTS and so
 * imports node implementations: an extension wiring to the trunk needs the names only, and
 * this is what the SDK ships (the instruments-as-graphs ADR, §4.4).
 */

/** The trunk branch's id: implied by every spec, never listed as a feature. */
export const TRUNK_ID = 'trunk';

/** Node ids the trunk owns; branches wire to these by name. */
export const TRUNK = {
  cam: 'cam',
  feat: 'feat',
  /** The hand stream with its labels held by the handedness dwell (#314): what the air instruments read. */
  hands: 'dwelled',
  ui: 'ui',
  merge: 'merge',
  synth: 'synth',
  overlay: 'overlay',
} as const;

/**
 * A node another extension's branch may read on an OPTIONAL edge (#600 S15): the song slice's
 * player (#186 PR G), whose `songTime` is the loaded song's musical time. It was the trunk's; now
 * it is present only in a build that lists the song slice, so a reader's edge from it is optional
 * and its node treats a missing time as no song.
 */
export const SONG_PLAYER = 'songPlayer';
