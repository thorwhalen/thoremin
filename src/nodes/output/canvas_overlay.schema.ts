/**
 * The canvas overlay's CONTRACT, importable without the overlay's 2,300 lines of drawing code
 * (the `<node>.schema.ts` pattern, #600 S6; started here by S5): its core input ports. The overlay
 * node (`canvas_overlay.ts`) spreads them and adds one port per input of each element an
 * extension contributes (`overlay_contributions.ts`). The air instruments' three ports are not
 * here: they are extension remnants the overlay node still lists itself until S10 moves the drum
 * pads and the breath cue into the air extension.
 */
import type { PortSpec } from '@thoremin/dag';

/** The overlay's core input ports (every overlay has them; an extension's elements add theirs). */
export const OVERLAY_CORE_INPUTS: readonly PortSpec[] = [
  { name: 'hands', kind: 'hands-frame' },
  { name: 'features', kind: 'hand-features' },
  { name: 'params', kind: 'synth-params' },
  { name: 'scale', kind: 'number[]' },
  { name: 'scaleLeft', kind: 'number[]' },
  { name: 'chordScale', kind: 'number[]' },
  { name: 'chord', kind: 'number[]' },
  { name: 'faceFrame', kind: 'face-frame' },
  // The body branch (#186): the latest pose + the model's load state, for the skeleton.
  { name: 'bodyFrame', kind: 'body-frame' },
  { name: 'bodyStatus', kind: 'body-status' },
  // The conductor (#187): its musical time + enable flag, for the beat HUD.
  { name: 'conductorTime', kind: 'musical-time' },
  { name: 'conductorEnabled', kind: 'boolean', default: false },
  // A node's on-screen targets (the chord map's), for the cell grid.
  { name: 'cellGrid', kind: 'cell-grid' },
  { name: 'expression', kind: 'face-expression' },
  // A personal categorizer's per-category degrees (#330 P4), for its bars' chord names.
  { name: 'categoryDegrees', kind: 'category-degrees' },
  { name: 'octaveShift', kind: 'number', default: 0 },
  { name: 'overlayConfig', kind: 'overlay-config' },
  // A classifier's reading and per-class captions, for the category cues.
  { name: 'categories', kind: 'category-scores' },
  { name: 'categoryCaptions', kind: 'string[]' },
  // A player's own learned categories (#384: a saved pose categorizer), drawn by the same cues
  // while the classifier above is not reading. Its own port: two branches can never feed one.
  { name: 'learnedCategories', kind: 'category-scores' },
  // The categorizer that plays chords (#450: a hand-shape or pose categorizer), drawn while
  // neither above is reading. Its own port, for the same reason.
  { name: 'chordCategories', kind: 'category-scores' },
  // The chord that categorizer plays (#491), named and highlighted by `chordName` /
  // `chordGuide` while the chord selector (`chord`: the face, pose and sign chords) is empty.
  // Its own port: the selector's three inputs are taken, and a branch without a face has none.
  { name: 'categorizerChord', kind: 'number[]' },
  // The composed graph's element set (the ADR, §3.2 rule 4): which elements exist for
  // the current instrument. Absent → every element (headless tests, pre-composition).
  { name: 'elements', kind: 'string[]' },
  // Raw feature vectors for the Feature Lab (#119). Additive: the vector nodes
  // tap the existing camFace/cam edges; the lab element normalizes + draws them.
  { name: 'faceVector', kind: 'feature-vector' },
  { name: 'handVector', kind: 'feature-vector' },
  { name: 'bodyVector', kind: 'feature-vector' },
];
