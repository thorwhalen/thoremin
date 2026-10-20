/**
 * A cell grid: labelled on-screen targets a hand points at (the chord map's hexagons, its
 * melody ladder), as data a node emits and the overlay draws. Generic on purpose, like the
 * overlay's category cues: the overlay names no instrument, and any node that turns a hand's
 * position on the screen into a choice can show its targets by emitting one of these to its own
 * overlay element (#600 S5; the chord map's and the chord wheel's draw them through
 * `./cell_grid_draw`).
 *
 * Coordinates are fractions of the DISPLAYED, mirrored frame (the overlay canvas), the air
 * drum pads' convention: the emitting node mirrors a hand's x itself.
 *
 * Pure: Zod only.
 */
import { z } from 'zod';

export const GRID_CELL_SHAPES = ['hex', 'rect'] as const;
/** `idle`: a target; `candidate`: the hand is over it and it has not taken over yet;
 *  `active`: the choice in force (sounding). */
export const GRID_CELL_STATES = ['idle', 'candidate', 'active'] as const;
/** A cell's emphasis beyond its state: `home` (the key's tonic on a map that keeps its place
 *  across keys), `changed` (its target changed a moment ago: a modulation relit it). */
export const GRID_CELL_MARKS = ['home', 'changed'] as const;

export const GridCellSchema = z.object({
  /** Centre, fractions of the displayed frame. */
  x: z.number(),
  y: z.number(),
  /** Size, fractions of the displayed frame: a hex's width across its flats and its height
   *  point to point (pointy-top), a rect's sides. */
  w: z.number(),
  h: z.number(),
  shape: z.enum(GRID_CELL_SHAPES),
  /** The big text (a chord name, a note name). */
  label: z.string(),
  /** The small text under it (a Roman numeral), '' for none. */
  sub: z.string().default(''),
  /** CSS colour of the label and the outline. */
  color: z.string(),
  state: z.enum(GRID_CELL_STATES).default('idle'),
  mark: z.enum(GRID_CELL_MARKS).optional(),
});
export type GridCell = z.infer<typeof GridCellSchema>;

/** A short text placed on the grid (what a move to a neighbour does). */
export const GridCaptionSchema = z.object({ x: z.number(), y: z.number(), text: z.string() });
export type GridCaption = z.infer<typeof GridCaptionSchema>;

/** A ghost trail (#713): the way a path goes on from here, drawn faintly over the cells, each
 *  point numbered in order; `from` is where it starts (the cell in force), not numbered. */
export const GridTrailSchema = z.object({
  points: z.array(z.object({ x: z.number(), y: z.number() })),
  from: z.object({ x: z.number(), y: z.number() }).optional(),
  color: z.string().default('#ffffff'),
  /** What the trail is (an idiom's name), shown by its first point; '' for none. */
  label: z.string().default(''),
});
export type GridTrail = z.infer<typeof GridTrailSchema>;

export const CellGridSchema = z.object({
  cells: z.array(GridCellSchema),
  captions: z.array(GridCaptionSchema).default([]),
  /** Ghost trails, drawn under the captions; absent for none (additive, #713). */
  trails: z.array(GridTrailSchema).optional(),
  /** Where each pointing hand is, so the player sees the point that chooses. */
  pointers: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
});
export type CellGrid = z.infer<typeof CellGridSchema>;

export const EMPTY_CELL_GRID: CellGrid = { cells: [], captions: [], pointers: [] };
