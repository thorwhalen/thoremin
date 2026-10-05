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
  ui: 'ui',
  merge: 'merge',
  synth: 'synth',
  overlay: 'overlay',
} as const;
