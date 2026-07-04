/**
 * Help copy for head-pose `controls` mode (issue #76) — "the few easy moves"
 * that replace "how to fake each emotion". Each entry names a deliberate,
 * near-universally performable move and what it does musically. The list mirrors
 * the axis→music mapping wired in `src/nodes/music/pose_chord.ts`, so this copy
 * cannot drift from the actual instrument.
 */
export interface PoseMove {
  /** The physical move, imperative and concrete. */
  move: string;
  /** What it does to the sound. */
  effect: string;
}

/** The EASY default head-pose instrument, in the order a first-timer meets them:
 *  pick a chord, sound it, then shade it. */
export const POSE_MOVES: PoseMove[] = [
  { move: 'Turn your head left/right', effect: 'picks the chord (sweeps the seven scale chords)' },
  { move: 'Open your mouth', effect: 'sounds the chord — closed is silent, so your jaw plays and rests it' },
  { move: 'Nod up / down', effect: 'shifts the octave (register)' },
  { move: 'Smile / frown', effect: 'brightens / darkens the tone' },
  { move: 'Raise both eyebrows', effect: 'adds the 7th for a richer chord' },
];
